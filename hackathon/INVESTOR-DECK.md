# RHODIUM

## The 40 million shops that have no cash register.

**Payments and a real sales ledger for the merchants who sell in WhatsApp.**

Emmanuel Doji · Founder | Benedict Maigida · Product | Samaila Solomon Monday · Engineering
Lagos, Nigeria · Raising **$250,000 seed grant**

> **Note before you present:** every figure marked `[FILL]` is a number only you can supply — do not present this deck until they are replaced with real ones. Every figure marked `[SOURCE]` is externally verified and cited on the last slide.

---

## 1 · The problem

### Nigeria's biggest retail channel has no infrastructure.

**67% of Nigerian online purchases now start with a chat conversation.** Globally that figure is 22%. `[SOURCE]`

**69% of Nigerian WhatsApp users buy or sell on it** — the highest rate in the world. `[SOURCE]`

Nigeria leads Africa with **52.47M WhatsApp Business downloads.** `[SOURCE]`

So the channel is settled. The infrastructure under it is not:

| What she does today | What it costs her |
|---|---|
| Buyer sends a **payment screenshot** | Fakes get through. She eats the loss. |
| She checks her banking app, manually | Minutes per sale, every sale |
| She records it in a notebook — or not at all | No records |
| She needs working capital | **No trade history = no credit.** Rejected. |

**She is running a real business on a chat app and a notebook.**

---

## 2 · Why this is a market, not a niche

- **~39.7 million MSMEs in Nigeria** `[SOURCE]`
- They contribute **~50% of GDP and ~80% of employment** `[SOURCE]`
- Nigerian social commerce transaction value: **$2.04B (2025) → $3.96B (2030)**, growing faster than e-commerce overall `[SOURCE]`

This isn't an emerging behaviour we have to teach. It already happened. **We're building the rails under a market that formed without them.**

---

## 3 · Why now

**1. The behaviour is locked in.** Chat-first buying isn't a trend to bet on — it's the majority case, already.

**2. The rails finally exist.** Instant bank transfers and virtual accounts made auto-confirmation possible. It wasn't five years ago.

**3. Crypto stopped being ideology and became a payment method.** Sub-cent transactions on modern chains mean a ₦5,000 lipstick sale can settle on-chain — gas used to make that absurd. Self-custody wallets put checkout in the buyer's pocket with no app install.

**4. The data is the asset.** Nigeria's credit gap for MSMEs is enormous, and the blocker is not appetite — it's that these merchants are invisible. Whoever holds their verified sales history holds the underwriting.

---

## 4 · The solution

### She sells the way she already sells. We handle getting paid — and remembering it.

**In WhatsApp:** she lists a product, sends a payment request in the chat.
**Buyer pays:** bank transfer *or* crypto, whichever they have.
**Auto-confirmed:** no screenshot, no squinting at an app. Merchant notified, buyer receipted — **in milliseconds.**
**Recorded:** every sale appends to a permanent naira ledger. Weekly summaries. Exportable statements.
**Her money never touches us.** Funds settle to her account or her wallet, directly. Non-custodial on both rails, enforced in code.

> **The one-liner:** *Get paid in WhatsApp. Keep your books in naira.*

---

## 5 · The wedge nobody else has: two rails, one ledger

A buyer with crypto and a merchant who thinks in naira currently **cannot transact.** Every existing answer makes one of them do the work.

Rhodium makes neither of them change:

```
Buyer pays in USDT  ──►  RhodiumPay contract  ──►  merchant's own wallet
                              (same transaction, we never hold it)
                                        │
                          converted back to kobo
                                        │
      ▼                                 ▼
Bank sale ───────────────► ONE NAIRA LEDGER ◄──── Crypto sale
```

She gets paid in crypto. **Her books stay in naira.** She never learns what a wallet is.

Built with **Quai Network** (sub-cent L1) and **BlipPay** (self-custody wallet = the buyer's checkout).

---

## 6 · Traction

### Product — shipped and verifiable today

| | |
|---|---|
| ✅ Full payment loop, live | WhatsApp → payment → auto-confirm → receipt → ledger |
| ✅ **Two payment rails working** | bank transfer + crypto, one codebase |
| ✅ Confirmation-to-ledger latency | **~2 milliseconds** |
| ✅ **49 automated tests passing** | incl. live-Postgres, 50+ tx no-double-count |
| ✅ 14 of 14 build milestones | complete |
| ✅ Zero-custody | enforced by contract, not policy |

### Commercial — `[FILL: replace every line below with real numbers or delete the line]`

- Merchants onboarded: `[FILL]`
- Transactions processed: `[FILL]`
- GMV to date: `[FILL]`
- Design partners committed: `[FILL]`
- Waitlist / LOIs: `[FILL]`

> **Say this plainly:** we are pre-revenue with a **complete, tested product** and live traction instrumentation. Investors respect that far more than a soft number they can smell.

---

## 7 · Business model

`[CONFIRM — these are proposed rates, set your own before presenting]`

**1. Transaction fee — today.** A small percentage of each confirmed sale, on both rails. Proposed: `[CONFIRM: 0.5–1%]`. We only earn when she gets paid.

**2. Merchant subscription — year 1.** Flat monthly for multi-user access, analytics, statements, bulk catalogue. Proposed: `[CONFIRM: ₦X/mo]`

**3. The real business — year 2+: credit.** Every confirmed sale builds an append-only, verified trade record for a merchant who had none. That ledger is an underwriting file. Working-capital advances against observed cash flow — originated, or in partnership with a lender.

> Payments buy us the data. **The data is the business.**

---

## 8 · Why we win

| Who | What they do | Why we're different |
|---|---|---|
| Payment processors | Give her a payment link | A link, not a ledger. No records, no history, no credit. |
| Storefront builders | Give her a web shop | **She doesn't want a shop.** Her customers are in her chat. |
| Bookkeeping apps | Ask her to type in every sale | Manual entry dies in week two. **We capture at the moment of payment.** |
| Crypto checkouts | Settle her in crypto | Her books are in naira. We convert back so hers stay clean. |

**Our moat compounds:** payments → verified sales history → underwriting no one else can do → a merchant who cannot afford to leave, because her credit file lives here.

---

## 9 · Go to market

**Phase 1 — 10 design partners, hand-onboarded.** Lagos, cosmetics/fashion/food. We sit with them. We learn what breaks.
**Phase 2 — merchant-led growth.** Every receipt a buyer gets is branded. **Buyers become merchants** — that's the loop, and it's free.
**Phase 3 — cluster distribution.** Market associations, WhatsApp seller groups, and micro-influencer sellers who already have the trust we'd otherwise pay for.
**Phase 4 — the credit unlock.** Once merchants have 6 months of ledger, working capital becomes the retention product.

**CAC advantage:** we launch *inside* the app they already open 50 times a day. No download, no migration, no behaviour change.

---

## 10 · The ask

# $250,000 seed grant
### 18 months of runway to 1,000 paying merchants

`[CONFIRM: adjust the amount and the target — this is a proposal, not a fixed plan]`

| Use of funds | % | Amount |
|---|---|---|
| **Engineering** — 2 hires, crypto rail to mainnet, credit-scoring v1 | 40% | $100,000 |
| **Merchant acquisition** — field onboarding team, partner clusters | 25% | $62,500 |
| **Compliance & licensing** — regulatory posture for payments + lending | 15% | $37,500 |
| **Infrastructure** — Postgres, WhatsApp conversation costs, chain ops | 10% | $25,000 |
| **Operating buffer** | 10% | $25,000 |

---

## 11 · Milestones this buys

| Month | Milestone | Proof point |
|---|---|---|
| **M1–3** | 10 design partners live · crypto rail on mainnet | First ₦1M GMV |
| **M4–6** | 100 merchants · transaction fee switched on | **First revenue** |
| **M7–9** | 300 merchants · buyer→merchant loop measurable | CAC under `[FILL]` |
| **M10–12** | 600 merchants · credit-scoring model v1 on real ledgers | Underwriting thesis validated |
| **M13–15** | 1,000 merchants · first working-capital pilot | Default rate under `[FILL]` |
| **M16–18** | Lending partnership signed · Series A materials | **Raise on data, not story** |

**The number that matters at month 18:** merchants with 6+ months of continuous ledger history. That cohort is the loan book — and the reason the next round prices well.

---

## 12 · Risks, and what we did about them

We would rather you hear these from us.

| Risk | Our answer |
|---|---|
| **Merchant churn** — informal merchants are fickle | Ledger and credit history are switching costs that grow monthly |
| **Regulatory** — payments and lending are licensed activities | **Non-custodial by design from day one** — we never hold funds, which materially narrows our regulatory surface |
| **A processor builds this** | They lack the WhatsApp-native flow and the merchant relationship. We'd rather be their distribution than their competitor. |
| **Crypto rail sees low usage** | It's additive, not load-bearing. Bank transfer is the volume rail; crypto opens buyers who couldn't pay at all. |
| **Fraud / underpayment** | To-the-kobo amount integrity checks and two-layer idempotency, shipped and tested |

---

## 13 · Team

**Emmanuel Doji — Founder.** Product thesis and payment architecture. Built the rail abstraction and the non-custody invariant that lets Rhodium add payment methods without a rewrite.

**Benedict Maigida — Product.** Merchant and buyer experience: the WhatsApp flow, checkout, and the metrics that show what's working.

**Samaila Solomon Monday — Engineering.** Payment rail internals, on-chain settlement, and ledger integrity.

`[FILL: add one line each — prior company, years shipping, relevant domain credibility. Investors fund people. This slide is currently your weakest and it is the easiest to fix.]`

**Why us:** we shipped a complete, tested two-rail payment system before asking for a naira. That's the proof of execution.

---

## 14 · The vision

**Today:** she stops losing sales and stops keeping books in a notebook.

**In three years:** every WhatsApp merchant in Nigeria has a verified trade history — and the working capital that finally comes with it.

The formal economy never showed up for these 40 million businesses.
**We're not digitising them. We're giving them a balance sheet.**

# Get paid in WhatsApp. Keep your books in naira.

**Emmanuel Doji** · `[FILL: email]` · `[FILL: phone]` · `[FILL: site]`

---

## Appendix · Sources

- MSME count, GDP and employment share — [Moniepoint, Nigeria small business statistics](https://moniepoint.com/blog/nigeria-small-business-statistics); [SMEDAN / NBS collaborative survey](https://www.nigerianstat.gov.ng/download/290)
- Chat-initiated purchases (67% NG vs 22% global), NIBSS 2024 — [BusinessDay, "The WhatsApp economy"](https://businessday.ng/life/article/the-whatsapp-economy-how-social-commerce-is-rewriting-retail-rules/)
- WhatsApp buying/selling rate (69% Nigeria), WhatsApp Business downloads — [BusinessDay, "MSMEs tap WhatsApp"](https://businessday.ng/technology/article/msmes-tap-whatsapp-to-unlock-revenue-streams/); [Realdata, WhatsApp commerce in Africa](https://realdataintl.com/articles/whatsapp-commerce)
- Social commerce transaction value 2025→2030 — [Nigeria E-commerce market analysis](https://www.researchandmarkets.com/reports/5601277/nigeria-e-commerce-market-share-analysis)

> **Verify each of these against the primary source before presenting.** Secondary aggregators drift, and an investor who checks one number and finds it wrong will discount every other number on the slide.

## Appendix · Product proof

```bash
npm run demo          # bank-transfer loop, end to end
npm run demo:crypto   # crypto loop: WhatsApp → BlipPay → naira ledger
npm test              # 49 tests
```

Technical detail: [PITCH-DECK.md](PITCH-DECK.md) · [TRD.md](TRD.md) · [../README.md](../README.md)
