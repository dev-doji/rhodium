/**
 * Seed the two demo storefronts and print their shareable buyer links.
 *
 *   npm run seed:demo-stores -- "+2347061328353" "+2348012345678"
 *                                 ^ jewellery      ^ gadgets
 *
 * Writes to whatever DATABASE_URL points at — set it to the Render external
 * URL to seed production. Safe to re-run: merchants are matched by phone and
 * updated rather than duplicated, and catalogues are only filled if empty.
 *
 * Each store gets an embedded Cyprus1 Quai wallet so buyers can pay in QUAI
 * through BlipPay and have it settle merchant-direct. Without a quaiAddress the
 * crypto rail has nowhere to send funds and the checkout page cannot render.
 */
import { loadEnv } from "../config/load-env.js";
loadEnv();
import { loadConfig } from "../config/index.js";
import { createPrismaRepositories } from "../db/prisma/prisma-repositories.js";
import { createInMemoryRepositories } from "../db/memory/in-memory-repositories.js";
import { prisma, disconnectPrisma } from "../db/prisma/client.js";
import { CommerceService } from "../modules/commerce/commerce-service.js";
import { WalletService } from "../modules/wallet/wallet-service.js";
import { InMemoryObjectStore } from "../modules/storage/object-store.js";
import { systemClock } from "../lib/clock.js";
import type { Repositories } from "../db/repositories.js";
import { formatNaira } from "../lib/money.js";
import { ref } from "../lib/ids.js";

interface StoreSpec {
  phone: string;
  businessName: string;
  items: [string, number][]; // [name, naira]
}

const CIRCUIT_CITY: Omit<StoreSpec, "phone"> = {
  businessName: "Circuit City",
  // Deliberately spans ₦6,500 → ₦95,000. The cheap end matters: a buyer paying
  // in testnet QUAI needs an item they can actually afford from a faucet.
  items: [
    ["HDMI Cable 2m", 6_500],
    ["Wireless Mouse", 12_000],
    ["Phone Tripod + Ring Light", 15_000],
    ["Laptop Sleeve 15\"", 16_000],
    ["65W GaN Fast Charger", 18_000],
    ["Wireless Charging Pad", 20_000],
    ["Laptop Stand (Aluminium)", 22_000],
    ["USB-C Hub 6-in-1", 28_000],
    ["Webcam 1080p", 32_000],
    ["Power Bank 20,000mAh", 35_000],
    ["Bluetooth Speaker", 40_000],
    ["Mechanical Keyboard", 45_000],
    ["Smart Watch", 55_000],
    ["Noise-Cancelling Earbuds", 65_000],
    ["External SSD 1TB", 95_000],
  ],
};

const DIADEM: Omit<StoreSpec, "phone"> = {
  businessName: "Diadem Store",
  items: [
    ["Gold-Plated Hoop Earrings", 8_500],
    ["Pearl Drop Necklace", 15_000],
    ["Stainless Steel Bangle Set", 12_000],
    ["Silver Anklet", 6_500],
    ["Beaded Waist Chain", 4_000],
  ],
};

function stores(gadgetPhone: string, jewelleryPhone?: string): StoreSpec[] {
  const list: StoreSpec[] = [{ phone: gadgetPhone, ...CIRCUIT_CITY }];
  if (jewelleryPhone) list.push({ phone: jewelleryPhone, ...DIADEM });
  return list;
}

async function seedStore(
  repos: Repositories,
  commerce: CommerceService,
  wallets: WalletService,
  spec: StoreSpec,
): Promise<{ id: string; name: string; wallet: string }> {
  let merchant = await repos.merchants.byPhone(spec.phone);
  if (merchant) {
    merchant = await repos.merchants.update(merchant.id, {
      businessName: spec.businessName,
      status: "active",
      kycState: "verified",
      cryptoEnabled: true,
    });
    console.log(`  ↻ ${spec.businessName} — existing merchant ${merchant.id}`);
  } else {
    merchant = await repos.merchants.create({
      id: ref("mch"),
      phone: spec.phone,
      businessName: spec.businessName,
      status: "active",
      kycState: "verified",
      cryptoEnabled: true,
      settlementBankCode: "058",
      settlementAccountNumber: "0123456789",
    });
    console.log(`  + ${spec.businessName} — created ${merchant.id}`);
  }

  // Crypto rail needs a destination. Only mint one if it has none, so re-runs
  // never orphan a wallet a merchant has already backed up.
  if (!merchant.quaiAddress) {
    const wallet = await wallets.generateCyprus1();
    await repos.merchants.setWalletSecrets(merchant.id, wallet.mnemonic, wallet.privateKey);
    merchant = await repos.merchants.update(merchant.id, { quaiAddress: wallet.address });
    console.log(`    🪙 wallet ${wallet.address}`);
  }

  const existing = await commerce.listProducts(merchant.id);
  if (existing.length > 0) {
    console.log(`    ${existing.length} product(s) already — leaving catalogue alone`);
  } else {
    for (const [name, naira] of spec.items) {
      await commerce.createProduct({
        merchantId: merchant.id,
        name,
        price: naira * 100,
      });
      console.log(`    • ${name} — ${formatNaira(naira * 100)}`);
    }
  }
  return { id: merchant.id, name: merchant.businessName, wallet: merchant.quaiAddress ?? "(none)" };
}

async function main(): Promise<void> {
  const [gadgets, jewellery] = process.argv.slice(2);
  if (!gadgets) {
    throw new Error(
      'usage: npm run seed:demo-stores -- "+234gadgets" ["+234jewellery"]\n' +
        "  first number = Circuit City, optional second = Diadem Store.\n" +
        "  Each identifies its vendor for vendor commands, so they must differ.",
    );
  }
  if (jewellery && jewellery === gadgets) {
    throw new Error("the two stores need different phone numbers — vendors are keyed by phone");
  }

  const cfg = loadConfig();
  const usingPg = !!cfg.DATABASE_URL;
  const repos = usingPg ? createPrismaRepositories(prisma()) : createInMemoryRepositories();
  const commerce = new CommerceService(repos, new InMemoryObjectStore(), systemClock);
  const wallets = new WalletService();

  const target = usingPg ? cfg.DATABASE_URL!.replace(/:\/\/[^@]*@/, "://***@") : "in-memory (no DATABASE_URL!)";
  console.log(`\nSeeding demo stores → ${target}\n`);
  if (!usingPg) {
    console.log("  ⚠️  No DATABASE_URL — this run will vanish. Point it at Render to seed live.\n");
  }

  const seeded = [];
  for (const spec of stores(gadgets, jewellery)) {
    seeded.push(await seedStore(repos, commerce, wallets, spec));
    console.log("");
  }

  const wa = cfg.WHATSAPP_WA_NUMBER;
  if (!wa) {
    throw new Error(
      "WHATSAPP_WA_NUMBER is not set — the shop links below would point nowhere.",
    );
  }
  console.log("─".repeat(66));
  console.log("SHARE THESE LINKS — anyone on WhatsApp can buy from them:\n");
  for (const s of seeded) {
    console.log(`  ${s.name}`);
    console.log(`  https://wa.me/${wa}?text=shop-${s.id}`);
    console.log(`  settles QUAI to ${s.wallet}\n`);
  }
  console.log("─".repeat(66));
  console.log(
    "\nBuyers: tap a link → pick a product → choose 3 (QUAI/BlipPay) →\n" +
      "pay on the checkout page → receipt lands back in WhatsApp.\n",
  );

  if (usingPg) await disconnectPrisma();
}

main().catch((err) => {
  console.error(`\n✗ ${(err as Error).message}`);
  process.exit(1);
});
