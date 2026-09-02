import express, { type Express, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { App } from "../app.js";
import { asyncRoute, errorHandler } from "./errors.js";
import { requireMerchant, type AuthedRequest } from "./auth-middleware.js";
import { ledgerToCsv, ledgerToStatement } from "./export.js";
import { nairaToKobo, formatNaira } from "../lib/money.js";
import { withTrace, logger } from "../lib/logger.js";
import { ref } from "../lib/ids.js";
import { encryptField, decryptField, hmacSign } from "../lib/crypto.js";
import type { RailId } from "../domain/types.js";
import { ValidationError, NotFoundError, UnauthorizedError } from "../lib/errors.js";
import { timingSafeEqual } from "node:crypto";

const log = logger("http-api");

/** Process start time — lets /health show whether a deploy actually restarted. */
const STARTED_AT = new Date().toISOString();

/**
 * HTTP surface (§2.1): the two ingress points are (a) provider + WhatsApp
 * webhooks and (b) the merchant dashboard API. Auth is phone-OTP → bearer token.
 */
export function buildApi(app: App): Express {
  const server = express();

  // In-memory recorder of inbound WhatsApp webhooks — lets us diagnose delivery
  // + processing over HTTPS without server-log access.
  const waDebug: { count: number; events: Record<string, unknown>[] } = { count: 0, events: [] };

  // Trace id per request for payment-path tracing (§2.5 observability).
  server.use((req, _res, next) => {
    const traceId = req.header("x-request-id") ?? ref("trace");
    withTrace(traceId, () => next());
  });

  // `commit` answers "did my deploy actually go out?" without needing the admin
  // token — Render injects RENDER_GIT_COMMIT, and a zero-downtime rollout is
  // otherwise invisible from the outside (health stays 200 the whole time).
  server.get("/health", (_req, res) => {
    res.json({
      ok: true,
      ts: new Date().toISOString(),
      commit: (process.env.RENDER_GIT_COMMIT ?? "local").slice(0, 7),
      startedAt: STARTED_AT,
    });
  });

  // Live QUAI→NGN, polled by the checkout page so a buyer watching the screen
  // sees the rate move rather than a number frozen at page load.
  server.get("/api/fx/quai", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(app.fx.snapshot());
  });

  // Prometheus-ish metrics incl. WhatsApp conversation cost (§2.5, §4).
  server.get("/metrics", (_req, res) => {
    res.json(app.metrics.snapshot());
  });

  // --- Webhooks: RAW body needed for signature verification ---
  server.post(
    "/webhooks/rails/:railId",
    express.raw({ type: "*/*" }),
    asyncRoute(async (req: Request, res: Response) => {
      const railId = req.params.railId as RailId;
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
      await app.payments.handleRailWebhook(railId, {
        headers: req.headers as Record<string, string | undefined>,
        rawBody,
      });
      res.json({ received: true });
    }),
  );

  // --- WhatsApp Cloud API webhook verification (GET) + inbound (POST) ---
  server.get("/webhooks/whatsapp", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === app.config.WHATSAPP_VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

  /**
   * Is this really Meta? Every inbound webhook is signed with the app secret
   * over the RAW body as `X-Hub-Signature-256: sha256=<hex>`.
   *
   * Without this the endpoint accepts anything: a forged payload naming a
   * merchant's phone number is treated as that merchant, so a stranger could
   * add products, raise orders or read a shop's books just by knowing the URL.
   * The payment rails have always verified their signatures; this one did not.
   *
   * Unset secret (dev, tests, demos) => skip, so the system still runs with no
   * credentials. In production the guardrail in config requires the secret.
   */
  const whatsappSignatureOk = (raw: Buffer, header?: string): boolean => {
    const secret = app.config.WHATSAPP_APP_SECRET;
    if (!secret) return true;
    if (!header?.startsWith("sha256=")) return false;
    const expected = `sha256=${hmacSign(raw.toString("utf8"), secret)}`;
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  server.post(
    "/webhooks/whatsapp",
    // RAW, not json(): the signature covers the exact bytes Meta sent, and
    // re-serialising a parsed object would not reproduce them.
    express.raw({ type: "*/*" }),
    asyncRoute(async (req: Request, res: Response) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
      if (!whatsappSignatureOk(raw, req.header("x-hub-signature-256"))) {
        log.warn({ ip: req.ip }, "rejected unsigned whatsapp webhook");
        res.sendStatus(401);
        return;
      }
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(raw.toString("utf8") || "{}") as Record<string, unknown>;
      } catch {
        res.sendStatus(200); // malformed: ack so Meta stops retrying
        return;
      }
      // Parse the Cloud API inbound message envelope.
      const value = (parsed as any)?.entry?.[0]?.changes?.[0]?.value;
      const msg = value?.messages?.[0];
      // WHICH of our numbers this arrived on. With vendors on their own numbers
      // this is the tenant key — the same webhook now serves every shop.
      const toPhoneNumberId = value?.metadata?.phone_number_id as string | undefined;
      // --- WhatsApp Coexistence (vendor keeps her Business app on the same
      // number). These arrive on DIFFERENT paths to `value.messages`, which is
      // what keeps them out of the normal inbound router:
      //   history            → data.history[].threads[].messages[]  (up to 6 months)
      //   smb_app_state_sync → data.state_sync[]                    (contacts)
      //   smb_message_echoes → value.message_echoes[]               (her app replies)
      // If history ever landed on the inbound path it would replay months of old
      // chat as live commands — creating orders from messages sent last March.
      const echoes = value?.message_echoes as { to?: string }[] | undefined;
      const rec: Record<string, unknown> = {
        at: new Date().toISOString(),
        from: msg?.from,
        to: toPhoneNumberId,
        type: msg?.type,
        text: msg?.text?.body,
        isStatus: !!value?.statuses,
      };
      try {
        if (echoes?.length && toPhoneNumberId) {
          // She answered from her phone — stand the bot down on those threads.
          for (const echo of echoes) {
            if (echo.to) app.whatsapp.noteVendorReply(toPhoneNumberId, `+${echo.to}`);
          }
          rec.echoes = echoes.length;
        } else if (msg?.type === "text" && msg.from) {
          const reply = await app.whatsapp.handleInbound({
            from: `+${msg.from}`,
            text: msg.text.body,
            toPhoneNumberId,
          });
          // An empty reply means human takeover muted us. Record it explicitly:
          // "the bot said nothing" is otherwise indistinguishable from a bug.
          if (reply) rec.replied = String(reply).slice(0, 80);
          else rec.suppressed = "vendor handling this thread";
        } else {
          rec.skipped = true;
        }
      } catch (e) {
        rec.error = (e as Error).message;
      }
      waDebug.count += 1;
      waDebug.events.unshift(rec);
      waDebug.events = waDebug.events.slice(0, 25);
      res.sendStatus(200); // always 200 so Meta doesn't retry-storm
    }),
  );

  // --- WhatsApp Embedded Signup: a vendor connects their OWN number ---
  // Meta redirects here after the vendor authorises us. Public by necessity, so
  // the merchant it applies to comes from the HMAC-signed `state`, never from a
  // plain query param.
  server.get(
    "/oauth/whatsapp/callback",
    asyncRoute(async (req, res) => {
      const { code, state, error, error_description: errorDescription } = req.query;
      if (error) {
        res.status(400).send(signupPage("Connection cancelled", String(errorDescription ?? error)));
        return;
      }
      if (!code || !state) {
        res.status(400).send(signupPage("Missing details", "No authorisation code was returned."));
        return;
      }
      try {
        const connected = await app.waSignup.completeSignup(String(code), String(state));
        const merchant = await app.repos.merchants.byId(connected.merchantId);
        // Say hello on the number they just connected: it proves the whole loop
        // (their WABA → our token → their number) works, right now, rather than
        // at the next buyer's expense.
        if (merchant) {
          await app.waTransport
            .send(
              merchant.phone,
              [
                `✅ *${merchant.businessName}* is now live on your own WhatsApp number.`,
                ...(connected.displayPhone ? [`Buyers can message ${connected.displayPhone}.`] : []),
                "",
                "Type *link* here for the link to share.",
              ].join("\n"),
              { phoneNumberId: connected.waPhoneNumberId },
            )
            .catch(() => undefined);
        }
        res.send(
          signupPage(
            "Your number is connected 🎉",
            `${merchant?.businessName ?? "Your shop"} now sells from ${
              connected.displayPhone ?? "your own WhatsApp number"
            }. You can close this tab — we've messaged you on WhatsApp.`,
          ),
        );
      } catch (err) {
        res.status(400).send(signupPage("Couldn't connect that number", (err as Error).message));
      }
    }),
  );

  // JSON for everything below.
  server.use(express.json());

  /**
   * "I've sent the money" — ask the PROVIDER, right now.
   *
   * It cannot make a bank transfer arrive sooner, but it removes the wait on a
   * webhook that may be delayed, retried, or lost. The buyer's claim is never
   * itself evidence: this polls Paystack and confirms only on their answer, so
   * pressing it on an unpaid order changes nothing.
   */
  server.post(
    "/api/checkout/:orderId/verify",
    asyncRoute(async (req, res) => {
      const order = await app.repos.orders.byId(req.params.orderId!);
      if (!order) throw new NotFoundError("order", { id: req.params.orderId });
      if (order.status === "paid") {
        res.json({ status: "paid" });
        return;
      }
      const payment = await app.repos.payments.byOrderId(order.id);
      if (!payment) throw new NotFoundError("payment", { orderId: order.id });
      const confirmed = await app.payments
        .reconcileByPolling(payment.providerRef)
        .catch((err) => {
          // A mismatch (wrong amount) is information, not a server fault.
          log.info({ orderId: order.id, err: (err as Error).message }, "verify poll failed");
          return false;
        });
      res.json({ status: confirmed ? "paid" : "pending" });
    }),
  );

  /**
   * Public receipt for a PAID order. Both sides of a sale get this link, so it
   * carries no auth: the order id is an unguessable uuid, the same shape Stripe
   * and every other processor uses for shareable receipts.
   *
   * Two deliberate limits. It answers only for paid orders, so the URL can
   * never be used to watch an order that has not settled. And the buyer's phone
   * is masked — a receipt is forwarded to family, group chats and accountants,
   * and neither party should leak the other's number by sharing it.
   */
  server.get(
    "/api/receipt/:orderId",
    asyncRoute(async (req, res) => {
      const order = await app.repos.orders.byId(req.params.orderId!);
      if (!order) throw new NotFoundError("order", { id: req.params.orderId });
      if (order.status !== "paid") {
        res.status(404).json({ error: "receipt not available until the order is paid" });
        return;
      }
      const merchant = await app.repos.merchants.byId(order.merchantId);
      const payment = await app.repos.payments.byOrderId(order.id);

      let buyer = order.buyerRef || "";
      if (buyer.startsWith("buy_")) {
        buyer = (await app.repos.buyers.byId(buyer).catch(() => null))?.phoneOrRef ?? "";
      }

      const items = [];
      for (const line of order.items) {
        const product = await app.repos.products.byId(line.productId).catch(() => null);
        items.push({
          name: product?.name ?? "Item",
          qty: line.qty,
          unitPrice: product?.price ?? line.unitPrice ?? 0,
          unitPriceFormatted: formatNaira(product?.price ?? line.unitPrice ?? 0),
        });
      }

      res.set("Cache-Control", "no-store");
      res.json({
        orderRef: order.id.slice(-6).toUpperCase(),
        orderId: order.id,
        merchantName: merchant?.businessName ?? "Merchant",
        amount: order.amount,
        amountFormatted: formatNaira(order.amount),
        items,
        buyerMasked: maskPhone(buyer),
        method: payment?.railId === "quai" ? "Crypto" : "Bank transfer",
        paidAt: payment?.confirmedAt ?? null,
      });
    }),
  );

  // --- Crypto buyer-facing checkout ---
  // Public order + payment instruction for the checkout page (no auth: buyer-facing).
  server.get(
    "/api/checkout/:orderId",
    asyncRoute(async (req, res) => {
      const order = await app.repos.orders.byId(req.params.orderId!);
      if (!order) throw new NotFoundError("order", { id: req.params.orderId });
      const merchant = await app.repos.merchants.byId(order.merchantId);
      const instruction = await app.payments.requestPayment(order.id); // idempotent
      res.json({
        order: {
          id: order.id,
          amount: order.amount,
          amountFormatted: formatNaira(order.amount),
          rail: order.rail,
          status: order.status,
        },
        merchantName: merchant?.businessName ?? "Merchant",
        instruction,
        quaiMode: app.config.QUAI_ADAPTER_MODE,
        quaiExplorer: app.config.QUAI_EXPLORER_URL,
        // Needed so a wallet sitting on mainnet can be asked to add/switch to
        // the chain this order actually settles on.
        quaiRpcUrl: app.config.QUAI_RPC_URL,
        quaiChainId: app.config.QUAI_CHAIN_ID,
        fx: app.fx.snapshot(),
      });
    }),
  );

  // Buyer's wallet reports the on-chain tx; we verify it against the chain.
  server.post(
    "/api/crypto/confirm",
    asyncRoute(async (req, res) => {
      const { txHash, orderId } = req.body ?? {};
      if (!txHash) throw new ValidationError("txHash required");
      await app.payments.handleRailWebhook("quai", {
        headers: {},
        rawBody: JSON.stringify({ txHash, orderId }),
      });
      res.json({ ok: true });
    }),
  );

  // DEV/mock only: simulate a BlipPay payment so the loop is demoable without a
  // wallet or a live chain. Disabled once QUAI_ADAPTER_MODE=live.
  server.post(
    "/api/crypto/simulate-pay",
    asyncRoute(async (req, res) => {
      if (app.config.QUAI_ADAPTER_MODE !== "mock") {
        throw new ValidationError("simulate-pay is disabled in live mode");
      }
      const { orderId } = req.body ?? {};
      const order = await app.repos.orders.byId(String(orderId));
      if (!order) throw new NotFoundError("order", { id: orderId });
      const merchant = await app.repos.merchants.byId(order.merchantId);
      const rail = app.rails.crypto() as { chain?: import("../rails/mock-quai-chain.js").MockQuaiChain };
      if (!rail.chain) throw new ValidationError("crypto rail not in mock mode");
      // Mirror the real payment instruction (asset, amount, token) so the mock
      // exercises the same confirmation path as a live tx.
      const instruction = await app.payments.requestPayment(order.id);
      const nativeToken = "0x0000000000000000000000000000000000000000";
      const paid = rail.chain.simulatePayment({
        orderId: order.id,
        merchant: merchant?.quaiAddress ?? "0xmerchant",
        token: instruction.tokenAddress ?? nativeToken,
        amount: instruction.cryptoAmount ?? "0",
      });
      await app.payments.handleRailWebhook("quai", {
        headers: {},
        rawBody: JSON.stringify({ txHash: paid.txHash }),
      });
      res.json({ ok: true, txHash: paid.txHash });
    }),
  );

  // --- Traction (the graded metric) — public so judges can watch it live ---
  server.get(
    "/api/traction",
    asyncRoute(async (_req, res) => {
      res.json(await app.traction.snapshot());
    }),
  );

  // --- Admin (bearer = APP_SECRET) — manage merchants over HTTPS. Used to seed
  //     a merchant / set a Quai wallet when direct DB access isn't available. ---
  const requireAdmin = (req: Request): void => {
    const header = req.header("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    const expected = app.config.APP_SECRET;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedError("bad admin token");
    }
  };

  server.post(
    "/admin/merchants",
    asyncRoute(async (req, res) => {
      requireAdmin(req);
      const { phone, businessName, quaiAddress } = req.body ?? {};
      if (!phone || !businessName) {
        throw new ValidationError("phone and businessName required");
      }
      const existing = await app.repos.merchants.byPhone(String(phone));
      const merchant = existing
        ? await app.repos.merchants.update(existing.id, {
            businessName: String(businessName),
            status: "active",
            kycState: "verified",
            cryptoEnabled: true,
            ...(quaiAddress ? { quaiAddress: String(quaiAddress) } : {}),
          })
        : await app.repos.merchants.create({
            id: ref("mch"),
            phone: String(phone),
            businessName: String(businessName),
            status: "active",
            kycState: "verified",
            cryptoEnabled: true,
            quaiAddress: quaiAddress ? String(quaiAddress) : undefined,
          });
      res.json({
        merchant: { id: merchant.id, businessName: merchant.businessName, quaiAddress: merchant.quaiAddress },
        created: !existing,
      });
    }),
  );

  // Diagnostics: pinpoint config/runtime issues without needing server logs.
  server.get(
    "/admin/diag",
    asyncRoute(async (req, res) => {
      requireAdmin(req);
      const out: Record<string, unknown> = {};
      out.fieldKeyLength = app.config.FIELD_ENCRYPTION_KEY.length; // want 64
      try {
        const enc = encryptField("diag-test");
        out.encryption = decryptField(enc) === "diag-test" ? "ok" : "roundtrip-mismatch";
      } catch (e) {
        out.encryption = `ERROR: ${(e as Error).message}`;
      }
      try {
        await app.repos.merchants.list();
        out.dbRead = "ok";
      } catch (e) {
        out.dbRead = `ERROR: ${(e as Error).message}`;
      }
      out.whatsappMode = app.config.WHATSAPP_MODE;
      out.quaiMode = app.config.QUAI_ADAPTER_MODE;
      out.fiatMode = app.config.FIAT_ADAPTER_MODE;
      out.activeFiatRail = app.rails.fiat().id;
      out.monnifyKeySet = !!app.config.MONNIFY_SECRET_KEY;
      out.monnifyContractSet = !!app.config.MONNIFY_CONTRACT_CODE;
      res.json(out);
    }),
  );

  server.get(
    "/admin/debug/webhooks",
    asyncRoute(async (req, res) => {
      requireAdmin(req);
      res.json(waDebug);
    }),
  );

  // Seed believable sales history so a demo merchant's dashboard isn't empty on
  // stage. Writes through the SAME services the real rails use — commerce for
  // the order, ledger.recordSale for the entry — so balances, the weekly summary
  // and CSV export all reconcile exactly as they would for genuine traffic.
  // Body: { merchantId, count?, days? }. Undo with /admin/cleanup.
  server.post(
    "/admin/seed-demo",
    asyncRoute(async (req, res) => {
      requireAdmin(req);
      const { merchantId, count = 8, days = 14 } = req.body ?? {};
      if (!merchantId) throw new ValidationError("merchantId required");
      const merchant = await app.repos.merchants.byId(merchantId);
      if (!merchant) throw new NotFoundError("merchant", { id: merchantId });

      // Reuse the merchant's catalogue; only invent one if they have none, so a
      // seeded demo still shows their real products.
      let products = await app.repos.products.listByMerchant(merchantId);
      if (products.length === 0) {
        const catalogue: [string, number][] = [
          ["Red Lipstick", 5_000],
          ["Gloss Set", 12_000],
          ["Lash Kit", 8_500],
          ["Brow Pencil", 3_500],
        ];
        for (const [name, price] of catalogue) {
          await app.commerce.createProduct({ merchantId, name, price: nairaToKobo(price) });
        }
        products = await app.repos.products.listByMerchant(merchantId);
      }

      const created: string[] = [];
      for (let i = 0; i < Number(count); i++) {
        const product = products[i % products.length]!;
        const qty = 1 + (i % 3);
        const rail = i % 4 === 3 ? "crypto" : "fiat";
        const order = await app.commerce.createOrder({
          merchantId,
          buyerRef: `+23480${String(10000000 + i * 7919).slice(0, 8)}`,
          lines: [{ productId: product.id, qty }],
          rail,
        });
        const payment = await app.repos.payments.create({
          id: ref("pay"),
          orderId: order.id,
          railId: rail === "crypto" ? "quai" : "monnify",
          providerRef: `seed_${order.id.slice(-8)}`,
          instructionType: rail === "crypto" ? "crypto" : "dva",
          amount: order.amount,
          status: "confirmed",
          confirmedAt: new Date(),
        });
        await app.repos.orders.updateStatus(order.id, "paid");
        await app.ledger.recordSale({
          merchantId,
          orderId: order.id,
          paymentId: payment.id,
          amount: order.amount,
        });
        created.push(order.id);
      }
      res.json({ ok: true, merchantId, seeded: created.length, orderIds: created, days });
    }),
  );

  // Cleanup test data: purge whole merchants (cascade) and/or specific orders /
  // products. Postgres-backed (prod). Body: { merchantIds?, orderIds?, productIds? }.
  server.post(
    "/admin/cleanup",
    asyncRoute(async (req, res) => {
      requireAdmin(req);
      if (!app.config.DATABASE_URL) throw new ValidationError("cleanup requires Postgres");
      const { merchantIds = [], orderIds = [], productIds = [] } = req.body ?? {};
      const { prisma } = await import("../db/prisma/client.js");
      const db = prisma();
      const summary: Record<string, number> = {};

      if (orderIds.length) {
        await db.$transaction([
          db.ledgerEntry.deleteMany({ where: { orderId: { in: orderIds } } }),
          db.payment.deleteMany({ where: { orderId: { in: orderIds } } }),
          db.order.deleteMany({ where: { id: { in: orderIds } } }),
        ]);
        summary.orders = orderIds.length;
      }
      if (productIds.length) {
        await db.product.deleteMany({ where: { id: { in: productIds } } });
        summary.products = productIds.length;
      }
      for (const mid of merchantIds) {
        const os = await db.order.findMany({ where: { merchantId: mid }, select: { id: true } });
        const oids = os.map((o) => o.id);
        await db.$transaction([
          db.ledgerEntry.deleteMany({ where: { merchantId: mid } }),
          db.payment.deleteMany({ where: { orderId: { in: oids } } }),
          db.order.deleteMany({ where: { merchantId: mid } }),
          db.product.deleteMany({ where: { merchantId: mid } }),
          db.buyer.deleteMany({ where: { merchantId: mid } }),
          db.merchant.delete({ where: { id: mid } }),
        ]);
      }
      summary.merchants = merchantIds.length;
      res.json({ ok: true, ...summary });
    }),
  );

  // Backfill an embedded Quai wallet for an existing merchant (e.g. one seeded
  // before the wallet feature). Returns the address only — secrets stay in the vault.
  server.post(
    "/admin/merchants/:id/wallet",
    asyncRoute(async (req, res) => {
      requireAdmin(req);
      const merchant = await app.repos.merchants.byId(req.params.id!);
      if (!merchant) throw new NotFoundError("merchant", { id: req.params.id });
      const wallet = await app.wallets.generateCyprus1();
      await app.repos.merchants.setWalletSecrets(merchant.id, wallet.mnemonic, wallet.privateKey);
      await app.repos.merchants.update(merchant.id, { quaiAddress: wallet.address });
      res.json({ merchantId: merchant.id, quaiAddress: wallet.address });
    }),
  );

  // Attach a WhatsApp number to a merchant WITHOUT Embedded Signup — the path
  // for a number added to our own WABA by hand (Meta review pending). Same
  // effect as a completed signup: the merchant becomes a tenant.
  server.post(
    "/admin/merchants/:id/whatsapp",
    asyncRoute(async (req, res) => {
      requireAdmin(req);
      const merchant = await app.repos.merchants.byId(req.params.id!);
      if (!merchant) throw new NotFoundError("merchant", { id: req.params.id });
      const { phoneNumberId, wabaId, displayPhone } = req.body ?? {};
      if (!phoneNumberId) throw new ValidationError("phoneNumberId required");
      const connected = await app.waSignup.attachNumber(merchant, {
        waPhoneNumberId: String(phoneNumberId),
        waBusinessAccountId: wabaId ? String(wabaId) : undefined,
        displayPhone: displayPhone ? String(displayPhone) : undefined,
      });
      res.json(connected);
    }),
  );

  server.get(
    "/admin/merchants",
    asyncRoute(async (req, res) => {
      requireAdmin(req);
      const merchants = await app.repos.merchants.list();
      res.json({
        merchants: merchants.map((m) => ({
          id: m.id,
          businessName: m.businessName,
          status: m.status,
          cryptoEnabled: m.cryptoEnabled,
          quaiAddress: m.quaiAddress,
          waPhoneNumberId: m.waPhoneNumberId,
          waDisplayPhone: m.waDisplayPhone,
        })),
      });
    }),
  );

  // --- Auth: phone-OTP ---
  server.post(
    "/auth/otp/request",
    asyncRoute(async (req, res) => {
      const phone = String(req.body?.phone ?? "");
      await app.auth.requestOtp(phone);
      res.json({ ok: true });
    }),
  );
  server.post(
    "/auth/otp/verify",
    asyncRoute(async (req, res) => {
      const { phone, code } = req.body ?? {};
      const result = await app.auth.verifyOtp(String(phone), String(code));
      res.json(result);
    }),
  );

  // --- Dashboard API (bearer-guarded) ---
  const guard = requireMerchant(app.auth);

  server.get(
    "/api/me",
    guard,
    asyncRoute(async (req: AuthedRequest, res) => {
      const merchant = await app.repos.merchants.byId(req.merchantId!);
      res.json({ merchant });
    }),
  );

  server.get(
    "/api/products",
    guard,
    asyncRoute(async (req: AuthedRequest, res) => {
      res.json({ products: await app.commerce.listProducts(req.merchantId!) });
    }),
  );

  server.post(
    "/api/products",
    guard,
    asyncRoute(async (req: AuthedRequest, res) => {
      const { name, priceNaira, stockQty } = req.body ?? {};
      if (!name || priceNaira == null) throw new ValidationError("name and priceNaira required");
      const product = await app.commerce.createProduct({
        merchantId: req.merchantId!,
        name: String(name),
        price: nairaToKobo(Number(priceNaira)),
        stockQty: stockQty != null ? Number(stockQty) : undefined,
      });
      res.status(201).json({ product });
    }),
  );

  server.get(
    "/api/orders",
    guard,
    asyncRoute(async (req: AuthedRequest, res) => {
      res.json({ orders: await app.repos.orders.listByMerchant(req.merchantId!) });
    }),
  );

  server.post(
    "/api/orders",
    guard,
    asyncRoute(async (req: AuthedRequest, res) => {
      const { buyerPhone, lines, rail, railId } = req.body ?? {};
      const order = await app.commerce.createOrder({
        merchantId: req.merchantId!,
        buyerRef: String(buyerPhone),
        lines,
        ttlMs: 60 * 60 * 1000,
        rail: rail === "crypto" ? "crypto" : "fiat",
      });
      const instruction = await app.payments.requestPayment(
        order.id,
        railId as RailId | undefined,
      );
      res.status(201).json({ order, instruction });
    }),
  );

  // Reveal the embedded wallet's secret phrase — 2FA-gated (bearer token issued
  // only after phone-OTP). Secrets are decrypted here and never logged.
  server.post(
    "/api/wallet/reveal",
    guard,
    asyncRoute(async (req: AuthedRequest, res) => {
      const merchant = await app.repos.merchants.byId(req.merchantId!);
      const secrets = await app.repos.merchants.getWalletSecrets(req.merchantId!);
      if (!merchant?.quaiAddress || !secrets) {
        throw new NotFoundError("wallet", { merchantId: req.merchantId });
      }
      res.set("Cache-Control", "no-store");
      res.json({
        address: merchant.quaiAddress,
        mnemonic: secrets.mnemonic,
        privateKey: secrets.privateKey,
      });
    }),
  );

  server.get(
    "/api/ledger",
    guard,
    asyncRoute(async (req: AuthedRequest, res) => {
      const entries = await app.ledger.entries(req.merchantId!);
      const balance = await app.ledger.balance(req.merchantId!);
      res.json({ balance, balanceFormatted: formatNaira(balance), entries });
    }),
  );

  server.get(
    "/api/summary",
    guard,
    asyncRoute(async (req: AuthedRequest, res) => {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      const summary = await app.ledger.weeklySummary(req.merchantId!, since);
      res.json({
        ...summary,
        totalFormatted: formatNaira(summary.total),
        message: `You sold ${formatNaira(summary.total)} across ${summary.count} orders this week.`,
      });
    }),
  );

  server.get(
    "/api/ledger/export.csv",
    guard,
    asyncRoute(async (req: AuthedRequest, res) => {
      const entries = await app.ledger.entries(req.merchantId!);
      res.header("Content-Type", "text/csv");
      res.header("Content-Disposition", "attachment; filename=ledger.csv");
      res.send(ledgerToCsv(entries));
    }),
  );

  server.get(
    "/api/ledger/statement.txt",
    guard,
    asyncRoute(async (req: AuthedRequest, res) => {
      const merchant = await app.repos.merchants.byId(req.merchantId!);
      const entries = await app.ledger.entries(req.merchantId!);
      res.header("Content-Type", "text/plain");
      res.send(ledgerToStatement(merchant?.businessName ?? "Merchant", entries));
    }),
  );

  // Buyer-facing checkout + shareable receipt + live traction page.
  server.get("/checkout/:orderId", (_req, res) => {
    res.sendFile(resolve("public/checkout.html"));
  });
  server.get("/receipt/:orderId", (_req, res) => {
    res.sendFile(resolve("public/receipt.html"));
  });
  server.get("/traction", (_req, res) => {
    res.sendFile(resolve("public/traction.html"));
  });
  server.get("/privacy", (_req, res) => {
    res.sendFile(resolve("public/privacy.html"));
  });
  server.get("/terms", (_req, res) => {
    res.sendFile(resolve("public/terms.html"));
  });
  server.get("/wallet", (_req, res) => {
    res.sendFile(resolve("public/wallet.html"));
  });
  server.use(express.static(resolve("public")));

  // Serve product images (local object store) + built dashboard, if present.
  server.use("/media", express.static(resolve("media-store")));
  const dashboardDist = resolve("dashboard/dist");
  if (existsSync(dashboardDist)) {
    server.use(express.static(dashboardDist));
    server.get(/^(?!\/api|\/webhooks|\/auth|\/health|\/metrics|\/media).*/, (_req, res) => {
      res.sendFile(join(dashboardDist, "index.html"));
    });
  }

  server.use(errorHandler);
  return server;
}

/** Last four digits only — a receipt gets forwarded, a phone number should not. */
function maskPhone(phone: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length < 4 ? "" : `•••• ${digits.slice(-4)}`;
}

/**
 * Landing page for the Embedded Signup redirect. Self-contained rather than a
 * file in public/: this is the one page a vendor sees mid-OAuth, and it must
 * render even if the static dir or dashboard build is missing.
 */
function signupPage(title: string, body: string): string {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Rhodium</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#faf7f2;
       font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c1a17;padding:24px}
  .card{max-width:32rem;background:#fff;border:1px solid #e8e0d4;border-radius:16px;padding:32px}
  h1{margin:0 0 12px;font-size:1.4rem}
  p{margin:0;color:#5a5348}
</style></head>
<body><main class="card"><h1>${esc(title)}</h1><p>${esc(body)}</p></main></body></html>`;
}
