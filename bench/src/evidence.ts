import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  ZERO32,
  batchProof,
  buildBatchTree,
  buildFieldCommitments,
  canonicalHash,
  discloseField,
  entryHash,
  keccakBytes,
  mandateId,
  merchantsHash,
  signReceipt,
  signTreeHead,
  verifyBundle,
  type AdjudicationInput,
  type BundleEntry,
  type EvidenceBundle,
  type LogEntry,
  type MandateJson,
} from "@recourse/shared";
import { T0, responseTs, type BenchCase } from "./types.js";

/**
 * Throwaway keys derived from a label, so no literal key is stored anywhere. Testnet only; they
 * sign synthetic benchmark evidence and nothing else.
 */
const key = (role: string) => privateKeyToAccount(keccakBytes(`recourse-bench-key:${role}`));
const accounts = {
  owner: key("owner"),
  agent: key("agent"),
  merchant: key("merchant"),
  gateway: key("gateway"),
};

export const CHAIN_ID = 31337;
const ESCROW: Address = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const TOKEN: Address = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
const PRICE = "10000";

export interface BuiltCase {
  input: AdjudicationInput;
  bundle: EvidenceBundle;
}

const salt = (seq: number) => (name: string) => keccakBytes(`bench-salt:${seq}:${name}`);

/**
 * Builds the evidence for one case with the same primitives the gateway uses (real field
 * commitments, hashes, Merkle tree, EIP-712 signatures), then runs the real `verifyBundle`, so
 * integrity cases are tested against the real verifier. Tampered cases flip a value after the
 * bundle is signed.
 */
export async function buildInput(c: BenchCase): Promise<BuiltCase> {
  const merchant = accounts.merchant.address.toLowerCase();
  const mandate: MandateJson = {
    owner: accounts.owner.address.toLowerCase(),
    agent: accounts.agent.address.toLowerCase(),
    token: TOKEN,
    maxPricePerCall: "50000",
    totalBudget: "2000000",
    expiresAt: T0 + 86_400,
    nonce: "1",
    merchantsHash: merchantsHash([accounts.merchant.address]),
    termsHash: canonicalHash(c.mandate_terms),
  };
  const mid = mandateId(CHAIN_ID, ESCROW, mandate);
  const requestId = keccakBytes(`bench:request:${c.id}`);
  const escrowId = keccakBytes(`bench:escrow:${c.id}`);

  const body = new TextEncoder().encode(c.response.body);
  const bodyHash = keccakBytes(body);
  const respTs = responseTs(c.response.latency_ms);

  const specs: { type: LogEntry["type"]; ts: number; fields: Record<string, unknown> }[] = [
    {
      type: "request",
      ts: T0,
      fields: {
        method: "GET",
        path: "/api/weather",
        query: new URLSearchParams({ city: c.request.city }).toString(),
        headers_hash: ZERO32,
        body_hash: ZERO32,
        merchant_id: "weather",
      },
    },
    {
      type: "payment_required",
      ts: T0 + 1,
      fields: {
        status: 402,
        requirements: {
          scheme: "recourse-escrow",
          chainId: CHAIN_ID,
          escrow: ESCROW,
          token: TOKEN,
          merchant,
          amount: PRICE,
          requestId,
          expiresAt: T0 + 60,
        },
      },
    },
    {
      type: "payment_proof",
      ts: T0 + 2,
      fields: {
        escrow_id: escrowId,
        tx_hash: keccakBytes(`bench:tx:${c.id}`),
        chain_state: {
          state: "Held",
          amount: PRICE,
          merchant,
          windowEnds: T0 + 32,
          block: 12,
        },
      },
    },
    {
      type: "response",
      ts: respTs,
      fields: {
        status: c.response.status,
        headers_hash: ZERO32,
        body_hash: bodyHash,
        body_len: body.length,
        content_type: "application/json",
        latency_ms: c.response.latency_ms,
      },
    },
  ];
  const withReceipt = c.receipt_mode === "valid";
  if (withReceipt) {
    specs.push({
      type: "receipt",
      ts: respTs + 1,
      fields: {
        request_id: requestId,
        response_hash: bodyHash,
        timestamp: respTs + 1,
        merchant,
        signature: "0x",
      },
    });
  }

  const committed = specs.map((s, i) => buildFieldCommitments(s.fields, salt(i + 1)));
  const entries: LogEntry[] = [];
  let prev: Hex = ZERO32;
  specs.forEach((s, i) => {
    const base = {
      seq: i + 1,
      ts: s.ts,
      type: s.type,
      request_id: requestId,
      mandate_id: mid,
      agent_id: accounts.agent.address.toLowerCase(),
      payload_commitment: committed[i]!.root,
      prev_hash: prev,
    };
    const e = { ...base, entry_hash: entryHash(base) } as LogEntry;
    entries.push(e);
    prev = e.entry_hash as Hex;
  });

  const tree = buildBatchTree(
    entries.map((e) => ({ seq: e.seq, entry_hash: e.entry_hash as Hex })),
  );
  const lastTs = entries[entries.length - 1]!.ts;
  const head = {
    root: tree.root as Hex,
    size: entries.length,
    batch_index: 0,
    timestamp: lastTs + 5,
  };
  const signature = await signTreeHead(accounts.gateway, CHAIN_ID, head);

  const receiptBase = {
    requestId,
    responseHash: bodyHash,
    timestamp: respTs + 1,
    merchant,
  };
  const receipt = withReceipt
    ? { ...receiptBase, signature: await signReceipt(accounts.merchant, CHAIN_ID, receiptBase) }
    : null;

  const bundleEntries: BundleEntry[] = entries.map((entry, i) => ({
    entry,
    disclosed: Object.keys(specs[i]!.fields)
      .filter((n) => n !== "signature")
      .map((n) => discloseField(committed[i]!.leaves, n)),
    batch_proof: {
      batch_index: 0,
      proof: batchProof(tree, { seq: entry.seq, entry_hash: entry.entry_hash as Hex }),
    },
  }));

  const bundle: EvidenceBundle = {
    version: 1,
    chain: {
      chain_id: CHAIN_ID,
      escrow: ESCROW,
      gateway: accounts.gateway.address.toLowerCase(),
      merchant,
    },
    request_id: requestId,
    mandate_id: mid,
    escrow_id: escrowId,
    entries: bundleEntries,
    tree_heads: [{ ...head, signature }],
    anchors: [
      {
        root: head.root,
        tx_hash: keccakBytes(`bench:anchor:${c.id}`),
        block_number: 20,
        block_timestamp: head.timestamp + 2,
      },
    ],
    receipt,
  };

  if (c.tamper) {
    // One changed value after signing: the response status. The disclosure no longer matches the
    // committed payload, so the real verifier must reject the bundle.
    const status = bundle.entries
      .find((e) => e.entry.type === "response")!
      .disclosed.find((d) => d.name === "status")!;
    status.value = (status.value as number) === 200 ? 201 : 200;
  }

  const report = await verifyBundle(bundle);
  const input: AdjudicationInput = {
    dispute_id: `bench-${c.id}`,
    escrow_id: escrowId,
    request_id: requestId,
    bundle,
    evidence_report: report,
    blobs: { [bodyHash]: body },
    reason_text: c.owner_reason,
    mandate: { mandate, terms: c.mandate_terms, merchants: [accounts.merchant.address] },
    escrow: {
      amount: PRICE,
      merchant: accounts.merchant.address,
      createdAt: T0 + 2,
      windowEnds: T0 + 32,
    },
    now: respTs + 20,
  };
  return { input, bundle };
}
