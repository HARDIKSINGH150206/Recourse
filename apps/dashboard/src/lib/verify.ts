import { verifyUntrustedBundle, type VerificationReport } from "@recourse/shared";
import type { PublicClient } from "viem";

export type Path = (string | number)[];

export interface Leaf {
  path: Path;
  value: string | number | boolean | null;
}

/** Report keys in docs/03 section 9 order, with a plain-English label for each check. */
export const CHECKS = [
  ["entry_hash_ok", "Entry hashes recompute"],
  ["fields_ok", "Disclosed fields match their commitments"],
  ["membership_ok", "Entries are in the signed batch"],
  ["tree_head_signature_ok", "Tree head signed by the gateway"],
  ["anchor_ok", "Root anchored on-chain"],
  ["receipt_ok", "Merchant receipt valid"],
  ["chain_ok", "Hash chain continuous (full batch only)"],
  ["time_ok", "Time order consistent"],
] as const;

export type CheckKey = (typeof CHECKS)[number][0];
export type CheckState = "pass" | "fail" | "pending";

/** `null` means the check was not run (no RPC, no receipt, no full batch): shown as pending. */
export function checkState(report: VerificationReport, key: CheckKey): CheckState {
  const v = report[key];
  return v === null ? "pending" : v ? "pass" : "fail";
}

/** Every scalar in a JSON value, with its path. Arrays and objects are walked in order. */
export function leaves(value: unknown, base: Path = []): Leaf[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, [...base, i]));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, [...base, k]));
  }
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return [{ path: base, value: value as Leaf["value"] }];
  }
  return [];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Copy of `doc` with the scalar at `path` replaced by `text`, keeping the original scalar type. */
export function setLeaf<T>(doc: T, path: Path, text: string): T {
  const next = clone(doc);
  let node = next as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  const last = path[path.length - 1]!;
  const was = node[last];
  if (typeof was === "number") {
    const n = Number(text);
    node[last] = text.trim() !== "" && Number.isFinite(n) ? n : text;
  } else if (typeof was === "boolean") {
    node[last] = text === "true";
  } else {
    node[last] = text;
  }
  return next;
}

export const samePath = (a: Path, b: Path): boolean =>
  a.length === b.length && a.every((k, i) => k === b[i]);

/** Paths whose scalar differs from the original (used to highlight tampered fields). */
export function changedPaths(original: unknown, current: unknown): Path[] {
  const orig = new Map(leaves(original).map((l) => [JSON.stringify(l.path), l.value]));
  return leaves(current)
    .filter((l) => orig.get(JSON.stringify(l.path)) !== l.value)
    .map((l) => l.path);
}

export function verifyInBrowser(bundle: unknown, rpc?: PublicClient): Promise<VerificationReport> {
  return verifyUntrustedBundle(bundle, rpc ? { rpc } : {});
}
