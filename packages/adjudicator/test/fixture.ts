import {
  type AdjudicationInput,
  type EvidenceBundle,
  type VerificationReport,
  keccakBytes,
} from "@recourse/shared";
import {
  ESCROW_ID,
  REQUEST_ID,
  T0,
  accounts,
  buildFixture,
  mandate,
  terms,
} from "@recourse/shared/testkit";
import type { ModelsConfig } from "../src/index.js";

export const CFG: ModelsConfig = {
  temperature: 0,
  seed: 42,
  top_p: 1,
  num_ctx: 4096,
  extractor: { name: "ex-model" },
  judges: [{ name: "judge-model" }],
};

export const goodBody = {
  city: "Mumbai",
  temp_c: 31,
  humidity: 70,
  observed_at: T0,
  summary: "Hazy sunshine",
};

/** Log seq numbers of the fixture: 1 request, 2 payment_required, 3 payment_proof, 4 response, 5 receipt. */
export const SEQ = { request: 1, response: 4, receipt: 5 };

export interface Opts {
  body?: unknown;
  status?: number;
  latency?: number;
  reason?: string | null;
  evidenceOk?: boolean;
  receipt?: boolean;
  blob?: boolean;
  amount?: string;
}

export async function makeInput(o: Opts = {}): Promise<AdjudicationInput> {
  const fx = await buildFixture();
  const bundle: EvidenceBundle = structuredClone(fx.bundle);
  const raw = o.body ?? goodBody;
  const bytes = new TextEncoder().encode(typeof raw === "string" ? raw : JSON.stringify(raw));
  const bodyHash = keccakBytes(bytes);

  const resp = bundle.entries.find((e) => e.entry.type === "response")!;
  const set = (name: string, value: unknown) => {
    resp.disclosed.find((d) => d.name === name)!.value = value;
  };
  set("status", o.status ?? 200);
  set("latency_ms", o.latency ?? 400);
  set("body_hash", bodyHash);
  set("body_len", bytes.length);

  if (o.receipt === false) bundle.receipt = null;
  else bundle.receipt!.responseHash = bodyHash;

  const ok = o.evidenceOk ?? true;
  const report: VerificationReport = {
    entry_hash_ok: ok,
    fields_ok: true,
    membership_ok: true,
    tree_head_signature_ok: true,
    anchor_ok: true,
    receipt_ok: bundle.receipt ? true : null,
    chain_ok: null,
    time_ok: true,
    errors: ok ? [] : ["entry_hash mismatch"],
  };

  return {
    dispute_id: "dispute-1",
    escrow_id: ESCROW_ID,
    request_id: REQUEST_ID,
    bundle,
    evidence_report: report,
    blobs: o.blob === false ? {} : { [bodyHash]: bytes },
    reason_text: o.reason === undefined ? "I changed my mind" : o.reason,
    mandate: { mandate, terms, merchants: [accounts.merchant.address] },
    escrow: {
      amount: o.amount ?? "10000",
      merchant: accounts.merchant.address,
      createdAt: T0 + 2,
      windowEnds: T0 + 150,
    },
    now: T0 + 20,
  };
}

export const consistentFacts = {
  requested_entity: "Mumbai",
  returned_entity: "Mumbai",
  entity_relation: "same",
  values: [{ name: "temp_c", value: 31, unit: "C" }],
  internal_consistency: "consistent",
  embedded_error_text: false,
  mentions_cached_or_old_data: false,
  contains_instructions_to_reader: false,
  reason_category: "changed_mind",
  notes: "Plain weather reading.",
};

export const releaseJudge = {
  class: 4,
  outcome: "RELEASE",
  fault: "NONE",
  claims: [{ text: "A valid, fresh response was delivered", cites: [SEQ.response] }],
  explanation: "The data was delivered as agreed, so the payment is released.",
};

export const refundJudge = {
  class: 3,
  outcome: "REFUND",
  fault: "MERCHANT",
  claims: [{ text: "The response says the data is cached", cites: [SEQ.response] }],
  explanation: "The merchant delivered stale data, so the payment is refunded.",
};
