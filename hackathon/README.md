# Rhodium × Quai × BlipPay — buildathon entry

**Accept crypto inside WhatsApp. Keep your books in naira.** A Lagos WhatsApp
merchant sends a payment request in chat; the buyer pays QUAI/QI/USDT from their
**BlipPay/Pelagus** wallet; the **RhodiumPay** contract forwards funds
**straight to the merchant** (no custody); the sale lands in the same **naira
ledger** and the **live traction feed**.

Read: [PRD](PRD.md) · [TRD](TRD.md) · [Implementation Plan](IMPLEMENTATION-PLAN.md)

## Run the demo (no chain, no credentials)
```bash
npm install
npm run db:up && npm run prisma:migrate      # Postgres
npm run demo:crypto                           # WhatsApp → BlipPay → naira ledger → traction
npm test                                      # 45 tests incl. the crypto rail
```

## See it in a browser
```bash
npm run dashboard:build && npm run dev        # serves API + pages on :3000
# open http://localhost:3000/traction         → live sales-traction board (the graded metric)
# a crypto order's checkout link → /checkout/<orderId>  (opens in BlipPay/Pelagus)
```

## The contract (Quai Orchard testnet, solc 0.8.20)
```bash
npm run contracts:install
npm run contracts:compile                     # compiles chain/contracts/RhodiumPay.sol
# fund a Cyprus1 key at https://orchard.faucet.quai.network, set CYPRUS1_PK in .env
npm run contracts:deploy                      # deploys to Orchard, prints the address
```
Then set `QUAI_CONTRACT_ADDRESS`, `QUAI_USDT_ADDRESS`, a merchant `quaiAddress`,
and `QUAI_ADAPTER_MODE=live` to route the crypto rail onto the real chain.

## Why this wins on "traction"
- Every purchase (bank **or** crypto) flows through one append-only naira ledger
  and shows up on `/traction`: **GMV, sales count, unique buyers, rail split** —
  updating live as judges make purchases.
- Zero custody (contract forwards atomically), zero double-counts (idempotent on
  tx hash), and crypto sits behind the **same `PaymentRail` seam** the fiat rail
  uses — proven by the test suite.

## What's real vs. mock
- **Real now:** the full commerce/ledger/traction stack, the `PaymentRail`
  abstraction, the crypto rail logic, the checkout UX, and the **contract
  (compiles under 0.8.20)**.
- **Flip to live:** deploy the contract to Orchard + fund a BlipPay/Pelagus
  wallet (needs the faucet). The adapter already speaks Orchard (chain 15000).
