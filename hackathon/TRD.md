# TRD — Rhodium × Quai × BlipPay crypto rail
*Companion to hackathon/PRD.md. Builds on the existing Rhodium MVP (README.md).*

---

## 1. The one architectural idea
Rhodium's payment code sits behind a single interface, `PaymentRail` (see `src/rails/types.ts`). The bank-transfer rail (Paystack DVA) already implements it. This entry adds a second implementation — **`QuaiRail`** — that satisfies the *same* interface and emits the *same* downstream event, `order.paid`. Because of that, the entire post-payment machine (receipt → append-only ledger → traction metrics → reconciliation) is reused **without modification**.

```
                         ┌──────────────── PaymentRail (existing seam) ────────────────┐
 WhatsApp / dashboard →  │  createPaymentInstruction · handleWebhook · verifyPayment   │
                         │  settlementTarget → owner:"merchant"  (NO CUSTODY, both)    │
                         └──────┬───────────────────────────────────────────┬─────────┘
                     ┌──────────┴─────────┐                       ┌──────────┴───────────┐
                     │ Paystack fiat rail │  (existing)           │  QuaiRail  (NEW)     │
                     │  DVA + webhook     │                       │  RhodiumPay contract │
                     └──────────┬─────────┘                       │  + BlipPay EIP-1193  │
                                │                                 └──────────┬───────────┘
                                ▼                                            ▼
                 order.paid → receipt → ledger.entry (kobo)  ◄── SAME chain for both rails
                                             │
                                             ▼
                              Traction: GMV · tx · buyers · rail split
```

## 2. No-custody design (the crypto twin of the DVA)
The bank rail never touches funds (DVA settles to the merchant's account). The crypto rail must match that. We deploy a tiny forwarder contract on Quai:

```solidity
// chain/contracts/RhodiumPay.sol  (Quai is EVM-compatible; solc pinned to 0.8.20)
event Paid(bytes32 indexed orderId, address indexed merchant, address token, uint256 amount, address payer);

function payNative(bytes32 orderId, address payable merchant) external payable {
    require(msg.value > 0, "no value");
    (bool ok, ) = merchant.call{value: msg.value}("");   // forward in the SAME tx
    require(ok, "forward failed");
    emit Paid(orderId, merchant, address(0), msg.value, msg.sender);
}

function payToken(bytes32 orderId, address merchant, address token, uint256 amount) external {
    require(IERC20(token).transferFrom(msg.sender, merchant, amount), "transfer failed"); // buyer → merchant
    emit Paid(orderId, merchant, token, amount, msg.sender);
}
```

- Funds go **buyer → merchant atomically**; the contract holds nothing between calls. `settlementTarget()` returns `owner: "merchant"`, identical to the fiat rail.
- The `Paid` event carries `orderId`, which is exactly how we match an on-chain payment to a Rhodium order (the crypto analogue of the DVA account number).

## 3. Order → payment → confirmation flow
1. **Create order** with `rail = "crypto"` (existing commerce service; one new enum value).
2. **`QuaiRail.createPaymentInstruction(order, merchant)`** returns a `PaymentInstruction` with:
   - `instructionType: "crypto"`, `providerRef = orderId` (bytes32 hex),
   - `chainId`, `contractAddress`, `method` (`payNative`|`payToken`), `tokenAddress` (USDT for stable value),
   - `cryptoAmount` (order kobo → USDT micro-units via the FX rate), `merchantAddress`,
   - `deepLink`: `blip://browser?url=<checkout_url>` to open in BlipPay.
3. **Buyer** opens checkout inside BlipPay → injected EIP-1193 provider → `quai_requestAccounts` → `quai_sendTransaction` calling `payToken(orderId, merchant, USDT, amount)`. `blip_requestAppWalletFunding` covers top-up.
4. **Confirmation** arrives one of two ways, both idempotent:
   - *Push*: an event watcher / indexer POSTs to `/webhooks/rails/quai`.
   - *Pull*: the checkout page reports the tx hash to `POST /api/crypto/confirm`, and `QuaiRail.verifyPayment` reads the chain for the matching `Paid` log.
5. **`handleWebhook` / `verifyPayment`** normalize to a `PaymentEvent`:
   - `providerRef = orderId`, `amount = ` on-chain amount **converted back to kobo** (so the existing kobo amount-integrity check and ledger work unchanged),
   - `idempotencyKey = tx hash` (a chain-unique id → replay-safe, reuses `processed_event`).
6. Orchestrator confirms exactly as for fiat → emits `order.paid` → receipt + ledger + traction.

## 4. Currency handling (why the ledger stays in naira)
- Merchants price in ₦. The crypto rail converts kobo → stablecoin units for the buyer, and converts the confirmed on-chain amount **back to kobo** before it reaches the orchestrator.
- Result: **one naira ledger across both rails**; the payment row also stores the token, chain amount, and tx hash for audit.
- FX: `src/lib/fx.ts`, rate from config (`FX_NGN_PER_USD`, `[VALIDATE]`). Production swaps in a price feed; the seam is isolated.
- Tolerance: on-chain amount is matched to the expected amount within a small basis-point tolerance to absorb rounding.

## 5. What changes vs. the existing codebase
| Change | File(s) | Size |
|---|---|---|
| `InstructionType` gains `"crypto"`; `PaymentInstruction` gains crypto fields | `src/rails/types.ts`, `src/domain/types.ts` | small |
| Merchant gains `quaiAddress` (settlement wallet) | `domain` + Prisma migration | small |
| `QuaiRail` + mock Quai chain + forwarder ABI | `src/rails/quai-rail.ts`, `mock-quai-chain.ts`, `contracts/` | new |
| FX helper | `src/lib/fx.ts` | small |
| `createOrder` accepts `rail`; orchestrator routes by `order.rail` | commerce + payments | small |
| Checkout page (EIP-1193), `/api/crypto/confirm`, `/webhooks/rails/quai`, `/api/traction` | `public/checkout.html`, `src/http/api.ts` | medium |
| Registry registers `QuaiRail` behind `FEATURE_QUAI_ENABLED` | `src/rails/registry.ts`, `config` | small |

Everything else — event bus, ledger, notifications, reconciliation, idempotency, audit, metrics — is **reused as-is**.

## 6. Non-functional
- **Idempotent** on tx hash (existing two-layer guarantee).
- **No custody** — enforced by the contract (atomic forward) and by `settlementTarget()`.
- **Reconciliation** — the existing daily job compares confirmed payments vs. ledger; the crypto rail's `verifyPayment` lets it re-check on-chain for missed events.
- **Security** — EIP-1193 signing is on-device in BlipPay (self-custody); we never see keys. Webhook/confirm endpoints validate the tx on-chain before trusting it.

## 7. Live-testnet checklist (flip from mock → real) — Quai Orchard
Orchard testnet: chain id **15000**, RPC `https://orchard.rpc.quai.network/cyprus1`,
faucet `https://orchard.faucet.quai.network`, explorer `https://orchard.quaiscan.io`.
1. `npm run contracts:install && npm run contracts:compile` (solc 0.8.20).
2. Fund a Cyprus1 key from the faucet; set `CYPRUS1_PK`; `npm run contracts:deploy` → set `QUAI_CONTRACT_ADDRESS`.
3. Set `QUAI_USDT_ADDRESS` (Orchard stablecoin) and each merchant's `quaiAddress`.
4. `FEATURE_QUAI_ENABLED=true`, `QUAI_ADAPTER_MODE=live`.
5. Point an event watcher (Quaiscan API / GraphQL) at `POST /webhooks/rails/quai`.
6. Fund a BlipPay/Pelagus wallet on Orchard and run a real purchase.
