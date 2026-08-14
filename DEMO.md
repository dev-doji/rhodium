# Rhodium — Live Demo Script

A 4-minute WhatsApp demo. Every message below is real: real bot, real Monnify
reserved account, real Quai transaction. Nothing is faked.

**Links**
| | |
|---|---|
| Landing page | https://rhodium-landing.onrender.com |
| The bot | https://wa.me/2348036803974 |
| Traction board | https://rhodium-8ocg.onrender.com/traction |
| Contract | https://orchard.quaiscan.io/address/0x0044Fa1a7d871a80c8b1027e75639c7A3Ef0E741 |

**You need:** two phones — **VENDOR** (yours) and **BUYER** (a colleague's).
Both must have WhatsApp. A laptop for the traction board.

---

## Pre-flight — 5 minutes before you present

Do not skip these. Each one is a demo that has died on stage.

```bash
# 1. Wake the app. Render's free tier sleeps and the first hit takes ~50s.
curl -s https://rhodium-8ocg.onrender.com/health
#    Expect: {"ok":true,...,"commit":"..."} — if it hangs, wait and retry.

# 2. Wake the landing page too.
curl -s -o /dev/null -w "%{http_code}\n" https://rhodium-landing.onrender.com
```

3. **Open the 24-hour window on BOTH phones.** Send any message to
   **+234 803 680 3974** from the vendor phone *and* the buyer phone. WhatsApp
   silently drops business-initiated messages outside a 24h window, so if a
   phone hasn't talked to the bot today, receipts will never arrive.

4. **Check the Meta app is in Live mode.** In Development mode the webhook only
   fires for app admins — your phone works, your colleague's doesn't, and you
   won't find out until you're on stage.

5. Have the traction board open on the laptop, ready to refresh.

**Rehearsal warning:** onboarding only happens once per phone number. Once you
rehearse the sign-up on a number, that number is a registered merchant forever
and will get the vendor menu instead. **Rehearse with a different number than
the one you present with**, or skip to Act 2 using an existing merchant.

---

## Act 1 — "No app. No website." *(45s)*

> "Amaka sells cosmetics on WhatsApp. Today she takes orders in chat and asks
> people to send a screenshot of their transfer. Watch her get a real
> storefront — without installing anything."

**VENDOR phone →** open https://rhodium-landing.onrender.com, tap **Start selling**.
It deep-links straight into WhatsApp with the message pre-filled. Send it.

**Bot replies:** greeting → what she'll be able to do → *"What's your business name?"*

**VENDOR →** `Amaka Beauty`
**VENDOR →** `0123456789`
**VENDOR →** `2`   *(GTBank)*

> "That's it. She's live — with a bank account for settlement **and** a Quai
> wallet generated for her in the background. She never left WhatsApp."

---

## Act 2 — The catalogue *(30s)*

**VENDOR →** `add Red Lipstick 5000`
**VENDOR →** `link`

Bot returns her shop link: `https://wa.me/2348036803974?text=shop-mch_...`

> "That link is her storefront. She drops it in her status, her groups, her bio."

**Send that link to the BUYER phone** (paste it into any chat).

---

## Act 3 — The buyer *(60s)*

**BUYER phone →** tap the link she just shared. WhatsApp opens with `shop-mch_...`
pre-filled. Send it.

**Bot →** shows the catalogue.

**BUYER →** `1`   *(Red Lipstick)*
**Bot →** offers: `1` bank transfer · `2` USDT→naira · `3` QUAI

**BUYER →** `1`

> "That account number is real — issued by Monnify, seconds ago, dedicated to
> this one order. No screenshots. Money goes straight to Amaka's bank."

---

## Act 4 — The magic moment *(45s)*

**BUYER →** transfer ₦5,000 to the account shown *(or use a sandbox transfer)*.

Within seconds, **without anyone refreshing anything**:

- **BUYER** gets: `🧾 Receipt from Amaka Beauty — Order …, Amount paid ₦5,000.00`
- **VENDOR** gets: `✅ Payment received: ₦5,000.00 for order … It's in your ledger.`

**VENDOR →** `ledger`

> "Both sides notified, booked in naira, reconciled. That's the whole problem
> we set out to kill — the screenshot."

Refresh **/traction** on the laptop. The sale is there.

---

## Act 5 — The crypto rail *(60s)*

> "Same order, same naira ledger — paid on-chain instead."

**BUYER →** `shop-mch_...` again → pick the product → **`3`** *(QUAI)*

Bot returns a checkout link. If the buyer phone has **BlipPay/Pelagus**, tap and
pay in the wallet.

**No wallet on the phone?** Pay it from the laptop — same result, real chain:

```bash
npm run contracts:pay -- <orderId> --app https://rhodium-8ocg.onrender.com
```

*(the `<orderId>` is in the checkout URL)*

> "Settled merchant-direct on Quai — Rhodium never custodies it. The buyer paid
> crypto, Amaka's books are still in naira."

Open the tx on Quaiscan. Refresh **/traction** — the crypto sale is in the
same ledger as the bank transfer.

---

## Closing line

> "One WhatsApp chat. Bank transfer or crypto. One naira ledger. No custody, no
> screenshots, no app to install."

---

## If something breaks on stage

| Symptom | Do this |
|---|---|
| Bot doesn't reply at all | App was asleep — hit `/health`, wait 30s, resend |
| Reply never arrives on the *buyer* phone | 24h window closed on that phone. Have them message the bot, then retry |
| Buyer's messages ignored, yours work | Meta app is in Development mode — only admins get through |
| Shop link looks wrong | Should be `wa.me/2348036803974`. If it shows `15551405536`, `WHATSAPP_WA_NUMBER` is stale on Render |
| Everything is down | **Fallback:** `npm run demo:whatsapp` on the laptop — runs the identical flow on mocks and prints the whole conversation as a transcript. Narrate that instead |

The fallback is worth rehearsing once. It needs no network, no Meta, and no
phones, and it exercises the same `handleInbound` code path the live bot uses.
