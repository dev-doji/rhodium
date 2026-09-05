import type { Repositories } from "../db/repositories.js";
import type { RailRegistry } from "../rails/registry.js";
import type { Metrics } from "../modules/metrics/metrics.js";
import { logger } from "../lib/logger.js";
import type { Kobo } from "../lib/money.js";

const log = logger("reconciliation");

export interface DriftRecord {
  paymentId: string;
  orderId: string;
  kind:
    | "confirmed_not_in_ledger" // money confirmed but no ledger entry
    | "ledger_without_confirmation" // ledger entry with no confirmed payment
    | "amount_mismatch"
    | "provider_says_paid_we_dont"; // poll disagreement
  expected?: Kobo;
  actual?: Kobo;
}

export interface ReconciliationReport {
  ranAt: Date;
  merchantsChecked: number;
  paymentsChecked: number;
  drift: DriftRecord[];
  clean: boolean;
}

/**
 * Daily reconciliation (§2.5) — compares processor records vs. the ledger and
 * flags any drift. This is the reliability backstop behind "zero lost/
 * double-counted payments across the pilot" (§1.6). Runs on a schedule in prod.
 */
export class ReconciliationJob {
  constructor(
    private repos: Repositories,
    private rails: RailRegistry,
    private metrics: Metrics,
    private opts: { pollProvider?: boolean } = {},
  ) {}

  async run(now = new Date()): Promise<ReconciliationReport> {
    const merchants = await this.repos.merchants.list();
    const payments = await this.repos.payments.all();
    const drift: DriftRecord[] = [];

    // Index ledger entries by paymentId for O(1) cross-checking.
    const ledgerByPayment = new Map<string, Kobo>();
    for (const merchant of merchants) {
      const entries = await this.repos.ledger.listByMerchant(merchant.id);
      for (const e of entries) {
        ledgerByPayment.set(e.paymentId, (ledgerByPayment.get(e.paymentId) ?? 0) + e.amount);
      }
    }

    for (const payment of payments) {
      const ledgered = ledgerByPayment.get(payment.id);

      if (payment.status === "confirmed") {
        if (ledgered == null) {
          drift.push({
            paymentId: payment.id,
            orderId: payment.orderId,
            kind: "confirmed_not_in_ledger",
            expected: payment.amount,
          });
        } else if (ledgered !== payment.amount) {
          drift.push({
            paymentId: payment.id,
            orderId: payment.orderId,
            kind: "amount_mismatch",
            expected: payment.amount,
            actual: ledgered,
          });
        }
      } else {
        if (ledgered != null) {
          drift.push({
            paymentId: payment.id,
            orderId: payment.orderId,
            kind: "ledger_without_confirmation",
            actual: ledgered,
          });
        }
        // Optionally ask the provider directly (catches missed webhooks).
        if (this.opts.pollProvider && payment.status === "pending") {
          // A payment on a retired rail cannot be polled — skip it rather than
          // failing the whole reconciliation run over one historical row.
          const rail = this.rails.find(payment.railId);
          const status = rail
            ? await rail.verifyPayment(payment.providerRef).catch(() => null)
            : null;
          if (status?.status === "confirmed") {
            drift.push({
              paymentId: payment.id,
              orderId: payment.orderId,
              kind: "provider_says_paid_we_dont",
              expected: status.amount,
            });
          }
        }
      }
    }

    const report: ReconciliationReport = {
      ranAt: now,
      merchantsChecked: merchants.length,
      paymentsChecked: payments.length,
      drift,
      clean: drift.length === 0,
    };

    this.metrics.observe("reconciliation_drift_count", drift.length);
    if (!report.clean) {
      log.error({ drift }, "RECONCILIATION DRIFT DETECTED — alerting");
      this.metrics.increment("reconciliation_drift_alerts");
    } else {
      log.info(
        { payments: payments.length },
        "reconciliation clean — processor and ledger agree",
      );
    }
    return report;
  }
}
