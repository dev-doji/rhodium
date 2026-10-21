import { useEffect, useRef, useState } from "react";
import { api, naira, type Product, type CounterOrder } from "./api.js";
import { CheckCircle, Receipt, X } from "./icons.js";

/**
 * Counter mode — the till, on whatever screen the shop already owns.
 *
 * The cashier keys an amount (or taps products), the buyer scans the QR with
 * their own phone and pays by bank or crypto there, and this screen chimes
 * when the money lands. No terminal, no waiting on a bank alert, no screenshot.
 *
 * Built to be left open all day: a sale that finishes resets straight back to
 * the keypad, and the whole flow runs from a keyboard as well as a finger.
 */

type Stage =
  | { kind: "entry" }
  | { kind: "waiting"; order: CounterOrder; qrUrl: string }
  | { kind: "paid"; order: CounterOrder }
  | { kind: "expired"; order: CounterOrder };

type Dva = { accountNumber: string; bankName: string; accountName: string };

const SOUND_KEY = "rhodium_counter_sound";
const MAX_DIGITS = 9; // ₦999,999,999 — past this it is a typo, not a sale.

function readSoundPref(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch { return true; }
}

export function Counter({ products, onSold }: { products: Product[]; onSold: () => void }) {
  const [mode, setMode] = useState<"amount" | "products">("amount");
  const [digits, setDigits] = useState("");
  const [note, setNote] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [buyerPhone, setBuyerPhone] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "entry" });
  const [dva, setDva] = useState<Dva>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sound, setSound] = useState(readSoundPref);
  const audio = useRef<AudioContext | null>(null);
  const wakeLock = useRef<{ release(): Promise<void> } | null>(null);

  const cartTotal = products.reduce((sum, p) => sum + p.price * (cart[p.id] ?? 0), 0);
  const total = mode === "amount" ? Number(digits || "0") * 100 : cartTotal;

  const reset = () => {
    setDigits(""); setNote(""); setCart({}); setBuyerPhone("");
    setDva(undefined); setErr(""); setStage({ kind: "entry" });
  };

  const charge = async () => {
    if (total <= 0 || busy) return;
    // Browsers only let a page make sound after a tap. Unlock it on THIS tap,
    // because the chime itself fires from a network event minutes later,
    // which on its own would be silenced.
    if (sound && !audio.current) {
      try { audio.current = new AudioContext(); } catch { /* no Web Audio: stay silent */ }
    }
    void audio.current?.resume();

    setBusy(true);
    try {
      const lines = Object.entries(cart)
        .filter(([, qty]) => qty > 0)
        .map(([productId, qty]) => ({ productId, qty }));
      const r = await api.counterSale(
        mode === "amount"
          ? { amountNaira: Number(digits), note: note.trim() || undefined, buyerPhone: buyerPhone.trim() || undefined }
          : { lines, buyerPhone: buyerPhone.trim() || undefined },
      );
      setErr("");
      setStage({ kind: "waiting", order: r.order, qrUrl: r.qrUrl });
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  const showAccount = async (orderId: string) => {
    setBusy(true);
    try { setDva((await api.bankInstruction(orderId)).instruction); setErr(""); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  // Listen for the payment. The server answers on the event bus when the
  // webhook lands here and falls back to a database check when it lands on
  // another instance, so this one stream covers both.
  const waitingId = stage.kind === "waiting" ? stage.order.id : null;
  useEffect(() => {
    if (stage.kind !== "waiting") return;
    const order = stage.order;
    const es = new EventSource(`/api/checkout/${order.id}/events`);
    es.addEventListener("status", (ev) => {
      const { status } = JSON.parse((ev as MessageEvent).data) as { status: string };
      if (status === "paid") {
        es.close();
        setStage({ kind: "paid", order });
        if (sound) announce(audio.current, order.amount);
        onSold();
      } else if (status === "expired" || status === "cancelled") {
        es.close();
        setStage({ kind: "expired", order });
      }
    });
    return () => es.close();
    // Keyed on the order id alone: re-subscribing on every render would drop
    // and reopen the stream, and a payment landing in the gap would be missed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingId]);

  // A screen that dims mid-sale looks like a till that died. Hold it awake
  // while a buyer is paying, where the browser allows it.
  useEffect(() => {
    if (stage.kind !== "waiting") return;
    const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => { wakeLock.current = l; }).catch(() => {});
    return () => { void wakeLock.current?.release().catch(() => {}); wakeLock.current = null; };
  }, [waitingId]);

  // Physical keyboard: digits, Backspace, Enter. Ignored while typing in a
  // field, so a note or a phone number is not also punched into the amount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (stage.kind === "entry" && mode === "amount") {
        if (/^\d$/.test(e.key)) press(e.key);
        else if (e.key === "Backspace") press("back");
        else if (e.key === "Enter") void charge();
      } else if (stage.kind !== "entry" && stage.kind !== "waiting" && e.key === "Enter") {
        reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const press = (k: string) => {
    setDigits((d) => {
      if (k === "back") return d.slice(0, -1);
      if (k === "clear") return "";
      const next = (d + k).replace(/^0+/, "");
      return next.length > MAX_DIGITS ? d : next;
    });
  };

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    try { localStorage.setItem(SOUND_KEY, next ? "on" : "off"); } catch { /* per-device nicety only */ }
  };

  /* ---------------------------------------------------------------- stages */

  if (stage.kind === "paid") {
    return (
      <div className="counter-done paid" role="status" aria-live="assertive">
        <CheckCircle size={56} />
        <div className="counter-done-label">Paid</div>
        <div className="counter-done-amount num">{stage.order.amountFormatted}</div>
        <div className="counter-done-sub">In your ledger · #{stage.order.id.slice(-6).toUpperCase()}</div>
        <div className="counter-actions">
          <a className="btn ghost" href={`/receipt/${stage.order.id}`} target="_blank" rel="noopener">
            <Receipt size={16} /> Receipt
          </a>
          <button className="btn brand" autoFocus onClick={reset}>Next sale</button>
        </div>
      </div>
    );
  }

  if (stage.kind === "expired") {
    return (
      <div className="counter-done" role="status">
        <X size={48} />
        <div className="counter-done-label">This sale expired unpaid</div>
        <div className="counter-done-amount num">{stage.order.amountFormatted}</div>
        <div className="counter-actions">
          <button className="btn brand" autoFocus onClick={reset}>Start again</button>
        </div>
      </div>
    );
  }

  if (stage.kind === "waiting") {
    const { order, qrUrl } = stage;
    return (
      <div className="counter-wait">
        <div className="counter-wait-amount num">{order.amountFormatted}</div>
        <div className="counter-wait-sub">Scan to pay — bank transfer or crypto</div>
        <img className="counter-qr" src={qrUrl} alt={`QR code to pay ${order.amountFormatted}`} />
        {err && <div className="error">{err}</div>}
        {dva ? (
          <div className="dva counter-dva">
            <div className="dva-bank">{dva.bankName}</div>
            <div className="dva-acct num">{dva.accountNumber}</div>
            <div className="dva-name">{dva.accountName}</div>
            <div className="dva-note">Transfer exactly {order.amountFormatted}. This screen updates by itself.</div>
          </div>
        ) : (
          <button className="btn ghost" onClick={() => void showAccount(order.id)} disabled={busy}>
            {busy ? "Getting account…" : "Buyer can't scan? Show account number"}
          </button>
        )}
        <div className="counter-listening" aria-live="polite">
          <span className="counter-dot" /> Waiting for payment…
        </div>
        <button className="btn ghost counter-cancel" onClick={reset}>Cancel sale</button>
      </div>
    );
  }

  /* ----------------------------------------------------------------- entry */

  return (
    <div className="counter">
      <div className="counter-top">
        <div className="toggle counter-mode" role="tablist">
          <button role="tab" aria-selected={mode === "amount"} className={mode === "amount" ? "on" : ""}
            onClick={() => setMode("amount")}>Amount</button>
          <button role="tab" aria-selected={mode === "products"} className={mode === "products" ? "on" : ""}
            onClick={() => setMode("products")} disabled={!products.length}
            title={products.length ? undefined : "Add products first"}>Products</button>
        </div>
        <div className="spacer" />
        <button className="chipbtn" onClick={toggleSound} aria-pressed={sound}>
          {sound ? "🔔 Sound on" : "🔕 Sound off"}
        </button>
      </div>

      <div className="counter-display num" aria-live="polite">{naira(total)}</div>

      {err && <div className="error">{err}</div>}

      {mode === "amount" ? (
        <>
          <div className="keypad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "back"].map((k) => (
              <button key={k} className="key num" onClick={() => press(k)}
                aria-label={k === "back" ? "Delete" : k}>
                {k === "back" ? "⌫" : k}
              </button>
            ))}
          </div>
          <input className="field" placeholder="What is it for? (optional)" value={note}
            maxLength={80} onChange={(e) => setNote(e.target.value)} />
        </>
      ) : (
        <div className="counter-products">
          {products.map((p) => {
            const qty = cart[p.id] ?? 0;
            const soldOut = p.stockQty != null && p.stockQty <= qty;
            return (
              <div key={p.id} className={`counter-product${qty ? " picked" : ""}`}>
                <button className="counter-product-main" disabled={soldOut}
                  onClick={() => setCart((c) => ({ ...c, [p.id]: qty + 1 }))}>
                  <span className="cell-main">{p.name}</span>
                  <span className="num">{naira(p.price)}</span>
                </button>
                {qty > 0 && (
                  <div className="counter-qty">
                    <button className="iconbtn" aria-label={`One fewer ${p.name}`}
                      onClick={() => setCart((c) => ({ ...c, [p.id]: qty - 1 }))}>−</button>
                    <span className="num">{qty}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <input className="field" placeholder="Buyer's WhatsApp for a receipt (optional)" value={buyerPhone}
        inputMode="tel" onChange={(e) => setBuyerPhone(e.target.value)} />

      <button className="btn brand block counter-charge" onClick={() => void charge()}
        disabled={busy || total <= 0}>
        {busy ? "Creating…" : total > 0 ? `Charge ${naira(total)}` : "Enter an amount"}
      </button>
    </div>
  );
}

/**
 * The till sound: a rising two-note chime, then the amount read aloud.
 *
 * The spoken amount is the point, not decoration. A trader serving three
 * people at once hears "payment received, three thousand five hundred naira"
 * without looking up — the thing the soundbox on every Lagos counter already
 * taught her to trust.
 */
function announce(ctx: AudioContext | null, amountKobo: number): void {
  if (ctx) {
    const now = ctx.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  }
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const whole = Math.floor(amountKobo / 100);
    const u = new SpeechSynthesisUtterance(`Payment received. ${whole.toLocaleString("en-NG")} naira.`);
    u.lang = "en-NG";
    // Let the chime finish first so the two do not talk over each other.
    setTimeout(() => synth.speak(u), 600);
  } catch { /* speech is a bonus; the chime and the green screen still land */ }
}
