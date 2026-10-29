import type { Address } from "viem";
import type { Terms } from "@recourse/shared";

function humanCategory(category: string): string {
  return category
    .split("_")
    .map((w) => (w.toLowerCase() === "api" ? "API" : w))
    .join(" ");
}

function humanDuration(seconds: number): string {
  const unit = (n: number, name: string) => `${n} ${name}${n === 1 ? "" : "s"}`;
  if (seconds % 86_400 === 0) return unit(seconds / 86_400, "day");
  if (seconds % 3600 === 0) return unit(seconds / 3600, "hour");
  if (seconds % 60 === 0) return unit(seconds / 60, "minute");
  return unit(seconds, "second");
}

function utc(ts: number): string {
  return new Date(ts * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(/:\d\d\.\d+Z$/, " UTC");
}

export interface SummaryInput {
  maxPricePerCall: string;
  totalBudget: string;
  symbol: string;
  expiresAt: number;
  merchants: readonly Address[];
  terms: Terms;
}

/**
 * Plain-English read-back of a mandate the owner is about to sign. Rendered by this template from
 * the validated values and never by an LLM (D-015), so what the owner reads is exactly what is signed.
 */
export function renderSummary(i: SummaryInput): string {
  const d = i.terms.defaults;
  const free = i.terms.discretion.length > 0 ? i.terms.discretion.join(", ") : "none";
  const parts = [
    `Your agent may spend up to ${i.maxPricePerCall} ${i.symbol} per call and ${i.totalBudget} ${i.symbol} in total on ${humanCategory(i.terms.category)} calls until ${utc(i.expiresAt)}.`,
    `Allowed merchants: ${i.merchants.join(", ")}.`,
    `Any other field is not restricted: ${free}.`,
    `Responses must be ${d.schema_required ? "valid and " : ""}fresher than ${humanDuration(d.freshness_seconds)} and arrive within ${d.sla_ms} ms.`,
    d.substitutions === "not_allowed"
      ? "Substituting a different product is not allowed."
      : "Substitutions are allowed.",
  ];
  return parts.join(" ");
}

/** "0.05" -> 50000n for 6 decimals; rejects junk, zero and excess precision. */
export function decimalToUnits(value: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) throw new Error(`invalid amount: ${value}`);
  const frac = m[2] ?? "";
  if (frac.length > decimals)
    throw new Error(`amount has more than ${decimals} decimals: ${value}`);
  const units = BigInt(m[1]! + frac.padEnd(decimals, "0"));
  if (units <= 0n) throw new Error("amount must be positive");
  return units;
}

/** 50000n -> "0.05" (trailing zeros trimmed, at least one integer digit). */
export function unitsToDecimal(units: bigint, decimals: number): string {
  const s = units.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}
