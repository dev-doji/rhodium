# Live on Quai Orchard — step by step

Goal: a **real** crypto purchase on Orchard testnet, end to end, showing on the
traction board. Simplest path uses **Pelagus** (Chrome extension) on the same
desktop, so **no public tunnel is needed** — the buyer's browser hits
`localhost:3000` and our backend reads the receipt straight from Orchard.

We use **native QUAI** (only faucet QUAI needed — no test USDT).

## 0. One-time wallet setup (Pelagus)
1. Install Pelagus (https://pelaguswallet.io), create a wallet, switch network to
   **Orchard testnet**.
2. You'll use one **Cyprus1** account as the *deployer* and the *buyer*, and a
   second Cyprus1 account as the *merchant* wallet (so you can see funds arrive).
   Copy both addresses. (Cyprus1 addresses start in the Cyprus1 range — Pelagus
   handles this for you.)
3. Fund the deployer/buyer account from the faucet:
   https://orchard.faucet.quai.network

## 1. Compile + deploy the contract
```bash
npm run contracts:install
npm run contracts:compile         # solc 0.8.20 → chain/artifacts/...
# put the funded Cyprus1 private key in .env:
#   CYPRUS1_PK=0x....
npm run contracts:deploy
```
It prints `✅ RhodiumPay deployed: 0x...`. Copy that address.

## 2. Point Rhodium at the live chain
Edit `.env`:
```
QUAI_ADAPTER_MODE=live
QUAI_PAYMENT_ASSET=native
QUAI_CONTRACT_ADDRESS=0x...        # from step 1
FX_NGN_PER_QUAI=5000               # ₦ per QUAI (arbitrary on testnet; keep amounts small)
PUBLIC_BASE_URL=http://localhost:3000
```

## 3. Create a crypto-capable merchant with a Quai wallet
Sign in on the dashboard (phone-OTP) and set the merchant's `quaiAddress` to the
**merchant** Cyprus1 address, or seed one directly. Then create a product and a
crypto order (WhatsApp `sell <productId> <qty> <buyerPhone> crypto`, or the API).

## 4. Run the app and pay for real
```bash
npm run dashboard:build && npm run dev      # serves on :3000
```
1. Open the traction board: http://localhost:3000/traction
2. Open the order's checkout in the same Chrome (with Pelagus):
   `http://localhost:3000/checkout/<orderId>`
3. Click **Pay with BlipPay / Pelagus** → Pelagus pops up → confirm the tx.
4. The page reports the tx hash to the backend, which polls the Orchard receipt,
   decodes the `Paid` event, confirms the order, sends the WhatsApp receipt, and
   appends the naira ledger entry.
5. Watch **/traction** tick: GMV, sales, unique buyers, `crypto` +1. Verify the
   funds arrived at the merchant address on https://orchard.quaiscan.io.

## Notes / gotchas
- **No tunnel needed** with desktop Pelagus on localhost. If the buyer is on a
  phone in BlipPay, expose the app with a tunnel (`cloudflared tunnel --url
  http://localhost:3000`) and set `PUBLIC_BASE_URL` to the tunnel URL.
- Keep the deployer, buyer, and merchant accounts all on **Cyprus1** for a
  single-shard demo (cross-shard transfers add confirmation time).
- Confirmation is **pull-based** (buyer's browser → our `/api/crypto/confirm` →
  Orchard RPC). For a production indexer, the same decode also runs from
  `POST /webhooks/rails/quai`.
- No custody at any point: `RhodiumPay.payNative` forwards buyer → merchant in
  the same transaction; verify on Quaiscan.
