import type { Hex } from "viem";
import {
  batchProof,
  buildBatchTree,
  signTreeHead,
  type Clock,
  type TreeHead,
} from "@recourse/shared";
import type { BatchRow, LogRepository } from "../db/repositories/log.js";

export interface TreeSigner {
  signTypedData: (args: never) => Promise<Hex>;
}

export interface BatcherOptions {
  chainId: number;
  maxEntries: number;
  maxSeconds: number;
}

export function treeHeadOf(b: BatchRow): TreeHead {
  return {
    root: b.root,
    size: b.size,
    batch_index: b.batchIndex,
    timestamp: b.ts,
    signature: b.signature,
  };
}

/**
 * Closes batches: Merkle tree over (seq, entry_hash), EIP-712 signed tree head (docs/03 section 6).
 * Closing is serialised so two timers or a timer and /log/flush never build overlapping batches.
 */
export class Batcher {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repo: LogRepository,
    private readonly signer: TreeSigner,
    private readonly clock: Clock,
    private readonly opts: BatcherOptions,
  ) {}

  private lastBatchedSeq(): number {
    return this.repo.lastBatch()?.lastSeq ?? 0;
  }

  /** True when a size or age trigger has fired for the pending entries. */
  shouldClose(): boolean {
    const pending = this.repo.unbatchedEntries(this.lastBatchedSeq(), this.opts.maxEntries);
    if (pending.length === 0) return false;
    if (pending.length >= this.opts.maxEntries) return true;
    return this.clock.now() - pending[0]!.ts >= this.opts.maxSeconds;
  }

  /** Close one batch of at most `limit` pending entries; null when nothing is pending. */
  closeBatch(limit = this.opts.maxEntries): Promise<BatchRow | null> {
    const run = this.chain.then(() => this.closeOne(limit));
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Close batches until nothing is pending. */
  async flush(): Promise<BatchRow[]> {
    const out: BatchRow[] = [];
    for (;;) {
      const b = await this.closeBatch();
      if (!b) return out;
      out.push(b);
    }
  }

  private async closeOne(limit: number): Promise<BatchRow | null> {
    const after = this.lastBatchedSeq();
    const pending = this.repo.unbatchedEntries(after, limit);
    if (pending.length === 0) return null;

    const first = pending[0]!;
    const last = pending[pending.length - 1]!;
    const prevBatch = this.repo.lastBatch();
    const tree = buildBatchTree(
      pending.map((e) => ({ seq: e.seq, entry_hash: e.entry_hash as Hex })),
    );
    const head = {
      root: tree.root as Hex,
      // cumulative entries: seq is gapless from 1, so this equals the last seq
      size: last.seq,
      batch_index: (prevBatch?.batchIndex ?? -1) + 1,
      timestamp: this.clock.now(),
    };
    const signature = await signTreeHead(this.signer, this.opts.chainId, head);

    const row = {
      batchIndex: head.batch_index,
      firstSeq: first.seq,
      lastSeq: last.seq,
      root: head.root,
      size: head.size,
      ts: head.timestamp,
      // uint256 leaf values are bigint; stored as decimal strings (the ABI coder accepts both on load)
      treeDump: JSON.stringify(tree.dump(), (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      signature,
    };
    this.repo.transaction(() => {
      // Serialised, but verify nothing else batched while we were signing.
      if (this.lastBatchedSeq() !== after) throw new Error("batch range changed while closing");
      this.repo.insertBatch(row);
    });
    return { ...row, anchorTx: null, anchorBlock: null, anchorTs: null };
  }

  /** Merkle proof for one entry of its batch. */
  proofFor(seq: number): { batch: BatchRow; proof: Hex[] } | null {
    const batch = this.repo.batchForSeq(seq);
    const entry = this.repo.getEntry(seq);
    if (!batch || !entry) return null;
    const entries = this.repo.entriesInRange(batch.firstSeq, batch.lastSeq);
    const tree = buildBatchTree(
      entries.map((e) => ({ seq: e.seq, entry_hash: e.entry_hash as Hex })),
    );
    return { batch, proof: batchProof(tree, { seq, entry_hash: entry.entry_hash as Hex }) };
  }
}
