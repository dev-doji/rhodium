/**
 * WhatsApp live-send smoke test — sends a real text through the Cloud API to a
 * recipient you pass on the command line. Proves the access token + phone number
 * id + transport work end-to-end. The recipient MUST be on your test number's
 * allowlist (added on the Meta "API Setup" screen).
 *
 * Run: `npm run smoke:whatsapp -- +2348030000001`
 */
import { loadEnv } from "../config/load-env.js";
import { loadConfig } from "../config/index.js";
import { WhatsAppCloudTransport } from "../modules/whatsapp/cloud-transport.js";

loadEnv();

async function main(): Promise<void> {
  const to = process.argv[2];
  if (!to) throw new Error("usage: npm run smoke:whatsapp -- +<recipient_number>");

  const cfg = loadConfig();
  if (!cfg.WHATSAPP_ACCESS_TOKEN) throw new Error("WHATSAPP_ACCESS_TOKEN not set");
  if (!cfg.WHATSAPP_PHONE_NUMBER_ID) throw new Error("WHATSAPP_PHONE_NUMBER_ID not set");

  // Force live regardless of WHATSAPP_MODE so the smoke test always really sends.
  const transport = new WhatsAppCloudTransport({
    mode: "live",
    accessToken: cfg.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: cfg.WHATSAPP_PHONE_NUMBER_ID,
  });

  console.log(`→ Sending a live WhatsApp message to ${to}…`);
  const res = await transport.send(
    to,
    "✅ Rhodium is connected. This is a live test message from your commerce backend.",
  );
  if (!res.ok) {
    throw new Error(
      "send failed — common causes: recipient not on the test allowlist, a 24h " +
        "token that expired, or (outside the 24h session window) needing an " +
        "approved template instead of a free-form text.",
    );
  }
  // A message id means Meta ACCEPTED the send, NOT that it was delivered. The
  // most common silent failure: WhatsApp only allows free-form text inside the
  // 24-hour customer service window, which opens when the CUSTOMER messages the
  // business. Outside it you need an approved template. Meta still returns HTTP
  // 200 + a wamid, then drops the message asynchronously (error 131047) — the
  // failure only ever shows up on the status webhook, never in this response.
  // So don't claim delivery here; say what we actually know.
  console.log(`✓ Accepted by Meta. Message id: ${res.ref}`);
  console.log(
    "\nNOTE: 'accepted' is not 'delivered'. If it never arrives, the 24-hour\n" +
      "session window is almost certainly closed. Message the bot from that\n" +
      `phone first (that opens the window), then re-run this. Business-initiated\n` +
      "sends outside the window need an approved template.",
  );
}

main().catch((err) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
});
