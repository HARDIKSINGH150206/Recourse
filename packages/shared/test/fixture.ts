import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes, type Address, type Hex } from "viem";
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
  type BundleEntry,
  type EvidenceBundle,
  type LogEntry,
  type MandateJson,
  type Terms,
} from "../src/index.js";

// Anvil's well-known development keys. Local and test use only.
export const KEYS = {
  owner: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  agent: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  merchant: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  gateway: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  arbiter: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
} as const;

export const accounts = {
  owner: privateKeyToAccount(KEYS.owner),
  agent: privateKeyToAccount(KEYS.agent),
  merchant: privateKeyToAccount(KEYS.merchant),
  gateway: privateKeyToAccount(KEYS.gateway),
  arbiter: privateKeyToAccount(KEYS.arbiter),
};

export const CHAIN_ID = 31337;
export const ESCROW: Address = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
export const TOKEN: Address = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
export const T0 = 1_767_200_000;

export const terms: Terms = {
  version: 1,
  category: "weather_data_api",
  defaults: {
    freshness_seconds: 3600,
    schema_required: true,
    substitutions: "not_allowed",
    sla_ms: 5000,
  },
  discretion: ["vendor_choice"],
};

export const mandate: MandateJson = {
  owner: accounts.owner.address.toLowerCase(),
  agent: accounts.agent.address.toLowerCase(),
  token: TOKEN,
  maxPricePerCall: "50000",
  totalBudget: "2000000",
  expiresAt: T0 + 86_400,
  nonce: "1",
  merchantsHash: merchantsHash([accounts.merchant.address]),
  termsHash: canonicalHash(terms),
};

export const MANDATE_ID = mandateId(CHAIN_ID, ESCROW, mandate);
export const REQUEST_ID: Hex = keccakBytes("request-0001");
export const ESCROW_ID: Hex = keccakBytes("escrow-0001");
export const BODY = new TextEncoder().encode(
  JSON.stringify({ city: "Mumbai", temp_c: 31, observed_at: T0 }),
);
export const BODY_HASH: Hex = keccak256(BODY);

/** Deterministic salt so vectors are reproducible. */
const salt =
  (seq: number) =>
  (name: string): Hex =>
    keccakBytes(`salt:${seq}:${name}`);

interface Spec {
  type: LogEntry["type"];
  fields: Record<string, unknown>;
}

const makeSpecs = (escrowIdForProof: Hex): Spec[] => [
  {
    type: "request",
    fields: {
      method: "GET",
      path: "/api/weather",
      query: "city=Mumbai",
      headers_hash: ZERO32,
      body_hash: ZERO32,
      merchant_id: "weather",
    },
  },
  {
    type: "payment_required",
    fields: {
      status: 402,
      requirements: {
        scheme: "recourse-escrow",
        chainId: CHAIN_ID,
        escrow: ESCROW,
        token: TOKEN,
        merchant: accounts.merchant.address.toLowerCase(),
        amount: "10000",
        requestId: REQUEST_ID,
        expiresAt: T0 + 60,
      },
    },
  },
  {
    type: "payment_proof",
    fields: {
      escrow_id: escrowIdForProof,
      tx_hash: keccakBytes("tx-1"),
      chain_state: {
        state: "Held",
        amount: "10000",
        merchant: accounts.merchant.address.toLowerCase(),
        windowEnds: T0 + 150,
        block: 12,
      },
    },
  },
  {
    type: "response",
    fields: {
      status: 200,
      headers_hash: ZERO32,
      body_hash: BODY_HASH,
      body_len: BODY.length,
      content_type: "application/json",
      latency_ms: 120,
    },
  },
  {
    type: "receipt",
    fields: {
      request_id: REQUEST_ID,
      response_hash: BODY_HASH,
      timestamp: T0 + 3,
      merchant: accounts.merchant.address.toLowerCase(),
      signature: "0x",
    },
  },
];

export interface Fixture {
  bundle: EvidenceBundle;
  batch: LogEntry[];
  blob: Uint8Array;
}

/** Build a deterministic 5-entry batch, signed tree head, merchant receipt and bundle. */
export interface FixtureOptions {
  /** Escrow id embedded in the payment proof and the bundle (defaults to a fixed placeholder). */
  escrowId?: Hex;
}

export async function buildFixture(o: FixtureOptions = {}): Promise<Fixture> {
  const escrowId = o.escrowId ?? ESCROW_ID;
  const specs = makeSpecs(escrowId);
  const entries: LogEntry[] = [];
  const committed = specs.map((s, i) => buildFieldCommitments(s.fields, salt(i + 1)));
  let prev: Hex = ZERO32;
  specs.forEach((s, i) => {
    const base = {
      seq: i + 1,
      ts: T0 + i,
      type: s.type,
      request_id: REQUEST_ID,
      mandate_id: MANDATE_ID,
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
  const head = { root: tree.root as Hex, size: entries.length, batch_index: 0, timestamp: T0 + 10 };
  const signature = await signTreeHead(accounts.gateway, CHAIN_ID, head);

  const receiptBase = {
    requestId: REQUEST_ID,
    responseHash: BODY_HASH,
    timestamp: T0 + 3,
    merchant: accounts.merchant.address.toLowerCase(),
  };
  const receipt = {
    ...receiptBase,
    signature: await signReceipt(accounts.merchant, CHAIN_ID, receiptBase),
  };

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
      merchant: accounts.merchant.address.toLowerCase(),
    },
    request_id: REQUEST_ID,
    mandate_id: MANDATE_ID,
    escrow_id: escrowId,
    entries: bundleEntries,
    tree_heads: [{ ...head, signature }],
    anchors: [
      {
        root: head.root,
        tx_hash: keccakBytes("anchor-tx"),
        block_number: 20,
        block_timestamp: T0 + 12,
      },
    ],
    receipt,
  };
  return { bundle, batch: entries, blob: BODY };
}

export { toBytes };
