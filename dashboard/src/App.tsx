import { useEffect, useState } from "react";
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
  return authed ? <Dashboard onLogout={() => { setToken(null); setAuthed(false); }} /> : <Login onLogin={() => setAuthed(true)} />;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [phone, setPhone] = useState("+234");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  return (
    <Shell>
      <h1>Rhodium</h1>
      <p style={{ color: "#667" }}>Merchant sign-in — we text you a 6-digit code.</p>
      {err && <div style={styles.error}>{err}</div>}
      {!sent ? (
        <>
          <input style={styles.input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2348030000001" />
          <button style={styles.btn} onClick={async () => {
            try { await api.requestOtp(phone); setSent(true); setErr(""); }
            catch (e) { setErr((e as Error).message); }
          }}>Send code</button>
        </>
      ) : (
        <>
          <input style={styles.input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
          <button style={styles.btn} onClick={async () => {
            try { const r = await api.verifyOtp(phone, code); setToken(r.token); onLogin(); }
            catch (e) { setErr((e as Error).message); }
          }}>Verify</button>
          <p style={{ fontSize: 12, color: "#889" }}>
            (Dev: the code is delivered on the merchant's WhatsApp/SMS channel.)
          </p>
        </>
      )}
    </Shell>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [biz, setBiz] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ledger, setLedger] = useState<{ balanceFormatted: string; entries: LedgerEntry[] }>();
  const [summary, setSummary] = useState<{ message: string }>();
  const [err, setErr] = useState("");

  const refresh = async () => {
    try {
      const [me, p, o, l, s] = await Promise.all([
        api.me(), api.products(), api.orders(), api.ledger(), api.summary(),
      ]);
      setBiz(me.merchant.businessName);
      setProducts(p.products); setOrders(o.orders); setLedger(l); setSummary(s);
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { void refresh(); }, []);

  return (
    <Shell wide>
      <div style={styles.header}>
        <h1 style={{ margin: 0 }}>{biz || "Dashboard"}</h1>
        <button style={styles.linkBtn} onClick={onLogout}>Sign out</button>
      </div>
      {err && <div style={styles.error}>{err}</div>}
      {summary && <div style={styles.summary}>📈 {summary.message}</div>}
      {ledger && (
        <div style={styles.balance}>
          Balance <strong>{ledger.balanceFormatted}</strong>
          <span style={{ float: "right", fontSize: 13 }}>
            <a href="/api/ledger/export.csv">CSV</a> · <a href="/api/ledger/statement.txt">Statement</a>
          </span>
        </div>
      )}

      <div style={styles.grid}>
        <Card title="Catalogue">
          <AddProduct onAdded={refresh} />
          {products.length === 0 && <Empty>No products yet.</Empty>}
          {products.map((p) => (
            <Row key={p.id}>
              <span>{p.name}</span>
              <span>{naira(p.price)}{p.stockQty != null ? ` · ${p.stockQty} in stock` : ""}</span>
            </Row>
          ))}
        </Card>

        <Card title="Create payment request">
          <NewOrder products={products} onCreated={refresh} />
        </Card>

        <Card title="Orders">
          {orders.length === 0 && <Empty>No orders yet.</Empty>}
          {orders.map((o) => (
            <Row key={o.id}>
              <span>{o.id.slice(-6).toUpperCase()}</span>
              <span>{naira(o.amount)} · <Badge status={o.status} /></span>
            </Row>
          ))}
        </Card>

        <Card title="Ledger">
          {!ledger?.entries.length && <Empty>No entries yet.</Empty>}
          {ledger?.entries.map((e) => (
            <Row key={e.id}>
              <span>{new Date(e.createdAt).toLocaleString()}</span>
              <span>{naira(e.amount)} · bal {naira(e.balanceAfter)}</span>
            </Row>
          ))}
        </Card>
      </div>
    </Shell>
  );
}

function AddProduct({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState(""); const [price, setPrice] = useState(""); const [err, setErr] = useState("");
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
      <input style={{ ...styles.input, flex: 2, margin: 0 }} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input style={{ ...styles.input, flex: 1, margin: 0 }} placeholder="₦ price" value={price} onChange={(e) => setPrice(e.target.value)} />
      <button style={{ ...styles.btn, width: "auto", margin: 0 }} onClick={async () => {
        try { await api.addProduct(name, Number(price)); setName(""); setPrice(""); onAdded(); }
        catch (e) { setErr((e as Error).message); }
      }}>Add</button>
      {err && <div style={styles.error}>{err}</div>}
    </div>
  );
}

function NewOrder({ products, onCreated }: { products: Product[]; onCreated: () => void }) {
  const [productId, setProductId] = useState(""); const [qty, setQty] = useState("1");
  const [buyer, setBuyer] = useState("+234"); const [dva, setDva] = useState<{ accountNumber: string; bankName: string; accountName: string }>();
  const [err, setErr] = useState("");
  return (
    <div>
      <select style={styles.input} value={productId} onChange={(e) => setProductId(e.target.value)}>
        <option value="">Choose product…</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {naira(p.price)}</option>)}
      </select>
      <input style={styles.input} placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
      <input style={styles.input} placeholder="Buyer phone" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
      <button style={styles.btn} onClick={async () => {
        try {
          const r = await api.createOrder(buyer, [{ productId, qty: Number(qty) }]);
          setDva(r.instruction); setErr(""); onCreated();
        } catch (e) { setErr((e as Error).message); }
      }}>Generate DVA</button>
      {err && <div style={styles.error}>{err}</div>}
      {dva && (
        <div style={styles.dva}>
          <div>🏦 {dva.bankName}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{dva.accountNumber}</div>
          <div>{dva.accountName}</div>
          <div style={{ fontSize: 12, color: "#667", marginTop: 6 }}>
            Buyer transfers here → you're auto-notified. No screenshot.
          </div>
        </div>
      )}
    </div>
  );
}

const Shell = ({ children, wide }: { children: React.ReactNode; wide?: boolean }) => (
  <div style={{ ...styles.page }}>
    <div style={{ maxWidth: wide ? 980 : 380, margin: "0 auto" }}>{children}</div>
  </div>
);
const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={styles.card}><h3 style={{ marginTop: 0 }}>{title}</h3>{children}</div>
);
const Row = ({ children }: { children: React.ReactNode }) => <div style={styles.rowItem}>{children}</div>;
const Empty = ({ children }: { children: React.ReactNode }) => <div style={{ color: "#99a", fontSize: 14 }}>{children}</div>;
const Badge = ({ status }: { status: string }) => {
  const color = status === "paid" ? "#0a7" : status === "awaiting_payment" ? "#c80" : "#889";
  return <span style={{ color, fontWeight: 600 }}>{status}</span>;
};

const styles: Record<string, React.CSSProperties> = {
  page: { fontFamily: "system-ui, sans-serif", background: "#f5f6fa", minHeight: "100vh", padding: 24, color: "#223" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  card: { background: "#fff", borderRadius: 12, padding: 18, boxShadow: "0 1px 3px rgba(0,0,0,.08)" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 16 },
  input: { display: "block", width: "100%", boxSizing: "border-box", padding: 10, margin: "6px 0", border: "1px solid #ccd", borderRadius: 8, fontSize: 15 },
  btn: { width: "100%", padding: 11, background: "#3a5bd9", color: "#fff", border: 0, borderRadius: 8, fontSize: 15, cursor: "pointer" },
  linkBtn: { background: "none", border: 0, color: "#3a5bd9", cursor: "pointer" },
  error: { background: "#fee", color: "#a00", padding: 8, borderRadius: 6, margin: "6px 0", fontSize: 14 },
  summary: { background: "#eef4ff", padding: 12, borderRadius: 8, marginTop: 12 },
  balance: { background: "#fff", padding: 14, borderRadius: 10, marginTop: 12, fontSize: 18 },
  rowItem: { display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #eef", fontSize: 14 },
  dva: { background: "#f0fff6", border: "1px solid #b6ecc9", borderRadius: 10, padding: 14, marginTop: 10, textAlign: "center" },
};
