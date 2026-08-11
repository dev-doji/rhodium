import { describe, it, expect } from "vitest";
import {
  PAID_TOPIC0,
  orderIdToBytes32,
  decodePaidLog,
  isNativeToken,
} from "../src/rails/quai-abi.js";
import { koboToQuaiWei, quaiWeiToKobo } from "../src/lib/fx.js";
import { resetConfigCache } from "../src/config/index.js";

const CONTRACT = "0xRhodiumPayContract000000000000000000abcd";

/** Build a synthetic Paid log the way Orchard would return it in a receipt. */
function paidLog(orderId: string, token: string, amountWei: bigint) {
  const pad = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");
  const tokenWord = pad(token.toLowerCase());
  const amountWord = pad("0x" + amountWei.toString(16));
  const payerWord = pad("0xabcabcabcabcabcabcabcabcabcabcabcabcabca");
  return {
    address: CONTRACT,
    topics: [PAID_TOPIC0, orderIdToBytes32(orderId), "0x" + pad("0xmerchant")],
    data: "0x" + tokenWord + amountWord + payerWord,
  };
}

describe("Quai Paid-event decoding (the live confirmation path, offline)", () => {
  it("computes a stable event topic and orderId hash", () => {
    expect(PAID_TOPIC0).toMatch(/^0x[0-9a-f]{64}$/);
    expect(orderIdToBytes32("ord_123")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(orderIdToBytes32("ord_123")).toBe(orderIdToBytes32("ord_123"));
  });

  it("decodes native QUAI amount from a receipt and matches the order", () => {
    resetConfigCache();
    process.env.FX_NGN_PER_QUAI = "5000";
    const wei = BigInt(koboToQuaiWei(500_000)); // ₦5,000 → 1 QUAI at 5000 ₦/QUAI
    const receipt = { status: "0x1", logs: [paidLog("ord_abc", "0x0000000000000000000000000000000000000000", wei)] };

    const decoded = decodePaidLog(receipt, CONTRACT, orderIdToBytes32("ord_abc"));
    expect(decoded).not.toBeNull();
    expect(isNativeToken(decoded!.token)).toBe(true);
    expect(quaiWeiToKobo(decoded!.amount)).toBe(500_000);
  });

  it("ignores a receipt for a different order or a failed tx", () => {
    const wei = 10n ** 18n;
    const good = { status: "0x1", logs: [paidLog("ord_abc", "0x0", wei)] };
    expect(decodePaidLog(good, CONTRACT, orderIdToBytes32("ord_OTHER"))).toBeNull();

    const failed = { status: "0x0", logs: [paidLog("ord_abc", "0x0", wei)] };
    expect(decodePaidLog(failed, CONTRACT, orderIdToBytes32("ord_abc"))).toBeNull();
  });

  it("native QUAI FX round-trips kobo", () => {
    resetConfigCache();
    process.env.FX_NGN_PER_QUAI = "5000";
    expect(quaiWeiToKobo(koboToQuaiWei(1_234_500))).toBe(1_234_500);
  });
});
