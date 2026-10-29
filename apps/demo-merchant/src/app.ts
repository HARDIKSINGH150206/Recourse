import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { protect, type ProtectOptions } from "@recourse/merchant-sdk";
import { systemClock, type Clock } from "@recourse/shared";
import { MODES, bodyFor, isMode, type Mode } from "./modes/bodies.js";

export interface MerchantOptions {
  protect: ProtectOptions;
  freshnessSeconds?: number;
  slaMs?: number;
  /** How long `timeout` mode stalls. Must exceed the SLA to be a failure. Default sla + 1000 ms. */
  timeoutDelayMs?: number;
  clock?: Clock;
  initialMode?: Mode;
}

export interface MerchantApp {
  app: Express;
  getMode(): Mode;
  setMode(m: Mode): void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The demo weather merchant: `GET /api/weather` behind the Recourse SDK, with switchable failure modes
 * for the demo scenarios. Modes come from the `X-Demo-Mode` header (per request, so concurrent runs
 * cannot interfere) or from `POST /admin/mode` (global default).
 */
export function createMerchant(o: MerchantOptions): MerchantApp {
  const clock = o.clock ?? systemClock;
  const freshness = o.freshnessSeconds ?? 3600;
  const slaMs = o.slaMs ?? 5000;
  const stallMs = o.timeoutDelayMs ?? slaMs + 1000;
  const merchant = privateKeyToAccount(o.protect.merchantPrivateKey).address as Address;
  let globalMode: Mode = o.initialMode ?? "honest";

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4kb" }));

  app.get("/health", (_req, res) => void res.json({ ok: true, mode: globalMode }));

  /** Merchant manifest (Should tier). */
  app.get("/.well-known/recourse.json", (_req, res) => {
    res.json({
      merchant,
      price: o.protect.price,
      scheme: "recourse-escrow",
      schema_hint: {
        city: "string",
        temp_c: "number -60..60",
        humidity: "number 0..100",
        observed_at: "unix seconds",
        summary: "string",
      },
      freshness_guarantee_seconds: freshness,
    });
  });

  // Admin routes are for the operator on this machine. The gateway adds X-Recourse-Request-Id to
  // everything it forwards, so anything carrying it came through the proxy and is refused.
  const direct = (req: Request, res: Response, next: NextFunction) => {
    if (req.header("x-recourse-request-id") !== undefined) {
      res.status(403).json({
        error: {
          code: "forbidden",
          message: "admin routes are not reachable through the gateway",
        },
      });
      return;
    }
    next();
  };
  app.get("/admin/mode", direct, (_req, res) => void res.json({ mode: globalMode, modes: MODES }));
  app.post("/admin/mode", direct, (req, res) => {
    const mode = (req.body as { mode?: unknown } | undefined)?.mode;
    if (!isMode(mode)) {
      res.status(400).json({
        error: { code: "bad_request", message: `mode must be one of ${MODES.join(", ")}` },
      });
      return;
    }
    globalMode = mode;
    res.json({ mode });
  });

  app.get("/api/weather", protect(o.protect), async (req, res) => {
    const headerMode = req.header("x-demo-mode");
    const mode: Mode = isMode(headerMode) ? headerMode : globalMode;
    const city =
      typeof req.query.city === "string" && req.query.city.trim()
        ? req.query.city.trim().slice(0, 100)
        : "Mumbai";

    if (mode === "timeout") await sleep(stallMs);
    if (mode === "http_error") {
      res.status(500).json({ error: { code: "internal", message: "upstream failure" } });
      return;
    }
    const body = bodyFor(mode, { city, now: clock.now(), freshnessSeconds: freshness });
    if (body === null) {
      res.status(200).end(); // empty 200
      return;
    }
    res.json(body);
  });

  return { app, getMode: () => globalMode, setMode: (m) => void (globalMode = m) };
}
