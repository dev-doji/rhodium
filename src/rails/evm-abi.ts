/**
 * The minimum EVM encoding this rail needs, hand-rolled.
 *
 * Pulling in ethers or viem for one event signature and one keccak would add a
 * large dependency to an image that already builds slowly on a free tier. The
 * frontend still uses a full library — it has to build and sign transactions —
 * but the server only ever READS a log it already knows the shape of.
 */
// @noble/hashes v2 moved subpaths to explicit .js — "/sha3" no longer resolves.
import { keccak_256 } from "@noble/hashes/sha3.js";

export function toUtf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function keccak256(data: Uint8Array): string {
  return `0x${Buffer.from(keccak_256(data)).toString("hex")}`;
}

/** `Paid(bytes32,address,address,uint256,address)` — topic0 of the event. */
export const PAID_TOPIC = keccak256(
  toUtf8Bytes("Paid(bytes32,address,address,uint256,address)"),
);

/** Our order id as the indexed bytes32 the contract was called with. */
export function orderIdToBytes32(orderId: string): string {
  return keccak256(toUtf8Bytes(orderId));
}

/** Left-pad a 20-byte address into the 32-byte word a log topic uses. */
export function addressToTopic(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

/** Read a 32-byte word out of ABI-encoded log data as a decimal string. */
export function wordToDecimal(data: string, index: number): string {
  const hex = data.replace(/^0x/, "").slice(index * 64, (index + 1) * 64);
  return hex ? BigInt(`0x${hex}`).toString(10) : "0";
}

/** Trailing 20 bytes of a topic, as a checksum-less address. */
export function topicToAddress(topic: string): string {
  return `0x${topic.replace(/^0x/, "").slice(-40)}`.toLowerCase();
}
