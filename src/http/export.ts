import type { LedgerEntry } from "../domain/types.js";
import { formatNaira } from "../lib/money.js";

/** CSV export of the ledger — useful to merchants AND the credit-data pipeline. */
export function ledgerToCsv(entries: LedgerEntry[]): string {
  const header = "date,type,order_id,amount_naira,balance_after_naira";
  const rows = entries.map((e) =>
    [
      e.createdAt.toISOString(),
      e.type,
      e.orderId,
      (e.amount / 100).toFixed(2),
      (e.balanceAfter / 100).toFixed(2),
    ].join(","),
  );
  return [header, ...rows].join("\n");
}

/** Minimal, dependency-free "PDF-ish" text statement. A real PDF lib slots in later. */
export function ledgerToStatement(businessName: string, entries: LedgerEntry[]): string {
  const lines = [
    `STATEMENT — ${businessName}`,
    `Generated ${new Date().toISOString()}`,
    "".padEnd(48, "="),
  ];
  for (const e of entries) {
    lines.push(
      `${e.createdAt.toISOString().slice(0, 10)}  ${e.type.padEnd(10)}  ` +
        `${formatNaira(e.amount).padStart(14)}  bal ${formatNaira(e.balanceAfter)}`,
    );
  }
  const total = entries.filter((e) => e.type === "sale").reduce((a, e) => a + e.amount, 0);
  lines.push("".padEnd(48, "="));
  lines.push(`TOTAL SALES: ${formatNaira(total)}`);
  return lines.join("\n");
}
