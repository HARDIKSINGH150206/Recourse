import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import type { DisputedEvent } from "@recourse/chain";
import {
  EvidenceBundleSchema,
  RecourseError,
  canonicalHash,
  computeVerdictCommitment,
  isEvidenceValid,
  verifyBundle,
  VerdictSchema,
  type Adjudicator,
  type Clock,
  type EvidenceBundle,
  type Verdict,
  type VerificationReport,
} from "@recourse/shared";
import type { DisputeRecord, DisputeRepository } from "../db/repositories/disputes.js";
import type { MandateRepository } from "../db/repositories/mandates.js";
import type { ArbiterChain, EvidencePort } from "../ports.js";

export const MAX_REASON_CHARS = 2000;
const MAX_BLOBS = 20;

export interface DisputeServiceDeps {
  disputes: DisputeRepository;
  mandates: MandateRepository;
  chain: ArbiterChain;
  evidence: EvidencePort;
  adjudicator: Adjudicator;
  clock: Clock;
  logger: Logger;
  /** Seconds to wait for the owner's reason text before adjudicating without it. */
  reasonWaitSeconds: number;
  adjudicationTimeoutSeconds: number;
  /** Injected for tests; defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
  newId?: () => string;
}

type Outcome = "REFUND" | "RELEASE";
type Fault = "NONE" | "AGENT" | "MERCHANT";

/** REFUND blames a party; RELEASE blames nobody (docs/08 section 2). */
function pairingOk(outcome: Outcome, fault: Fault): boolean {
  return outcome === "REFUND" ? fault !== "NONE" : fault === "NONE";
}

/**
 * Dispute lifecycle: index the on-chain event, collect the owner's reason, gather and verify
 * evidence, adjudicate, and (only when everything checks out) post the verdict on-chain.
 * The status column is moved only by compare-and-set, so overlapping triggers cannot double-run.
 */
export class DisputeService {
  private readonly schedule: (fn: () => void, ms: number) => void;
  private readonly newId: () => string;

  constructor(private readonly d: DisputeServiceDeps) {
    this.schedule =
      d.schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        t.unref?.();
      });
    this.newId = d.newId ?? randomUUID;
  }

  // ---- indexing

  /** Handle an on-chain Disputed event (watcher or lookup). Idempotent per escrow. */
  async onDisputed(ev: DisputedEvent, txHash: string | null = null): Promise<DisputeRecord> {
    const existing = this.d.disputes.byEscrow(ev.escrowId);
    if (existing) return existing;

    const escrow = await this.d.chain.getEscrow(ev.escrowId);
    if (escrow.state === "None") throw new RecourseError("not_found", "escrow does not exist");
    const disputeId = this.newId();
    this.d.disputes.insert({
      disputeId,
      escrowId: ev.escrowId,
      mandateId: escrow.mandateId,
      requestId: escrow.requestId,
      reasonHash: ev.reasonHash,
      openedTx: txHash,
      createdAt: this.d.clock.now(),
    });
    const record = this.d.disputes.byEscrow(ev.escrowId)!;
    this.d.logger.info({ dispute_id: record.disputeId, escrow_id: ev.escrowId }, "dispute opened");
    // Give the owner a moment to post the reason text; POST /disputes triggers it sooner.
    this.schedule(() => void this.safeProcess(record.disputeId), this.d.reasonWaitSeconds * 1000);
    return record;
  }

  /**
   * Attach the owner's reason text. It must hash to the reasonHash in the on-chain event, so the
   * text cannot be swapped after the fact. Starts adjudication immediately.
   */
  async submitReason(escrowId: Hex, reasonText: string): Promise<DisputeRecord> {
    if (reasonText.length > MAX_REASON_CHARS) {
      throw new RecourseError(
        "bad_request",
        `reason_text is limited to ${MAX_REASON_CHARS} characters`,
      );
    }
    let record = this.d.disputes.byEscrow(escrowId);
    if (!record) {
      const ev = await this.d.chain.findDisputed(escrowId);
      if (!ev) throw new RecourseError("not_found", "no Disputed event for this escrow");
      record = await this.onDisputed(ev);
    }
    if (keccak256(toBytes(reasonText)) !== record.reasonHash) {
      throw new RecourseError("bad_request", "reason_text does not match the on-chain reasonHash");
    }
    if (record.reasonText === reasonText) return record; // idempotent resubmission
    if (!this.d.disputes.setReasonIfOpen(record.disputeId, reasonText, this.d.clock.now())) {
      throw new RecourseError(
        "conflict",
        "adjudication already started; the reason can no longer be added",
      );
    }
    this.schedule(() => void this.safeProcess(record!.disputeId), 0);
    return this.d.disputes.get(record.disputeId)!;
  }

  /** Re-queue disputes left mid-flight by a crash and start them again. Call once at startup. */
  recover(): number {
    this.d.disputes.requeueStale(this.d.clock.now());
    const open = this.d.disputes.list({ status: "opened" });
    for (const r of open) this.schedule(() => void this.safeProcess(r.disputeId), 0);
    return open.length;
  }

  // ---- adjudication

  private async safeProcess(disputeId: string): Promise<void> {
    try {
      await this.process(disputeId);
    } catch (e) {
      this.d.logger.error({ err: e, dispute_id: disputeId }, "adjudication crashed");
    }
  }

  private fail(r: DisputeRecord, to: "failed" | "needs_human_review", note: string): DisputeRecord {
    this.d.disputes.transition(r.disputeId, ["adjudicating"], to, this.d.clock.now(), note);
    this.d.logger.warn(
      { dispute_id: r.disputeId, status: to, note },
      "dispute not resolved automatically",
    );
    return this.d.disputes.get(r.disputeId)!;
  }

  /** Run the pipeline for one dispute. Safe to call repeatedly: only one run proceeds at a time. */
  async process(disputeId: string): Promise<DisputeRecord> {
    const now = () => this.d.clock.now();
    const claimed = this.d.disputes.transition(
      disputeId,
      ["opened", "evidence_ready", "failed"],
      "adjudicating",
      now(),
    );
    const record = this.d.disputes.get(disputeId);
    if (!record) throw new RecourseError("not_found", "no such dispute");
    if (!claimed) return record; // resolved, in review, or already running elsewhere

    try {
      // 1. the chain is the source of truth for whether this is still open
      const escrow = await this.d.chain.getEscrow(record.escrowId);
      if (escrow.state === "Released" || escrow.state === "Refunded") {
        this.d.disputes.transition(
          disputeId,
          ["adjudicating"],
          "resolved",
          now(),
          `already settled on-chain (${escrow.state})`,
        );
        return this.d.disputes.get(disputeId)!;
      }
      if (escrow.state !== "Disputed")
        return this.fail(record, "failed", `escrow is ${escrow.state}, expected Disputed`);

      // 2. evidence: flush and anchor, fetch, parse, verify
      await this.d.evidence.flush();
      const parsed = EvidenceBundleSchema.safeParse(
        await this.d.evidence.getBundle(record.requestId),
      );
      if (!parsed.success)
        return this.fail(record, "needs_human_review", "evidence bundle failed schema validation");
      const bundle = parsed.data;
      if (bundle.request_id !== record.requestId || bundle.escrow_id !== record.escrowId) {
        return this.fail(
          record,
          "needs_human_review",
          "evidence bundle is for a different request or escrow",
        );
      }
      const blobs = await this.collectBlobs(bundle);
      const batchEntries =
        bundle.tree_heads.length === 1
          ? ((await this.d.evidence.getBatchEntries(bundle.tree_heads[0]!.batch_index)) ??
            undefined)
          : undefined;
      const report = await verifyBundle(bundle, {
        rpc: this.d.chain.rpc,
        blobs,
        batchEntries,
        disputeTs: now(),
      });
      this.d.disputes.setEvidenceReport(disputeId, report, now());
      this.d.disputes.transition(disputeId, ["adjudicating"], "evidence_ready", now());
      this.d.disputes.transition(disputeId, ["evidence_ready"], "adjudicating", now());

      // 3. the mandate terms the owner signed must be the ones we judge against
      const stored = this.d.mandates.get(record.mandateId);
      if (!stored)
        return this.fail(record, "needs_human_review", "mandate terms are not known to this API");
      const onchain = await this.d.chain.getMandate(record.mandateId).catch(() => null);
      if (!onchain || onchain.termsHash !== canonicalHash(stored.terms)) {
        return this.fail(
          record,
          "needs_human_review",
          "stored terms do not match the on-chain termsHash",
        );
      }

      // 4. verdict: resume from a stored one (e.g. after a failed resolve tx), else adjudicate
      let verdict = this.d.disputes.getVerdict(disputeId);
      if (!verdict) {
        verdict = await this.runAdjudicator(record, bundle, report, blobs, stored, escrow);
        this.d.disputes.insertVerdict(disputeId, verdict, now());
      }

      // 5. decide whether we may act on it
      if (!isEvidenceValid(report))
        return this.fail(
          record,
          "needs_human_review",
          "evidence did not verify; not resolving on-chain",
        );
      if (verdict.outcome === null || verdict.fault === null) {
        return this.fail(
          record,
          "needs_human_review",
          `adjudicator abstained: ${verdict.review_reason ?? "unspecified"}`,
        );
      }
      if (!pairingOk(verdict.outcome, verdict.fault)) {
        return this.fail(
          record,
          "failed",
          `inconsistent verdict: ${verdict.outcome} with fault ${verdict.fault}`,
        );
      }
      const roots = (xs: readonly string[]) => [...xs].sort().join();
      if (roots(verdict.evidence_root) !== roots(bundle.tree_heads.map((h) => h.root))) {
        return this.fail(
          record,
          "failed",
          "verdict was computed over different evidence roots than the ones fetched",
        );
      }
      const expected = computeVerdictCommitment({
        ...verdict,
        evidence_root: verdict.evidence_root as Hex[],
        outcome: verdict.outcome,
        fault: verdict.fault,
      });
      if (expected !== verdict.commitment)
        return this.fail(record, "failed", "verdict commitment does not match its contents");

      // 6. post it
      const { txHash } = await this.d.chain.resolve(
        record.escrowId,
        verdict.outcome,
        verdict.fault,
        verdict.commitment,
      );
      this.d.disputes.setResolvedTx(disputeId, txHash, now());
      this.d.disputes.transition(disputeId, ["adjudicating"], "resolved", now());
      this.d.logger.info(
        { dispute_id: disputeId, outcome: verdict.outcome, fault: verdict.fault, tx: txHash },
        "dispute resolved",
      );
      return this.d.disputes.get(disputeId)!;
    } catch (e) {
      return this.fail(record, "failed", (e as Error).message.slice(0, 300));
    }
  }

  private async collectBlobs(bundle: EvidenceBundle): Promise<Record<string, Uint8Array>> {
    const wanted = new Set<string>();
    for (const e of bundle.entries) {
      for (const f of e.disclosed)
        if (f.name === "body_hash" && typeof f.value === "string") wanted.add(f.value);
    }
    if (bundle.receipt) wanted.add(bundle.receipt.responseHash);
    const out: Record<string, Uint8Array> = {};
    for (const hash of [...wanted].slice(0, MAX_BLOBS)) {
      if (/^0x0{64}$/.test(hash)) continue; // "no body" placeholder
      const bytes = await this.d.evidence.getBlob(hash as Hex);
      // never trust the gateway's claim: the blob must hash to the key it was requested by
      if (bytes && keccak256(bytes) === hash) out[hash] = bytes;
    }
    return out;
  }

  private async runAdjudicator(
    record: DisputeRecord,
    bundle: EvidenceBundle,
    report: VerificationReport,
    blobs: Record<string, Uint8Array>,
    stored: NonNullable<ReturnType<MandateRepository["get"]>>,
    escrow: Awaited<ReturnType<ArbiterChain["getEscrow"]>>,
  ): Promise<Verdict> {
    const timeoutMs = this.d.adjudicationTimeoutSeconds * 1000;
    let timer: NodeJS.Timeout | undefined;
    try {
      const raw = await Promise.race([
        this.d.adjudicator.adjudicate({
          dispute_id: record.disputeId,
          escrow_id: record.escrowId,
          request_id: record.requestId,
          bundle,
          evidence_report: report,
          blobs,
          reason_text: record.reasonText,
          mandate: { mandate: stored.mandate, terms: stored.terms, merchants: stored.merchants },
          escrow: {
            amount: escrow.amount.toString(),
            merchant: escrow.merchant as Address,
            createdAt: escrow.createdAt,
            windowEnds: escrow.windowEnds,
          },
          now: this.d.clock.now(),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("adjudication timed out")), timeoutMs);
          timer.unref?.();
        }),
      ]);
      const verdict = VerdictSchema.safeParse(raw);
      if (!verdict.success) throw new Error("adjudicator returned an invalid verdict");
      if (
        verdict.data.dispute_id !== record.disputeId ||
        verdict.data.escrow_id !== record.escrowId
      ) {
        throw new Error("adjudicator returned a verdict for a different dispute");
      }
      return verdict.data;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- human review (privileged route)

  /**
   * Settle a dispute the adjudicator abstained on. The caller is the operator holding the admin
   * token; the commitment records that a human decided, with a hash of their note.
   */
  async humanReview(
    disputeId: string,
    input: { outcome: Outcome; fault: Fault; note: string },
  ): Promise<DisputeRecord> {
    const record = this.d.disputes.get(disputeId);
    if (!record) throw new RecourseError("not_found", "no such dispute");
    if (record.status !== "needs_human_review") {
      throw new RecourseError("conflict", `dispute is ${record.status}, not needs_human_review`);
    }
    if (!pairingOk(input.outcome, input.fault)) {
      throw new RecourseError(
        "bad_request",
        "REFUND must name a faulty party; RELEASE must be NONE",
      );
    }
    const escrow = await this.d.chain.getEscrow(record.escrowId);
    if (escrow.state !== "Disputed")
      throw new RecourseError("conflict", `escrow is ${escrow.state}, expected Disputed`);

    const commitment = canonicalHash({
      dispute_id: disputeId,
      escrow_id: record.escrowId,
      decided_by: "human",
      outcome: input.outcome,
      fault: input.fault,
      note_hash: keccak256(toBytes(input.note)),
    });
    // claim first so two reviewers cannot both send a transaction
    if (
      !this.d.disputes.transition(
        disputeId,
        ["needs_human_review"],
        "adjudicating",
        this.d.clock.now(),
      )
    ) {
      throw new RecourseError("conflict", "dispute is being handled elsewhere");
    }
    try {
      const { txHash } = await this.d.chain.resolve(
        record.escrowId,
        input.outcome,
        input.fault,
        commitment,
      );
      this.d.disputes.insertReview({
        disputeId,
        ...input,
        commitment,
        createdAt: this.d.clock.now(),
      });
      this.d.disputes.setResolvedTx(disputeId, txHash, this.d.clock.now());
      this.d.disputes.transition(
        disputeId,
        ["adjudicating"],
        "resolved",
        this.d.clock.now(),
        "resolved by human review",
      );
    } catch (e) {
      this.d.disputes.transition(
        disputeId,
        ["adjudicating"],
        "needs_human_review",
        this.d.clock.now(),
        (e as Error).message.slice(0, 300),
      );
      throw e;
    }
    return this.d.disputes.get(disputeId)!;
  }
}
