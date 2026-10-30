import type { Hex } from "viem";
import type { EscrowApi } from "@recourse/chain";
import type { LogRepository } from "../db/repositories/log.js";

export interface AnchorResult {
  txHash: Hex;
  blockNumber: number;
  blockTimestamp: number;
}

/** Anchors a batch root on-chain (RecourseEscrow.anchorRoot, gateway address only). */
export interface ChainAnchor {
  anchor(root: Hex, size: number, batchIndex: number): Promise<AnchorResult>;
}

/**
 * Anchor through an EscrowApi signed by the gateway. The block timestamp comes from
 * `anchoredAt(root)`; the block number from `blockNumberOf` (real chain) or 0 (fake chain).
 */
export function escrowAnchor(
  api: Pick<EscrowApi, "anchorRoot" | "anchoredAt">,
  blockNumberOf: (txHash: Hex) => Promise<number> = async () => 0,
): ChainAnchor {
  return {
    async anchor(root, size, batchIndex) {
      const { txHash } = await api.anchorRoot(root, size, batchIndex);
      const blockTimestamp = await api.anchoredAt(root);
      if (blockTimestamp === 0) throw new Error("anchorRoot succeeded but root is not anchored");
      return { txHash, blockNumber: await blockNumberOf(txHash), blockTimestamp };
    },
  };
}

export interface AnchorReport {
  anchored: number[];
  failed: Array<{ batchIndex: number; error: string }>;
}

// One anchoring run at a time per anchor: the scheduler and /log/flush can overlap, and two
// concurrent runs would send two transactions from the gateway key with the same nonce.
const queues = new WeakMap<ChainAnchor, Promise<unknown>>();

/**
 * Anchor every un-anchored batch in order. Failures are reported and retried on the next call.
 * Calls are queued, and each re-reads the pending batches once it is its turn.
 */
export function anchorPending(repo: LogRepository, anchor: ChainAnchor): Promise<AnchorReport> {
  const run = (queues.get(anchor) ?? Promise.resolve()).then(() => anchorOnce(repo, anchor));
  queues.set(
    anchor,
    run.catch(() => undefined),
  );
  return run;
}

async function anchorOnce(repo: LogRepository, anchor: ChainAnchor): Promise<AnchorReport> {
  const report: AnchorReport = { anchored: [], failed: [] };
  for (const b of repo.unanchoredBatches()) {
    try {
      const r = await anchor.anchor(b.root, b.size, b.batchIndex);
      repo.setAnchor(b.batchIndex, { tx: r.txHash, block: r.blockNumber, ts: r.blockTimestamp });
      report.anchored.push(b.batchIndex);
    } catch (e) {
      report.failed.push({ batchIndex: b.batchIndex, error: (e as Error).message });
      break; // keep anchoring in order; retry from here next time
    }
  }
  return report;
}
