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

## ⚡ START HERE — state as of 2026-09-03

**Nothing is broken.** The system is live and took real money. A demo ran on
2026-09-02; three pieces of feedback came out of it and they are the work.

| Thing | State |
|---|---|
| Live app | up on Render, commit `aab4033` |
| Tests | **149 passing** |
| WhatsApp bot | **+234 911 046 1379** (`phone_number_id` in Render env) — live, answers buyers |
| Bank rail | **Paystack, LIVE key**, dedicated virtual accounts. Two real ₦100 payments confirmed end to end |
| Stablecoin rail | `evm_stable` built (USDC/USDT), contract not yet deployed to Arbitrum Sepolia |
| Receipts | PNG + PDF with Rhodium and vendor logos, attached to both WhatsApp messages |
| Dashboard login | fixed (phone normalisation) — `09032621846`, `+2349032621846`, `2349032621846` all resolve to one merchant |

### ~~Paystack webhook URL~~ — ✅ SAVED 2026-09-03

The **Live Webhook URL** is now saved in the Paystack dashboard:

```
https://app.userhodium.xyz/webhooks/rails/paystack
```

Background: both real ₦100 payments had confirmed only via the manual
`/api/checkout/:orderId/verify` poll, never via a `charge.success` webhook,
because the URL was unsaved — so every payment depended on the buyer's browser
staying open. That is fixed.

Signature is HMAC-SHA512 over the raw body using the **secret key** — Paystack
has no separate webhook secret.

**Not yet proven end to end.** No `charge.success` has been observed arriving
since the URL was saved. Confirm with one real ₦100 purchase: the order should
reach `paid` **without** the checkout tab open, and a receipt image should land
on WhatsApp. That single run also closes out demo-feedback item 2.

---

## 🔴 NEXT UP — demo feedback, 2026-09-02

Three items, verbatim from the demo:

> "when a merchant is onboarding and enters a non-existing or invalid account
> number, the system currently accepts it without verifying the account details."

> "I bought a wireless mouse everything went through but then after the payment
> I didn't get a receipt"

> "someone suggested if it'll be possible for them to see a picture of what they
> are ordering. Probably the vendor/merchant can add the picture when creating a
> product to sell."

### 1. Validate the bank account at onboarding — ~1 hour ⬅ the real work

**Today:** [`whatsapp-service.ts`](src/modules/whatsapp/whatsapp-service.ts)
case `onboard:account_number` checks only `/^\d{10}$/`. Any ten digits are
accepted, and the merchant finds out their money has nowhere to go on their
first sale.

**Fix:** after the bank is picked (case `onboard:bank`, where both the account
number and the bank code are known), call Paystack:

```
GET https://api.paystack.co/bank/resolve?account_number=<10 digits>&bank_code=<code>
Authorization: Bearer <PAYSTACK_SECRET_KEY>
```

**This is already proven** — it was used to resolve `9032621846` to
`EMMANUEL GONI DOJI`. It returns `{ status: true, data: { account_name } }`,
or `status: false` with a message for a bad pair.

Then confirm the name back rather than silently accepting it — a typo that
resolves to a *different real person* is the dangerous case:

```
We found: *EMMANUEL GONI DOJI*
Is that you? Reply *yes* to confirm, or *no* to re-enter.
```

Notes:
- Resolution is what Paystack itself needs to create the DVA, so a merchant who
  fails here would have failed later anyway — just after their first sale.
- Add a new conversation state (`onboard:confirm_account`), don't overload one.
- Paystack can be slow or down. Do **not** hard-block onboarding on a network
  error: on a non-`false` failure, let them through and flag the merchant for
  review. Blocking signup on someone else's uptime is worse than the bug.

### 2. The missing receipt — **already fixed; verify, don't rebuild**

Investigated on 2026-09-03. **The receipt code was never at fault.**

Facts:
- Every wireless-mouse order in production is `status = awaiting_payment` with a
  `pending` payment — including `ord_c6a9b031-…afcff` (₦12,000, paystack,
  2026-09-02 13:15:16).
- Paystack's live account has **exactly two transactions ever, both ₦100**.
  There is no ₦12,000 payment. **The money never arrived.**
- That order's `provider_ref` is the *order id*, not a DVA account number —
  it predates the webhook-matching fix, so it could not have confirmed even if
  it had been paid.

**What the buyer actually saw:** the old checkout page called `paid()` when its
poll loop expired, so it displayed *"Payment confirmed · Receipt sent via
WhatsApp"* to someone who had not paid. They reasonably expected a receipt.

Both causes are fixed and deployed:
- `pollPaid()` in [`checkout.html`](public/checkout.html) polls indefinitely and
  never calls `paid()` on timeout.
- The Paystack webhook now matches on `metadata.receiver_account_number` ??
  `authorization.receiver_bank_account_number` (real payloads carry no
  `order_id`), and `providerRef` is the DVA account number.

**To close this out:** save the Live Webhook URL (top of this file), then run one
real ₦100 purchase through and confirm a receipt image lands on WhatsApp. Do not
rewrite receipt code — it works.

### 3. Product images — ~half a day

Most of it exists already:
- `Product.imageUrl` is on the type ([`types.ts:54`](src/domain/types.ts#L54))
- `CommerceService.createProduct` already accepts an image and stores it via
  `ObjectStore` ([`commerce-service.ts:47-60`](src/modules/commerce/commerce-service.ts#L47-L60))

Missing:
- **The webhook drops non-text messages.** [`api.ts`](src/http/api.ts) only
  handles `msg?.type === "text"`, so a photo a vendor sends is silently
  discarded. Handle `type === "image"`, pull `image.id`, then
  `GET /{media-id}` → follow the returned URL **with the bearer token attached**
  (Meta's media URLs are not public) to fetch the bytes.
- **Add a photo step** to the add-product flow: after the price, "Send a photo of
  it, or type *skip*."
- **Show it to buyers.** The catalogue is text today. `sendImage` already exists
  on the transport ([`cloud-transport.ts:73`](src/modules/whatsapp/cloud-transport.ts#L73))
  and takes a public URL — the same mechanism receipts use. Also render it on
  [`checkout.html`](public/checkout.html), where a buyer is deciding whether to
  actually pay.

Trap: media ids expire and the bytes are Meta's, not ours. Download and put them
in the `ObjectStore` at receive time; never store a Meta URL in `imageUrl`.

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
| **WhatsApp bot number** | **+234 911 046 1379** → `wa.me/2349110461379`. `WHATSAPP_PHONE_NUMBER_ID` is in the Render dashboard. The old +234 803 680 3974 (`1198640330004714`) is retired — links to it are dead |
| **Meta app (in use)** | `1782305146230634`, config_id `2564764790611751` — **the new registration (2026-09-03)**, v4 hosted Embedded Signup. This is the live one |
| **Meta app (previous)** | `1534245258196461` "Rhodium" with config_id `2976386586040947` (v2) — superseded, and no longer referenced anywhere in git |
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
- app_id `1782305146230634` · config_id `2564764790611751` — **v4**, used via
  Meta's *hosted* signup page (`WHATSAPP_SIGNUP_URL`), not the self-built dialog
  link. Redirect defaults to `${PUBLIC_BASE_URL}/oauth/whatsapp/callback`.
  Both values are dashboard-set, not in git — see the drift note below.
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

### ~~Embedded Signup v2 deprecation~~ — ✅ RESOLVED by re-registering

A **new Meta app was registered on 2026-09-03**: `1782305146230634` with
config_id `2564764790611751`, a **v4** config served from Meta's hosted signup
page. The old v2 config `2976386586040947` is superseded, so the
2026-10-15 deprecation no longer bites. A **new WABA + the new number
+234 911 046 1379** came with it, replacing the retired +234 803 680 3974.

### ~~DRIFT — the new registration was not wired into deploy config~~ — ✅ FIXED

The re-registration had not reached deploy config, and nothing baked into git is
allowed to carry these values any more. **No ids, config ids, signup URLs or
phone numbers are hardcoded outside tests.** Everything is dashboard-set:

| Where | Was | Now |
|---|---|---|
| `render.yaml` | `WHATSAPP_APP_ID` / `WHATSAPP_CONFIG_ID` pinned to the old app + v2 config; no `WHATSAPP_SIGNUP_URL` key at all | all three `sync: false`, plus `WHATSAPP_WA_NUMBER` |
| `apps/landing/lib/site.ts` | defaulted to the dead `2348036803974` | no default — the build **throws** if `NEXT_PUBLIC_WHATSAPP_NUMBER` is unset |
| `dashboard/src/App.tsx` | the WhatsApp nav link hardcoded the dead number | reads `waNumber` from `/api/me`, which now returns `config.WHATSAPP_WA_NUMBER` |
| `src/smoke/seed-demo-stores.ts` | same dead fallback | throws rather than print dead shop links |

**⚠️ Set these in the Render dashboard before the next deploy** — they are no
longer in git, so a deploy without them leaves Embedded Signup unconfigured and
`connect` will tell vendors it is off:

- `WHATSAPP_APP_ID`, `WHATSAPP_CONFIG_ID` — the new app + v4 config
- `WHATSAPP_SIGNUP_URL` — Meta's hosted page, pasted verbatim (the `extras`
  blob is percent-encoded and must survive byte for byte)
- `WHATSAPP_WA_NUMBER` — the bot's wa.me digits
- and on **Cloudflare Pages**: `NEXT_PUBLIC_WHATSAPP_NUMBER`, same digits

Also re-check `WHATSAPP_APP_SECRET` and `WHATSAPP_ACCESS_TOKEN`: they belong to
an *app*, and the app changed. A leftover pair from the old app fails webhook
signature verification and sending.

**Also re-confirm the WABA id.** `1057107730180826` is hardcoded in the manual
attach-number curl below and recorded in the table above. If the new
registration created a new WABA, that id is stale too.

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

## ✅ DONE — MVP week of 2026-08-31 (kept for context)

Items 1 and 2 are complete. 3 and 4 are still open.

### 1. ~~Re-register the number~~ — DONE
Replaced with a new number, **+234 911 046 1379**. Old note below.

<details><summary>original</summary>
See "START HERE". Until this runs, the bot answers nobody and nothing else can
be demoed.

</details>

### 2. ~~Switch the bank rail to Paystack~~ — DONE, live key, real money through it
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

## NEXT — Arbitrum + stablecoin rail (Arbitrum Singapore Buildathon)

**Goal.** Chain-agnostic **stablecoin-only** crypto rail: buyer pays USDC (or
USDT) on an EVM chain, merchant is paid direct, order settles into the same
naira ledger. Retires the native-token (QUAI) path.

### Decisions taken

**1. Arbitrum Sepolia for the demo, mainnet by config.**
- Sepolia USDC `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`
- Arbitrum One USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (Circle-issued
  NATIVE, not bridged `USDC.e` — different contract, confuses wallets)
- Judges get free testnet USDC from faucet.circle.com (20 per address / 2h).
  Real money in a demo is a liability, not a flourish.

**2. `approve` + `payToken` first; EIP-2612 `permit` as a fast-follow.**
Two wallet confirmations is real drop-off, and USDC does implement permit — but
it needs verifying against Arbitrum's deployment, and a working payment beats a
shorter one. The instruction shape leaves room for either.

**3. Stablecoins only; Quai stays registered but is no longer the default.**
Same pattern as Monnify: an old rail kept loaded so historical orders remain
explicable and a revert is one env var, while new crypto orders route elsewhere.

### Why this is smaller than it looks
`RhodiumPay.payToken()` **already does the job** — `transferFrom` buyer →
merchant, emits `Paid(orderId, merchant, token, amount, payer)`, never holds a
balance. Plain Solidity 0.8.20, and Arbitrum is EVM-equivalent. The contract is
redeployed unchanged.

EVM wallets are also *easier* than Quai: MetaMask and WalletConnect work
normally — no per-origin app wallets, no `blip_requestAppWalletFunding`, no
bespoke provider detection.

### Traps
- **USDC is 6 decimals, not 18.** The Quai code assumes 18 for native. Getting
  this wrong overcharges a buyer by 10^12. Highest-risk line in the port.
- **`withinTolerance` allows 150bps for `kind === "crypto"`.** Correct for a
  volatile token, wrong for a pegged one — a stablecoin should match near-exactly
  like fiat, or an underpayment silently passes.
- **Pricing gets SIMPLER.** A stablecoin is ~1 USD, so it is ₦ ÷ FX_NGN_PER_USD.
  No live oracle needed on this rail; the CoinGecko dependency is Quai-only.
- Use Circle-issued native USDC, never bridged `USDC.e`.

### Also queued
**Receipt images.** WhatsApp sends an image by public URL, and the receipt is
already public at an unguessable id. Build the SVG from the design tokens →
PNG via `@resvg/resvg-js` (Rust/WASM, no system deps — `node-canvas` and
Puppeteer are both wrong on a free tier that cold-starts in 11s). Send the link
as text AND the image: an image cannot be copy-pasted or forwarded as easily.

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
