import { keccak256, type Address, type Hex, type PublicClient } from "viem";
import { entryHash } from "./hash.js";
import { verifyDisclosure } from "./commit.js";
import { recoverReceiptSigner, recoverTreeHeadSigner } from "./eip712.js";
import { verifyBatchProof } from "./merkle.js";
import type { EvidenceBundle, LogEntry, VerificationReport } from "./types.js";

export interface VerifyOptions {
  /** RPC client; when present `anchor_ok` is checked against `anchoredAt(root)`. */
  rpc?: PublicClient;
  /** Raw stored bodies keyed by body hash; used to bind the receipt to the response. */
  blobs?: Record<string, Uint8Array>;
  /** Full batch export (all entries of a batch, in order); enables `chain_ok`. */
  batchEntries?: readonly LogEntry[];
  /** Unix seconds when the dispute was opened; enables the payment-before-dispute check. */
  disputeTs?: number;
}

const ANCHORED_AT_ABI = [
  {
    type: "function",
    name: "anchoredAt",
    stateMutability: "view",
    inputs: [{ name: "root", type: "bytes32" }],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

/** Steps 1 to 4 and 6 must pass for the evidence to be usable (docs/03 section 9). */
export function isEvidenceValid(r: VerificationReport): boolean {
  return (
    r.entry_hash_ok &&
    r.fields_ok &&
    r.membership_ok &&
    r.tree_head_signature_ok &&
    r.receipt_ok !== false
  );
}

export async function verifyBundle(
  bundle: EvidenceBundle,
  opts: VerifyOptions = {},
): Promise<VerificationReport> {
  const errors: string[] = [];
  const { chain_id: chainId, gateway, merchant, escrow } = bundle.chain;

  // 1. entry hashes
  let entry_hash_ok = true;
  for (const { entry } of bundle.entries) {
    if (entryHash(entry) !== entry.entry_hash) {
      entry_hash_ok = false;
      errors.push(`entry_hash mismatch at seq ${entry.seq}`);
    }
  }

  // 2. disclosed fields
  let fields_ok = true;
  for (const { entry, disclosed } of bundle.entries) {
    for (const d of disclosed) {
      if (!verifyDisclosure(entry.payload_commitment as Hex, d)) {
        fields_ok = false;
        errors.push(`field proof failed: seq ${entry.seq} field ${d.name}`);
      }
    }
  }

  // 3. batch membership
  let membership_ok = true;
  for (const { entry, batch_proof } of bundle.entries) {
    const head = bundle.tree_heads.find((h) => h.batch_index === batch_proof.batch_index);
    if (!head) {
      membership_ok = false;
      errors.push(`no tree head for batch ${batch_proof.batch_index} (seq ${entry.seq})`);
      continue;
    }
    const ok = verifyBatchProof(
      head.root as Hex,
      { seq: entry.seq, entry_hash: entry.entry_hash as Hex },
      batch_proof.proof as Hex[],
    );
    if (!ok) {
      membership_ok = false;
      errors.push(`batch membership failed at seq ${entry.seq}`);
    }
  }

  // 4. tree head signatures
  let tree_head_signature_ok = true;
  for (const head of bundle.tree_heads) {
    try {
      const signer = await recoverTreeHeadSigner(chainId, head);
      if (signer.toLowerCase() !== gateway.toLowerCase()) {
        tree_head_signature_ok = false;
        errors.push(`tree head ${head.batch_index} not signed by gateway`);
      }
    } catch {
      tree_head_signature_ok = false;
      errors.push(`tree head ${head.batch_index} signature unrecoverable`);
    }
  }

  // 5. anchors (optional)
  let anchor_ok: boolean | null = null;
  if (opts.rpc) {
    anchor_ok = true;
    for (const head of bundle.tree_heads) {
      const at = await opts.rpc.readContract({
        address: escrow as Address,
        abi: ANCHORED_AT_ABI,
        functionName: "anchoredAt",
        args: [head.root as Hex],
      });
      const claimed = bundle.anchors.find((a) => a.root === head.root);
      if (at === 0n || !claimed || BigInt(claimed.block_timestamp) !== at) {
        anchor_ok = false;
        errors.push(`root ${head.root} not anchored as claimed`);
      }
    }
  }

  // 6. receipt (optional)
  let receipt_ok: boolean | null = null;
  if (bundle.receipt) {
    const r = bundle.receipt;
    let bound: boolean | null = null;
    const blob = opts.blobs?.[r.responseHash];
    if (blob) bound = keccak256(blob) === r.responseHash;
    else {
      const bodyHashes = bundle.entries
        .filter((e) => e.entry.type === "response")
        .flatMap((e) => e.disclosed.filter((d) => d.name === "body_hash").map((d) => d.value));
      if (bodyHashes.length > 0) bound = bodyHashes.includes(r.responseHash);
    }
    try {
      const signer = await recoverReceiptSigner(chainId, r);
      const sigOk = signer.toLowerCase() === merchant.toLowerCase();
      if (!sigOk) errors.push("receipt not signed by merchant");
      if (bound === false) errors.push("receipt responseHash does not match response body");
      if (r.requestId !== bundle.request_id) errors.push("receipt requestId mismatch");
      receipt_ok = sigOk && bound !== false && r.requestId === bundle.request_id;
    } catch {
      receipt_ok = false;
      errors.push("receipt signature unrecoverable");
    }
  }

  // 7. continuity across a full batch export (optional)
  let chain_ok: boolean | null = null;
  if (opts.batchEntries && opts.batchEntries.length > 0) {
    chain_ok = true;
    const be = opts.batchEntries;
    for (let i = 0; i < be.length; i++) {
      const e = be[i]!;
      if (entryHash(e) !== e.entry_hash) {
        chain_ok = false;
        errors.push(`batch export: entry_hash mismatch at seq ${e.seq}`);
      }
      if (i > 0) {
        const p = be[i - 1]!;
        if (e.seq !== p.seq + 1) {
          chain_ok = false;
          errors.push(`batch export: gap between seq ${p.seq} and ${e.seq}`);
        }
        if (e.prev_hash !== p.entry_hash) {
          chain_ok = false;
          errors.push(`batch export: prev_hash broken at seq ${e.seq}`);
        }
      }
    }
  }

  // 8. time ordering
  let time_ok = true;
  const maxTs = Math.max(0, ...bundle.entries.map((e) => e.entry.ts));
  for (const a of bundle.anchors) {
    if (a.block_timestamp < maxTs && bundle.entries.length > 0) {
      // an anchor may legitimately cover an earlier batch, so only flag anchors of batches
      // that contain a later entry
      const head = bundle.tree_heads.find((h) => h.root === a.root);
      const inBatch = bundle.entries.filter((e) => e.batch_proof.batch_index === head?.batch_index);
      if (inBatch.some((e) => e.entry.ts > a.block_timestamp)) {
        time_ok = false;
        errors.push(`anchor ${a.root} is earlier than an entry it covers`);
      }
    }
  }
  if (opts.disputeTs !== undefined) {
    const pay = bundle.entries.find((e) => e.entry.type === "payment_proof");
    if (pay && opts.disputeTs < pay.entry.ts) {
      time_ok = false;
      errors.push("dispute precedes payment");
    }
  }

  return {
    entry_hash_ok,
    fields_ok,
    membership_ok,
    tree_head_signature_ok,
    anchor_ok,
    receipt_ok,
    chain_ok,
    time_ok,
    errors,
  };
}
