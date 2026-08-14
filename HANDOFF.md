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
| **WhatsApp bot number** | **+234 803 680 3974** "Fonio Labs" → `wa.me/2348036803974`, phone_number_id `1198640330004714` — **real** number, no allowlist |
| **Meta app** | "Rhodium", App ID `1534245258196461` |
| **WABA** | "Fonio Labs" `1057107730180826` (subscribed to the app, `messages` field) |
| **Retired** | Meta test number +1 555‑140‑5536 (`1242060842323233`) — removed from the WABA; any `wa.me/15551405536` link is dead |
| **Demo merchant** | "Amaka Beauty" `mch_31ee64974e03b907`, phone `+2349032621846`, wallet `0x0041bB8fB1087aB6d2026A81277bAC4ad57C357E` |

### Rails — all three LIVE on Render
| Rail | Provider | State | Webhook |
|---|---|---|---|
| **Bank transfer** (naira→bank) | **Monnify** (sandbox) | 🟢 live, verified (issues real reserved accounts) | `/webhooks/rails/monnify` (Transaction completion) |
| **Stablecoin→naira** (off‑ramp) | **OnSwitch** | 🟢 live, verified (USDT‑TRC20 → naira to bank) | `/webhooks/rails/onswitch` |
| **On‑chain crypto** | **Quai Orchard** (RhodiumPay contract) | 🟢 fully verified end‑to‑end — contract deployed, real on‑chain purchase settled merchant‑direct, order marked `paid` | `/webhooks/rails/quai` + `/api/crypto/confirm` |

- **RhodiumPay contract:** `0x0044Fa1a7d871a80c8b1027e75639c7A3Ef0E741` (Quai Orchard, Cyprus1) — verified on‑chain (real runtime bytecode). Explorer: https://orchard.quaiscan.io/address/0x0044Fa1a7d871a80c8b1027e75639c7A3Ef0E741
- **Deployer/buyer wallet:** `0x003280a5a7e5a1F99ee3D87ad2Deaeb8Daef6C02` (funded ~100k test QUAI). Key is `QUAI_PRIVATE_KEY` in `.env`.
- Paystack was **removed**; Monnify is the sole bank rail.

---

## What works (verified)
- **WhatsApp bot (live):** self‑onboarding (business name → account → bank → creates an active merchant + an **embedded Cyprus1 Quai wallet**), vendor commands (`add`, `list`, `link`, `sell`, `ledger`), and a **buyer storefront** via deep link `wa.me/2348036803974?text=shop-<merchantId>` (pick product → choose bank / USDT→naira / QUAI → pay).
- **Embedded wallet + 2FA reveal:** wallet generated at onboarding, secrets encrypted in a vault, revealable at `/wallet` with a WhatsApp code.
- **Ledger, receipts, traction, idempotency, reconciliation** — all wired; sales land in one naira ledger and on `/traction`.
- **58 unit/integration tests green** (incl. live‑Postgres + HTTP over the wire).
- **All ~31 HTTP endpoints tested against the live app — every one green** (health, pages, auth, guarded `/api/*`, buyer, rail webhooks with signature checks, admin). Highlights: Monnify issued a **real reserved account** via the API; forged webhook signatures → 401; live‑mode guards work.

## Deployment
- Render **Blueprint** (`render.yaml`) → web service + free Postgres. Build forces dev deps (`--include=dev`); `--workspaces=false` keeps landing/chain out of the API image.
- **Env vars on Render** (set in dashboard; NOT in git): `FIELD_ENCRYPTION_KEY`, `APP_SECRET`, `WHATSAPP_ACCESS_TOKEN` (60‑day), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `MONNIFY_API_KEY/SECRET/CONTRACT_CODE/WALLET_ACCOUNT_NUMBER`, `ONSWITCH_SERVICE_KEY`, `QUAI_CONTRACT_ADDRESS`, and modes `WHATSAPP_MODE=live`, `FIAT_ADAPTER_MODE=live`, `ONSWITCH_ADAPTER_MODE=live`, `QUAI_ADAPTER_MODE=live`, `ONSWITCH_ASSET=tron:usdt`.
- Admin endpoints are bearer‑guarded by `APP_SECRET`.

---

## In progress / open threads
1. ~~**Quai on‑chain PURCHASE run (last mile).**~~ ✅ **DONE.** Order
   `ord_ee8d9bf9-7234-4a52-8fdb-88db09eb6932` (₦5,000 = 1 QUAI) is now **`paid`**, settled
   merchant‑direct on Orchard.
   - tx [`0x001a0026b704270b414eef4275503f9033cf47774dee931be9f28a9459e95d52`](https://orchard.quaiscan.io/tx/0x001a0026b704270b414eef4275503f9033cf47774dee931be9f28a9459e95d52) — `status 0x1`, one `Paid` log, merchant wallet credited.
   - **The contract was never at fault.** The revert came from the *hand‑rolled,
     offline‑signed* transaction. The identical call sent through the quais SDK
     (`new quais.Contract(...).payNative(...)`, letting `populateQuaiTransaction` set the
     zone‑correct gas price and estimate gas) succeeded first try. The old "reverts with
     all 200k gas consumed while `quai_call` succeeds" symptom was a malformed tx
     envelope — not a Quai value‑transfer quirk, and not the merchant EOA being cold.
   - Repeatable via **`chain/scripts/pay.cjs`** — `npm run contracts:pay -- <orderId> --app <url>`.
     It is the headless twin of `public/checkout.html`: it pulls the *live* payment
     instruction (so the amount and orderId hash can never drift from what the backend
     verifies), sends `payNative`, then POSTs `/api/crypto/confirm`. It refuses to
     double‑pay an order that is already `paid`.
2. **Test data in prod DB** from the endpoint sweep: merchant `mch_2633e2bb196e4795` ("Endpoint Test Merchant"), a few "Endpoint Test Item" / "On‑Chain Demo" products, and unconfirmed orders. New endpoint to clean them: `POST /admin/cleanup` (bearer `APP_SECRET`) with `{ "merchantIds": [...], "orderIds": [...], "productIds": [...] }`. Unconfirmed orders don't show on `/traction`.
   **Still to run.** Use `npm run cleanup:test-data` (`src/smoke/cleanup-test-data.ts`):
   it lists every merchant on the live app, marks the ones matching the test‑data
   rules, prints the exact payload it would send, and **dry‑runs by default** —
   `--confirm` is required to actually delete. It matches on the *merchant*, never on
   product name, because "On‑Chain Demo" products belong to Amaka Beauty (the real
   demo merchant with the paid on‑chain order) and must survive.
   Needs `ADMIN_SECRET` = the **`APP_SECRET` from the Render dashboard** — the local
   `.env` one is different and returns 401 (verified).

## NEXT UP — multi-tenant WhatsApp (vendors on their own number)

**Goal.** A buyer messages the *vendor's* WhatsApp Business number, says anything,
and immediately gets that vendor's catalogue → picks a product → gets a payment
link → pays → the vendor is notified. Rhodium's own number becomes
vendor-onboarding only.

**Embedded Signup is configured** (application under review as of 2026-08-14):
- app_id `1534245258196461` · config_id `2976386586040947`
- redirect_uri `https://rhodium-8ocg.onrender.com/oauth/whatsapp/callback`
- Onboarding type: **Independent Tech Provider** (not Solution Partner — that
  needs someone else's app id and builds under their umbrella).
- Blocked on Meta review + Business Verification. Code can be built meanwhile;
  for the demo, add the vendor number to the existing WABA by hand instead.

**Build order** (start here, cold):
0. `GET /oauth/whatsapp/callback` — exchange `code` → vendor token, read their
   WABA id + `phone_number_id`. This supplies the value everything else keys off.
   Route does not exist yet; the URI 404s today, which is fine for review.
1. `Merchant.waPhoneNumberId` — Prisma schema + migration + repo lookup by it.
2. Webhook resolves the merchant from `value.metadata.phone_number_id` —
   `src/http/api.ts` (~line 85) currently ignores that field entirely.
3. Routing in `whatsapp-service.ts` `route()`: unknown sender on a vendor's
   number → THAT vendor's catalogue (today it falls through to vendor
   onboarding); sender is the vendor → vendor commands.
4. Transport sends **from** the merchant's `phone_number_id`, falling back to the
   global one. `cloud-transport.ts` takes a single id from config today — this is
   the step that touches the most code.
5. Tests for both paths, then verify with `npm run demo:whatsapp`.

**Watch out.** There is no phone normalisation anywhere in the codebase, so key
tenancy off `phone_number_id` (a Meta id), never off a phone string.

## Gotchas learned (so they don't bite again)
- **Quai deploy hang:** `quais` `usePathing` defaults **true** and appends `/prime` for shard discovery; a URL already ending in `/cyprus1` becomes `…/cyprus1/prime` → 404 → every call hangs. Fix: pass the **base** RPC (strip the shard) + a **static network**; pin reads to `Shard.Cyprus1`. Deploy also needs an **IPFS metadata hash** (`ipfs-only-hash`) as the 4th `ContractFactory` arg.
- **~~Agent sandbox blocks the `quais` HTTP client~~ — WRONG, ignore this.** The SDK
  provider works fine from the sandbox; both the contract deploy and the on‑chain
  purchase were run from it. What actually looked like a block was the `usePathing`
  hang above (no request ever left the process). Don't waste time re‑testing this.
- **Never hand‑roll / offline‑sign a Quai tx.** Build it with the quais SDK
  (`Contract`/`Wallet`) and let `populateQuaiTransaction` fill gas price + gas limit for
  the sender's zone. A hand‑built envelope mines and then reverts with `status 0x0` and
  the full gas limit consumed, even though `quai_call` simulates fine — which sends you
  hunting a contract bug that isn't there.
- **Render free tier sleeps.** The first request to a cold instance can fail outright
  (`fetch failed`), not just hang; `chain/scripts/pay.cjs` retries with backoff. If a
  script that talks to the live app dies instantly, wake the app and retry before
  believing the error.
- **Monnify DVA / all Nigerian bank rails** need business KYC/approval for *real* money; sandbox proves the flow only.
- **OnSwitch off‑ramp** supports USDT on tron/ethereum/polygon (NOT base, NOT Quai). Default `tron:usdt`. USDT‑on‑Quai ≠ USDT‑TRC20 — different chains.
- **Switched to the real number** +234 803 680 3974 (`1198640330004714`); the test number
  is gone from the WABA, so the old allowlist limit no longer applies. When switching
  numbers, `WHATSAPP_WA_NUMBER` must move too — it is what builds the buyer
  `wa.me/<digits>?text=shop-<id>` links, and a stale value silently points every buyer
  at a dead number while the vendor side keeps working. Same digits are mirrored in
  `apps/landing/lib/site.ts`.
- **Access token** is a SYSTEM_USER token, valid until **2026-10-10**. Re-issue before then.
- **`.env` had `QUAI_PRIVATE_KEY` glued to `QUAI_CONTRACT_ADDRESS`** on one line (an `echo >>` with no trailing newline) — fixed to separate lines. Watch for it.

## Run locally
```bash
npm install && npm run db:up && npm run prisma:migrate
npm test                 # 58 tests
npm run demo             # bank-transfer magic-moment (mock)
npm run demo:crypto      # crypto magic-moment (mock)
npm run dev              # API + dashboard on :3000
# contracts:
npm --prefix chain run compile
npm run contracts:deploy # deploy RhodiumPay to Orchard (needs QUAI_PRIVATE_KEY funded)
npm run contracts:pay -- <orderId> --app https://rhodium-8ocg.onrender.com
                         # pay a crypto order on-chain, headless (no browser wallet)
ADMIN_SECRET=<render APP_SECRET> npm run cleanup:test-data   # dry run; -- --confirm to delete
```

## Suggested next steps
1. ~~Land the Quai on‑chain purchase~~ ✅ done — order `ord_ee8d9bf9…` is `paid` with a real Quaiscan tx. Re‑run for fresh demo orders with `npm run contracts:pay`.
2. Run `POST /admin/cleanup` to remove the test data.
3. Optionally switch the bot to the real +234 number + publish the Meta app (privacy URL ready) so judges can message it without the allowlist.
4. Record the end‑to‑end demos (WhatsApp → each rail → naira ledger → traction).
