/**
 * Enumerate — and only then delete — test data left in a live Rhodium DB.
 *
 *   ADMIN_SECRET=<prod APP_SECRET> npm run cleanup:test-data              # dry run
 *   ADMIN_SECRET=<prod APP_SECRET> npm run cleanup:test-data -- --confirm # delete
 *
 * `POST /admin/cleanup` is a HARD, CASCADING delete: a merchant takes its orders,
 * products, buyers and ledger entries with it, inside a transaction, with no undo.
 * So this script defaults to a dry run — it lists exactly what it matched and what
 * it would send, and refuses to delete unless `--confirm` is passed.
 *
 * It deliberately matches on the *merchant*, never on product names: "On-Chain
 * Demo" products belong to the real demo merchant (Amaka Beauty), whose paid
 * on-chain order is the buildathon demo. Deleting by product name would take it out.
 */
const APP = process.env.APP_URL ?? "https://rhodium-8ocg.onrender.com";
const SECRET = process.env.ADMIN_SECRET ?? "";
const CONFIRM = process.argv.includes("--confirm");

/** Merchants considered disposable test fixtures — extend as needed. */
const TEST_MERCHANT_IDS = ["mch_2633e2bb196e4795"];
const TEST_NAME_PATTERN = /endpoint test|test merchant/i;

interface AdminMerchant {
  id: string;
  businessName: string;
  status: string;
  quaiAddress?: string | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Render's free tier sleeps; a cold instance can fail outright, so retry.
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`${APP}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${SECRET}`,
          ...(init?.headers ?? {}),
        },
      });
      const text = await res.text();
      if (res.status === 401) {
        throw new Error(
          "401 unauthorized — ADMIN_SECRET must be the APP_SECRET set in the Render " +
            "dashboard, which is NOT the one in your local .env",
        );
      }
      if (!res.ok) throw new Error(`${path} → HTTP ${res.status} ${text}`);
      return JSON.parse(text) as T;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("401")) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function main(): Promise<void> {
  if (!SECRET) throw new Error("set ADMIN_SECRET (the APP_SECRET from the Render dashboard)");

  const { merchants } = await api<{ merchants: AdminMerchant[] }>("/admin/merchants");
  console.log(`${merchants.length} merchant(s) on ${APP}:\n`);

  const doomed: AdminMerchant[] = [];
  for (const m of merchants) {
    const isTest = TEST_MERCHANT_IDS.includes(m.id) || TEST_NAME_PATTERN.test(m.businessName);
    console.log(`  ${isTest ? "DELETE →" : "  keep  "} ${m.id}  ${m.businessName} (${m.status})`);
    if (isTest) doomed.push(m);
  }

  if (doomed.length === 0) {
    console.log("\nNothing matched the test-data rules — already clean.");
    return;
  }

  const payload = { merchantIds: doomed.map((m) => m.id) };
  console.log(`\nWould POST /admin/cleanup ${JSON.stringify(payload)}`);
  console.log("This cascades to each merchant's orders, products, buyers and ledger entries.");

  if (!CONFIRM) {
    console.log("\nDRY RUN — nothing deleted. Re-run with --confirm to apply.");
    return;
  }

  const result = await api<Record<string, unknown>>("/admin/cleanup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  console.log("\n✅ cleanup done:", JSON.stringify(result));
}

main().catch((e: unknown) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
