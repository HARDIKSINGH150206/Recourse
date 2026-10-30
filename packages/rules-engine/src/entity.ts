/** R6 helpers (docs/08 section 3): normalisation and the exact / alias / different / ambiguous call. */

export type EntityMatch = "exact" | "alias" | "different" | "ambiguous";

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasGroups(table: Record<string, string[]>): Set<string>[] {
  return Object.entries(table).map(
    ([canonical, aliases]) => new Set([canonical, ...aliases].map(normalizeName)),
  );
}

/**
 * - `exact`: equal after normalisation.
 * - `alias`: both names are in the same alias-table group.
 * - `different`: no shared token.
 * - `ambiguous`: partial token overlap ("Navi Mumbai" vs "Mumbai"); goes to the AI stage.
 */
export function matchEntity(
  requested: string,
  returned: string,
  aliasTable: Record<string, string[]>,
): EntityMatch {
  const a = normalizeName(requested);
  const b = normalizeName(returned);
  if (a === "" || b === "") return "ambiguous";
  if (a === b) return "exact";
  if (aliasGroups(aliasTable).some((g) => g.has(a) && g.has(b))) return "alias";
  const tokensA = new Set(a.split(" "));
  const shared = b.split(" ").some((t) => tokensA.has(t));
  return shared ? "ambiguous" : "different";
}
