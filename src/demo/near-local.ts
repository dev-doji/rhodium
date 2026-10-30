/**
 * Try the NEAR Intents checkout by hand, on this machine, with no real money.
 *
 *   npm run demo:near:ui
 *
 * Boots the real API in memory with every rail mocked, seeds a shop whose
 * crypto sales settle to `amaka.rhodium.near`, and prints checkout links. Open
 * one, tap "Pay with crypto", pick a token, paste a refund address, and you get
 * a deposit address. Then open /dev/near in a second tab: it plays the buyer
 * depositing and a solver delivering USDC — or delivering it wrong — and the
 * checkout tab reacts the way it would to the real thing.
 *
 * Every live switch is forced off BEFORE .env is read, because values already
 * in the environment win over the file. A developer's .env holds live keys,
 * and a test tool that quietly used them would quote real swaps.
 */
import express from "express";

const PORT = Number(process.env.NEAR_DEMO_PORT ?? 3000);

Object.assign(process.env, {
  NODE_ENV: "development",
  DATABASE_URL: "",
  FIAT_ADAPTER_MODE: "mock",
  WHATSAPP_MODE: "mock",
  EMAIL_MODE: "mock",
  EVM_ADAPTER_MODE: "mock",
  ONSWITCH_ADAPTER_MODE: "mock",
  FEATURE_NEAR_ENABLED: "true",
  NEAR_ADAPTER_MODE: "mock",
  FX_LIVE_RATES: "false",
  RUN_BACKGROUND_JOBS: "false",
  PUBLIC_BASE_URL: `http://localhost:${PORT}`,
  MERCHANT_BASE_URL: `http://localhost:${PORT}`,
  PORT: String(PORT),
});

async function main(): Promise<void> {
  const { loadEnv } = await import("../config/load-env.js");
  loadEnv();
  const { loadConfig } = await import("../config/index.js");
  const { buildApp } = await import("../app.js");
  const { buildApi } = await import("../http/api.js");
  const { CaptureTransport } = await import("../modules/notification/transport.js");
  const { NearPaymentPoller } = await import("../jobs/near-payment-poller.js");
  const { systemClock } = await import("../lib/clock.js");
  type NearRail = import("../rails/near-intents-rail.js").NearIntentsRail;

  const config = loadConfig();
  const whatsapp = new CaptureTransport("whatsapp");
  const app = buildApp({ config, notificationChannels: [whatsapp] });
  const rail = app.rails.get("near_intents") as NearRail;

  const merchant = await app.repos.merchants.create({
    id: "mch_near_demo",
    phone: "+2348030009999",
    businessName: "Amaka Beauty",
    status: "active",
    kycState: "verified",
    cryptoEnabled: true,
    cryptoSettlement: "near_usdc",
    nearAccountId: "amaka.rhodium.near",
    slug: "amaka",
  });
  const products = await Promise.all(
    [
      ["Shea Butter (500g)", 350_000],
      ["Ankara Headwrap", 1_200_000],
      ["Black Soap", 180_000],
    ].map(([name, price]) =>
      app.commerce.createProduct({ merchantId: merchant.id, name: String(name), price: Number(price) }),
    ),
  );
  const newOrder = (productId: string) =>
    app.commerce.createOrder({
      merchantId: merchant.id,
      buyerRef: "+2348090001234",
      lines: [{ productId, qty: 1 }],
      rail: "crypto",
      ttlMs: config.ONECLICK_QUOTE_TTL_MINUTES * 60_000,
    });
  const orders = await Promise.all(products.map((p) => newOrder(p.id)));

  const server = buildApi(app);

  // --- /dev/near: the buyer's wallet and the solver, played by buttons ---
  const dev = express.Router();
  dev.use(express.json());
  dev.get("/dev/near", async (_req, res) => {
    const pending = (await app.repos.payments.listPendingByRail("near_intents", new Date(0))).reverse();
    const rows = pending
      .map(
        (p) => `<tr><td><a href="/checkout/${p.orderId}" target="_blank">${p.orderId.slice(-6).toUpperCase()}</a></td>
        <td><code>${p.providerRef}</code></td><td>
        ${["success", "short", "wrong_recipient", "incomplete", "refund"]
          .map((m) => `<button onclick="pay('${p.orderId}','${m}')">${m}</button>`)
          .join(" ")}</td></tr>`,
      )
      .join("");
    const sent = whatsapp.sent
      .slice(-6)
      .reverse()
      .map((m) => `<pre>${m.to}\n${m.message.replace(/</g, "&lt;")}</pre>`)
      .join("");
    res.type("html").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
      <title>NEAR dev panel</title>
      <style>body{font:14px system-ui;margin:16px;max-width:900px}td,th{padding:6px;border-bottom:1px solid #ddd;text-align:left}
      button{margin:2px;padding:6px 10px}pre{background:#f4f4f6;padding:10px;white-space:pre-wrap}</style>
      <h2>NEAR Intents — mock buyer &amp; solver</h2>
      <p>Pick a token on a checkout first; its deposit address appears here. Then choose what happens.</p>
      <p><button onclick="fetch('/dev/near/order',{method:'POST'}).then(r=>r.json()).then(j=>open(j.url))">+ New order</button>
         <button onclick="location.reload()">Refresh</button></p>
      <table><tr><th>Order</th><th>Deposit address</th><th>Simulate</th></tr>${rows || "<tr><td colspan=3>No NEAR payments waiting.</td></tr>"}</table>
      <h3>WhatsApp messages (latest first)</h3>${sent || "<p>None yet.</p>"}
      <script>async function pay(orderId,mode){const r=await fetch('/api/crypto/simulate-pay',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId,mode})});const j=await r.json();
      alert(mode+': '+(j.confirmed?'credited ✅':'not credited — '+(j.message||'see checkout')));location.reload()}</script>`);
  });
  dev.post("/dev/near/order", async (_req, res) => {
    const o = await newOrder(products[0]!.id);
    res.json({ url: `${config.PUBLIC_BASE_URL}/checkout/${o.id}` });
  });
  // --- /dev/whatsapp: two phones in a browser, talking to the real bot ---
  //
  // Every message goes through app.whatsapp.handleInbound — the same call the
  // Cloud API webhook makes — so the bot's replies, the checkout link it sends
  // and the receipt it pushes after payment are the real ones. Only the
  // transport is fake: messages land on this page instead of a phone.
  const BUYER_PHONE = "+2348090005555";
  const chat: { phone: string; from: "me" | "bot"; text: string }[] = [];
  let seenPushes = 0;
  const collectPushes = (): void => {
    for (const m of whatsapp.sent.slice(seenPushes)) chat.push({ phone: m.to, from: "bot", text: m.message });
    seenPushes = whatsapp.sent.length;
  };
  dev.post("/dev/whatsapp/send", async (req, res) => {
    const phone = String(req.body?.phone ?? "");
    const text = String(req.body?.text ?? "").trim();
    if (!phone || !text) {
      res.status(400).json({ error: "phone and text required" });
      return;
    }
    collectPushes();
    chat.push({ phone, from: "me", text });
    try {
      // The bot sends its own reply through the (captured) channel, so it
      // arrives with the pushes — adding the return value too would show it twice.
      await app.whatsapp.handleInbound({ from: phone, text });
      collectPushes();
    } catch (err) {
      chat.push({ phone, from: "bot", text: `⚠️ bot error: ${(err as Error).message}` });
    }
    res.json({ ok: true });
  });
  dev.get("/dev/whatsapp/messages", (req, res) => {
    collectPushes();
    res.json({ messages: chat.filter((m) => m.phone === String(req.query.phone ?? "")) });
  });
  dev.get("/dev/whatsapp", (_req, res) => {
    const phone = (who: string, num: string, hint: string) => `
      <section><h3>${who} <small>${num}</small></h3><div class="log" id="log-${num}"></div>
      <form onsubmit="send(event,'${num}')"><input name="t" placeholder="${hint}" autocomplete="off"><button>Send</button></form></section>`;
    res.type("html").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
      <title>WhatsApp simulator</title>
      <style>body{font:14px system-ui;margin:16px;background:#eceff1}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
      section{background:#efeae2;border:1px solid #ccc;display:flex;flex-direction:column;height:80vh}h3{margin:0;padding:10px;background:#075e54;color:#fff;font-size:15px}
      small{opacity:.7;font-weight:400}.log{flex:1;overflow:auto;padding:10px}.m{max-width:85%;margin:6px 0;padding:7px 10px;white-space:pre-wrap;word-break:break-word;border-radius:6px}
      .me{background:#d9fdd3;margin-left:auto}.bot{background:#fff}form{display:flex}input{flex:1;padding:12px;font:inherit;border:0}button{padding:0 16px}</style>
      <p>Buyer: type <b>shop-amaka</b> to open Amaka's shop. Seller: try <b>ledger</b> after a sale. Payments panel: <a href="/dev/near" target="_blank">/dev/near</a></p>
      <main>${phone("Buyer", BUYER_PHONE, "shop-amaka")}${phone("Amaka (seller)", merchant.phone, "ledger")}</main>
      <script>
      const esc=s=>s.replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"})[c]);
      const fmt=s=>esc(s).replace(/\\*([^*\\n]+)\\*/g,"<b>$1</b>").replace(/(https?:\\/\\/\\S+)/g,'<a href="$1" target="_blank">$1</a>');
      const counts={};
      async function load(p){const r=await (await fetch('/dev/whatsapp/messages?phone='+encodeURIComponent(p))).json();
        if(counts[p]===r.messages.length)return;counts[p]=r.messages.length;const el=document.getElementById('log-'+p);
        el.innerHTML=r.messages.map(m=>'<div class="m '+m.from+'">'+fmt(m.text)+'</div>').join('');el.scrollTop=el.scrollHeight}
      async function send(e,p){e.preventDefault();const i=e.target.t;const t=i.value;i.value='';
        await fetch('/dev/whatsapp/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:p,text:t})});load(p)}
      const phones=${JSON.stringify([BUYER_PHONE, merchant.phone])};setInterval(()=>phones.forEach(load),1500);phones.forEach(load);
      </script>`);
  });

  // Mounted ahead of the API so it is reachable; the API's own 404 handler
  // would otherwise answer first.
  const outer = express();
  outer.use(dev);
  outer.use(server);

  // The real poller, so a deposit "lands" without pressing anything else.
  const poller = new NearPaymentPoller(app.repos, app.payments, systemClock, config.ONECLICK_QUOTE_TTL_MINUTES);
  setInterval(() => void poller.tick().catch(() => undefined), 3_000).unref();

  outer.listen(PORT, () => {
    const line = "─".repeat(64);
    console.log(`\n${line}\n NEAR Intents checkout — local, mock, no real money\n${line}`);
    console.log(` Shop: ${merchant.businessName} → USDC settles to ${merchant.nearAccountId}\n`);
    orders.forEach((o, i) =>
      console.log(`  ${products[i]!.name.padEnd(20)} ${config.PUBLIC_BASE_URL}/checkout/${o.id}`),
    );
    console.log(`\n WhatsApp simulator:    ${config.PUBLIC_BASE_URL}/dev/whatsapp   (buyer types: shop-amaka)`);
    console.log(` Online store:          ${config.PUBLIC_BASE_URL}/s/amaka`);
    console.log(` Buyer + solver panel:  ${config.PUBLIC_BASE_URL}/dev/near`);
    console.log(` Tokens offered:        ${rail.payAssets().map((a) => a.label).join(", ")}`);
    console.log(` Test refund addresses: Tron TJRabPrwbZy45sbavfcjinPJC18kjpRTv8`);
    console.log(`                        EVM  0x2527D02599Ba641c19FEa793cD0F167589a0f10D`);
    console.log(`${line}\n`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
