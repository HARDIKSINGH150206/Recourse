import type { RuleResults, Terms } from "@recourse/shared";

/**
 * Input to `runRules` (docs/08 section 3), built by the adjudicator from the verified bundle.
 * Additions to the spec: `evidenceValid` (the verifyBundle verdict for R0) and `cites` (the log
 * `seq` numbers a decisive result must cite).
 */
export interface RuleInput {
  /** R0: result of `verifyBundle` (steps 1 to 4 and 6 all pass). */
  evidenceValid: boolean;
  mandate: {
    maxPricePerCall: bigint;
    totalBudget: bigint;
    expiresAt: number;
    /** Lowercase or checksummed; compared case-insensitively. */
    merchants: string[];
    terms: Terms;
  };
  escrow: { amount: bigint; merchant: string; createdAt: number; windowEnds: number };
  request: { city?: string; path: string; ts: number };
  response?: {
    status: number;
    bodyText?: string;
    bodyJson?: unknown;
    latencyMs: number;
    ts: number;
  };
  receipt?: { valid: boolean; responseHashMatches: boolean };
  /** config/alias-table.json: canonical name -> aliases. */
  aliasTable: Record<string, string[]>;
  /** Log entry `seq` numbers of the `request` entry and, when one exists, the `response` entry. */
  cites: { request: number; response?: number };
}

/** What `decide` returns when the rules settle the case without AI. */
export type RuleDecision =
  | {
      kind: "verdict";
      class: 1 | 2 | 3 | 4;
      outcome: "REFUND" | "RELEASE";
      fault: "NONE" | "AGENT" | "MERCHANT";
      reason: string;
      cites: number[];
    }
  | { kind: "review"; reason: "evidence_invalid" | "evidence_incomplete"; cites: number[] };

export type { RuleResults };
