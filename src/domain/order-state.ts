import type { OrderStatus } from "./types.js";
import { ConflictError } from "../lib/errors.js";

/**
 * Order state machine — §2.4:
 *   draft → awaiting_payment → paid → fulfilled | cancelled | expired
 *
 * Encoded explicitly so illegal transitions are impossible, not just unlikely.
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ["awaiting_payment", "cancelled"],
  awaiting_payment: ["paid", "cancelled", "expired"],
  paid: ["fulfilled", "cancelled"], // cancelled-after-paid => refund path
  fulfilled: [],
  cancelled: [],
  expired: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictError(
      `illegal order transition ${from} → ${to}`,
      { from, to },
    );
  }
}

export const TERMINAL: OrderStatus[] = ["fulfilled", "cancelled", "expired"];

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL.includes(status);
}
