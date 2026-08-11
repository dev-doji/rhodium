/**
 * Seed / update a merchant bound to a WhatsApp phone so the bot recognizes you
 * the moment you message it. Writes to whatever DB the app uses (Postgres if
 * DATABASE_URL is set). Crypto-ready: sets a Quai wallet address.
 *
 *   npm run seed:merchant -- "+2348030000001" "Amaka Beauty" "0xYourQuaiWallet"
 */
import { loadEnv } from "../config/load-env.js";
loadEnv();
import { loadConfig } from "../config/index.js";
import { createInMemoryRepositories } from "../db/memory/in-memory-repositories.js";
import { createPrismaRepositories } from "../db/prisma/prisma-repositories.js";
import { prisma, disconnectPrisma } from "../db/prisma/client.js";
import { ref } from "../lib/ids.js";

async function main(): Promise<void> {
  const [phone, businessName, quaiAddress] = process.argv.slice(2);
  if (!phone || !businessName) {
    throw new Error('usage: npm run seed:merchant -- "+234..." "Business Name" "0xWallet"');
  }
  const cfg = loadConfig();
  const usingPg = !!cfg.DATABASE_URL;
  const repos = usingPg ? createPrismaRepositories(prisma()) : createInMemoryRepositories();

  const existing = await repos.merchants.byPhone(phone);
  if (existing) {
    const updated = await repos.merchants.update(existing.id, {
      businessName,
      status: "active",
      kycState: "verified",
      cryptoEnabled: true,
      ...(quaiAddress ? { quaiAddress } : {}),
    });
    console.log(`✓ updated merchant ${updated.id} (${businessName}) for ${phone}`);
  } else {
    const created = await repos.merchants.create({
      id: ref("mch"),
      phone,
      businessName,
      status: "active",
      kycState: "verified",
      cryptoEnabled: true,
      quaiAddress: quaiAddress || undefined,
    });
    console.log(`✓ created merchant ${created.id} (${businessName}) for ${phone}`);
  }
  console.log(`  Now message your WhatsApp business number from ${phone} and send: help`);
  if (usingPg) await disconnectPrisma();
}

main().catch((err) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
});
