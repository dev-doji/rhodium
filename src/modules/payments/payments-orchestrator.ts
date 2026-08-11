import type { Repositories } from "../../db/repositories.js";
import type { RailRegistry } from "../../rails/registry.js";
import type { EventBus } from "../../events/bus.js";
import type { PaymentInstruction, WebhookPayload } from "../../rails/types.js";
import type { Payment, RailId } from "../../domain/types.js";
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

  /** Issue a payment instruction (DVA) for an order and present it in-chat. */
  async requestPayment(orderId: string): Promise<PaymentInstruction> {
    const order = await this.repos.orders.byId(orderId);
    if (!order) throw new NotFoundError("order", { id: orderId });
    const merchant = await this.repos.merchants.byId(order.merchantId);
    if (!merchant) throw new NotFoundError("merchant", { id: order.merchantId });

    const existing = await this.repos.payments.byOrderId(orderId);
    if (existing) {
      const rail = this.rails.get(existing.railId);
      // Crypto instructions are deterministic + side-effect-free, so recompute
      // the FULL instruction (contract, amount, orderId hash) the checkout needs.
      if (rail.kind === "crypto") {
        return rail.createPaymentInstruction(order, merchant);
      }
      // Fiat: return the stored DVA view — never mint a 2nd DVA.
      return {
        railId: existing.railId,
        instructionType: existing.instructionType,
        providerRef: existing.providerRef,
        amount: existing.amount,
        ...(await this.recreateInstructionView(rail, existing)),
      };
    }

    // Route by the order's rail: bank transfer → fiat, crypto → Quai/BlipPay.
    const rail = this.rails.forKind(order.rail);
    const instruction = await rail.createPaymentInstruction(order, merchant);

    await this.repos.payments.create({
      id: id("pay"),
      orderId: order.id,
      railId: rail.id,
      providerRef: instruction.providerRef,
      instructionType: instruction.instructionType,
      amount: order.amount,
      status: "pending",
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
      await this.confirmByProviderRef(
        providerRef,
        status.amount,
        `poll:${providerRef}:${payment.id}`,
      );
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
      log.warn({ providerRef }, "confirmation for unknown providerRef");
      return;
    }
    // Amount integrity: fiat must match to the kobo; crypto allows a small FX
    // round-trip tolerance (the on-chain stablecoin amount reconverted to kobo).
    const rail = this.rails.get(payment.railId);
    const toleranceBps = rail.kind === "crypto" ? 150 : 0;
    if (amount != null && !withinTolerance(amount, payment.amount, toleranceBps)) {
      this.metrics.increment("payment_amount_mismatch");
      await this.audit.record({
        actor: "system",
        action: "payment.amount_mismatch",
        entity: "payment",
        entityId: payment.id,
        metadata: { expected: payment.amount, received: amount },
      });
      throw new ValidationError("payment amount mismatch", {
        expected: payment.amount,
        received: amount,
      });
    }

    const order = await this.repos.orders.byId(payment.orderId);
    if (!order) throw new NotFoundError("order", { id: payment.orderId });
    if (order.status !== "awaiting_payment" && order.status !== "draft") {
      throw new ConflictError(`order ${order.id} not payable in ${order.status}`);
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

  /** Rebuild the buyer-facing DVA view for an idempotent re-request. */
  private async recreateInstructionView(
    _rail: unknown,
    payment: Payment,
  ): Promise<Partial<PaymentInstruction>> {
    // In mock/live, the DVA details persist provider-side; for the MVP we only
    // need the stable providerRef + amount to re-present. Real adapters can
    // re-fetch account details here if desired.
    return { amount: payment.amount };
  }
}
