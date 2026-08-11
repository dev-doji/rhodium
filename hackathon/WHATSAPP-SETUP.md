# Run the bot on real WhatsApp (payments still mock)

Goal: message your WhatsApp business number and have the bot reply, create
crypto orders, send BlipPay checkout links, and post receipts — all over real
WhatsApp, with the Quai payment simulated (mock) until the faucet/deploy is done.

Already wired & running on this machine:
- App server on `:3000` (Postgres, `WHATSAPP_MODE=live`, crypto rail `mock`).
- Public tunnel (ngrok): **https://35df-102-89-23-227.ngrok-free.app**
  (⚠️ this URL changes if ngrok restarts — see "Tunnel" below).
- Webhook verify handshake confirmed through the tunnel.

## What YOU need to do (≈5 min)

### 1. Fresh access token (the current one expired)
Meta temporary tokens last 24h. In the Meta dashboard → your app → **WhatsApp →
API Setup**, copy the **Temporary access token** (good for 24h — fine for the
demo). For something durable, make a **System User** token instead.
Put it in `.env`:
```
WHATSAPP_ACCESS_TOKEN=EAAG...           # the fresh token
```

### 2. Configure the webhook (Meta → WhatsApp → Configuration)
- **Callback URL:** `https://35df-102-89-23-227.ngrok-free.app/webhooks/whatsapp`
- **Verify token:** `rhodium-verify`
- Click **Verify and save** (our server answers the handshake).
- **Subscribe** to the **`messages`** field.

### 3. Allowlist your personal number
On API Setup, add the personal number you'll message FROM to the recipient
allowlist (test numbers can only message allowlisted recipients).

### 4. Tell me your number → I seed the merchant
```
npm run seed:merchant -- "+234YOURNUMBER" "Amaka Beauty" "0xYourQuaiWallet"
```
(binds your number to a crypto-ready merchant so the bot knows you).

## Then test it
From your personal WhatsApp, message the business number:
```
help
add Red Lipstick 5000
list
sell <productId> 1 +234BUYERNUMBER crypto
```
The bot replies with a **BlipPay checkout link** (public via ngrok). Open it,
tap **Pay** (mock), and you'll get the "✅ Payment received" on WhatsApp + the
buyer gets a receipt + it shows on the traction board:
`https://35df-102-89-23-227.ngrok-free.app/traction`

## Tunnel notes
- ngrok-free URL changes on restart. If it changes, update BOTH the Meta
  callback URL and `PUBLIC_BASE_URL` in `.env`, then restart the server.
- Keep ngrok + the server running during the demo.
