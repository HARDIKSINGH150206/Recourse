import { describe, expect, it } from "vitest";
import { tally, toVote, type Vote } from "../src/index.js";
import { refundJudge, releaseJudge } from "./fixture.js";
import type { JudgeOutput } from "@recourse/shared";

const types = new Map([
  [1, "request"],
  [4, "response"],
]);
type Valid = Extract<Vote, { kind: "vote" }>;
const refund = toVote(refundJudge as JudgeOutput, types) as Valid;
const release = toVote(releaseJudge as JudgeOutput, types) as Valid;
const uncited: Vote = { kind: "uncited" };
const error: Vote = { kind: "error" };
const bad: Vote = { kind: "inconsistent" };

describe("toVote", () => {
  it("accepts a consistent, cited decision and keeps only valid claims", () => {
    const v = toVote(
      {
        ...releaseJudge,
        claims: [...releaseJudge.claims, { text: "x", cites: [99] }],
      } as JudgeOutput,
      types,
    );
    expect(v).toMatchObject({ kind: "vote", claims: releaseJudge.claims });
  });
  it("rejects forbidden or mismatched decisions and uncited ones", () => {
    expect(toVote({ ...refundJudge, fault: "NONE" } as JudgeOutput, types).kind).toBe(
      "inconsistent",
    );
    expect(toVote({ ...refundJudge, class: 1, fault: "AGENT" } as JudgeOutput, types).kind).toBe(
      "inconsistent",
    );
    expect(
      toVote({ ...refundJudge, claims: [{ text: "x", cites: [1] }] } as JudgeOutput, types).kind,
    ).toBe("uncited");
  });
});

describe("tally", () => {
  it("one judge is its own majority", () => {
    expect(tally([release])).toMatchObject({ ok: true, agreeing: 1 });
  });
  it("3-0 and 2-1 are majorities", () => {
    expect(tally([release, release, release])).toMatchObject({ ok: true, agreeing: 3 });
    const r = tally([release, refund, release]);
    expect(r).toMatchObject({ ok: true, agreeing: 2 });
    if (r.ok) expect(r.winner.judge.outcome).toBe("RELEASE");
  });
  it("two judges that disagree have no quorum", () => {
    expect(tally([release, refund])).toEqual({ ok: false, reason: "no_quorum" });
  });
  it("a split of valid votes across different decisions has no quorum", () => {
    const other = {
      ...release,
      judge: { ...release.judge, class: 3, outcome: "REFUND", fault: "AGENT" },
    } as Vote;
    expect(tally([release, refund, other])).toEqual({ ok: false, reason: "no_quorum" });
  });
  it("a broken judge still counts in the denominator", () => {
    expect(tally([release, release, error])).toMatchObject({ ok: true, agreeing: 2 });
    expect(tally([release, error, bad])).toEqual({ ok: false, reason: "no_quorum" });
    expect(tally([release, uncited, error])).toEqual({ ok: false, reason: "no_quorum" });
  });
  it("picks the winner's claims from the first agreeing judge", () => {
    const second = { ...release, claims: [{ text: "other", cites: [4] }] } as Vote;
    const r = tally([refund, release, second]);
    expect(r.ok && r.winner).toBe(release);
  });
  it("reports why when nobody voted", () => {
    expect(tally([uncited, error, bad])).toEqual({ ok: false, reason: "uncited_claims" });
    expect(tally([error, bad, error])).toEqual({ ok: false, reason: "model_error" });
    expect(tally([bad])).toEqual({ ok: false, reason: "model_error" });
    expect(tally([uncited])).toEqual({ ok: false, reason: "uncited_claims" });
  });
});
