import type { Kobo } from "../lib/money.js";
import type { RailId } from "../domain/types.js";

/**
 * Downstream domain events. RULE (§2.3): every rail emits the SAME events —
 * `order.paid → receipt → ledger.entry`. Rail specifics stop at the adapter.
 */
export type DomainEventName =
  | "order.paid"
  | "receipt.requested"
  | "ledger.entry.appended"
  | "payment.failed";

export interface OrderPaidEvent {
  name: "order.paid";
  orderId: string;
  paymentId: string;
  merchantId: string;
  railId: RailId;
  amount: Kobo;
  providerRef: string;
  occurredAt: string; // ISO
}

export interface ReceiptRequestedEvent {
  name: "receipt.requested";
  orderId: string;
  paymentId: string;
  merchantId: string;
  amount: Kobo;
  occurredAt: string;
}

export interface LedgerEntryAppendedEvent {
  name: "ledger.entry.appended";
  merchantId: string;
  orderId: string;
  ledgerEntryId: string;
  amount: Kobo;
  balanceAfter: Kobo;
  occurredAt: string;
}

export interface PaymentFailedEvent {
  name: "payment.failed";
  orderId: string;
  paymentId: string;
  reason: string;
  occurredAt: string;
}

export type DomainEvent =
  | OrderPaidEvent
  | ReceiptRequestedEvent
  | LedgerEntryAppendedEvent
  | PaymentFailedEvent;

export interface EnqueuedEvent {
  /** Idempotency key — the same business event replayed carries the same key. */
  idempotencyKey: string;
  event: DomainEvent;
}
