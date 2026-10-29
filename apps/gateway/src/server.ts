import cors from "@fastify/cors";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { RecourseError, parseLenientJson } from "@recourse/shared";
import type { GatewayDeps } from "./deps.js";
import { registerProxy } from "./proxy.js";
import { registerLogRoutes } from "./routes/log.js";
import { registerDevRoutes } from "./routes/dev.js";

export function buildServer(deps: GatewayDeps): FastifyInstance {
  const app = Fastify({ loggerInstance: deps.logger as FastifyBaseLogger, bodyLimit: 1_000_000 });

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
      return reply
        .code(status)
        .send({ error: { code: "bad_request", message: (err as Error).message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "internal", message: "internal error" } });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: "not_found", message: "route not found" } }),
  );

  if (deps.corsOrigins && deps.corsOrigins.length > 0) {
    // read-only: the dashboard fetches evidence and verifies it in the browser
    app.register(cors, { origin: deps.corsOrigins, methods: ["GET", "OPTIONS"] });
  }

  // The proxy replaces content-type parsers (raw bytes), so it lives in its own scope.
  app.register(async (scope) => registerProxy(scope, deps));
  app.register(async (scope) => {
    // an empty JSON body is {} (e.g. POST /log/flush); malformed JSON is a 400
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
      try {
        done(null, parseLenientJson(body));
      } catch (e) {
        done(e as Error);
      }
    });
    registerLogRoutes(scope, deps);
  });
  if (deps.devRoutes) app.register(async (scope) => registerDevRoutes(scope, deps));
  return app as unknown as FastifyInstance;
}
