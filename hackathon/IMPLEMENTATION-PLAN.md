# Implementation Plan + MVP — Rhodium × Quai × BlipPay
*~24h build. Sequence matters more than the hours. Traction is the graded output, so it is built first-class, not last.*

---

## MVP definition (what "done" means for submission)
A judge can:
1. Open a Rhodium checkout link **in BlipPay**, connect a wallet, and **pay a naira-priced order in USDT/QUAI** on Quai testnet.
2. See the payment **forward straight to the merchant** (no custody), confirmed on-chain.
3. Watch the merchant get auto-notified, the buyer receipted, and the sale appear in a **naira ledger**.
4. Watch a **live traction page** increment: GMV, transaction count, unique buyers, split by rail (bank vs crypto).
5. Repeat it and see **no double counting**.

## Build order

### Phase A — Rail core (mock-backed, runs with zero external deps) ✅ target first
1. `contracts/RhodiumPay.sol` — forwarder + `Paid` event (source in repo; deploy in Phase D).
2. `src/lib/fx.ts` — kobo ↔ stablecoin-unit conversion (configurable rate).
3. `src/rails/mock-quai-chain.ts` — simulates a BlipPay payment producing a `Paid` log + tx hash.
4. `src/rails/quai-rail.ts` — implements `PaymentRail`: instruction (contract + orderId + deep link), `handleWebhook` (Paid log → kobo `PaymentEvent`), `verifyPayment` (poll chain), `settlementTarget` (merchant).
5. Types: `InstructionType += "crypto"`; `PaymentInstruction` crypto fields; `Merchant.quaiAddress`.
6. Registry: register `QuaiRail` behind `FEATURE_QUAI_ENABLED`; config keys.

**Gate:** a unit test drives order(crypto) → instruction → simulated BlipPay pay → confirm → **one kobo ledger entry**.

### Phase B — Wire the loop
7. `commerce.createOrder` accepts `rail`; `orchestrator.requestPayment` routes by `order.rail` (fiat→Paystack, crypto→Quai).
8. Prisma migration for `quaiAddress`; keep in-memory + Postgres in lockstep.
9. Reuse the entire downstream chain unchanged (receipt, ledger, reconciliation, idempotency).

**Gate:** the crypto path is idempotent on tx-hash replay (no double entry); reconciliation clean.

### Phase C — Surfaces (the demo + the graded metric)
10. `public/checkout.html` — BlipPay dApp-browser page: EIP-1193 connect, show ₦ + USDT, `payToken`, report tx.
11. HTTP: `GET /checkout/:orderId` (serve + data), `POST /api/crypto/confirm {orderId, txHash}`, `POST /webhooks/rails/quai`.
12. **Traction**: `GET /api/traction` (GMV, tx count, unique buyers, rail split, recent sales) + a `/traction` live page (auto-refresh) for judges.
13. WhatsApp: `sell … crypto` variant returns the BlipPay deep link.

**Gate:** end-to-end demo script runs green; traction page shows accruing purchases.

### Phase D — Live testnet (do last, needs external bits)
14. Deploy `RhodiumPay` to Quai **Orchard** testnet (Cyprus1 shard, chain 15000) via `npm run contracts:deploy`; fill `QUAI_*` env; set a merchant `quaiAddress`.
15. `FEATURE_QUAI_ENABLED=true`, `QUAI_ADAPTER_MODE=live`; point a watcher at the webhook.
16. Fund a BlipPay testnet wallet; run **one real purchase** on camera for the submission.

## Risks & mitigations (24h reality)
| Risk | Mitigation |
|---|---|
| Testnet deploy / RPC flaky near deadline | Phase A–C are 100% mock-backed and demo-complete; live is a flag flip. Record the mock demo as fallback. |
| BlipPay provider quirks | Checkout targets standard EIP-1193 (`window.blip` ‖ `window.ethereum`); works in any wallet browser. |
| Matching on-chain tx to order | `orderId` in the `Paid` event = deterministic match (crypto twin of the DVA acct). |
| FX/units confusion corrupts ledger | Rail converts on-chain amount back to kobo before the orchestrator; ledger stays single-currency. |
| Custody accusation | Contract forwards atomically; `settlementTarget` = merchant; provable in one tx. |

## Deliverables for submission
- This PRD + TRD + plan.
- Running code: crypto rail, checkout, traction page, tests, demo (`npm run demo:crypto`).
- A short screen recording of a purchase → traction tick.
- A shareable one-page summary (artifact).
