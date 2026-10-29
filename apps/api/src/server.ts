import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { RecourseError, parseLenientJson } from "@recourse/shared";
import type { ApiDeps } from "./deps.js";
import { registerRoutes } from "./routes/index.js";

export async function buildServer(deps: ApiDeps): Promise<FastifyInstance> {
  const app = Fastify({ loggerInstance: deps.logger as FastifyBaseLogger, bodyLimit: 64 * 1024 });

  // an empty JSON body is {} (action routes); malformed JSON is a 400
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, parseLenientJson(body));
    } catch (e) {
      done(e as Error);
    }
  });

  await app.register(cors, {
    origin: deps.corsOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization"],
  });
  await app.register(rateLimit, { max: deps.rateLimitPerMinute, timeWindow: "1 minute" });

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
      const code = status === 429 ? "rate_limited" : "bad_request";
      return reply.code(status).send({ error: { code, message: (err as Error).message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "internal", message: "internal error" } });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: "not_found", message: "route not found" } }),
  );

  registerRoutes(app, deps);
  return app as unknown as FastifyInstance;
}
