import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256, toUtf8Bytes } from "../src/rails/evm-abi.js";

/**
 * The checkout page hand-encodes its calldata — no ABI library on a payment
 * page — so nothing type-checks the argument order against the contract. These
 * guard the one mistake that cannot be seen: `payToken`'s merchant and token
 * are BOTH addresses, so swapping them yields the same selector and a
 * well-formed transaction that reverts only on execution. It shipped that way,
 * and every browser card payment on the crypto rail reverted.
 */
const checkout = readFileSync(join(process.cwd(), "public", "checkout.html"), "utf8");

describe("checkout calldata matches the RhodiumPay ABI", () => {
  it("uses the real selectors", () => {
    const sel = (sig: string) => keccak256(toUtf8Bytes(sig)).slice(0, 10);
    expect(checkout).toContain(sel("payToken(bytes32,address,address,uint256)"));
    expect(checkout).toContain(sel("payNative(bytes32,address)"));
    expect(checkout).toContain(sel("approve(address,uint256)"));
  });

  it("encodes payToken as (orderId, MERCHANT, TOKEN, amount)", () => {
    const selector = keccak256(toUtf8Bytes("payToken(bytes32,address,address,uint256)")).slice(0, 10);
    const line = checkout.slice(checkout.indexOf(selector));
    const call = line.slice(0, line.indexOf("}"));

    const merchant = call.indexOf("merchantAddress");
    const token = call.indexOf("tokenAddress");
    expect(merchant).toBeGreaterThan(-1);
    expect(token).toBeGreaterThan(-1);
    // Contract: payToken(bytes32 orderId, address merchant, address token, ...)
    expect(merchant).toBeLessThan(token);
  });

  it("does not hardcode ether as the native currency when adding a chain", () => {
    // Arc's gas token is USDC. A wallet told "ETH" labels the buyer's dollars
    // as ether, and refuses the add outright when it already knows the chain.
    const start = checkout.indexOf("async function ensureEvmChain");
    expect(start).toBeGreaterThan(-1);
    const body = checkout.slice(start, checkout.indexOf("wallet_addEthereumChain", start) + 400);
    expect(body).toContain("evmNativeCurrency");
  });
});
