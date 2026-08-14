# Rhodium — WhatsApp-Native Merchant Commerce (MVP)

> Get a Lagos merchant to collect a bank-transfer payment inside their existing
> WhatsApp flow, **auto-confirmed with no screenshot**, with a receipt and a
> running ledger — and capture that transaction as clean data.

This repo is the **MVP as drafted** in the implementation plan: the modular
monolith, the `PaymentRail` abstraction (fiat live, stablecoin dark), the
idempotent payment loop, the append-only ledger, the WhatsApp merchant flow, a
thin React dashboard, reconciliation, and a full test suite.

**Two rules that never bend** (both enforced in code):
1. **We never hold funds.** `settlementTarget()` on every rail returns the
   *merchant's* account (`owner: "merchant"`) — there is no custody path.
2. **The `PaymentRail` seam exists from day one.** One fiat adapter is live; the
   stablecoin adapter implements the same interface but refuses while its flag is
   off. Adding Moniepoint / flipping stablecoin on is a registry change, not a
   rewrite.

---

## Repo layout (npm workspaces)

The repo is a monorepo. The API stays at the root — every deploy path
(`Dockerfile`, `render.yaml`, CI) is unchanged — and the other packages are
declared as workspaces alongside it:

| Package | Path | What it is |
|---------|------|------------|
| `rhodium` | `.` (root) | the API / modular monolith |
| `rhodium-dashboard` | `dashboard/` | merchant React SPA (Vite) |
| `rhodium-chain` | `chain/` | `RhodiumPay` contract (Hardhat) |
| `rhodium-landing` | `apps/landing/` | public landing page (Next.js + Tailwind) |

Each package installs and builds independently — add new ones under `apps/`:

```bash
npm run landing:install && npm run landing:dev    # landing page on :3001
npm run dashboard:install && npm run dashboard:build
```

> **Note:** the API's own installs pin `--workspaces=false` (see `Dockerfile`,
> `render.yaml`, `.github/workflows/ci.yml`) so the server image and CI never
> pull in Next.js or Hardhat. Keep that flag if you touch those commands.

## Quick start

```bash
# 1. everything: deps, Postgres (docker), migrate, build dashboard
npm run setup

# 2. run the magic-moment demo (no credentials needed — all mocks)
npm run demo

# 3. run the tests (33 tests incl. live-Postgres + HTTP over the wire)
npm test

# 4. run the server (serves API + dashboard on :3000)
npm run dev        # or: npm run build && npm start
```

`npm run demo` prints the whole loop end-to-end: merchant lists a product →
sends a payment request → buyer "transfers" to a DVA → merchant auto-notified +
buyer receipted + ledger appended **in ~2ms**, a replayed webhook produces **no
double entry**, and daily reconciliation is **clean**.

---

## Architecture (the MVP slice)

```
WhatsApp (merchant+buyer)            Web dashboard (merchant)
      │ webhooks/messages                   │ HTTPS
      ▼                                      ▼
┌──────────────────────────────────────────────────────────┐
│              APPLICATION (modular monolith)                │
│  WhatsApp · Commerce · Payments Orchestrator ·             │
│  Ledger · Notification · Auth · Reconciliation             │
└───────────────┬───────────────────────────┬───────────────┘
                │  PaymentRail interface     │
        ┌───────┴────────┐          ┌────────┴─────────┐
        │ FIAT adapter   │          │ STABLECOIN       │
        │ (Paystack-     │          │ (stub, dark,     │
        │  shaped)       │          │  flag OFF)       │
        └───────┬────────┘          └──────────────────┘
                ▼
┌──────────────────────────────────────────────────────────┐
│  Postgres (merchant/product/order/payment/ledger_entry/   │
│  buyer/processed_event/audit_log) · object store · queue  │
│  (idempotent event processing)                            │
└──────────────────────────────────────────────────────────┘
```

Module map (`src/`):

| Area | Path | Notes |
|------|------|-------|
| Config (validated, fail-fast) | `config/` | mock defaults so it runs with zero creds |
| Domain model + order state machine | `domain/` | `draft→awaiting_payment→paid→…` |
| PaymentRail spine + adapters | `rails/` | interface, Paystack fiat, dark stablecoin, registry |
| Idempotent event bus | `events/` | replayed event ⇒ one side effect; retry + dead-letter |
| Repositories | `db/` | interface + in-memory (tests) + Prisma/Postgres (prod) |
| Commerce | `modules/commerce/` | catalogue, orders, object store |
| Payments orchestrator | `modules/payments/` | DVA, auto-reconcile, poll fallback, event wiring |
| Ledger | `modules/ledger/` | append-only, running balance, weekly summary |
| Notification | `modules/notification/` | confirmation + receipt, WhatsApp→SMS→email fallback |
| WhatsApp | `modules/whatsapp/` | inbound command flow + Cloud API transport |
| Auth | `modules/auth/` | phone-OTP → signed bearer token |
| Metrics / Audit | `modules/metrics/`, `modules/audit/` | incl. WhatsApp conversation cost |
| Reconciliation job | `jobs/` | daily processor-vs-ledger drift alert |
| HTTP | `http/` | webhooks, dashboard API, CSV/statement export |
| Dashboard | `dashboard/` | thin React SPA (Vite) |

## The magic moment, in code

1. `POST /api/orders` → `CommerceService.createOrder` → `PaymentsOrchestrator.requestPayment`
   issues a **DVA** via the fiat rail and returns the account number to show in-chat.
2. Buyer transfers → provider posts to `POST /webhooks/rails/paystack` (raw body,
   HMAC-verified) → `handleRailWebhook` → matches by `providerRef`, checks the
   amount to the kobo, marks the order `paid`, and publishes `order.paid`.
3. The event chain fans out: **ledger append** (append-only, running balance) +
   **merchant confirmation** + **buyer receipt** + **stock decrement**.

**Idempotency has two layers** so a duplicated/replayed webhook can never
double-count: (1) the orchestrator short-circuits an already-confirmed payment;
(2) the event bus dedupes `order.paid` on the provider event's stable key
(backed in Postgres by a unique `processed_event` row that survives restarts).

## Money & integrity

- Money is **integer kobo** everywhere on the payment path — never floats.
- Ledger append runs in a **Serializable** Postgres transaction so `balanceAfter`
  can never race under concurrency (proven by `tests/ledger-integrity.test.ts`).
- **No custody:** funds settle to the merchant's bank via the processor.

## Security / NDPR

- PII (phone, settlement account) is **encrypted at rest** (AES-256-GCM) with a
  blind-index hash for equality lookups — we never query on plaintext PII.
- Webhook signatures verified in constant time; secrets via env/secrets manager.
- Append-only `audit_log` on money-adjacent actions; structured logs with
  PII/secret redaction; per-request trace ids on the payment path.

---

See **[MILESTONES.md](MILESTONES.md)** for the build sequence and status, and
**[CREDENTIALS.md](CREDENTIALS.md)** for exactly what to flip from mock → live
and the `[LEGAL]` gates before launch.
