import type { Repositories } from "../db/repositories.js";
import type { PaymentsOrchestrator } from "../modules/payments/payments-orchestrator.js";
import type { Clock } from "../lib/clock.js";
import { logger } from "../lib/logger.js";

const log = logger("near-poller");

/**
 * Confirms NEAR Intents payments nobody is watching.
 *
 * 1Click has no webhook: a payment is only ever learned about by asking. The
 * checkout asks while the buyer has the page open, but a buyer who pays and
 * closes the tab is common, and the merchant's "✅ received" must not depend
 * on a stranger's browser staying open.
 *
 * Bounded to payments younger than the quote's lifetime plus a margin for a
 * slow solver, so an abandoned order is not polled forever. Sequential and
 * caught per item: one bad row must not stop the rest.
 */
export class NearPaymentPoller {
  private running = false;

  constructor(
    private repos: Repositories,
    private payments: PaymentsOrchestrator,
    private clock: Clock,
    private quoteTtlMinutes: number,
  ) {}

  async tick(): Promise<{ checked: number; confirmed: number }> {
    // A slow RPC can make one tick outlast the interval. Overlapping ticks
    // would ask about the same payments twice at once for no gain.
    if (this.running) return { checked: 0, confirmed: 0 };
    this.running = true;
    try {
      const since = new Date(this.clock.now().getTime() - (this.quoteTtlMinutes + 15) * 60_000);
      const pending = await this.repos.payments.listPendingByRail("near_intents", since);
      let confirmed = 0;
      for (const p of pending) {
        try {
          if (await this.payments.reconcileByPolling(p.providerRef)) confirmed++;
        } catch (err) {
          log.warn({ paymentId: p.id, err: (err as Error).message }, "NEAR poll failed for payment");
        }
      }
      return { checked: pending.length, confirmed };
    } finally {
      this.running = false;
    }
  }
}
