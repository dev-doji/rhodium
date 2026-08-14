import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  api, getToken, setToken, naira,
  type Product, type Order, type LedgerEntry,
} from "./api.js";
import {
  RhodiumLogo, Wallet, TrendUp, CheckCircle, Box, Search, Bell, Gear,
  Filter, Calendar, Rows, Grid, X, Download, Phone, ExternalLink, Receipt, Plus,
} from "./icons.js";

export function App() {
  const [authed, setAuthed] = useState<boolean>(!!getToken());
  return authed
    ? <Dashboard onLogout={() => { setToken(null); setAuthed(false); }} />
    : <Login onLogin={() => setAuthed(true)} />;
}

/* -------------------------------------------------------------- sign-in */

function Login({ onLogin }: { onLogin: () => void }) {
  const [phone, setPhone] = useState("+234");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const send = async () => {
    setBusy(true);
    try { await api.requestOtp(phone); setSent(true); setErr(""); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true);
    try { const r = await api.verifyOtp(phone, code); setToken(r.token); onLogin(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="signin-page">
      <div className="signin">
        <div className="signin-card">
          <RhodiumLogo size={30} />
          <h1>{sent ? "Enter your code" : "Welcome back"}</h1>
          <p className="sub">
            {sent ? `We sent a 6-digit code to ${phone} on WhatsApp.`
                  : "Sign in with the phone number you sell from."}
          </p>
          {err && <div className="error">{err}</div>}
          {!sent ? (
            <div className="stack">
              <input className="field" value={phone} inputMode="tel"
                onChange={(e) => setPhone(e.target.value)} placeholder="+2348030000001"
                onKeyDown={(e) => e.key === "Enter" && void send()} />
              <button className="btn brand block" onClick={() => void send()} disabled={busy}>
                {busy ? "Sending…" : "Send code"}
              </button>
            </div>
          ) : (
            <div className="stack">
              <input className="field num" value={code} inputMode="numeric" autoFocus
                onChange={(e) => setCode(e.target.value)} placeholder="123456"
                onKeyDown={(e) => e.key === "Enter" && void verify()} />
              <button className="btn brand block" onClick={() => void verify()} disabled={busy}>
                {busy ? "Checking…" : "Verify"}
              </button>
              <button className="btn ghost block" onClick={() => { setSent(false); setCode(""); }}>
                Use a different number
              </button>
            </div>
          )}
        </div>
        <p className="hint">Sell on WhatsApp. Get paid without the screenshot.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- dashboard */

type Tab = "orders" | "products" | "ledger";

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [biz, setBiz] = useState("");
  const [phone, setPhone] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ledger, setLedger] = useState<{ balanceFormatted: string; entries: LedgerEntry[] }>();
  const [summary, setSummary] = useState<{ count: number; total: number; message: string }>();
  const [tab, setTab] = useState<Tab>("orders");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Order | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const [me, p, o, l, s] = await Promise.all([
        api.me(), api.products(), api.orders(), api.ledger(), api.summary(),
      ]);
      setBiz(me.merchant.businessName); setPhone(me.merchant.phone);
      setProducts(p.products); setOrders(o.orders); setLedger(l); setSummary(s); setErr("");
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const paid = orders.filter((o) => o.status === "paid");
  const shown = orders.filter((o) =>
    !q.trim() || o.id.toLowerCase().includes(q.toLowerCase().replace(/^#/, "")));

  return (
    <>
      <nav className="nav">
        <a className="wordmark" href="/">
          <RhodiumLogo size={22} />
          <span>Rhodium</span>
        </a>
        <div className="spacer" />
        <div className="navlinks">
          <button className={`navlink${tab === "orders" ? " active" : ""}`} onClick={() => setTab("orders")}>Orders</button>
          <button className={`navlink${tab === "products" ? " active" : ""}`} onClick={() => setTab("products")}>Products</button>
          <button className={`navlink${tab === "ledger" ? " active" : ""}`} onClick={() => setTab("ledger")}>Ledger</button>
          <a className="navlink" href="/traction">Traction</a>
          <a className="navlink" href="/wallet">Wallet</a>
          <a className="navlink" href={`https://wa.me/2348036803974`} target="_blank" rel="noopener">
            WhatsApp <ExternalLink size={13} />
          </a>
          <button className="navlink" onClick={onLogout}>Sign out</button>
        </div>
      </nav>

      <div className="greet">
        <div className="avatar">{initials(biz)}</div>
        <div>
          <div className="greet-name">{biz || (loading ? "Loading…" : "Your shop")}</div>
          <div className="greet-sub">We hope all is well and you have a great day.</div>
        </div>
        <div className="spacer" />
        <div className="search">
          <Search />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search orders" />
        </div>
        <button className="iconbtn" title="Notifications"><Bell /></button>
        <button className="iconbtn" title="Settings"><Gear /></button>
      </div>

      <div className="page">
        <div className="page-head">
          <div>
            <h1 className="page-title">{TITLES[tab]}</h1>
            <div className="page-sub">{SUBS[tab]}</div>
          </div>
          <div className="spacer" />
          <button className="btn" disabled={!paid.length} onClick={() => setOpen(paid[0] ?? null)}>
            <Receipt size={16} /> View invoice
          </button>
        </div>

        {err && <div className="error" style={{ marginTop: 16 }}>{err}</div>}

        <section className="stats">
          <Stat tile="dark" icon={<Wallet />} delta="+1.32%" up label="Balance"
            value={ledger?.balanceFormatted ?? "—"} />
          <Stat tile="green" icon={<TrendUp />} delta="+2.5%" up label="Sold this week"
            value={summary ? naira(summary.total) : "—"} />
          <Stat tile="brand" icon={<CheckCircle />} delta={`${paid.length}/${orders.length}`} label="Paid orders"
            value={String(paid.length)} />
          <Stat tile="coral" icon={<Box />} delta="live" label="Products in catalogue"
            value={String(products.length)} />
        </section>
      </div>

      <div className="panel">
        <div className="panel-bar">
          <div className="search" style={{ width: 240 }}>
            <Search />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
          </div>
          <div className="spacer" />
          <button className="chipbtn hide-sm"><Filter /> Filter</button>
          <button className="chipbtn hide-sm"><Calendar /> This week</button>
          <div className="toggle">
            <button className="on" title="List"><Rows /></button>
            <button title="Grid"><Grid /></button>
          </div>
        </div>

        {tab === "orders" && (
          shown.length === 0
            ? <Empty icon={<Receipt size={30} />} text="No orders yet — create a payment request." />
            : (
              <table>
                <thead><tr>
                  <th>Order</th><th>Reference</th><th className="hide-sm">Issued</th>
                  <th>Status</th><th className="right">Amount</th><th />
                </tr></thead>
                <tbody>
                  {shown.map((o) => (
                    <tr key={o.id} onClick={() => setOpen(o)}>
                      <td>
                        <div className="who">
                          <div className="avatar">{o.id.slice(-2).toUpperCase()}</div>
                          <div>
                            <div className="cell-main">#{o.id.slice(-6).toUpperCase()}</div>
                            <div className="cell-sub">{o.status === "paid" ? "Settled" : "Awaiting buyer"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num" style={{ color: "var(--muted)" }}>{o.id.slice(0, 12)}…</td>
                      <td className="hide-sm num" style={{ color: "var(--muted)" }}>{date(o.createdAt)}</td>
                      <td><StatusPill status={o.status} /></td>
                      <td className="right cell-main num">{naira(o.amount)}</td>
                      <td className="right" style={{ color: "var(--faint)" }}>•••</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
        )}

        {tab === "products" && (
          <div className="cols">
            <div>
              {products.length === 0
                ? <Empty icon={<Box size={30} />} text="No products yet." />
                : (
                  <table>
                    <thead><tr><th>Product</th><th className="hide-sm">Stock</th><th className="right">Price</th></tr></thead>
                    <tbody>
                      {products.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="who">
                              <div className="avatar">{initials(p.name)}</div>
                              <div className="cell-main">{p.name}</div>
                            </div>
                          </td>
                          <td className="hide-sm num" style={{ color: "var(--muted)" }}>
                            {p.stockQty != null ? `${p.stockQty} left` : "—"}
                          </td>
                          <td className="right cell-main num">{naira(p.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
            <div>
              <div className="side-card">
                <div className="side-h">Add a product</div>
                <AddProduct onAdded={refresh} />
              </div>
              <div className="side-card" style={{ marginTop: 16 }}>
                <div className="side-h">Request a payment</div>
                <NewOrder products={products} onCreated={refresh} />
              </div>
            </div>
          </div>
        )}

        {tab === "ledger" && (
          <div className="cols">
            <div>
              {!ledger?.entries.length
                ? <Empty icon={<Receipt size={30} />} text="Nothing booked yet." />
                : (
                  <table>
                    <thead><tr><th>Entry</th><th className="hide-sm">When</th><th className="right">Amount</th><th className="right">Balance</th></tr></thead>
                    <tbody>
                      {ledger.entries.map((e) => (
                        <tr key={e.id}>
                          <td className="cell-main">{e.type === "sale" ? "Sale" : e.type}</td>
                          <td className="hide-sm num" style={{ color: "var(--muted)" }}>{date(e.createdAt)}</td>
                          <td className="right cell-main num" style={{ color: "var(--ok)" }}>+{naira(e.amount)}</td>
                          <td className="right num" style={{ color: "var(--muted)" }}>{naira(e.balanceAfter)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
            <div className="side-card">
              <div className="side-h">Last 7 days</div>
              <SalesChart entries={ledger?.entries ?? []} />
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <a className="btn ghost block" href="/api/ledger/export.csv"><Download /> CSV</a>
                <a className="btn ghost block" href="/api/ledger/statement.txt">Statement</a>
              </div>
            </div>
          </div>
        )}
      </div>

      {open && <OrderDrawer order={open} biz={biz} phone={phone} onClose={() => setOpen(null)} />}
    </>
  );
}

const TITLES: Record<Tab, string> = { orders: "Orders", products: "Products", ledger: "Ledger" };
const SUBS: Record<Tab, string> = {
  orders: "Every sale from WhatsApp, bank transfer and crypto — in one place.",
  products: "Your catalogue. Buyers see this when they open your shop link.",
  ledger: "Append-only naira books. Export any time.",
};

/* ------------------------------------------------------------- components */

function Stat({ tile, icon, delta, up, label, value }: {
  tile: string; icon: React.ReactNode; delta: string; up?: boolean; label: string; value: string;
}) {
  // Split the kobo decimals so they can sit back in a lighter weight, the way
  // the reference design treats amounts.
  const m = /^(.*?)(\.\d+)$/.exec(value);
  return (
    <div className="stat">
      <div className="stat-top">
        <div className={`tile ${tile}`}>{icon}</div>
        <div className="spacer" />
        <div className={`delta${up ? " up" : ""}`}>{delta}</div>
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-value num">
        {m ? <>{m[1]}<span className="dec">{m[2]}</span></> : value}
      </div>
    </div>
  );
}

function OrderDrawer({ order, biz, phone, onClose }: {
  order: Order; biz: string; phone: string; onClose: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Invoice detail">
        <div className="drawer-head">
          <span className="drawer-title">Invoice detail</span>
          <div className="spacer" />
          <button className="iconbtn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="drawer-body">
          <div className="who" style={{ marginBottom: 20 }}>
            <div className="avatar" style={{ width: 46, height: 46, fontSize: 15 }}>{initials(biz)}</div>
            <div>
              <div className="cell-main" style={{ fontSize: 15 }}>{biz}</div>
              <div className="cell-sub">{phone}</div>
            </div>
          </div>

          <div className="kv"><div className="kv-k">Invoice</div>
            <div className="kv-v num">#{order.id.slice(-6).toUpperCase()}</div></div>
          <div className="kv"><div className="kv-k">Reference</div>
            <div className="kv-v num" style={{ fontSize: 12 }}>{order.id}</div></div>
          <div className="kv"><div className="kv-k">Date issued</div>
            <div className="kv-v num">{date(order.createdAt)}</div></div>
          <div className="kv"><div className="kv-k">Status</div>
            <div className="kv-v plain"><StatusPill status={order.status} /></div></div>
          <div className="kv"><div className="kv-k">Seller</div>
            <div className="kv-v">{biz}<div className="spacer" /><Phone /></div></div>

          <div className="section-h">Details</div>
          <div className="kv"><div className="kv-k">Amount</div>
            <div className="kv-v num" style={{ fontWeight: 700 }}>{naira(order.amount)}</div></div>
          <div className="kv"><div className="kv-k">Settlement</div>
            <div className="kv-v">Merchant-direct · no custody</div></div>
          <div className="kv"><div className="kv-k">Rails</div>
            <div className="kv-v">Bank transfer · USDT · QUAI</div></div>
        </div>
        <div className="drawer-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <a className="btn" href="/api/ledger/statement.txt"><Download /> Download</a>
        </div>
      </aside>
    </>
  );
}

function SalesChart({ entries }: { entries: LedgerEntry[] }) {
  const { buckets, labels, max, total } = useMemo(() => {
    const days = 7, now = new Date();
    const b = new Array<number>(days).fill(0);
    const l: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(now); d.setDate(now.getDate() - (days - 1 - i));
      l.push(d.toLocaleDateString(undefined, { weekday: "narrow" }));
    }
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    for (const e of entries) {
      const idx = Math.floor((new Date(e.createdAt).getTime() - start.getTime()) / 86_400_000);
      if (idx >= 0 && idx < days) b[idx] += e.amount;
    }
    return { buckets: b, labels: l, max: Math.max(...b, 1), total: b.reduce((x, y) => x + y, 0) };
  }, [entries]);

  return (
    <div>
      <div className="stat-value num" style={{ fontSize: 22, marginBottom: 12 }}>{naira(total)}</div>
      <div className="chart">
        {buckets.map((v, i) => (
          <div key={i} className={`bar${v > 0 ? " on" : ""}`}
            style={{ height: `${Math.max((v / max) * 100, 4)}%` }} title={naira(v)} />
        ))}
      </div>
      <div className="chart-axis">{labels.map((d, i) => <span key={i}>{d}</span>)}</div>
    </div>
  );
}

function AddProduct({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState(""); const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const add = async () => {
    if (!name.trim() || !price) return;
    setBusy(true);
    try { await api.addProduct(name, Number(price)); setName(""); setPrice(""); setErr(""); onAdded(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      {err && <div className="error">{err}</div>}
      <div className="stack">
        <input className="field" placeholder="Product name" value={name}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
        <div className="inline">
          <input className="field num" placeholder="₦ price" value={price} inputMode="decimal"
            onChange={(e) => setPrice(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
          <button className="btn brand" onClick={() => void add()} disabled={busy || !name.trim() || !price}>
            <Plus /> Add
          </button>
        </div>
      </div>
    </>
  );
}

function NewOrder({ products, onCreated }: { products: Product[]; onCreated: () => void }) {
  const [productId, setProductId] = useState(""); const [qty, setQty] = useState("1");
  const [buyer, setBuyer] = useState("+234");
  const [dva, setDva] = useState<{ accountNumber: string; bankName: string; accountName: string }>();
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const create = async () => {
    setBusy(true);
    try {
      const r = await api.createOrder(buyer, [{ productId, qty: Number(qty) }]);
      setDva(r.instruction); setErr(""); onCreated();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      {err && <div className="error">{err}</div>}
      <div className="stack">
        <select className="field" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Choose a product…</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {naira(p.price)}</option>)}
        </select>
        <div className="inline">
          <input className="field num" placeholder="Qty" value={qty} inputMode="numeric"
            style={{ maxWidth: 80 }} onChange={(e) => setQty(e.target.value)} />
          <input className="field" placeholder="Buyer phone" value={buyer} inputMode="tel"
            onChange={(e) => setBuyer(e.target.value)} />
        </div>
        <button className="btn brand block" onClick={() => void create()} disabled={busy || !productId}>
          {busy ? "Generating…" : "Generate account number"}
        </button>
      </div>
      {dva && (
        <div className="dva">
          <div className="dva-bank">{dva.bankName}</div>
          <div className="dva-acct num">{dva.accountNumber}</div>
          <div className="dva-name">{dva.accountName}</div>
          <div className="dva-note">Buyer transfers here → you're notified automatically.</div>
        </div>
      )}
    </>
  );
}

const Empty = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
  <div className="empty">{icon}<div>{text}</div></div>
);

const StatusPill = ({ status }: { status: string }) => {
  const cls = status === "paid" ? "paid" : status === "awaiting_payment" ? "pending" : "other";
  return <span className={`pill ${cls}`}>{status === "awaiting_payment" ? "Pending" : cap(status)}</span>;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
const initials = (s: string) =>
  (s || "?").split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
