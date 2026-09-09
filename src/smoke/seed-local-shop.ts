/**
 * Seed a realistic shop into your LOCAL database, ready to sell.
 *
 *   npm run seed:local-shop
 *   npm run seed:local-shop -- "Tees kitchen" teeskitchen
 *
 * The demo seeder makes "Circuit City" and "Diadem Store", which are hackathon
 * fiction — nobody is testing against those any more. This makes a shop shaped
 * like the one that actually trades: a slug, a catalogue, a payout account, and
 * naira settlement, so /s/<slug> and the whole checkout work immediately.
 *
 * Deliberately NOT a copy of production. Copying the real merchant would drag a
 * real person's phone number and bank account into a development database, and
 * those columns are encrypted with the production key anyway — they would
 * decrypt to nothing here. The details below are local inventions in the same
 * shape.
 */
import { loadEnv } from "../config/load-env.js";
loadEnv();
import { loadConfig } from "../config/index.js";
import { createPrismaRepositories } from "../db/prisma/prisma-repositories.js";
import { prisma, disconnectPrisma } from "../db/prisma/client.js";
import { CommerceService } from "../modules/commerce/commerce-service.js";
import { InMemoryObjectStore } from "../modules/storage/object-store.js";
import { systemClock } from "../lib/clock.js";
import { ref } from "../lib/ids.js";

/** A short menu, priced the way a real one is — not round demo numbers. */
const MENU: { name: string; price: number }[] = [
  { name: "Jollof rice & chicken", price: 3_500_00 },
  { name: "Fried rice & turkey", price: 4_200_00 },
  { name: "Egusi soup & pounded yam", price: 3_800_00 },
  { name: "Peppered goat meat", price: 5_000_00 },
  { name: "Small chops platter", price: 6_500_00 },
];

async function main(): Promise<void> {
  const [businessName = "Tees kitchen", slug = "teeskitchen", phoneArg] = process.argv.slice(2);
  const cfg = loadConfig();

  // Refuse anything that is not obviously a local database. Seeding invented
  // products into production — or into the Neon copy — would be indisputably
  // worse than the inconvenience of this check.
  const url = cfg.DATABASE_URL ?? "";
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  if (!isLocal) {
    throw new Error(
      `DATABASE_URL does not look local (${url.replace(/:\/\/[^@]*@/, "://***@")}). ` +
        "This seeds invented data and must never touch production.",
    );
  }

  // A local test number, not the merchant's real one.
  const phone = phoneArg ?? "+2348000000001";
  const repos = createPrismaRepositories(prisma());
  const commerce = new CommerceService(repos, new InMemoryObjectStore(), systemClock);

  const existing = await repos.merchants.byPhone(phone);
  const merchant = existing
    ? await repos.merchants.update(existing.id, {
        businessName,
        slug,
        status: "active",
        kycState: "verified",
      })
    : await repos.merchants.create({
        id: ref("mch"),
        phone,
        businessName,
        slug,
        status: "active",
        kycState: "verified",
        cryptoEnabled: true,
        // Naira settlement, like the real merchant: crypto sales off-ramp to
        // her bank rather than paying a wallet she does not have.
        cryptoSettlement: "naira",
        settlementBankCode: "opay",
        settlementAccountNumber: "9110461379",
        // A payout subaccount, so the LIVE Paystack rail would route to her.
        // The mock rail does not need one, but without it the live rail
        // refuses — which is the failure worth being able to reproduce here.
        processorSubaccountCode: "ACCT_local_test",
      });

  const already = await repos.products.listByMerchant(merchant.id);
  if (already.length === 0) {
    for (const item of MENU) {
      await commerce.createProduct({
        merchantId: merchant.id,
        name: item.name,
        price: item.price,
      });
    }
  }

  const base = cfg.PUBLIC_BASE_URL;
  const handle = merchant.slug ?? merchant.id;
  console.log("");
  console.log(`  ✓ ${businessName}`);
  console.log(`    merchant   ${merchant.id}`);
  console.log(`    products   ${(await repos.products.listByMerchant(merchant.id)).length}`);
  console.log(`    payout     ${merchant.processorSubaccountCode ? "ready" : "MISSING"}`);
  console.log("");
  console.log(`    storefront ${base}/s/${handle}`);
  console.log(`    dashboard  ${base}/  (sign in as ${phone})`);
  console.log("");

  await disconnectPrisma();
}

main().catch((err) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
});
