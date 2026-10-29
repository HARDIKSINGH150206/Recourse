import { and, count, desc, eq, inArray, lt } from "drizzle-orm";
import type { Hex } from "viem";
import { VerdictSchema, type Verdict, type VerificationReport } from "@recourse/shared";
import type { ApiDb } from "../client.js";
import { benchRuns, disputes, pendingReasons, reviews, verdicts } from "../schema.js";

export type DisputeStatus = (typeof disputes.$inferSelect)["status"];

export interface DisputeRecord {
  disputeId: string;
  escrowId: Hex;
  mandateId: Hex;
  requestId: Hex;
  reasonText: string | null;
  reasonHash: Hex;
  status: DisputeStatus;
  note: string | null;
  evidenceReport: VerificationReport | null;
  openedTx: string | null;
  resolvedTx: string | null;
  createdAt: number;
  updatedAt: number;
}

function toRecord(r: typeof disputes.$inferSelect): DisputeRecord {
  return {
    disputeId: r.disputeId,
    escrowId: r.escrowId as Hex,
    mandateId: r.mandateId as Hex,
    requestId: r.requestId as Hex,
    reasonText: r.reasonText,
    reasonHash: r.reasonHash as Hex,
    status: r.status,
    note: r.note,
    evidenceReport: r.evidenceReportJson
      ? (JSON.parse(r.evidenceReportJson) as VerificationReport)
      : null,
    openedTx: r.openedTx,
    resolvedTx: r.resolvedTx,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class DisputeRepository {
  constructor(private readonly db: ApiDb) {}

  /** Returns false if a dispute for this escrow already exists. */
  insert(
    d: Pick<
      DisputeRecord,
      "disputeId" | "escrowId" | "mandateId" | "requestId" | "reasonHash" | "openedTx" | "createdAt"
    >,
  ): boolean {
    return (
      this.db
        .insert(disputes)
        .values({ ...d, status: "opened", updatedAt: d.createdAt })
        .onConflictDoNothing()
        .run().changes > 0
    );
  }

  get(disputeId: string): DisputeRecord | null {
    const r = this.db.select().from(disputes).where(eq(disputes.disputeId, disputeId)).get();
    return r ? toRecord(r) : null;
  }

  byEscrow(escrowId: string): DisputeRecord | null {
    const r = this.db.select().from(disputes).where(eq(disputes.escrowId, escrowId)).get();
    return r ? toRecord(r) : null;
  }

  list(q: { status?: DisputeStatus; mandateId?: string; limit?: number }): DisputeRecord[] {
    const conds = [
      q.status ? eq(disputes.status, q.status) : undefined,
      q.mandateId ? eq(disputes.mandateId, q.mandateId) : undefined,
    ].filter((c) => c !== undefined);
    return this.db
      .select()
      .from(disputes)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(disputes.createdAt))
      .limit(Math.min(q.limit ?? 100, 500))
      .all()
      .map(toRecord);
  }

  /**
   * Store the reason only while adjudication has not started, so a late reason can never be
   * silently ignored by a verdict that was already computed. Returns false if too late.
   */
  setReasonIfOpen(disputeId: string, reasonText: string, now: number): boolean {
    return (
      this.db
        .update(disputes)
        .set({ reasonText, updatedAt: now })
        .where(and(eq(disputes.disputeId, disputeId), eq(disputes.status, "opened")))
        .run().changes > 0
    );
  }

  /** Atomic compare-and-set: moves to `to` only when the current status is one of `from`. */
  transition(
    disputeId: string,
    from: readonly DisputeStatus[],
    to: DisputeStatus,
    now: number,
    note: string | null = null,
  ): boolean {
    return (
      this.db
        .update(disputes)
        .set({ status: to, note, updatedAt: now })
        .where(and(eq(disputes.disputeId, disputeId), inArray(disputes.status, [...from])))
        .run().changes > 0
    );
  }

  setEvidenceReport(disputeId: string, report: VerificationReport, now: number): void {
    this.db
      .update(disputes)
      .set({ evidenceReportJson: JSON.stringify(report), updatedAt: now })
      .where(eq(disputes.disputeId, disputeId))
      .run();
  }

  setResolvedTx(disputeId: string, tx: string, now: number): void {
    this.db
      .update(disputes)
      .set({ resolvedTx: tx, updatedAt: now })
      .where(eq(disputes.disputeId, disputeId))
      .run();
  }

  /** Crash recovery at startup: a dispute left `adjudicating` is re-queued. */
  requeueStale(now: number): number {
    return this.db
      .update(disputes)
      .set({ status: "opened", updatedAt: now })
      .where(eq(disputes.status, "adjudicating"))
      .run().changes;
  }

  // ---- reasons posted before their dispute event was indexed

  /** Returns false when the table is full (callers refuse rather than grow without bound). */
  insertPendingReason(
    hash: string,
    text: string,
    now: number,
    maxRows: number,
    ttlSeconds: number,
  ): boolean {
    this.db
      .delete(pendingReasons)
      .where(lt(pendingReasons.createdAt, now - ttlSeconds))
      .run();
    const n = this.db.select({ n: count() }).from(pendingReasons).get()?.n ?? 0;
    if (n >= maxRows) return false;
    this.db
      .insert(pendingReasons)
      .values({ reasonHash: hash, reasonText: text, createdAt: now })
      .onConflictDoNothing()
      .run();
    return true;
  }

  /** Remove and return the pending text for this hash, if any. */
  takePendingReason(hash: string): string | null {
    return this.db.transaction((tx) => {
      const row = tx.select().from(pendingReasons).where(eq(pendingReasons.reasonHash, hash)).get();
      if (!row) return null;
      tx.delete(pendingReasons).where(eq(pendingReasons.reasonHash, hash)).run();
      return row.reasonText;
    });
  }

  // ---- verdicts and reviews (immutable)

  insertVerdict(disputeId: string, v: Verdict, now: number): void {
    this.db
      .insert(verdicts)
      .values({
        disputeId,
        verdictJson: JSON.stringify(v),
        commitment: v.commitment,
        createdAt: now,
      })
      .run();
  }

  getVerdict(disputeId: string): Verdict | null {
    const r = this.db.select().from(verdicts).where(eq(verdicts.disputeId, disputeId)).get();
    if (!r) return null;
    // re-validate on the way out: the stored JSON is a trust boundary too
    return VerdictSchema.parse(JSON.parse(r.verdictJson));
  }

  insertReview(r: typeof reviews.$inferInsert): void {
    this.db.insert(reviews).values(r).run();
  }

  getReview(disputeId: string) {
    return this.db.select().from(reviews).where(eq(reviews.disputeId, disputeId)).get() ?? null;
  }

  // ---- benchmark runs (written by the benchmark tooling, read by GET /bench/*)

  insertBenchRun(r: typeof benchRuns.$inferInsert): void {
    this.db.insert(benchRuns).values(r).run();
  }

  latestBenchRun() {
    return (
      this.db.select().from(benchRuns).orderBy(desc(benchRuns.createdAt)).limit(1).get() ?? null
    );
  }

  getBenchRun(runId: string) {
    return this.db.select().from(benchRuns).where(eq(benchRuns.runId, runId)).get() ?? null;
  }
}
