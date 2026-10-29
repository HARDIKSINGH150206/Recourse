import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Hex } from "viem";
import { AddressLc, Hex32, RecourseError, canonicalJson, type LogEntry } from "@recourse/shared";
import type { GatewayDeps } from "../deps.js";
import type { BatchRow } from "../db/repositories/log.js";
import { anchorPending } from "../log/anchor.js";
import { treeHeadOf } from "../log/batcher.js";
import { buildEvidenceBundle, discloseFields } from "../evidence/bundle.js";

const IntParam = z.coerce.number().int().nonnegative();
const EntriesQuery = z
  .object({
    from: IntParam.optional(),
    to: IntParam.optional(),
    request_id: Hex32.optional(),
    limit: IntParam.optional(),
  })
  .strict();
const DecisionBody = z
  .object({
    request_id: Hex32,
    mandate_id: Hex32.optional(),
    agent_id: AddressLc.optional(),
    kind: z.enum(["shortlist", "rationale", "choice"]),
    data: z.record(z.unknown()),
  })
  .strict();
const DiscloseBody = z
  .object({
    fields: z
      .array(z.object({ seq: z.number().int().positive(), name: z.string().min(1).max(64) }))
      .min(1)
      .max(100),
  })
  .strict();

function batchJson(b: BatchRow) {
  return {
    batch_index: b.batchIndex,
    first_seq: b.firstSeq,
    last_seq: b.lastSeq,
    root: b.root,
    size: b.size,
    timestamp: b.ts,
    signature: b.signature,
    anchored: b.anchorTx !== null,
  };
}

function anchorJson(b: BatchRow) {
  return b.anchorTx
    ? {
        root: b.root,
        tx_hash: b.anchorTx,
        block_number: b.anchorBlock ?? 0,
        block_timestamp: b.anchorTs ?? 0,
      }
    : null;
}

export function registerLogRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { repo } = deps;

  app.get("/health", async () => ({
    ok: true,
    head_seq: repo.headSeq(),
    last_batch: repo.lastBatch()?.batchIndex ?? null,
  }));

  app.get("/log/head", async () => {
    const b = repo.lastBatch();
    if (!b) throw new RecourseError("not_found", "no batches yet");
    return { ...treeHeadOf(b), anchored: b.anchorTx !== null };
  });

  app.get("/log/entries", async (req) => {
    const q = EntriesQuery.parse(req.query);
    return {
      entries: repo.listEntries({
        from: q.from,
        to: q.to,
        requestId: q.request_id,
        limit: q.limit,
      }),
    };
  });

  app.get("/log/entries/:seq", async (req) => {
    const seq = IntParam.parse((req.params as { seq: string }).seq);
    const e = repo.getEntry(seq);
    if (!e) throw new RecourseError("not_found", "no such entry");
    return e;
  });

  app.get("/log/batches/:index", async (req) => {
    const b = repo.getBatch(IntParam.parse((req.params as { index: string }).index));
    if (!b) throw new RecourseError("not_found", "no such batch");
    return {
      batch: batchJson(b),
      entries: repo.entriesInRange(b.firstSeq, b.lastSeq) satisfies LogEntry[],
      tree_head: treeHeadOf(b),
      anchor: anchorJson(b),
    };
  });

  app.get("/log/proof/:seq", async (req) => {
    const seq = IntParam.parse((req.params as { seq: string }).seq);
    const p = deps.batcher.proofFor(seq);
    if (!p) throw new RecourseError("not_found", "entry not found or not batched yet");
    return { seq, batch_index: p.batch.batchIndex, proof: p.proof, tree_head: treeHeadOf(p.batch) };
  });

  app.post("/log/flush", async (_req, reply) => {
    await deps.batcher.flush();
    const report = await anchorPending(repo, deps.anchor);
    if (report.failed.length > 0) {
      deps.logger.error({ failed: report.failed }, "anchoring failed");
      throw new RecourseError(
        "upstream_error",
        "batch closed but anchoring failed; retry /log/flush",
        {
          failed: report.failed,
        },
      );
    }
    const b = repo.lastBatch();
    return reply.send({
      batch_index: b?.batchIndex ?? null,
      root: b?.root ?? null,
      anchor_tx: b?.anchorTx ?? null,
    });
  });

  app.get("/evidence/blob/:bodyHash", async (req, reply) => {
    const hash = Hex32.safeParse((req.params as { bodyHash: string }).bodyHash.toLowerCase());
    if (!hash.success) throw new RecourseError("bad_request", "invalid body hash");
    const blob = repo.getBlob(hash.data);
    if (!blob) throw new RecourseError("not_found", "no such blob");
    return reply.header("content-type", "application/octet-stream").send(blob);
  });

  app.get("/evidence/:requestId", async (req) => {
    const id = Hex32.safeParse((req.params as { requestId: string }).requestId.toLowerCase());
    if (!id.success) throw new RecourseError("bad_request", "invalid request id");
    return buildEvidenceBundle(repo, id.data as Hex, {
      chainId: deps.chainId,
      escrow: deps.escrow,
      gateway: deps.gatewayAddress,
    });
  });

  app.post("/evidence/:requestId/disclose", async (req) => {
    const id = Hex32.safeParse((req.params as { requestId: string }).requestId.toLowerCase());
    if (!id.success) throw new RecourseError("bad_request", "invalid request id");
    const body = DiscloseBody.parse(req.body);
    const disclosed = body.fields.flatMap(({ seq, name }) => {
      const e = repo.getEntry(seq);
      if (!e || e.request_id !== id.data)
        throw new RecourseError("not_found", `entry ${seq} not found for this request`);
      const d = discloseFields(repo, seq, [name]);
      if (d.length === 0) throw new RecourseError("not_found", `entry ${seq} has no field ${name}`);
      return d.map((x) => ({ seq, ...x }));
    });
    return { disclosed };
  });

  // Agent decision records are accepted but flagged as agent-claimed (docs/03 section 4.2).
  app.post("/log/decision", { bodyLimit: 16_384 }, async (req) => {
    const b = DecisionBody.parse(req.body);
    try {
      canonicalJson(b.data); // rejects floats and bigints before they reach the log
    } catch (e) {
      throw new RecourseError("bad_request", (e as Error).message);
    }
    const entry = deps.log.append({
      type: "decision",
      requestId: b.request_id as Hex,
      mandateId: (b.mandate_id as Hex | undefined) ?? null,
      agentId: b.agent_id ?? null,
      fields: { kind: b.kind, data: b.data, claimed_by: "agent" },
    });
    return { seq: entry.seq };
  });
}
