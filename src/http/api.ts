import express, { type Express, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { App } from "../app.js";
import { asyncRoute, errorHandler } from "./errors.js";
import { requireMerchant, type AuthedRequest } from "./auth-middleware.js";
import { ledgerToCsv, ledgerToStatement } from "./export.js";
import { nairaToKobo, formatNaira } from "../lib/money.js";
import { withTrace } from "../lib/logger.js";
import { ref } from "../lib/ids.js";
import { encryptField, decryptField } from "../lib/crypto.js";
import type { RailId } from "../domain/types.js";
import { ValidationError, NotFoundError, UnauthorizedError } from "../lib/errors.js";
import { timingSafeEqual } from "node:crypto";

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

  server.get("/health", (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
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

  server.post(
    "/webhooks/whatsapp",
    express.json(),
    asyncRoute(async (req: Request, res: Response) => {
      // Parse the Cloud API inbound message envelope.
      const value = req.body?.entry?.[0]?.changes?.[0]?.value;
      const msg = value?.messages?.[0];
      const rec: Record<string, unknown> = {
        at: new Date().toISOString(),
        from: msg?.from,
        type: msg?.type,
        text: msg?.text?.body,
        isStatus: !!value?.statuses,
      };
      try {
        if (msg?.type === "text" && msg.from) {
          const reply = await app.whatsapp.handleInbound({ from: `+${msg.from}`, text: msg.text.body });
          rec.replied = String(reply).slice(0, 80);
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

  // JSON for everything below.
  server.use(express.json());

  // --- Crypto (Quai/BlipPay) buyer-facing checkout ---
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

  // Buyer-facing crypto checkout (opens inside BlipPay) + live traction page.
  server.get("/checkout/:orderId", (_req, res) => {
    res.sendFile(resolve("public/checkout.html"));
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
