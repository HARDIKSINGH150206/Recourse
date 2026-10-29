import type { Address, Hex } from "viem";
import {
  RecourseError,
  ZERO32,
  buildBatchTree,
  batchProof,
  discloseField,
  fieldLeafHash,
  type DisclosedField,
  type EvidenceBundle,
  type FieldLeaf,
  type LogEntry,
  type Receipt,
} from "@recourse/shared";
import type { BatchRow, LogRepository, StoredField } from "../db/repositories/log.js";
import { treeHeadOf } from "../log/batcher.js";

function toLeaves(stored: readonly StoredField[]): FieldLeaf[] {
  return stored.map((f) => ({
    name: f.name,
    value: f.value,
    salt: f.salt,
    leaf: fieldLeafHash(f.salt, f.name, f.value),
  }));
}

/** Disclosure of the named fields of one entry (value, salt, proof against payload_commitment). */
export function discloseFields(
  repo: LogRepository,
  seq: number,
  names?: readonly string[],
): DisclosedField[] {
  const leaves = toLeaves(repo.fieldsFor(seq));
  return leaves
    .filter((l) => !names || names.includes(l.name))
    .map((l) => discloseField(leaves, l.name));
}

/** Caches one Merkle tree per batch while building a bundle. */
class BatchProver {
  private readonly trees = new Map<number, ReturnType<typeof buildBatchTree>>();
  constructor(private readonly repo: LogRepository) {}

  prove(batch: BatchRow, entry: LogEntry): Hex[] {
    let tree = this.trees.get(batch.batchIndex);
    if (!tree) {
      const all = this.repo.entriesInRange(batch.firstSeq, batch.lastSeq);
      tree = buildBatchTree(all.map((e) => ({ seq: e.seq, entry_hash: e.entry_hash as Hex })));
      this.trees.set(batch.batchIndex, tree);
    }
    return batchProof(tree, { seq: entry.seq, entry_hash: entry.entry_hash as Hex });
  }
}

export interface BundleContext {
  chainId: number;
  escrow: Address;
  gateway: Address;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * Evidence bundle for one request (docs/03 section 8). Requires every entry of the request to be
 * batched; the API flushes the log before asking (docs/04 section 3.3).
 */
export function buildEvidenceBundle(
  repo: LogRepository,
  requestId: Hex,
  ctx: BundleContext,
): EvidenceBundle {
  const entries = repo.listEntries({ requestId, limit: 1000 });
  if (entries.length === 0) throw new RecourseError("not_found", "no entries for this request id");

  const prover = new BatchProver(repo);
  const usedBatches = new Map<number, BatchRow>();
  let merchant: string | undefined;
  let escrowId: Hex = ZERO32;
  let receipt: Receipt | null = null;

  const bundleEntries = entries.map((entry) => {
    const batch = repo.batchForSeq(entry.seq);
    if (!batch) {
      throw new RecourseError("conflict", "entries are not batched yet; flush the log first", {
        seq: entry.seq,
      });
    }
    usedBatches.set(batch.batchIndex, batch);
    const stored = repo.fieldsFor(entry.seq);
    const byName = new Map(stored.map((f) => [f.name, f.value]));

    if (entry.type === "payment_proof") {
      escrowId = (str(byName.get("escrow_id")) as Hex | undefined) ?? escrowId;
      merchant ??= str((byName.get("chain_state") as { merchant?: unknown } | undefined)?.merchant);
    } else if (entry.type === "payment_required") {
      merchant ??= str(
        (byName.get("requirements") as { merchant?: unknown } | null | undefined)?.merchant,
      );
    } else if (entry.type === "receipt") {
      const m = str(byName.get("merchant"));
      merchant ??= m;
      receipt = {
        requestId: byName.get("request_id") as Hex,
        responseHash: byName.get("response_hash") as Hex,
        timestamp: byName.get("timestamp") as number,
        merchant: m as string,
        signature: byName.get("signature") as Hex,
      };
    }

    return {
      entry,
      disclosed: discloseFields(repo, entry.seq),
      batch_proof: { batch_index: batch.batchIndex, proof: prover.prove(batch, entry) },
    };
  });

  if (!merchant)
    throw new RecourseError("conflict", "cannot determine merchant from the logged entries");
  const mandateId = entries.find((e) => e.mandate_id)?.mandate_id;
  if (!mandateId) throw new RecourseError("conflict", "entries carry no mandate id");

  const batches = [...usedBatches.values()].sort((a, b) => a.batchIndex - b.batchIndex);
  return {
    version: 1,
    chain: {
      chain_id: ctx.chainId,
      escrow: ctx.escrow.toLowerCase(),
      gateway: ctx.gateway.toLowerCase(),
      merchant: merchant.toLowerCase(),
    },
    request_id: requestId,
    mandate_id: mandateId as Hex,
    escrow_id: escrowId,
    entries: bundleEntries,
    tree_heads: batches.map(treeHeadOf),
    anchors: batches
      .filter((b) => b.anchorTx !== null)
      .map((b) => ({
        root: b.root,
        tx_hash: b.anchorTx as Hex,
        block_number: b.anchorBlock ?? 0,
        block_timestamp: b.anchorTs ?? 0,
      })),
    receipt,
  };
}
