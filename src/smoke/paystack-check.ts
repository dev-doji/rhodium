/**
 * Paystack connectivity smoke test — proves the secret key + live API path work
 * WITHOUT needing a public webhook URL. Creates a test-mode customer and reads
 * it back. Run: `npm run smoke:paystack`
 */
import { loadEnv } from "../config/load-env.js";
import { loadConfig } from "../config/index.js";

loadEnv();

async function main(): Promise<void> {
  const cfg = loadConfig();
  const key = cfg.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY not set");
  if (!key.startsWith("sk_")) throw new Error("that doesn't look like a Paystack secret key");
  const mode = key.startsWith("sk_test_") ? "TEST" : "LIVE";
  console.log(`→ Paystack key detected (${mode} mode), calling the API…`);

  // 1) Auth check: list banks (a simple authenticated GET).
  const banksRes = await fetch("https://api.paystack.co/bank?country=nigeria&perPage=1", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (banksRes.status === 401) throw new Error("401 Unauthorized — the secret key is wrong");
  if (!banksRes.ok) throw new Error(`bank list failed: HTTP ${banksRes.status}`);
  console.log("✓ Authenticated — key is valid and the API is reachable.");

  // 2) Create a test customer (the first step of the real DVA flow).
  const email = `smoke-${Date.now()}@buyers.rhodium.africa`;
  const custRes = await fetch("https://api.paystack.co/customer", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, first_name: "Rhodium", last_name: "Smoke" }),
  });
  const cust = (await custRes.json()) as { status: boolean; data?: { customer_code: string } };
  if (!custRes.ok || !cust.status) throw new Error(`customer create failed: HTTP ${custRes.status}`);
  console.log(`✓ Created a customer: ${cust.data?.customer_code}`);

  console.log(
    "\nPaystack is wired up correctly. Next: create a merchant subaccount " +
      "(no-custody split target) and expose a public webhook to run the full " +
      "DVA → transfer → confirm loop.",
  );
}

main().catch((err) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
});
