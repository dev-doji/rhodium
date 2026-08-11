# Going live — what needs credentials & the [LEGAL] gates

The MVP runs end-to-end **today** on mocks (no external accounts). Everything
below is a **config swap behind an existing adapter** — no code rewrite. These
are the plan's Phase-0 external dependencies; they are the honest "you must do
this" list, gated on things only the founders/counsel can provide.

## 1. Fiat processor (Paystack)

- **Status:** adapter live in `mock` mode via an in-process simulator that now
  mirrors the **real** Paystack DVA webhook shape (matches on
  `authorization.receiver_bank_account_number`, idempotency on the per-charge
  `reference`).
- **To go live — just TWO env values** (there is **no** separate webhook secret;
  Paystack signs webhooks with the secret key):
  ```
  FIAT_ADAPTER_MODE=live
  PAYSTACK_SECRET_KEY=sk_test_xxx   # sandbox; sk_live_xxx in prod
  ```
  Then in the Paystack dashboard set the webhook URL to
  `https://<host>/webhooks/rails/paystack`.
- **Per-merchant onboarding (no-custody, required):** create a Paystack
  **subaccount** for each merchant (their bank details) and store the returned
  `subaccount_code` on `merchant.processorSubaccountCode`. The live adapter
  **refuses to issue a DVA without it**, so funds always split merchant-direct.
- **Model note:** Paystack DVAs are **per-customer and persistent** (reused
  across a buyer's orders), so `provider_ref` is the account number and is not
  unique; the pending order is matched by account + amount. If you need strict
  one-DVA-per-order, Moniepoint-style dynamic accounts slot in behind the same
  interface. The `verifyPayment` poll fallback is already wired for missed
  webhooks.

## 2. WhatsApp Business Cloud API (direct vs BSP)

- **Status:** transport live in `mock` mode (captures sends); inbound webhook +
  subscription handshake implemented (`GET/POST /webhooks/whatsapp`).
- **To go live:** set `WHATSAPP_MODE=live`, `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`.
- **Phase-0 task:** start business verification + first message template NOW
  (approval has lead time). Decide direct vs BSP — it's a token/id swap here.

## 3. Object store (product images)

- **Status:** local filesystem store (`OBJECT_STORE_MODE=local`).
- **To go live:** set `OBJECT_STORE_MODE=s3` + S3 creds and add the S3 `put`
  implementation (interface already in `modules/storage/object-store.ts`).

## 4. Secrets & encryption

- Set a real 32-byte `FIELD_ENCRYPTION_KEY` (hex) and `APP_SECRET`. Production
  config **refuses to boot** with the placeholder key or `live` mode without
  credentials (see `src/config/index.ts`).

## 5. Stablecoin rail — BUILT but DARK ⚠️

- Implements `PaymentRail`, refuses every call while `FEATURE_STABLECOIN_ENABLED=false`.
- **Do not enable** until **[LEGAL]** confirms VASP classification. Flesh out on
  **testnet** first, per-merchant flag, settling merchant-direct (no crypto
  custody, no FX by us).

---

## [LEGAL] gates (counsel required — not legal advice)

- [ ] Confirm the **no-custody fiat flow** avoids PSSP/PSP licensing triggers.
- [ ] Scope credit + crypto structures for later acts.
- [ ] VASP classification **before** enabling the stablecoin rail.
- [ ] NDPR review of PII handling (encryption + retention) before scale-up.

## MVP success gate (§1.6) — instrument, then decide

Wired as metrics (`GET /metrics`): activation, retention, volume/merchant, take
rate, and **WhatsApp conversation cost** (first-class from day one). Reliability
target — *zero lost/double-counted payments* — is enforced by idempotency + the
daily reconciliation job and covered by tests.
