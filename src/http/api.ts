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
import type { RailId } from "../domain/types.js";
import { ValidationError, NotFoundError, UnauthorizedError } from "../lib/errors.js";
import { timingSafeEqual } from "node:crypto";

/**
 * HTTP surface (§2.1): the two ingress points are (a) provider + WhatsApp
 * webhooks and (b) the merchant dashboard API. Auth is phone-OTP → bearer token.
 */
export function buildApi(app: App): Express {
  const server = express();

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
      const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
      const msg = entry?.messages?.[0];
      if (msg?.type === "text" && msg.from) {
        await app.whatsapp.handleInbound({ from: `+${msg.from}`, text: msg.text.body });
      }
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
      const { buyerPhone, lines } = req.body ?? {};
      const order = await app.commerce.createOrder({
        merchantId: req.merchantId!,
        buyerRef: String(buyerPhone),
        lines,
        ttlMs: 60 * 60 * 1000,
      });
      const instruction = await app.payments.requestPayment(order.id);
      res.status(201).json({ order, instruction });
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
