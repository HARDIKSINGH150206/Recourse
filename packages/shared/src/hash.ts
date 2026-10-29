import { keccak256, toBytes, type Hex } from "viem";
import { canonicalize } from "json-canonicalize";
import type { LogEntry } from "./types.js";

export const ZERO32: Hex = `0x${"0".repeat(64)}`;

/** keccak256 of raw bytes, or of the UTF-8 encoding of a string. */
export function keccakBytes(data: Uint8Array | string): Hex {
  return keccak256(typeof data === "string" ? toBytes(data) : data);
}

function assertNoFloats(value: unknown, path = "$"): void {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error(`float not allowed in hashed object at ${path}`);
    if (!Number.isSafeInteger(value)) throw new Error(`unsafe integer in hashed object at ${path}`);
  } else if (typeof value === "bigint") {
    throw new Error(`bigint not allowed in hashed object at ${path}; use a decimal string`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoFloats(v, `${path}[${i}]`));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertNoFloats(v, `${path}.${k}`);
  }
}

/** RFC 8785 canonical JSON. Throws on floats and bigints (docs/03 section 1). */
export function canonicalJson(value: unknown): string {
  assertNoFloats(value);
  return canonicalize(value);
}

/** keccak256(utf8(JCS(value))) */
export function canonicalHash(value: unknown): Hex {
  return keccakBytes(canonicalJson(value));
}

/** entry_hash over the 8 JCS fields of docs/03 section 4.1. */
export function entryHash(e: Omit<LogEntry, "entry_hash">): Hex {
  return canonicalHash({
    seq: e.seq,
    ts: e.ts,
    type: e.type,
    request_id: e.request_id,
    mandate_id: e.mandate_id,
    agent_id: e.agent_id,
    payload_commitment: e.payload_commitment,
    prev_hash: e.prev_hash,
  });
}

export function isHex32(v: unknown): v is Hex {
  return typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v);
}
