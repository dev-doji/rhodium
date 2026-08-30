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

## ⚡ START HERE — state as of 2026-08-30

**Nothing is broken except one thing.** A previous session deregistered the
WhatsApp number while attempting a WABA migration. Every other asset survived.

| Thing | State |
|---|---|
| Meta app `1534245258196461` ("Rhodium") | **ALIVE** — was thought deleted, it is not. Its SYSTEM_USER token still works, valid to **2026-10-10** |
| WABA `1057107730180826` ("Rhodium") | **ALIVE**, `account_review_status: APPROVED` |
| Number `+234 803 680 3974` (`1198640330004714`) | **DISCONNECTED** ← the one broken thing. `quality_rating` still GREEN |
| Template `buyer_receipt` | **APPROVED**, still on the WABA |
| Live app | up, commit `50a7e93` |
| Landing + `/privacy` + `/terms` | up on Cloudflare Pages |
| Tests | **105 passing** |

### The one fix — restores the bot in ~1 minute
```bash
T=$(grep '^WHATSAPP_ACCESS_TOKEN=' .env | cut -d= -f2)
curl -X POST "https://graph.facebook.com/v26.0/1198640330004714/request_code" \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"code_method":"SMS","language":"en"}'
# → SMS arrives on +234 803 680 3974
curl -X POST "https://graph.facebook.com/v26.0/1198640330004714/verify_code" \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"code":"<6 DIGITS FROM SMS>"}'
curl -X POST "https://graph.facebook.com/v26.0/1198640330004714/register" \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","pin":"204815"}'
```
PIN **`204815`** — two-step verification was off before this; registering turns
it on. Record it: losing it means a support ticket.

### The Meta mess, explained
There are **two business portfolios with near-identical names**, which caused
every symptom:

| Portfolio | Name | Holds |
|---|---|---|
| `972224245869574` | `"Fonio Labs "` (**trailing space**) | the WABA, the number, the template |
| `1847657433251972` | `"Fonio Labs"` | the new app `1782305146230634`, an empty WABA |

The browser login can reach the second but **not** the first; the system-user
token can reach the first. That mismatch is why "migrate" and "disconnect"
links kept 404ing, and why each attempt minted another empty WABA (there are
now three: `1057107730180826` real, `2059584464807156` and `1523889746086292`
empty).

**Do not create more WABAs.** Either regain access to `972224245869574` (likely
a different Facebook login — check `business.facebook.com` top-right), or use
the number where it already lives. Meta Direct Support can restore portfolio
access with proof of ownership.

### New Meta app (`1782305146230634`) — configured but not in use
- config_id `2564764790611751`, ES **v4**, featureType
  `whatsapp_business_app_onboarding` (Coexistence)
- Meta-**hosted** signup URL goes in `WHATSAPP_SIGNUP_URL`; `connect` appends
  only the signed state (never re-encode the `extras` blob)
- Its redirect_uri is baked as the **onrender** origin, so
  `WHATSAPP_OAUTH_REDIRECT_URI` must be pinned to match exactly, or the token
  exchange fails
- Embedded Signup only works for **app admins** until Tech Provider approval

---

## Live system

| Thing | Value |
|---|---|
| **Legal entity** | **Fonio Labs Limited** (parent; Rhodium is the product) — https://www.foniolabs.xyz. Meta Business Verification matches this name against the CAC certificate character for character, so it is the business-portfolio name and the controller named in both policies. |
| **Landing** | https://www.userhodium.xyz (Cloudflare Pages) — also `/privacy`, `/terms` |
| **App / dashboard** | https://app.userhodium.xyz → Render `rhodium` |
| **Checkout (buyer-facing)** | https://pay.userhodium.xyz → same Render service |
| **App (Render origin)** | https://rhodium-8ocg.onrender.com — keep enabled; old checkout links point here |
| **GitHub** | github.com/dev-doji/rhodium (branch `main`) |
| **DB** | Render Postgres `rhodium-db` (external URL in Render dashboard) |
| **WhatsApp bot number** | **+234 803 680 3974** "Fonio Labs" → `wa.me/2348036803974`, phone_number_id `1198640330004714` — **real** number, no allowlist |
| **Meta app (in use)** | `1534245258196461` "Rhodium" — **NOT deleted**, still alive, owns the working WABA + system-user token |
| **Meta app (new, spare)** | `1782305146230634`, config_id `2564764790611751` — created during the failed migration; usable but its portfolio has no assets |
| **OAuth redirect** | Derives from `MERCHANT_BASE_URL`. Both `https://app.userhodium.xyz/oauth/whatsapp/callback` and the onrender equivalent are live (400 on GET = route healthy). Must match the Meta app's registered URI **character for character**, including whichever is baked into `WHATSAPP_SIGNUP_URL`. |
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
- Paystack was removed in favour of Monnify. **It is coming back** — a live
  Paystack key has now been approved. See "Switch the bank rail to Paystack".

---

## What works (verified)
- **WhatsApp bot (live):** self‑onboarding (business name → account → bank → creates an active merchant + an **embedded Cyprus1 Quai wallet**), vendor commands (`add`, `list`, `link`, `sell`, `ledger`), and a **buyer storefront** via deep link `wa.me/2348036803974?text=shop-<merchantId>` (pick product → choose bank / USDT→naira / QUAI → pay).
- **Embedded wallet + 2FA reveal:** wallet generated at onboarding, secrets encrypted in a vault, revealable at `/wallet` with a WhatsApp code.
- **Ledger, receipts, traction, idempotency, reconciliation** — all wired; sales land in one naira ledger and on `/traction`.
- **Multi‑tenant WhatsApp:** a vendor connects their own number (`connect` →
  Embedded Signup, or the admin route by hand) and buyers who message *them* get
  their shop; Rhodium's number still onboards vendors.
- **105 unit/integration tests green** (incl. live‑Postgres + HTTP over the wire).
- **All ~31 HTTP endpoints tested against the live app — every one green** (health, pages, auth, guarded `/api/*`, buyer, rail webhooks with signature checks, admin). Highlights: Monnify issued a **real reserved account** via the API; forged webhook signatures → 401; live‑mode guards work.

## Hosting

| Piece | Host | Why |
|---|---|---|
| Landing + `/privacy` + `/terms` | **Cloudflare Pages** | free commercially, unlimited domains, no cold start |
| API + dashboard + checkout | **Render** (`rhodium`) | long-running Node: in-memory conversation state + reconciliation job |
| Postgres | Render `rhodium-db` | |
| DNS | Cloudflare | |

**Cloudflare Pages settings** (Git integration, repo `dev-doji/rhodium`):
- Root directory `apps/landing` (it has its own lockfile, so it builds standalone)
- Build command `npm run build`, output directory `out`
- `.node-version` pins 22 — Pages defaults older and Next 16 needs 20+
- `public/_headers` ships the security headers

**Why the API is NOT on Workers.** `ConversationStore` and `HumanTakeoverStore`
are in-memory `Map`s with no isolate affinity on Workers, so a buyer mid-checkout
would lose their catalogue between messages. Add the reconciliation `setInterval`,
Express, and 14 `node:*` imports and it is a rewrite, not a migration. Moving
those two stores into Postgres is the prerequisite if that ever changes.

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

## Multi-tenant WhatsApp (vendors on their own number) — ✅ BUILT

A buyer messages the *vendor's* WhatsApp Business number, says anything, and gets
that vendor's catalogue → product → payment link → pays → vendor notified.
Rhodium's own number keeps doing vendor onboarding. **105 tests green** (was 58);
`npm run demo:whatsapp` drives both paths end to end (acts 12–15, incl. coexistence).

**How tenancy works.** Everything keys off the Meta `phone_number_id` — never a
phone string (there is still no phone normalisation anywhere in this codebase).
- `Merchant.waPhoneNumberId` (unique) + `waBusinessAccountId` + `waDisplayPhone`
  — migration `20260814120000_merchant_wa_phone_number_id`.
  Lookup: `repos.merchants.byWaPhoneNumberId()`.
- Webhook reads `value.metadata.phone_number_id` and passes it as
  `InboundMessage.toPhoneNumberId`.
- `whatsapp-service.ts` `route()`: tenant number → vendor themself gets vendor
  commands, **everyone else gets the catalogue** (never onboarding, and a
  `shop-<other>` deep link is ignored so a vendor's number can't serve a rival).
  Our own id / an unknown id → the old platform behaviour, unchanged.
- Conversation keys are `"<phoneNumberId>:<sender>"`, so one buyer can hold
  separate threads with two shops.
- `transport.send(to, msg, { phoneNumberId })` picks the sending number;
  `NotificationService` passes the merchant's, so receipts + paid-confirmations
  go out from the vendor's number. **This is not cosmetic** — the 24-hour
  free-form window is per number, and the buyer only ever opened one on the
  vendor's.

**Embedded Signup** (`src/modules/whatsapp/embedded-signup.ts`):
- app_id `1534245258196461` · config_id `2976386586040947` (both now in
  `render.yaml`; redirect defaults to `${PUBLIC_BASE_URL}/oauth/whatsapp/callback`).
- Onboarding type: **Independent Tech Provider**.
- `GET /oauth/whatsapp/callback` is live: code → token → `debug_token` for the
  WABA id → `/{waba}/phone_numbers` → `subscribed_apps` → merchant updated.
  The vendor token is used and **discarded** — under tech-provider onboarding our
  own system-user token gains access via the shared WABA, so one token serves
  every tenant and no vendor credential is ever stored.
- The OAuth `state` is HMAC-signed with `APP_SECRET`. The callback is a public
  URL with no session; unsigned merchant ids there would let anyone attach their
  number to someone else's shop.
- Vendor command **`connect`** hands out the signup link (and says plainly that
  it's off when `WHATSAPP_APP_ID`/`CONFIG_ID` are unset).

### Coexistence — the vendor KEEPS her WhatsApp Business app

The default migration path takes a number *away* from the WhatsApp Business app
and wipes the vendor's chat history. For a real trader with existing customers
that is a non-starter. **Coexistence** is Meta's answer: the number runs on the
Business app **and** the Cloud API at once, she keeps chatting personally, and up
to 6 months of history syncs. Onboarded through the same Embedded Signup.
Precondition: she must be on the *WhatsApp Business app* (the free in-place
upgrade from consumer WhatsApp preserves chats).

Coexistence adds three webhook fields, all on **different payload paths** to
normal inbound — which is what keeps them out of the router:

| Field | Path | What we do |
|---|---|---|
| `history` | `data.history[].threads[].messages[]` | ignore (see below) |
| `smb_app_state_sync` | `data.state_sync[]` | ignore — contacts only |
| `smb_message_echoes` | `value.message_echoes[]` | **drives human takeover** |

- **Never let `history` reach the inbound router.** It carries up to 6 months of
  old chat; routed as live messages it would create orders from texts sent last
  March. It misses `value.messages[0]`, so it lands in the existing `skipped`
  branch — there is an HTTP test pinning exactly this.
- **Human takeover** (`human-takeover.ts`): under coexistence the vendor answers
  by hand in her app *while* the bot auto-replies to the same messages — two
  answers to every "hi". Each `smb_message_echoes` mutes the bot on that ONE
  thread for 30 min (`noteVendorReply`). Per conversation, not per number: a
  vendor handling one order personally still wants the other twenty served.
  Muting happens **before** routing, so no conversation state advances and the
  buyer resumes where they left off.
- The webhook **fields themselves are an app-level setting** — tick
  `smb_message_echoes`, `history`, `smb_app_state_sync` in App Dashboard →
  WhatsApp → Configuration. `subscribed_apps` cannot set them. Without
  `smb_message_echoes` every buyer gets two replies.
- Coexistence numbers are capped at **20 msg/sec**; group chats, broadcast lists
  and calls aren't supported API-side. There's a 24h window to consume the
  history sync — **irrelevant to us**, we have no agent inbox and her phone keeps
  everything regardless. Don't let it drive the timeline.

**⚠️ Embedded Signup v2 is deprecated 2026-10-15 and coexistence needs v4.**
Verify `config_id 2976386586040947` is a v4 config in the Meta dashboard — if it
was created as v2 it must be redone, and better to learn that before review
clears than after.

**Still blocked on Meta review + Business Verification** (submitted 2026-08-14),
so the OAuth leg is untested against real Meta. Until it clears, add the vendor
number to the existing WABA by hand and make it a tenant with:
```bash
curl -X POST $APP/admin/merchants/<merchantId>/whatsapp \
  -H "Authorization: Bearer $APP_SECRET" -H 'content-type: application/json' \
  -d '{"phoneNumberId":"<meta id>","wabaId":"1057107730180826","displayPhone":"+234 …"}'
```
That is the same code path the callback ends in (`attachNumber`), so the routing,
sending and receipt behaviour it produces is exactly what signup will produce.
One thing to re-check when review clears: we build the signup URL as a plain
`/dialog/oauth` link with `config_id` (shareable in chat) rather than the JS-SDK
popup Meta's docs lead with.

## NEXT UP — MVP, week of 2026-08-31

Ordered by what blocks what. (1) is the only true blocker.

### 1. Re-register the number — 1 minute
See "START HERE". Until this runs, the bot answers nobody and nothing else can
be demoed.

### 2. Switch the bank rail to Paystack — ~half a day
A **live** Paystack key is now approved, so Paystack replaces Monnify sandbox as
the bank rail. The architecture was built for this: `PaymentRail` is a 4-method
interface (`createPaymentInstruction`, `handleWebhook`, `verifyPayment`,
`settlementTarget`) and `MonnifyFiatRail` is only 181 lines. Copy its shape.

Work:
- `src/rails/paystack-fiat-rail.ts` implementing `PaymentRail`
  - instruction = a **dedicated virtual account** per order (Paystack DVA), so
    the existing "transfer to this account, we detect it" UX is unchanged
  - `handleWebhook` must verify `x-paystack-signature` (HMAC-SHA512 of the raw
    body with the secret key) — mirror how `MonnifyFiatRail` verifies, and note
    `/webhooks/rails/:railId` already passes the RAW body for exactly this
  - **idempotency on the Paystack event id** — the ledger must never
    double-credit a replayed webhook (`tests/ledger-integrity.test.ts` guards it)
- `src/rails/mock-paystack-server.ts` mirroring `mock-monnify-server.ts` so the
  tests and `npm run demo` keep running offline
- register it in `src/rails/registry.ts` (`fiat()`), config in `src/config/index.ts`
- **No-custody rule holds:** settlement must name the MERCHANT's account via a
  subaccount/split, never a Rhodium balance. `settlementTarget()` is where this
  is enforced — see the `processorSubaccountCode` field already on `Merchant`,
  which exists from the original Paystack integration.
- Keep Monnify's files; make the rail a config switch rather than a deletion, so
  a Paystack outage can be reverted in one env var.

### 3. White-label / Tech Provider
Two routes, and the choice is strategic:
- **Own Tech Provider status** — free, but gated on Business Verification then
  Access Verification, *sequentially*. Do not plan an MVP date around it.
- **Ride a BSP** (360dialog or Gupshup Partner API) — their Tech Provider status
  is already approved, so multi-tenant onboarding works immediately; you pay a
  per-message margin. `NotificationTransport` is already an interface with
  `WhatsAppCloudTransport` as one implementation, so a `Dialog360Transport` is a
  sibling class, not a rewrite.

If the MVP must ship next week with vendors on their own numbers, take the BSP.
If vendors can live on Rhodium's number via `shop-<handle>` links for now, stay
on Cloud API and wait out the review.

### 4. Before real money
- Move the in-memory stores to Postgres. `src/events/bus.ts` (idempotency) and
  `src/modules/auth/auth-service.ts` (OTP) are the two that matter — the first
  is what stops a replayed webhook double-crediting a ledger, and it only holds
  on a single instance. This is also the prerequisite for any multi-instance host.
- Wire `buyer_receipt` into `NotificationService.sendReceiptToBuyer`. Receipts
  are sent as free-form text today, which Meta silently drops outside the
  24-hour window — so a bank transfer confirming next morning delivers nothing.
  The template is APPROVED and unused.
- Render free tier sleeps (11.5s cold start measured). $7/mo Starter removes it
  and raises the 2-domain cap.

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
npm test                 # 105 tests
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
