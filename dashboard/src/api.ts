const TOKEN_KEY = "rhodium_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null): void {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Download a guarded file.
 *
 * A plain <a href> is a browser navigation, and a navigation carries no
 * Authorization header — so every download button returned "missing bearer
 * token" while the rest of the dashboard worked. Fetch it with the token,
 * then hand the browser a blob it already has.
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(path, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick: revoking synchronously can cancel the download
  // in some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface Product { id: string; name: string; price: number; stockQty?: number }
export interface Order { id: string; amount: number; status: string; createdAt: string }
export interface LedgerEntry { id: string; type: string; amount: number; balanceAfter: number; createdAt: string }

export const api = {
  requestOtp: (phone: string) =>
    req<{ ok: boolean }>("/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) }),
  verifyOtp: (phone: string, code: string) =>
    req<{ token: string; merchantId: string }>("/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({ phone, code }),
    }),
  me: () => req<{ merchant: { businessName: string; phone: string } }>("/api/me"),
  products: () => req<{ products: Product[] }>("/api/products"),
  addProduct: (name: string, priceNaira: number, stockQty?: number) =>
    req<{ product: Product }>("/api/products", {
      method: "POST",
      body: JSON.stringify({ name, priceNaira, stockQty }),
    }),
  orders: () => req<{ orders: Order[] }>("/api/orders"),
  createOrder: (buyerPhone: string, lines: { productId: string; qty: number }[]) =>
    req<{ order: Order; instruction: { accountNumber: string; bankName: string; accountName: string } }>(
      "/api/orders",
      { method: "POST", body: JSON.stringify({ buyerPhone, lines }) },
    ),
  ledger: () =>
    req<{ balance: number; balanceFormatted: string; entries: LedgerEntry[] }>("/api/ledger"),
  summary: () => req<{ count: number; total: number; message: string }>("/api/summary"),
};

export const naira = (kobo: number): string => `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
