import type { JudgeOutput } from "@recourse/shared";
import { checkCitations } from "./citations.js";
import { judgeIsConsistent } from "./judge.js";

type Claim = JudgeOutput["claims"][number];

/** What one judge contributed. Only `vote` counts toward the quorum. */
export type Vote =
  | { kind: "vote"; judge: JudgeOutput; claims: Claim[] }
  /** Valid decision, but no kept claim cites a `response` entry (docs/08 section 4.4). */
  | { kind: "uncited" }
  /** A class, outcome or fault the AI may not choose, or a pairing that does not fit. */
  | { kind: "inconsistent" }
  /** The model call failed or its output never validated. */
  | { kind: "error" };

export type ReviewReason = "no_quorum" | "uncited_claims" | "model_error";

export type Tally =
  | { ok: true; winner: Extract<Vote, { kind: "vote" }>; agreeing: number }
  | { ok: false; reason: ReviewReason };

/** Citation and consistency checks for one judge's output. */
export function toVote(judge: JudgeOutput, types: Map<number, string>): Vote {
  if (!judgeIsConsistent(judge)) return { kind: "inconsistent" };
  const cited = checkCitations(judge.claims, types);
  if (!cited.supported) return { kind: "uncited" };
  return { kind: "vote", judge, claims: cited.kept };
}

const keyOf = (j: JudgeOutput) => `${j.class}|${j.outcome}|${j.fault}`;

/**
 * Quorum (docs/08 section 4.5): a strict majority of ALL configured judges must agree on
 * (class, outcome, fault). Judges that errored, were inconsistent or were uncited count in the
 * denominator but never as agreement, so one broken judge out of three cannot decide alone. The
 * winning claims come from the first agreeing judge in config order, which keeps the claims hash
 * deterministic. With one judge the vote is its own majority.
 */
export function tally(votes: Vote[]): Tally {
  const valid = votes.filter((v): v is Extract<Vote, { kind: "vote" }> => v.kind === "vote");
  const groups = new Map<string, typeof valid>();
  for (const v of valid) groups.set(keyOf(v.judge), [...(groups.get(keyOf(v.judge)) ?? []), v]);
  for (const group of groups.values()) {
    if (group.length * 2 > votes.length)
      return { ok: true, winner: group[0]!, agreeing: group.length };
  }
  if (valid.length > 0) return { ok: false, reason: "no_quorum" };
  if (votes.some((v) => v.kind === "uncited")) return { ok: false, reason: "uncited_claims" };
  return { ok: false, reason: "model_error" };
}
