import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Address, Hex } from "viem";
import { AddressLc, Hex32, RecourseError } from "@recourse/shared";
import type { ApiDeps } from "../deps.js";
import type { DisputeRecord } from "../db/repositories/disputes.js";
import { MAX_REASON_CHARS } from "../services/disputes.js";

const STATUSES = [
  "opened",
  "evidence_ready",
  "adjudicating",
  "resolved",
  "needs_human_review",
  "failed",
] as const;

const ListQuery = z
  .object({
    status: z.enum(STATUSES).optional(),
    mandateId: Hex32.optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

const CreateDisputeBody = z
  .object({ escrow_id: Hex32, reason_text: z.string().max(MAX_REASON_CHARS) })
  .strict();

const ReviewBody = z
  .object({
    outcome: z.enum(["REFUND", "RELEASE"]),
    fault: z.enum(["NONE", "AGENT", "MERCHANT"]),
    note: z.string().min(1).max(1000),
  })
  .strict();

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Privileged routes need `Authorization: Bearer <API_ADMIN_TOKEN>`; with no token configured they are off. */
function requireAdmin(deps: ApiDeps, req: FastifyRequest): void {
  if (!deps.adminToken)
    throw new RecourseError(
      "forbidden",
      "privileged routes are disabled (API_ADMIN_TOKEN is not set)",
    );
  const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
  if (!given || !timingSafeEqual(digest(given), digest(deps.adminToken))) {
    throw new RecourseError("unauthorized", "missing or invalid admin token");
  }
}

function disputeJson(deps: ApiDeps, r: DisputeRecord) {
  return {
    dispute_id: r.disputeId,
    status: r.status,
    note: r.note,
    escrow_id: r.escrowId,
    mandate_id: r.mandateId,
    request_id: r.requestId,
    reason_text: r.reasonText,
    verdict: deps.disputes.getVerdict(r.disputeId),
    review: deps.disputes.getReview(r.disputeId),
    evidence_report: r.evidenceReport,
    txs: { dispute: r.openedTx, resolve: r.resolvedTx },
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

export function registerRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.get("/health", async () => ({ ok: true, time: deps.clock.now() }));

  // ---- mandates
  app.post("/mandates/compile", async (req) => deps.mandates.compile(req.body));

  app.post("/mandates", async (req, reply) => {
    const r = await deps.mandates.store(req.body);
    return reply.code(r.created ? 201 : 200).send({ mandate_id: r.mandate_id });
  });

  app.get("/mandates/:mandateId", async (req) => {
    const id = Hex32.safeParse((req.params as { mandateId: string }).mandateId.toLowerCase());
    if (!id.success) throw new RecourseError("bad_request", "invalid mandate id");
    const m = await deps.mandates.get(id.data);
    if (!m) throw new RecourseError("not_found", "no such mandate");
    return {
      mandate_id: m.mandateId,
      mandate: m.mandate,
      terms: m.terms,
      merchants: m.merchants,
      summary: m.summary,
      registered_onchain: m.registeredOnchain,
      created_at: m.createdAt,
    };
  });

  // ---- disputes
  app.get("/disputes", async (req) => {
    const q = ListQuery.parse(req.query);
    return { disputes: deps.disputes.list(q).map((r) => disputeJson(deps, r)) };
  });

  app.get("/disputes/:id", async (req) => {
    const r = deps.disputes.get((req.params as { id: string }).id);
    if (!r) throw new RecourseError("not_found", "no such dispute");
    return disputeJson(deps, r);
  });

  /** Register the owner's reason text for an on-chain dispute (it must hash to the event's reasonHash). */
  app.post("/disputes", async (req, reply) => {
    const b = CreateDisputeBody.parse(req.body);
    const r = await deps.disputeService.submitReason(b.escrow_id as Hex, b.reason_text);
    return reply.code(202).send(disputeJson(deps, r));
  });

  app.post("/disputes/:id/adjudicate", async (req) => {
    requireAdmin(deps, req);
    const r = await deps.disputeService.process((req.params as { id: string }).id);
    return disputeJson(deps, r);
  });

  app.post("/disputes/:id/review", async (req) => {
    requireAdmin(deps, req);
    const b = ReviewBody.parse(req.body);
    const r = await deps.disputeService.humanReview((req.params as { id: string }).id, b);
    return disputeJson(deps, r);
  });

  // ---- reputation (reads the chain)
  app.get("/reputation/:address", async (req) => {
    const a = AddressLc.safeParse((req.params as { address: string }).address.toLowerCase());
    if (!a.success) throw new RecourseError("bad_request", "invalid address");
    const [asAgent, asMerchant] = await Promise.all([
      deps.chain.agentReputation(a.data as Address),
      deps.chain.merchantReputation(a.data as Address),
    ]);
    return { address: a.data, as_agent: asAgent, as_merchant: asMerchant };
  });

  // ---- benchmark results (written by the benchmark tooling)
  const benchJson = (r: NonNullable<ReturnType<ApiDeps["disputes"]["latestBenchRun"]>>) => ({
    run_id: r.runId,
    config: JSON.parse(r.configJson) as unknown,
    results: JSON.parse(r.resultsJson) as unknown,
    created_at: r.createdAt,
  });
  app.get("/bench/latest", async () => {
    const r = deps.disputes.latestBenchRun();
    if (!r) throw new RecourseError("not_found", "no benchmark run recorded yet");
    return benchJson(r);
  });
  app.get("/bench/runs/:id", async (req) => {
    const r = deps.disputes.getBenchRun((req.params as { id: string }).id);
    if (!r) throw new RecourseError("not_found", "no such benchmark run");
    return benchJson(r);
  });
}
