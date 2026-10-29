import type { AdjudicationInput, JudgeOutput } from "@recourse/shared";

type Claim = JudgeOutput["claims"][number];

export function entryTypes(input: AdjudicationInput): Map<number, string> {
  return new Map(input.bundle.entries.map((e) => [e.entry.seq, e.entry.type]));
}

/**
 * Citation check (docs/08 section 4.4, CLAUDE.md rule 4). A claim stays only if it cites at least
 * one entry and every cited `seq` exists in the bundle. The verdict is supported only if a kept
 * claim cites a `response` entry, since both AI outcomes are about the delivered response.
 */
export function checkCitations(
  claims: Claim[],
  types: Map<number, string>,
): { kept: Claim[]; dropped: number; supported: boolean } {
  const kept = claims.filter((c) => c.cites.length > 0 && c.cites.every((s) => types.has(s)));
  const supported = kept.some((c) => c.cites.some((s) => types.get(s) === "response"));
  return { kept, dropped: claims.length - kept.length, supported };
}
