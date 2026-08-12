# Rhodium × Quai × BlipPay
## Accept crypto in WhatsApp. Keep your books in naira.

*Hackathon entry · Sponsors: Quai Network + BlipPay · Judged on purchase/sales traction*

**Emmanuel Doji** · Founder  |  **Benedict Maigida** · Product  |  **Samaila Solomon Monday** · Engineering

> **Speaker note:** 15 slides, ~5 minutes, then the live demo. The demo is the pitch — slides 6–8 are the ones to slow down on.

---

## 1 · The one sentence

**Rhodium lets a Nigerian WhatsApp merchant accept crypto from a BlipPay wallet — settled straight to the merchant's own wallet, no custody — while the sale still lands in their normal naira ledger.**

Two rails. One ledger. One currency on the books.

> **Speaker note:** Do not say "crypto payments for Africa." Say: *she already sells on WhatsApp, we added a second way to get paid, her books didn't change.*

---

## 2 · The merchant

**Amaka.** Cosmetics seller in Lagos. Her entire storefront is a WhatsApp chat.

Today, without Rhodium, getting paid means:

| Step | What actually happens |
|---|---|
| Buyer pays | Sends a bank-transfer **screenshot** |
| Amaka verifies | Squints at it, checks her banking app, sometimes gets faked |
| Amaka records it | A notebook, or nothing |
| Amaka's history | Doesn't exist — so no credit, no proof of trade |

She isn't asking for a blockchain. She's asking to not lose a sale and to know what she sold.

---

## 3 · What Rhodium already is (before this hackathon)

A working WhatsApp-native commerce system, shipped:

- Merchant onboards over WhatsApp + phone OTP
- Lists a product, sends a payment request **in-chat**
- Buyer transfers to a dedicated virtual account
- **Auto-confirmed with no screenshot** — merchant notified, buyer receipted
- Every sale appends to an **append-only naira ledger** (integer kobo, Serializable writes)
- Reconciliation job, encrypted PII, audit log, CSV/statement export

**14 milestones green. 49 tests passing, including live-Postgres and 50+ tx no-double-count.**

> **Speaker note:** This is the credibility slide. We didn't build a crypto demo — we added a rail to a real product.

---

## 4 · The gap this entry closes

Two people who cannot currently transact:

**The buyer** holds value in crypto, has no bank account or doesn't want to use it.
**The merchant** prices in ₦, thinks in ₦, and must keep books in ₦.

Every existing answer makes one of them do the work: the merchant learns wallets and reconciles two currencies, or the buyer off-ramps first and loses the sale to friction.

**Rhodium makes neither of them change.**

---

## 5 · The insight that makes it a small build

Rhodium shipped a `PaymentRail` interface **on day one**, with a stablecoin adapter written and **dark behind a feature flag**. Non-custody was an invariant from the start: `settlementTarget()` returns `owner: "merchant"` on every rail — there is no custody code path to add.

> This hackathon is literally the task of flipping that seam on.

The new rail satisfies the same interface and emits the same `order.paid` event, so the entire post-payment machine — event bus, ledger, receipts, notifications, reconciliation, idempotency, audit, metrics — is **reused without modification**.

---

## 6 · The demo, in six beats

1. Amaka sends a payment request in WhatsApp: `sell <product> 1 <buyer> **crypto**`
2. Bot returns a link. She forwards it. **The buyer taps it and it opens inside BlipPay.**
3. Checkout shows **₦5,000.00 (~3.13 USDT)** — priced in naira, payable in stablecoin.
4. Buyer taps Pay. **One transaction** to the `RhodiumPay` contract.
5. In **~2ms** after confirmation: merchant notified, buyer receipted, ledger appended — **in naira**.
6. **Traction ticks:** GMV ₦5,000 · sales 1 · buyers 1 · rail split bank 0 / crypto 1.

Then we replay the same transaction on stage. **Ledger entries: still 1.**

> **Speaker note:** This is real output from `npm run demo:crypto`, not a mockup. Run it live.

---

## 7 · No custody — enforced, not promised

`RhodiumPay` is a ~40-line forwarder on Quai. The forward happens **in the same transaction** as the payment:

```solidity
function payToken(bytes32 orderId, address merchant, address token, uint256 amount) external {
    require(IERC20(token).transferFrom(msg.sender, merchant, amount), "transfer failed"); // buyer → merchant
    emit Paid(orderId, merchant, token, amount, msg.sender);
}
```

- The contract **holds nothing between calls.** There is no balance to freeze, drain, or misappropriate.
- It is the exact twin of the fiat rail, where the virtual account settles to the merchant's own bank.
- Keys never leave the buyer's device — BlipPay is self-custody, EIP-1193 signing on-device.
- The claim is **auditable in one transaction**, not a policy paragraph.

---

## 8 · Why the ledger stays in naira

The rail does the currency work so the merchant never has to:

```
order (kobo) ──FX──► USDT micro-units ──buyer pays──► on-chain amount
                                                          │
                              converted BACK to kobo ◄─────┘
                                                          │
   existing kobo integrity check → ledger → receipt → traction  (unchanged)
```

- One ledger, one currency, both rails — a bank sale and a crypto sale sit **side by side**.
- The payment row still stores token, chain amount, and tx hash for audit.
- Idempotency key is the **transaction hash** — chain-unique, so replays are structurally safe.
- Amount matched within a basis-point tolerance to absorb rounding.

---

## 9 · Architecture

```
 WhatsApp / dashboard
         │
 ┌───────┴─────────── PaymentRail (the seam, built day one) ───────────┐
 │  createPaymentInstruction · handleWebhook · verifyPayment           │
 │  settlementTarget → owner:"merchant"   (NO CUSTODY, both rails)     │
 └───────┬──────────────────────────────────────────┬─────────────────┘
         │                                          │
 ┌───────┴────────┐                        ┌────────┴──────────┐
 │ Fiat rail      │  (existing)            │ QuaiRail   (NEW)  │
 │ virtual acct   │                        │ RhodiumPay + BlipPay
 └───────┬────────┘                        └────────┬──────────┘
         │                                          │
         └──────────────► order.paid ◄──────────────┘
                              │
              receipt · naira ledger · traction  ← SAME chain, both rails
```

**Total new surface:** one adapter, an FX helper, a checkout page, three endpoints, one registry line.

---

## 10 · Traction — the graded metric, built first-class

A live page judges can watch, not a screenshot we claim:

| Metric | Why it's the right one |
|---|---|
| **GMV (₦)** | Real value moved, in the merchant's currency |
| **Transaction count** | Repeat use, not one staged demo |
| **Unique buyers** | Breadth, not one wallet paying itself |
| **Rail split** (bank vs crypto) | Proves the crypto rail is additive, not a replacement |

`GET /api/traction` + an auto-refreshing `/traction` page. Every purchase during judging increments it in seconds.

**Zero double-counts is part of the metric:** idempotent on tx hash, provable on stage by replaying.

---

## 11 · Status: what runs today

| | |
|---|---|
| ✅ `RhodiumPay.sol` — forwarder + `Paid` event | written, compiled |
| ✅ `QuaiRail` — instruction / webhook / verify / settlement | implemented against the existing interface |
| ✅ FX kobo ↔ stablecoin units | isolated seam |
| ✅ BlipPay checkout page (EIP-1193) | `public/checkout.html` |
| ✅ `/api/crypto/confirm`, `/webhooks/rails/quai`, `/api/traction` | live |
| ✅ Live traction page | `public/traction.html` |
| ✅ End-to-end crypto demo | `npm run demo:crypto` |
| ✅ Tests | **49 passing**, incl. crypto-rail + ABI + idempotent replay |
| ⏳ Orchard testnet deploy | contract ready; deploy + `QUAI_ADAPTER_MODE=live` is a **flag flip** |

> **Honest note, say it out loud:** the full loop runs mock-backed today, which is why the demo can't fail on stage. Going live is `npm run contracts:deploy` and two env vars. That was deliberate sequencing, not an unfinished feature.

---

## 12 · Why this fits the sponsors

**Quai Network** — EVM-compatible L1, sub-cent fast transactions, plus stable-value assets. Sub-cent matters specifically here: a ₦5,000 lipstick sale cannot carry a dollar of gas. This is a payment rail for real African basket sizes, not a settlement layer for whales.

**BlipPay** — self-custody Quai wallet with an in-app dApp browser and injected EIP-1193 provider. It is the **buyer's checkout surface**: a link that opens into a wallet the buyer already controls, and the payment is two taps. No app install at the moment of purchase, which is exactly where these sales die.

**Rhodium** — brings the merchant, the catalogue, the order, the ledger, and the traction. The parts a chain and a wallet can't supply on their own.

---

## 13 · What we're not claiming

- We are **not** issuing a token.
- We are **not** running FX or custodying crypto.
- The FX rate is a configurable oracle stub for the hackathon (marked `[VALIDATE]`); production swaps in a price feed, and the seam is one file.
- Merchant crypto→naira off-ramp is deferred — funds land in the merchant's wallet; off-ramp is a partner integration.
- Works with any EIP-1193 wallet; we demo BlipPay.

> **Speaker note:** Lead with this before a judge finds it. Naming the limits is what makes the non-custody claim believable.

---

## 14 · Team

| | | |
|---|---|---|
| **Emmanuel Doji** | Founder | Owns the product thesis and the `PaymentRail` architecture — the non-custody invariant and the day-one seam this entry flips on. |
| **Benedict Maigida** | Product | Owns the merchant and buyer experience: the WhatsApp flow, the BlipPay checkout surface, and the traction metrics judges are watching. |
| **Samaila Solomon Monday** | Engineering | Owns the crypto rail internals: the `RhodiumPay` contract, chain integration and confirmation, and ledger/idempotency integrity. |

Three people. Both engineers on the team ship code — one carries the product surface, one carries the rail.

> **Speaker note:** Say the second line out loud. A small team where the product owner also writes code is a feature at this stage, not an apology.

---

## 15 · Where it goes

**Next:** Orchard testnet live, then mainnet · price feed replaces the stub · off-ramp partner so merchants can hold naira if they want.

**The real prize:** every confirmed sale — bank or crypto — is a clean, append-only trade record for a merchant who previously had none. That ledger is the credit file. Crypto acceptance widens the top of it; the naira ledger is what makes it bankable.

**Ask:** Quai + BlipPay ecosystem support to put this in front of the first cohort of Lagos WhatsApp merchants.

---

## Appendix · Run it yourself

```bash
npm run setup          # deps, Postgres, migrate, dashboard
npm run demo:crypto    # the full crypto loop, no credentials needed
npm test               # 49 tests
npm run dev            # API + dashboard + /checkout + /traction on :3000
```

**Docs:** [PRD.md](PRD.md) · [TRD.md](TRD.md) · [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) · [../README.md](../README.md)

**Go-live checklist:** deploy `RhodiumPay` to Orchard (Cyprus1, chain 15000) → set `QUAI_CONTRACT_ADDRESS` + `QUAI_USDT_ADDRESS` → set merchant `quaiAddress` → `QUAI_ADAPTER_MODE=live` → point a watcher at `/webhooks/rails/quai` → fund a BlipPay testnet wallet → one real purchase.
