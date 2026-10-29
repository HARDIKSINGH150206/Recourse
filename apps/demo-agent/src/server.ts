import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { z, ZodError } from "zod";
import { Hex32, RecourseError } from "@recourse/shared";
import type { Hex } from "viem";
import type { DemoAgent } from "./service.js";

const RunBody = z.object({ mandate_id: Hex32.optional() }).strict().default({});
const DisputeBody = z
  .object({ reason_text: z.string().min(1).max(2000).optional() })
  .strict()
  .default({});

/** HTTP API of the demo agent (docs/04 section 6). */
export async function buildServer(
  agent: DemoAgent,
  logger: Logger,
  corsOrigins: string[],
): Promise<FastifyInstance> {
  const app = Fastify({ loggerInstance: logger as FastifyBaseLogger, bodyLimit: 16 * 1024 });
  await app.register(cors, { origin: corsOrigins, methods: ["GET", "POST", "OPTIONS"] });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof RecourseError) return reply.code(err.status).send(err.toBody());
    if (err instanceof ZodError) {
      const e = new RecourseError("bad_request", "invalid input", {
        issues: err.issues.slice(0, 10),
      });
      return reply.code(e.status).send(e.toBody());
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({
        error: {
          code: status === 429 ? "rate_limited" : "bad_request",
          message: (err as Error).message,
        },
      });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "internal", message: "internal error" } });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: "not_found", message: "route not found" } }),
  );

  app.get("/health", async () => ({ ok: true, can_dispute: agent.canDispute }));
  app.get("/scenarios", async () => ({ scenarios: agent.listScenarios() }));

  app.post("/scenarios/:id/run", async (req, reply) => {
    const body = RunBody.parse(req.body ?? {});
    const run = agent.startRun((req.params as { id: string }).id, {
      mandateId: body.mandate_id as Hex | undefined,
    });
    return reply.code(202).send({ run_id: run.run_id });
  });

  app.get("/runs/:runId", async (req) => agent.getRun((req.params as { runId: string }).runId));

  app.post("/runs/:runId/dispute", async (req) => {
    const body = DisputeBody.parse(req.body ?? {});
    return agent.dispute((req.params as { runId: string }).runId, body.reason_text);
  });

  return app as unknown as FastifyInstance;
}
