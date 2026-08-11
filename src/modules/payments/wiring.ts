import type { EventBus } from "../../events/bus.js";
import type { LedgerService } from "../ledger/ledger-service.js";
import type { NotificationService } from "../notification/notification-service.js";
import type { Repositories } from "../../db/repositories.js";
import { logger } from "../../lib/logger.js";

const log = logger("payments-wiring");

/**
 * The downstream chain (§2.3): `order.paid → receipt → ledger.entry`. This is
 * the seam that lets web3/credit attach later with no rewrite — they'll emit
 * the exact same `order.paid`, and this wiring handles it identically.
 */
export function wirePaymentEvents(deps: {
  bus: EventBus;
  ledger: LedgerService;
  notifications: NotificationService;
  repos: Repositories;
}): void {
  const { bus, ledger, notifications, repos } = deps;

  // 1) Append to the ledger (the records value + credit-pipeline seed).
  bus.on("order.paid", async (e) => {
    if (e.name !== "order.paid") return;
    const entry = await ledger.recordSale({
      merchantId: e.merchantId,
      orderId: e.orderId,
      paymentId: e.paymentId,
      amount: e.amount,
    });
    log.info({ orderId: e.orderId, ledgerEntryId: entry.id }, "ledger entry appended");
    await bus.publish(`ledger:${entry.id}`, {
      name: "ledger.entry.appended",
      merchantId: e.merchantId,
      orderId: e.orderId,
      ledgerEntryId: entry.id,
      amount: entry.amount,
      balanceAfter: entry.balanceAfter,
      occurredAt: entry.createdAt.toISOString(),
    });
  });

  // 2) Notify merchant + send buyer receipt (kills manual checking).
  bus.on("order.paid", async (e) => {
    if (e.name !== "order.paid") return;
    const order = await repos.orders.byId(e.orderId);
    await notifications.notifyMerchantPaid({
      merchantId: e.merchantId,
      orderId: e.orderId,
      amount: e.amount,
    });
    if (order) {
      await notifications.sendReceiptToBuyer({
        merchantId: e.merchantId,
        orderId: e.orderId,
        buyerRef: order.buyerRef,
        amount: e.amount,
      });
      // Simple stock decrement on sale (§Phase 3).
      for (const item of order.items) {
        await repos.products.decrementStock(item.productId, item.qty);
      }
    }
  });
}
