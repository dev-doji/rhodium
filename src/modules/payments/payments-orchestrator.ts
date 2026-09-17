import type { Repositories } from "../../db/repositories.js";
import type { RailRegistry } from "../../rails/registry.js";
import type { EventBus } from "../../events/bus.js";
import type { PaymentInstruction, PaymentRail, WebhookPayload } from "../../rails/types.js";
import type { Merchant, Payment, RailId } from "../../domain/types.js";
import { isAnomalyStatus } from "../../domain/types.js";
import type { Clock } from "../../lib/clock.js";
import type { Metrics } from "../metrics/metrics.js";
import type { AuditService } from "../audit/audit-service.js";
import { id } from "../../lib/ids.js";
import { NotFoundError, ConflictError, ValidationError } from "../../lib/errors.js";
import { assertTransition } from "../../domain/order-state.js";
import { withinTolerance } from "../../lib/fx.js";
import { logger } from "../../lib/logger.js";

const log = logger("payments");

/**
 * Payments Orchestrator (§2.1, §2.5) — the magic moment. Issues a DVA per order,
 * auto-reconciles the incoming transfer to the order, and drives the order to
 * `paid`, then emits `order.paid` for the downstream chain (receipt + ledger).
 *
 * Idempotency has TWO layers so a replayed/duplicated webhook can never
 * double-count: (1) short-circuit if the payment is already confirmed;
 * (2) the event bus dedupes `order.paid` on the provider event's stable key.
 */
export class PaymentsOrchestrator {
  constructor(
    private repos: Repositories,
    private rails: RailRegistry,
    private bus: EventBus,
    private clock: Clock,
    private metrics: Metrics,
    private audit: AuditService,
  ) {}

  /**
   * The name on a bank account, when the active rail can tell us.
   *
   * The result distinguishes three outcomes, because collapsing them is a bug:
   *   unsupported — the rail has no resolver, so nothing was checked
   *   not found   — the rail checked and the account does not exist
   *   the name    — the rail checked and it does
   *
   * "Could not check" must not be treated as "does not exist": doing so would
   * make every merchant re-enter a perfectly good account number whenever the
   * configured provider happens not to offer resolution.
   */
  async resolveBankAccount(
    bankCode: string,
    accountNumber: string,
  ): Promise<{ supported: boolean; name: string | null }> {
    const rail = this.rails.fiat() as PaymentRail & {
      resolveAccount?: (b: string, a: string) => Promise<string | null>;
    };
    if (typeof rail.resolveAccount !== "function") return { supported: false, name: null };
    return { supported: true, name: await rail.resolveAccount(bankCode, accountNumber) };
  }

  /**
   * Make sure a merchant can actually be paid on the active bank rail.
   *
   * Some processors need a per-merchant payout account before they will route
   * money to them; Paystack calls it a subaccount. Without it the rail either
   * refuses the payment or — worse — settles into the platform's own balance,
   * which is custody. This is the one place that gap gets closed, and it is
   * idempotent so it can be called at onboarding and again as a repair.
   *
   * Returns the code, or null when the active rail needs no such thing (as
   * Monnify does not).
   */
  async ensurePayoutAccount(merchant: Merchant): Promise<string | null> {
    if (merchant.processorSubaccountCode) return merchant.processorSubaccountCode;

    const rail = this.rails.fiat() as PaymentRail & {
      createSubaccount?: (m: Merchant) => Promise<string>;
    };
    if (typeof rail.createSubaccount !== "function") return null;

    const code = await rail.createSubaccount(merchant);
    await this.repos.merchants.update(merchant.id, { processorSubaccountCode: code });
    return code;
  }

  /**
   * Issue a payment instruction for an order. `railId` picks a specific rail
   * (e.g. 'onswitch' for crypto→naira, 'quai' for crypto→wallet); otherwise the
   * order's kind decides (fiat → Monnify, crypto → Quai).
   */
  async requestPayment(orderId: string, railId?: RailId): Promise<PaymentInstruction> {
    const order = await this.repos.orders.byId(orderId);
    if (!order) throw new NotFoundError("order", { id: orderId });
    const merchant = await this.repos.merchants.byId(order.merchantId);
    if (!merchant) throw new NotFoundError("merchant", { id: order.merchantId });

    const existing = await this.repos.payments.byOrderId(orderId);
    if (existing) {
      const rail = this.rails.get(existing.railId);
      // Only the Quai rail's instruction is deterministic + side-effect-free, so
      // it's safe to recompute for the checkout page. Others (DVA, off-ramp) have
      // side effects on create — return the stored view instead of re-issuing.
      if (rail.id === "quai") {
        return rail.createPaymentInstruction(order, merchant);
      }
      return {
        railId: existing.railId,
        instructionType: existing.instructionType,
        providerRef: existing.providerRef,
        amount: existing.amount,
        ...(await this.recreateInstructionView(rail, existing)),
      };
    }

    // Route: explicit railId wins; else the order's kind, and for a crypto
    // order the merchant's own choice of being paid in naira or in USDC.
    const rail = railId
      ? this.rails.get(railId)
      : this.rails.forKind(order.rail, merchant.cryptoSettlement);
    // Look the buyer up: order.buyerRef is an internal id, and a processor
    // handed that as a "phone" records nonsense against a real payment.
    const buyer = await this.repos.buyers.byId(order.buyerRef).catch(() => null);
    const instruction = await rail.createPaymentInstruction(order, merchant, {
      phone: buyer?.phoneOrRef,
      name: buyer?.name,
    });

    await this.repos.payments.create({
      id: id("pay"),
      orderId: order.id,
      railId: rail.id,
      providerRef: instruction.providerRef,
      instructionType: instruction.instructionType,
      amount: order.amount,
      status: "pending",
      // Snapshot the provider's answer. Issuing a DVA has side effects, so the
      // checkout page must never re-issue one just to redraw the screen.
      instructionJson: JSON.stringify(instruction),
    });

    if (order.status === "draft") {
      assertTransition(order.status, "awaiting_payment");
      await this.repos.orders.updateStatus(order.id, "awaiting_payment");
    }
    this.metrics.increment("payment_instruction_issued");
    log.info({ orderId, providerRef: instruction.providerRef }, "DVA issued");
    return instruction;
  }

  /** Entry point for provider webhooks — verifies, matches, confirms. */
  async handleRailWebhook(railId: RailId, raw: WebhookPayload): Promise<void> {
    const rail = this.rails.get(railId);
    const event = await rail.handleWebhook(raw);
    this.metrics.increment("webhook_received");

    if (event.status === "ignored") {
      log.info({ providerRef: event.providerRef }, "webhook ignored");
      return;
    }
    if (event.status === "failed") {
      await this.markFailed(event.providerRef, "provider reported failure");
      return;
    }
    await this.confirmByProviderRef(
      event.providerRef,
      event.amount,
      event.idempotencyKey,
      event.recipient,
    );
  }

  /** Poll fallback (§2.5) for a webhook that never arrived. */
  async reconcileByPolling(providerRef: string): Promise<boolean> {
    const payment = await this.repos.payments.byProviderRef(providerRef);
    if (!payment) throw new NotFoundError("payment", { providerRef });
    if (payment.status === "confirmed") return true;
    const rail = this.rails.get(payment.railId);
    const status = await rail.verifyPayment(providerRef);
    this.metrics.increment("verify_poll");
    if (status.status === "confirmed") {
      // Key on the PROVIDER's transaction where it gives us one. A dedicated
      // account is reused across orders, so `poll:<account>:<payment>` would
      // let a single real transfer confirm a second order on the same account.
      const key = status.rawEventId
        ? `${payment.railId}:${status.rawEventId}`
        : `poll:${providerRef}:${payment.id}`;
      await this.confirmByProviderRef(providerRef, status.amount, key, status.recipient);
      return true;
    }
    return false;
  }

  /**
   * The single confirmation path used by BOTH webhook and poll. Idempotent.
   */
  private async confirmByProviderRef(
    providerRef: string,
    amount: number | undefined,
    idempotencyKey: string,
    recipient?: string,
  ): Promise<void> {
    // Match the PENDING payment for this account. Live DVAs are per-customer
    // and reused, so there may be older confirmed payments on the same ref.
    const payment = await this.repos.payments.findPendingByProviderRef(providerRef);
    if (!payment) {
      const any = await this.repos.payments.byProviderRef(providerRef);
      if (any?.status === "confirmed") {
        // Layer 1: nothing pending + a confirmed exists => duplicate delivery.
        this.metrics.increment("webhook_duplicate");
        log.info({ providerRef, paymentId: any.id }, "duplicate confirm dropped");
        return;
      }
      if (any && isAnomalyStatus(any.status)) {
        // Already recorded as an anomaly and awaiting review. Providers retry,
        // so this arrives repeatedly; re-recording it would spam the audit log
        // and a throw here would keep the retries coming forever.
        this.metrics.increment("webhook_duplicate");
        log.info(
          { providerRef, paymentId: any.id, status: any.status },
          "duplicate anomaly delivery dropped",
        );
        return;
      }
      log.warn({ providerRef }, "confirmation for unknown providerRef");
      return;
    }
    // Amount integrity: fiat must match to the kobo; crypto allows a small FX
    // round-trip tolerance (the on-chain stablecoin amount reconverted to kobo).
    const rail = this.rails.get(payment.railId);
    // 150bps exists for a VOLATILE token, where the price moves between quoting
    // and settling. A stablecoin is pegged, so the same slack would let a real
    // underpayment through — 50bps covers only rounding at 6 decimals.
    const toleranceBps =
      rail.kind !== "crypto" ? 0 : rail.id === "evm_stable" ? 50 : 150;
    if (amount != null && !withinTolerance(amount, payment.amount, toleranceBps)) {
      // The buyer's money moved, just not in the amount we quoted. Recording it
      // beats throwing: a throw left the payment pending forever with nothing
      // anywhere saying funds had arrived, and made the provider retry the same
      // rejected webhook indefinitely.
      await this.recordAnomaly(
        payment,
        amount < payment.amount ? "underpaid" : "overpaid",
        { expected: payment.amount, received: amount },
      );
      return;
    }

    const order = await this.repos.orders.byId(payment.orderId);
    if (!order) throw new NotFoundError("order", { id: payment.orderId });
    if (order.status !== "awaiting_payment" && order.status !== "draft") {
      throw new ConflictError(`order ${order.id} not payable in ${order.status}`);
    }

    // Recipient integrity. Proving that an order id was paid is NOT proving the
    // merchant was paid: on a chain rail the payer names the recipient in the
    // call, so a buyer could pay their own wallet, quote the real transaction
    // hash, and take the goods for the price of gas. Compare against the
    // address the buyer was actually quoted, falling back to the merchant's
    // wallet for rows written before instructions were snapshotted.
    if (recipient) {
      const quoted =
        this.quotedRecipient(payment) ??
        (await this.repos.merchants.byId(order.merchantId))?.quaiAddress;
      if (!quoted || recipient.toLowerCase() !== quoted.toLowerCase()) {
        this.metrics.increment("payment_recipient_mismatch");
        await this.audit.record({
          actor: "system",
          action: "payment.recipient_mismatch",
          entity: "payment",
          entityId: payment.id,
          metadata: { orderId: order.id, expected: quoted ?? null, received: recipient },
        });
        throw new ValidationError("payment went to an unexpected recipient", {
          expected: quoted ?? null,
          received: recipient,
        });
      }
    }

    // Expiry, checked only once the funds are known to have reached the
    // merchant. The quote had a shelf life and the money arrived after it; on a
    // crypto order the stablecoin amount was priced when the order was made, so
    // honouring a stale quote pays her at whatever the rate was then. Recorded
    // rather than rejected: the transfer already happened, and a payment nobody
    // wrote down is worse than one flagged for review.
    if (order.expiresAt && this.clock.now() > order.expiresAt) {
      await this.recordAnomaly(payment, "expired", {
        orderId: order.id,
        expiresAt: order.expiresAt.toISOString(),
        receivedAt: this.clock.now().toISOString(),
        received: amount ?? null,
      });
      return;
    }

    const now = this.clock.now();
    await this.repos.payments.markConfirmed(payment.id, now);
    assertTransition(order.status, "paid");
    await this.repos.orders.updateStatus(order.id, "paid");
    await this.repos.buyers.incrementOrderCount(order.buyerRef);

    await this.audit.record({
      actor: "system",
      action: "payment.confirmed",
      entity: "payment",
      entityId: payment.id,
      metadata: { orderId: order.id, amount: payment.amount },
    });
    this.metrics.increment("payment_confirmed");

    // Layer 2: downstream chain is deduped by the provider event's stable key.
    await this.bus.publish(idempotencyKey, {
      name: "order.paid",
      orderId: order.id,
      paymentId: payment.id,
      merchantId: order.merchantId,
      railId: payment.railId,
      amount: payment.amount,
      providerRef,
      occurredAt: now.toISOString(),
    });
  }

  private async markFailed(providerRef: string, reason: string): Promise<void> {
    const payment = await this.repos.payments.byProviderRef(providerRef);
    if (!payment || payment.status === "confirmed") return;
    await this.repos.payments.updateStatus(payment.id, "failed");
    this.metrics.increment("payment_failed");
    await this.bus.publish(`failed:${providerRef}`, {
      name: "payment.failed",
      orderId: payment.orderId,
      paymentId: payment.id,
      reason,
      occurredAt: this.clock.now().toISOString(),
    });
  }

  /**
   * Record money that arrived on terms we cannot accept, and stop.
   *
   * Terminal for this payment: the order is NOT credited and the ledger is not
   * touched, so nothing downstream treats the sale as complete. Resolving it is
   * a human decision (refund, top-up, honour the stale quote) — see the refund
   * and dispute model, which is still an open product question.
   */
  private async recordAnomaly(
    payment: Payment,
    status: "underpaid" | "overpaid" | "expired",
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.repos.payments.updateStatus(payment.id, status);
    this.metrics.increment(`payment_${status}`);
    await this.audit.record({
      actor: "system",
      action: `payment.${status}`,
      entity: "payment",
      entityId: payment.id,
      metadata,
    });
    log.warn(
      { paymentId: payment.id, orderId: payment.orderId, status, ...metadata },
      "payment recorded as an anomaly — order not credited, awaiting review",
    );
  }

  /** The recipient address the buyer was quoted, from the instruction snapshot. */
  private quotedRecipient(payment: Payment): string | undefined {
    if (!payment.instructionJson) return undefined;
    try {
      return (JSON.parse(payment.instructionJson) as PaymentInstruction).merchantAddress;
    } catch {
      return undefined;
    }
  }

  /** Rebuild the buyer-facing DVA view for an idempotent re-request. */
  /**
   * Re-present a previously issued instruction.
   *
   * This used to return only `{ amount }`, so the account number, bank and
   * account name vanished on every reload: the WhatsApp message carried the
   * real details while the checkout page showed an empty box. The instruction
   * is now snapshotted at issue time and replayed verbatim.
   */
  private async recreateInstructionView(
    _rail: unknown,
    payment: Payment,
  ): Promise<Partial<PaymentInstruction>> {
    if (payment.instructionJson) {
      try {
        return JSON.parse(payment.instructionJson) as Partial<PaymentInstruction>;
      } catch {
        // Corrupt snapshot must not blank the page; fall through to the amount.
        log.warn({ paymentId: payment.id }, "unreadable instruction snapshot");
      }
    }
    return { amount: payment.amount };
  }
}
