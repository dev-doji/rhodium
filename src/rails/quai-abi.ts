// js-sha3 is CommonJS; a named ESM import fails at runtime under Node. Import
// the module object and pull keccak256 off it.
import jsSha3 from "js-sha3";
const { keccak256 } = jsSha3 as unknown as { keccak256: (msg: string) => string };

/**
 * Minimal ABI plumbing for the RhodiumPay `Paid` event, so the backend can
 * confirm a real on-chain payment by reading the tx receipt itself (no external
 * indexer). Pure functions — unit-tested against a fabricated receipt.
 *
 *   event Paid(bytes32 indexed orderId, address indexed merchant,
 *              address token, uint256 amount, address payer)
 */
export const PAID_SIGNATURE = "Paid(bytes32,address,address,uint256,address)";
export const PAID_TOPIC0 = "0x" + keccak256(PAID_SIGNATURE);

/** keccak256(utf8(orderId)) — matches quais.id() used by the checkout page. */
export function orderIdToBytes32(orderId: string): string {
  return "0x" + keccak256(orderId);
}

export interface RpcLog {
  address: string;
  topics: string[];
  data: string;
}
export interface RpcReceipt {
  status?: string; // "0x1" success
  logs: RpcLog[];
}
export interface DecodedPaid {
  token: string; // "0x000…0" for native QUAI
  amount: bigint; // token base units / wei
}

/** Find and decode the Paid log for a given order in a tx receipt. */
export function decodePaidLog(
  receipt: RpcReceipt,
  contractAddress: string,
  expectedOrderId: string,
): DecodedPaid | null {
  if (receipt.status != null && receipt.status !== "0x1") return null;
  const contract = contractAddress.toLowerCase();
  const wantOrder = expectedOrderId.toLowerCase();
  for (const lg of receipt.logs ?? []) {
    if ((lg.address ?? "").toLowerCase() !== contract) continue;
    if ((lg.topics?.[0] ?? "").toLowerCase() !== PAID_TOPIC0) continue;
    if ((lg.topics?.[1] ?? "").toLowerCase() !== wantOrder) continue;
    // Non-indexed data layout: token(32) ++ amount(32) ++ payer(32)
    const data = lg.data.startsWith("0x") ? lg.data.slice(2) : lg.data;
    const tokenWord = data.slice(0, 64);
    const amountWord = data.slice(64, 128) || "0";
    return {
      token: "0x" + tokenWord.slice(24), // last 20 bytes = address
      amount: BigInt("0x" + amountWord),
    };
  }
  return null;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export function isNativeToken(token: string): boolean {
  return /^0x0+$/.test(token);
}
