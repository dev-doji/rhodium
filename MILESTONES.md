# Milestones & status

Mapped to the implementation plan's build-order (§3.5). All green.

| # | Milestone | Plan ref | Status |
|---|-----------|----------|--------|
| M0 | Infra + repo + Postgres + CI/CD | Phase 0/1 | ✅ |
| M1 | Core domain model + order state machine | §2.4 | ✅ |
| M2 | `PaymentRail` interface + fiat adapter (DVA) + dark stablecoin + registry | §2.3, build-step 2 | ✅ |
| M3 | Idempotent event queue + logging/tracing | §2.5, build-step 4 | ✅ |
| M4 | Persistence: Prisma/Postgres schema + repo interfaces + in-memory impl | §2.2 | ✅ |
| M5 | Commerce: catalogue + object store + orders | Phase 2, build-step 5 | ✅ |
| M6 | Payments orchestrator: DVA → auto-reconcile → confirm, poll fallback | Phase 2, build-step 6 (the magic moment) | ✅ |
| M7 | Ledger (append-only) + Notification (confirmation + receipt) | §2.1 | ✅ |
| M8 | WhatsApp inbound/outbound + merchant flow + phone-OTP auth | build-step 3 | ✅ |
| M9 | Daily reconciliation job + drift alert | §2.5, build-step 7 | ✅ |
| M10 | HTTP: webhooks + dashboard API + auth + export | build-step 8 | ✅ |
| M11 | Thin React dashboard (catalogue/orders/ledger/summary/export) | Phase 3 | ✅ |
| M12 | Test suite: magic-moment, idempotent replay, drift, 50+ tx no double-count | acceptance | ✅ |
| M13 | Harden + instrument: encryption, audit, metrics, Postgres repos | Phase 4 | ✅ |
| M14 | E2E demo + live-Postgres run + docs/gate checklist | acceptance | ✅ |

## Definition of Done (Appendix) — status

- [x] Merchant onboards via WhatsApp/OTP and reaches first payment in one session.
- [x] Buyer pays by transfer to a DVA; merchant auto-notified + buyer auto-receipted within ms; no screenshot, no manual check.
- [x] Every sale lands in an append-only ledger; weekly summary + CSV/statement export.
- [x] Zero lost/double-counted payments (idempotency + reconciliation; proven in tests, incl. live Postgres).
- [x] `PaymentRail` live with fiat adapter #1; stablecoin present but dark; **no fund custody anywhere**.
- [~] 10 design partners live; activation/retention/volume **instrumented** (metrics wired); onboarding partners + **[LEGAL]** sign-off are the human/Phase-0 steps that remain (see CREDENTIALS.md).
- [x] Numbers to decide are captured (`GET /metrics`), and the ledger seeds the credit pipeline.

## Inadequacies in the source plan that were fixed while building

1. **Amount-integrity check.** The plan matched a webhook to an order but didn't
   specify verifying the *amount*. Added a to-the-kobo check that refuses (and
   audits) a mismatch — closes an underpayment/fraud gap.
2. **Two-layer idempotency.** "Idempotency keys" were named but not located.
   Implemented at both the confirmation short-circuit **and** the event bus
   (unique `processed_event` row), so races and restarts are both safe.
3. **Serializable ledger append.** "Append-only + running balance" needs the
   read-balance-then-write to be atomic or concurrent sales corrupt the balance.
   Done inside a Serializable transaction; regression-tested with concurrent writes.
4. **Blind-index for encrypted PII.** "Encrypt PII" conflicts with "look up
   merchant by phone". Added an HMAC blind-index column so lookups never touch
   plaintext.
5. **Poll fallback path unified.** `verifyPayment` is routed through the *same*
   confirmation code as webhooks (not a parallel path), so both get identical
   idempotency + audit + events.
6. **Config guardrails.** Production boot now refuses placeholder encryption keys
   and `live` modes without credentials — prevents shipping mock-mode to prod.
