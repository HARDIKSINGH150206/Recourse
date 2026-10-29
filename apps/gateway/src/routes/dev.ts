import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RecourseError } from "@recourse/shared";
import type { GatewayDeps } from "../deps.js";

const TamperBody = z
  .object({
    seq: z.number().int().positive(),
    field: z.enum(["ts", "agent_id", "payload_commitment", "prev_hash"]),
    value: z.union([z.string(), z.number()]),
  })
  .strict();

const COLUMN: Record<z.infer<typeof TamperBody>["field"], string> = {
  ts: "ts",
  agent_id: "agent_id",
  payload_commitment: "payload_commitment",
  prev_hash: "prev_hash",
};

/**
 * DEV ONLY (ENABLE_DEV_ROUTES=1). Rewrites one stored entry to demonstrate that tampering is
 * detected. It briefly drops the append-only trigger on purpose; nothing else ever does.
 */
export function registerDevRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  app.post("/admin/tamper", async (req) => {
    const b = TamperBody.parse(req.body);
    if (!deps.repo.getEntry(b.seq)) throw new RecourseError("not_found", "no such entry");
    const sqlite = deps.repo.db.$client;
    sqlite.exec("DROP TRIGGER entries_no_update");
    try {
      sqlite.prepare(`UPDATE entries SET ${COLUMN[b.field]} = ? WHERE seq = ?`).run(b.value, b.seq);
    } finally {
      sqlite.exec(
        "CREATE TRIGGER entries_no_update BEFORE UPDATE ON entries BEGIN SELECT RAISE(ABORT, 'entries are append-only'); END",
      );
    }
    deps.logger.warn({ seq: b.seq, field: b.field }, "DEV tamper applied");
    return { ok: true };
  });
}
