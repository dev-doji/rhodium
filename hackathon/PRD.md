# PRD — Rhodium × Quai × BlipPay
## "Accept crypto in WhatsApp. Keep your books in naira."
*Hackathon entry · Sponsors: Quai Network (qu.ai) + BlipPay (blippay.me) · Judged on: real purchase/sales traction*

---

## 1. One-line pitch
Rhodium already lets a Lagos WhatsApp merchant collect a bank transfer, auto-confirm it, and keep a clean ledger. **This entry lets that same merchant accept QUAI / QI / USDT from a BlipPay wallet — settled directly to the merchant, no custody — and every crypto sale lands in the same naira ledger that proves traction.**

## 2. Why this fits the sponsors
- **Quai Network** is an EVM-compatible L1 with fast, sub-cent transactions and a stablecoin-like asset (QI) plus USDT. That's a real payment rail for African commerce.
- **BlipPay** is a self-custody Quai wallet with an in-app dApp browser + injected EIP-1193 provider. It is the *buyer's checkout surface*: a buyer opens the payment link inside BlipPay and pays in two taps.
- **Rhodium** already has the merchant, the catalogue, the order, the ledger, and — critically — a `PaymentRail` abstraction with a **dark crypto stub built on day one**. The hackathon is literally the task of flipping that seam on. Minimal rewrite, maximum working surface.

## 3. Primary user story (the one we demo)
> **As Amaka**, a WhatsApp cosmetics seller in Lagos, **I want** to accept payment from a buyer who holds crypto in their BlipPay wallet, **so that** I don't lose the sale — and I want the money to land in *my own* wallet and the sale to show up in my naira sales records automatically, **so that** my books and my growing sales history stay in one place.

**Acceptance (this is the demo):**
1. Amaka sends a product's payment request in WhatsApp; she picks "crypto" for this buyer.
2. The buyer taps the link, which opens Rhodium checkout **inside BlipPay**.
3. Checkout shows the price in ₦ and its live USDT equivalent; the buyer taps **Pay**.
4. BlipPay signs one transaction to the **RhodiumPay** contract, which forwards the funds to **Amaka's wallet in the same transaction** (Rhodium never holds funds) and emits a `Paid(orderId, …)` event.
5. Within seconds Amaka is auto-notified, the buyer gets a receipt, and the sale appears in her ledger **in naira** — exactly like the bank-transfer flow.
6. The **traction dashboard** ticks up: +1 sale, +₦ GMV, +1 unique buyer, tagged `crypto`.

## 4. Secondary user stories
- *As a buyer with only crypto*, I can pay a naira-priced order without a bank account, from a wallet I control.
- *As Amaka*, I can see one ledger + one traction view across **both** rails (bank transfer and crypto).
- *As a judge*, I can watch real transactions accrue on a live traction page (GMV, tx count, unique buyers, rail split) — the required "purchase/sales traction."

## 5. Scope
### In (MVP)
| # | Feature | Notes |
|---|---------|-------|
| 1 | Crypto order creation | reuse existing order/commerce; `rail = "crypto"` |
| 2 | `RhodiumPay` forwarder contract on Quai | atomic forward to merchant → **no custody**; emits `Paid` |
| 3 | Quai/BlipPay `PaymentRail` adapter | fills the existing dark stub; create instruction / confirm / verify |
| 4 | BlipPay checkout page (EIP-1193) | connect wallet, pay, report tx |
| 5 | On-chain → confirm → **same** `order.paid` chain | receipt + ledger, unchanged downstream |
| 6 | NGN↔USDT display + kobo-normalized ledger | merchant books stay in naira |
| 7 | **Traction dashboard** (GMV, tx, buyers, rail split) | the judged metric, first-class |

### Out (deferred, seams noted)
- Multi-hop QUAI↔QI conversion / on-chain FX (use USDT for stable value; QUAI/QI accepted, valued via rate).
- Merchant crypto→naira off-ramp (funds land in the merchant's wallet; off-ramp is a later partner).
- Non-BlipPay wallets (works with any EIP-1193 wallet, but we demo BlipPay).

## 6. Success criteria — traction-first
- **≥1 real end-to-end crypto purchase** on Quai testnet via BlipPay during judging (hard requirement).
- A **live traction page** showing cumulative **GMV, transaction count, unique buyers**, split by rail, updating as purchases happen.
- **Zero custody**: an auditable claim — funds move buyer → merchant in a single contract call; Rhodium is never a holder.
- **Zero double-counts**: on-chain confirmations are idempotent on the tx hash (reuses existing guarantee).
- Same-ledger proof: a bank-transfer sale and a crypto sale appear side by side in one naira ledger.

## 7. Non-goals / honesty
- We are **not** issuing a token, running FX, or custodying crypto.
- The FX rate for display/valuation is a configurable oracle stub for the hackathon (marked `[VALIDATE]`); production would use a price feed.
