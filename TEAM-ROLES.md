# Roles & Responsibilities

*Rhodium · 3-person team · last updated 2026-08-13*

At this size the point of a roles document is **not** to divide labour — everyone will touch everything. The point is to fix **decision rights**, so that no decision waits for a meeting and no decision gets made twice. Where this document says "owns," it means: *this person decides, and does not need to ask.*

Both leads write and ship code. One carries the surface the customer touches; one carries the machine underneath it.

---

## Engineering Lead — Samaila Solomon Monday

> **Mission:** the money is always right, and the system is always up.

Rhodium moves other people's money. That makes correctness a product feature, not an engineering preference. This role exists so that a merchant never has to wonder whether her ledger is true.

### Owns (decides without asking)

- **Technical architecture** — service boundaries, the `PaymentRail` abstraction, how new rails are added
- **The payment path** — orchestration, confirmation, idempotency, amount integrity
- **Ledger integrity** — append-only guarantees, transaction isolation, running balance correctness
- **On-chain settlement** — the `RhodiumPay` contract, chain integration, confirmation watchers, testnet/mainnet deploys
- **Data model and migrations** — schema changes, Prisma migrations, backfills
- **Security posture** — PII encryption, key handling, webhook verification, secrets
- **Production** — deploys, environments, monitoring, incident response, rollback
- **Test strategy** — what must be covered before anything ships near money

### Core responsibilities

**Correctness.** Every payment confirms exactly once, for exactly the right amount, in exactly one ledger entry — across replays, restarts, and concurrent sales. Maintain the two-layer idempotency guarantee and the to-the-kobo amount check. No change ships on the payment path without a test that would have caught its failure.

**Non-custody as an invariant.** `settlementTarget()` returns the merchant on every rail, always. Any proposal that would route funds through a Rhodium-controlled account is refused at this desk, regardless of who is asking. This is a company-defining constraint, and the Engineering Lead is its custodian.

**Reliability.** Own uptime and latency on the payment path. Run reconciliation, investigate drift, and close the loop on every discrepancy — a drift alert is never dismissed, it is explained.

**New rails.** Adding a payment method should be an adapter and a registry line, not a rewrite. Protect that property as new rails are added.

**Reviews and standards.** Review every change that touches money, auth, or PII. Keep the codebase something a fourth engineer could join and understand in a week.

**Hiring.** As the team grows, define the engineering bar and run the technical interview.

### Measured on

| | |
|---|---|
| Payment success rate | and time-to-confirmation |
| Money defects | **target: zero** — lost, doubled, or mis-amounted payments |
| Reconciliation | drift closed, not just detected |
| Uptime | on the payment path |
| Rail velocity | time to add a new payment method |
| Incidents | mean time to recovery |

### Not this role

Deciding *what* to build, pricing, merchant messaging, or which metric matters commercially. Input is expected and welcome — the decision belongs to Product or the Founder.

---

## Product Lead — Benedict Maigida

> **Mission:** a Lagos merchant gets paid without thinking about Rhodium at all.

Our users are not technical, are working in a chat window, and will abandon anything that costs them more effort than the screenshot method they already tolerate. This role exists to make sure the thing we ship is the thing they'll actually use.

### Owns (decides without asking)

- **The roadmap** — what gets built next, and in what order
- **Merchant and buyer experience** — the WhatsApp conversation flow, command grammar, wording of every message
- **Checkout** — the payment surface a buyer sees, including the crypto checkout page
- **Onboarding** — the path from first contact to first payment received
- **The dashboard** — what a merchant sees about her own business
- **Metrics definition** — what counts as an active merchant, activation, retention, GMV
- **The traction surface** — what we measure, and what we show investors and partners
- **Scope calls** — what is in a release and what is cut to ship it

### Core responsibilities

**Talk to merchants — continuously.** This is the first responsibility and the one most easily skipped. Own the design-partner relationships, watch real merchants use the product, and bring back specifics rather than impressions. No feature enters the roadmap without a merchant problem attached to it.

**Write the words.** Every WhatsApp message, receipt, error, and prompt. Our entire interface is text in a chat, which makes copy the product, not decoration. Plain language over precision: *"we never hold your funds"* beats *"non-custodial."*

**Reduce steps to payment.** Guard the number of actions between "buyer wants it" and "merchant is paid." Any change that adds a step must justify itself.

**Define before build.** Every piece of work arrives with the problem, the merchant it's for, the acceptance criteria, and how we'll know it worked. Ambiguity resolved before code starts, not during review.

**Own the funnel end to end.** Onboarding completion, first-payment rate, repeat usage, churn. Find where merchants drop off and fix it — that number is this role's scoreboard.

**Ship code.** This is a hands-on role. Front-of-house surfaces — checkout, dashboard, traction, message flows — are yours to build, not just specify.

**Launch and outward comms.** Flyers, deck content, demo narrative, partner and sponsor updates.

### Measured on

| | |
|---|---|
| Activation | % of merchants reaching first payment in one session |
| Retention | merchants still transacting at 30 / 60 / 90 days |
| Repeat usage | transactions per merchant per month |
| Funnel | drop-off at each onboarding step |
| GMV | and unique buyers |
| Support load | per merchant — falling means the product got clearer |

### Not this role

Architecture, schema design, security implementation, deploy decisions, or how the payment path works internally. Product sets the *what* and the *why*; Engineering owns the *how*.

---

## Founder — Emmanuel Doji

Holds company strategy, fundraising, partnerships, legal and regulatory posture, and hiring. Breaks ties. Sets the constraints both leads work inside — non-custody, naira-native books, WhatsApp-first — and is the final call on anything that changes those.

**The founder's discipline:** having built the original architecture, resist re-deciding what has been delegated. Set the constraint, then let the owner own it.

---

## Where the two overlap

Most friction in a small team happens at seams, not inside roles. These are the seams:

| Seam | Product decides | Engineering decides |
|---|---|---|
| **Checkout page** | what the buyer sees, the flow, the copy | how it signs, submits, and confirms |
| **Traction metrics** | which metrics, and their definitions | how they're computed and stored |
| **New payment rail** | whether merchants need it, and when | how it's built, and what it costs to maintain |
| **Bug priority** | merchant impact | technical severity |
| **Release scope** | what ships | whether it's safe to ship |
| **Latency & reliability targets** | what merchants will tolerate | what the system can guarantee |

### Two rules for the seams

**1. Engineering has a veto on correctness and safety.** If the Engineering Lead says a change risks money integrity, custody, or security, it does not ship — regardless of roadmap pressure. Product may escalate to the Founder, but the default is: **it waits.**

**2. Product has a veto on merchant experience.** If the Product Lead says a change makes the merchant's path harder, it doesn't ship as-is — regardless of how elegant it is internally.

Anything unresolved after one conversation goes to the Founder the same day. **Nothing sits blocked overnight.**

---

## Working cadence

| When | What | Who runs it |
|---|---|---|
| **Daily, 15 min** | What shipped, what's blocked | Rotating |
| **Weekly** | Metrics review — activation, retention, GMV, defects | Product |
| **Weekly** | Merchant conversation — at least one, non-negotiable | Product |
| **Bi-weekly** | Roadmap and priority reset | Product, with Founder |
| **Monthly** | System health — reliability, tech debt, security | Engineering |
| **Per incident** | Written post-mortem, no blame, fix tracked to closure | Engineering |

---

## The shared standard

Three things are everyone's job regardless of title, and any one of us can stop a release over them:

1. **We never hold a merchant's funds.**
2. **A merchant's ledger is always correct.**
3. **A merchant never has to understand how any of this works.**
