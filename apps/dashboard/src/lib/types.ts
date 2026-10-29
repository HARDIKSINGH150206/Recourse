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
