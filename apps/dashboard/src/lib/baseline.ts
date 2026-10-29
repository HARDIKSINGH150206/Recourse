import type { Reputation } from "./types";

export type Counters = { disputes: number; faults: number };

export const delta = (now: Counters, base: Counters | null): Counters => ({
  disputes: now.disputes - (base?.disputes ?? now.disputes),
  faults: now.faults - (base?.faults ?? now.faults),
});

export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

const key = (address: string) => `recourse.rep.${address.toLowerCase()}`;

/** The baseline lives in this browser only (a convenience for the demo's before/after view). */
export function loadBaseline(address: string): Reputation | null {
  try {
    const raw = sessionStorage.getItem(key(address));
    return raw ? (JSON.parse(raw) as Reputation) : null;
  } catch {
    return null;
  }
}

export function saveBaseline(address: string, r: Reputation): void {
  try {
    sessionStorage.setItem(key(address), JSON.stringify(r));
  } catch {
    /* storage can be blocked; the panel then shows absolute counters only */
  }
}
