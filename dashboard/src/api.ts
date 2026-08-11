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
