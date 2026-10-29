// Response shapes of the services the dashboard talks to. They mirror docs/04; the zod
// schemas that enforce them live server-side in each service.

export interface Question {
  id: string;
  text: string;
  options: string[];
}

export interface MandateJson {
  owner: string;
  agent: string;
  token: string;
  maxPricePerCall: string;
  totalBudget: string;
  expiresAt: number;
  nonce: string;
  merchantsHash: string;
  termsHash: string;
}

export interface Terms {
  version: number;
  category: string;
  defaults: Record<string, unknown>;
  discretion: string[];
}

export interface CompileResponse {
  mandate: MandateJson;
  display: { maxPricePerCall: string; totalBudget: string; symbol: string };
  terms: Terms;
  merchants: string[];
  summary: string;
  questions: Question[];
  typed_data: {
    domain: Record<string, unknown>;
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  };
}

export interface ScenarioInfo {
  id: string;
  description: string;
}

export interface RunStep {
  name: string;
  ts: number;
  ok: boolean;
  seq?: number;
  tx?: string;
  detail?: string;
}

export type RunStatus = "running" | "completed" | "blocked" | "failed";

export interface Run {
  run_id: string;
  scenario: string;
  status: RunStatus;
  steps: RunStep[];
  request_id: string | null;
  mandate_id: string | null;
  escrow_id: string | null;
  tx_hashes: { escrow?: string; dispute?: string; resolve?: string };
  response: { status: number; body: string } | null;
  reverted: string | null;
  dispute: { dispute_id: string | null; status: string } | null;
  error: string | null;
  created_at: number;
}

export interface StoredMandate {
  mandateId: string;
  summary: string;
  registeredOnchain?: boolean;
  mandate: MandateJson;
}

export interface Claim {
  text: string;
  cites: number[];
}

export interface Verdict {
  dispute_id: string;
  escrow_id: string;
  class: number | null;
  class_name: string | null;
  outcome: "REFUND" | "RELEASE" | null;
  fault: "NONE" | "AGENT" | "MERCHANT" | null;
  decided_by: "rules" | "ai" | "ai_quorum" | "human";
  claims: Claim[];
  explanation: string;
  injection_detected: boolean;
  evidence_root: string[];
  prompt_hash: string;
  commitment: string;
  review_reason?: string;
  created_at: number;
}

export interface Dispute {
  dispute_id: string;
  status: string;
  note: string | null;
  escrow_id: string;
  mandate_id: string;
  request_id: string;
  reason_text: string | null;
  verdict: Verdict | null;
  review: { outcome: string; fault: string; note: string } | null;
  evidence_report: Record<string, unknown> | null;
  txs: { dispute: string | null; resolve: string | null };
  created_at: number;
  updated_at: number;
}

export interface LogEntryRow {
  seq: number;
  ts: number;
  type: string;
  request_id: string | null;
  entry_hash: string;
}

export interface Reputation {
  address: string;
  as_agent: { disputes: number; faults: number };
  as_merchant: { disputes: number; faults: number };
}
