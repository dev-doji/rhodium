# Rhodium — Handoff Note

**What it is:** WhatsApp‑native merchant commerce for Nigeria. A vendor onboards,
lists products, and sells — all inside WhatsApp. Buyers pay by **bank transfer**,
**stablecoin→naira**, or **on‑chain QUAI**, and every sale lands in one naira
ledger + a live traction board. Buildathon entry aligned to **Quai + BlipPay**.

**Core design:** modular monolith (TypeScript/Node + Express + Postgres/Prisma).
Every payment method implements one `PaymentRail` interface, so rails are
swappable and all funnel into the same `order.paid → receipt → ledger` chain.
**No custody:** every rail settles to the *merchant* (bank or their own wallet).

---

## Live system

| Thing | Value |
|---|---|
| **App (Render)** | https://rhodium-8ocg.onrender.com |
| **GitHub** | github.com/dev-doji/rhodium (branch `main`) |
| **DB** | Render Postgres `rhodium-db` (external URL in Render dashboard) |
| **WhatsApp bot number** | +1 555‑140‑5536 → `wa.me/15551405536` (Meta **test** number) |
| **Meta app** | "Rhodium", App ID `1534245258196461` |
| **WABA** | "Fonio Labs" `1057107730180826` (subscribed to the app, `messages` field) |
| **Real number (not yet used)** | +234 803 680 3974 → phone_number_id `1198640330004714` |
| **Demo merchant** | "Amaka Beauty" `mch_31ee64974e03b907`, phone `+2349032621846`, wallet `0x0041bB8fB1087aB6d2026A81277bAC4ad57C357E` |

### Rails — all three LIVE on Render
| Rail | Provider | State | Webhook |
|---|---|---|---|
| **Bank transfer** (naira→bank) | **Monnify** (sandbox) | 🟢 live, verified (issues real reserved accounts) | `/webhooks/rails/monnify` (Transaction completion) |
| **Stablecoin→naira** (off‑ramp) | **OnSwitch** | 🟢 live, verified (USDT‑TRC20 → naira to bank) | `/webhooks/rails/onswitch` |
| **On‑chain crypto** | **Quai Orchard** (RhodiumPay contract) | 🟢 contract deployed + app live; **purchase run in debug** (see below) | `/webhooks/rails/quai` + `/api/crypto/confirm` |

- **RhodiumPay contract:** `0x0044Fa1a7d871a80c8b1027e75639c7A3Ef0E741` (Quai Orchard, Cyprus1) — verified on‑chain (real runtime bytecode). Explorer: https://orchard.quaiscan.io/address/0x0044Fa1a7d871a80c8b1027e75639c7A3Ef0E741
- **Deployer/buyer wallet:** `0x003280a5a7e5a1F99ee3D87ad2Deaeb8Daef6C02` (funded ~100k test QUAI). Key is `QUAI_PRIVATE_KEY` in `.env`.
- Paystack was **removed**; Monnify is the sole bank rail.

---

## What works (verified)
- **WhatsApp bot (live):** self‑onboarding (business name → account → bank → creates an active merchant + an **embedded Cyprus1 Quai wallet**), vendor commands (`add`, `list`, `link`, `sell`, `ledger`), and a **buyer storefront** via deep link `wa.me/15551405536?text=shop-<merchantId>` (pick product → choose bank / USDT→naira / QUAI → pay).
- **Embedded wallet + 2FA reveal:** wallet generated at onboarding, secrets encrypted in a vault, revealable at `/wallet` with a WhatsApp code.
- **Ledger, receipts, traction, idempotency, reconciliation** — all wired; sales land in one naira ledger and on `/traction`.
- **~54 unit/integration tests green** (incl. live‑Postgres + HTTP over the wire).
- **All ~31 HTTP endpoints tested against the live app — every one green** (health, pages, auth, guarded `/api/*`, buyer, rail webhooks with signature checks, admin). Highlights: Monnify issued a **real reserved account** via the API; forged webhook signatures → 401; live‑mode guards work.

## Deployment
- Render **Blueprint** (`render.yaml`) → web service + free Postgres. Build forces dev deps (`--include=dev`); `--workspaces=false` keeps landing/chain out of the API image.
- **Env vars on Render** (set in dashboard; NOT in git): `FIELD_ENCRYPTION_KEY`, `APP_SECRET`, `WHATSAPP_ACCESS_TOKEN` (60‑day), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `MONNIFY_API_KEY/SECRET/CONTRACT_CODE/WALLET_ACCOUNT_NUMBER`, `ONSWITCH_SERVICE_KEY`, `QUAI_CONTRACT_ADDRESS`, and modes `WHATSAPP_MODE=live`, `FIAT_ADAPTER_MODE=live`, `ONSWITCH_ADAPTER_MODE=live`, `QUAI_ADAPTER_MODE=live`, `ONSWITCH_ASSET=tron:usdt`.
- Admin endpoints are bearer‑guarded by `APP_SECRET`.

---

## In progress / open threads
1. **Quai on‑chain PURCHASE run (last mile).** Created crypto order `ord_ee8d9bf9-7234-4a52-8fdb-88db09eb6932` (₦5,000 = 1 QUAI). Signed a `payNative(orderId, merchant)` tx offline (Quai type‑0 uses `gasPrice`, not EIP‑1559; reads need the shard suffix stripped + a static network — see `chain/scripts/deploy.cjs`). Broadcast **succeeds and mines**, but the tx **reverts** (`status 0x0`, gasUsed = full 200k, 0 logs), even though `quai_call` simulation of the identical call **succeeds** (`estimateGas` ≈ 93k). To‑do: figure out why execution reverts when the simulation passes — try quais‑native `sendTransaction` from the user's machine (the SDK provider hangs in the agent sandbox), a higher/estimated gasLimit, or a Quai value‑transfer quirk when the merchant EOA first receives value. Once a tx confirms on‑chain, `POST /api/crypto/confirm {orderId, txHash}` closes the loop (backend reads the receipt + decodes the `Paid` event).
2. **Test data in prod DB** from the endpoint sweep: merchant `mch_2633e2bb196e4795` ("Endpoint Test Merchant"), a few "Endpoint Test Item" / "On‑Chain Demo" products, and unconfirmed orders. New endpoint to clean them: `POST /admin/cleanup` (bearer `APP_SECRET`) with `{ "merchantIds": [...], "orderIds": [...], "productIds": [...] }`. Unconfirmed orders don't show on `/traction`.

## Gotchas learned (so they don't bite again)
- **Quai deploy hang:** `quais` `usePathing` defaults **true** and appends `/prime` for shard discovery; a URL already ending in `/cyprus1` becomes `…/cyprus1/prime` → 404 → every call hangs. Fix: pass the **base** RPC (strip the shard) + a **static network**; pin reads to `Shard.Cyprus1`. Deploy also needs an **IPFS metadata hash** (`ipfs-only-hash`) as the 4th `ContractFactory` arg.
- **Agent sandbox blocks the `quais` HTTP client** (raw `fetch`/`curl` to the RPC work, the SDK provider doesn't) — run chain scripts from a real terminal.
- **Monnify DVA / all Nigerian bank rails** need business KYC/approval for *real* money; sandbox proves the flow only.
- **OnSwitch off‑ramp** supports USDT on tron/ethereum/polygon (NOT base, NOT Quai). Default `tron:usdt`. USDT‑on‑Quai ≠ USDT‑TRC20 — different chains.
- **WhatsApp test number** only messages allowlisted recipients; going fully open needs the real +234 number in Live mode (privacy policy at `/privacy` already added).
- **`.env` had `QUAI_PRIVATE_KEY` glued to `QUAI_CONTRACT_ADDRESS`** on one line (an `echo >>` with no trailing newline) — fixed to separate lines. Watch for it.

## Run locally
```bash
npm install && npm run db:up && npm run prisma:migrate
npm test                 # ~54 tests
npm run demo             # bank-transfer magic-moment (mock)
npm run demo:crypto      # crypto magic-moment (mock)
npm run dev              # API + dashboard on :3000
# contracts:
npm --prefix chain run compile
npm run contracts:deploy # deploy RhodiumPay to Orchard (needs QUAI_PRIVATE_KEY funded)
```

## Suggested next steps
1. Land the Quai on‑chain purchase (run the sign+broadcast from a real terminal / debug the revert), then confirm via `/api/crypto/confirm` and watch `/traction` tick with a real Quaiscan tx.
2. Run `POST /admin/cleanup` to remove the test data.
3. Optionally switch the bot to the real +234 number + publish the Meta app (privacy URL ready) so judges can message it without the allowlist.
4. Record the end‑to‑end demos (WhatsApp → each rail → naira ledger → traction).
