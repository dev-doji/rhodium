import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  api,
  getToken,
  setToken,
  naira,
  type Product,
  type Order,
  type LedgerEntry,
} from "./api.js";

export function App() {
  const [authed, setAuthed] = useState<boolean>(!!getToken());
  return authed ? (
    <Dashboard onLogout={() => { setToken(null); setAuthed(false); }} />
  ) : (
    <Login onLogin={() => setAuthed(true)} />
  );
}

/* ------------------------------------------------------------------ sign-in */

function Login({ onLogin }: { onLogin: () => void }) {
  const [phone, setPhone] = useState("+234");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const send = async () => {
    setBusy(true);
    try { await api.requestOtp(phone); setSent(true); setErr(""); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true);
    try { const r = await api.verifyOtp(phone, code); setToken(r.token); onLogin(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="signin-page">
      <div className="signin">
        <div className="signin-card">
          <div className="brand-mark">R</div>
          <h1>{sent ? "Enter your code" : "Welcome back"}</h1>
          <p className="sub">
            {sent
              ? `We sent a 6-digit code to ${phone} on WhatsApp.`
              : "Sign in with the phone number you sell from."}
          </p>
          {err && <div className="error">{err}</div>}
          {!sent ? (
            <div className="stack">
              <input
                className="field"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+2348030000001"
                inputMode="tel"
                onKeyDown={(e) => e.key === "Enter" && void send()}
              />
              <button className="btn block" onClick={() => void send()} disabled={busy}>
                {busy ? "Sending…" : "Send code"}
              </button>
            </div>
          ) : (
            <div className="stack">
              <input
                className="field num"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                inputMode="numeric"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && void verify()}
              />
              <button className="btn block" onClick={() => void verify()} disabled={busy}>
                {busy ? "Checking…" : "Verify"}
              </button>
              <button className="btn ghost block" onClick={() => { setSent(false); setCode(""); }}>
                Use a different number
              </button>
            </div>
          )}
        </div>
        <p className="hint">Rhodium — sell on WhatsApp, get paid without the screenshot.</p>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- dashboard */

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [biz, setBiz] = useState("");
  const [phone, setPhone] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ledger, setLedger] = useState<{ balanceFormatted: string; entries: LedgerEntry[] }>();
  const [summary, setSummary] = useState<{ count: number; total: number; message: string }>();
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const [me, p, o, l, s] = await Promise.all([
        api.me(), api.products(), api.orders(), api.ledger(), api.summary(),
      ]);
      setBiz(me.merchant.businessName);
      setPhone(me.merchant.phone);
      setProducts(p.products); setOrders(o.orders); setLedger(l); setSummary(s);
      setErr("");
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const paidCount = orders.filter((o) => o.status === "paid").length;

  return (
    <>
      <header className="topbar">
        <div className="brand-mark">R</div>
        <div>
          <div className="biz-name">{biz || (loading ? "Loading…" : "Dashboard")}</div>
          {phone && <div className="biz-sub">{phone}</div>}
        </div>
        <div className="spacer" />
        <button className="linkbtn" onClick={() => void refresh()}>Refresh</button>
        <button className="linkbtn" onClick={onLogout}>Sign out</button>
      </header>

      <div className="wrap">
        {err && <div className="error">{err}</div>}

        <section className="stats">
          <div className="stat primary">
            <div className="stat-label">Balance</div>
            <div className="stat-value num">{ledger?.balanceFormatted ?? "—"}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Sold this week</div>
            <div className="stat-value num">{summary ? naira(summary.total) : "—"}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Paid orders</div>
            <div className="stat-value num">{paidCount}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Products</div>
            <div className="stat-value num">{products.length}</div>
          </div>
        </section>

        <div className="grid">
          {/* ---- left: the money ---- */}
          <div>
            <div className="card">
              <div className="card-head">
                <span className="card-title">Sales — last 7 days</span>
                <div className="spacer" />
                <a className="linkbtn" href="/api/ledger/export.csv">CSV</a>
                <a className="linkbtn" href="/api/ledger/statement.txt">Statement</a>
              </div>
              <div className="card-body pad">
                <SalesChart entries={ledger?.entries ?? []} />
              </div>
            </div>

            <div className="card">
              <div className="card-head"><span className="card-title">Orders</span></div>
              <div className="card-body">
                {orders.length === 0 ? (
                  <Empty emoji="🧾">No orders yet — create a payment request.</Empty>
                ) : (
                  orders.slice(0, 8).map((o) => (
                    <div className="row" key={o.id}>
                      <div>
                        <div className="row-main num">{o.id.slice(-6).toUpperCase()}</div>
                        <div className="row-sub">{when(o.createdAt)}</div>
                      </div>
                      <div className="row-right">
                        <div className="row-main num">{naira(o.amount)}</div>
                        <div className="row-sub"><StatusPill status={o.status} /></div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-head"><span className="card-title">Ledger</span></div>
              <div className="card-body">
                {!ledger?.entries.length ? (
                  <Empty emoji="📒">Nothing booked yet.</Empty>
                ) : (
                  ledger.entries.slice(0, 8).map((e) => (
                    <div className="row" key={e.id}>
                      <div>
                        <div className="row-main">{e.type === "sale" ? "Sale" : e.type}</div>
                        <div className="row-sub">{when(e.createdAt)}</div>
                      </div>
                      <div className="row-right">
                        <div className="row-main num">+{naira(e.amount)}</div>
                        <div className="row-sub num">bal {naira(e.balanceAfter)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* ---- right: the actions ---- */}
          <div>
            <div className="card">
              <div className="card-head"><span className="card-title">Request a payment</span></div>
              <div className="card-body pad">
                <NewOrder products={products} onCreated={refresh} />
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <span className="card-title">Catalogue</span>
                <div className="spacer" />
                <span className="pill other">{products.length}</span>
              </div>
              <div className="card-body pad">
                <AddProduct onAdded={refresh} />
              </div>
              <div className="card-body">
                {products.length === 0 ? (
                  <Empty emoji="📦">No products yet.</Empty>
                ) : (
                  products.map((p) => (
                    <div className="row" key={p.id}>
                      <div className="row-main">{p.name}</div>
                      <div className="row-right">
                        <div className="row-main num">{naira(p.price)}</div>
                        {p.stockQty != null && <div className="row-sub num">{p.stockQty} in stock</div>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- components */

/**
 * Seven day-buckets of sales, newest on the right. Hand-rolled divs rather than
 * a charting dependency — it's one series of seven bars, and the bundle cost of
 * a chart library would dwarf the feature.
 */
function SalesChart({ entries }: { entries: LedgerEntry[] }) {
  const { buckets, labels, max, total } = useMemo(() => {
    const days = 7;
    const now = new Date();
    const b = new Array<number>(days).fill(0);
    const l: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - (days - 1 - i));
      l.push(d.toLocaleDateString(undefined, { weekday: "narrow" }));
    }
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    for (const e of entries) {
      const t = new Date(e.createdAt);
      const idx = Math.floor((t.getTime() - start.getTime()) / 86_400_000);
      if (idx >= 0 && idx < days) b[idx] += e.amount;
    }
    return { buckets: b, labels: l, max: Math.max(...b, 1), total: b.reduce((x, y) => x + y, 0) };
  }, [entries]);

  return (
    <div>
      <div className="stat-value small num" style={{ marginBottom: 10 }}>{naira(total)}</div>
      <div className="chart">
        {buckets.map((v, i) => (
          <div
            key={i}
            className={`bar${v > 0 ? " on" : ""}`}
            style={{ height: `${Math.max((v / max) * 100, 3)}%` }}
            title={naira(v)}
          />
        ))}
      </div>
      <div className="chart-axis">{labels.map((d, i) => <span key={i}>{d}</span>)}</div>
    </div>
  );
}

function AddProduct({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const add = async () => {
    if (!name.trim() || !price) return;
    setBusy(true);
    try { await api.addProduct(name, Number(price)); setName(""); setPrice(""); setErr(""); onAdded(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <>
      {err && <div className="error">{err}</div>}
      <div className="inline">
        <input className="field" placeholder="Product name" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()} />
        <input className="field num" placeholder="₦ price" value={price} inputMode="decimal"
          style={{ maxWidth: 110 }}
          onChange={(e) => setPrice(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()} />
        <button className="btn" onClick={() => void add()} disabled={busy || !name.trim() || !price}>
          Add
        </button>
      </div>
    </>
  );
}

function NewOrder({ products, onCreated }: { products: Product[]; onCreated: () => void }) {
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [buyer, setBuyer] = useState("+234");
  const [dva, setDva] = useState<{ accountNumber: string; bankName: string; accountName: string }>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.createOrder(buyer, [{ productId, qty: Number(qty) }]);
      setDva(r.instruction); setErr(""); onCreated();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <>
      {err && <div className="error">{err}</div>}
      <div className="stack">
        <select className="field" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Choose a product…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name} — {naira(p.price)}</option>
          ))}
        </select>
        <div className="inline">
          <input className="field num" placeholder="Qty" value={qty} inputMode="numeric"
            style={{ maxWidth: 90 }} onChange={(e) => setQty(e.target.value)} />
          <input className="field" placeholder="Buyer phone" value={buyer} inputMode="tel"
            onChange={(e) => setBuyer(e.target.value)} />
        </div>
        <button className="btn block" onClick={() => void create()} disabled={busy || !productId}>
          {busy ? "Generating…" : "Generate account number"}
        </button>
      </div>
      {dva && (
        <div className="dva">
          <div className="dva-bank">🏦 {dva.bankName}</div>
          <div className="dva-acct num">{dva.accountNumber}</div>
          <div className="dva-name">{dva.accountName}</div>
          <div className="dva-note">Buyer transfers here → you're notified automatically. No screenshot.</div>
        </div>
      )}
    </>
  );
}

const Empty = ({ emoji, children }: { emoji: string; children: React.ReactNode }) => (
  <div className="empty"><span className="empty-emoji">{emoji}</span>{children}</div>
);

const StatusPill = ({ status }: { status: string }) => {
  const cls = status === "paid" ? "paid" : status === "awaiting_payment" ? "pending" : "other";
  const label = status === "awaiting_payment" ? "awaiting payment" : status.replace(/_/g, " ");
  return <span className={`pill ${cls}`}>{label}</span>;
};

/** Short relative time — "2h ago" reads better than a full timestamp in a list. */
function when(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
