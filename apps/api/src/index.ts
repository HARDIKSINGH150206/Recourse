import { privateKeyToAccount } from "viem/accounts";
import { createEscrowClient } from "@recourse/chain";
import { createLogger, systemClock } from "@recourse/shared";
import { loadApiConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { DisputeRepository } from "./db/repositories/disputes.js";
import { MandateRepository } from "./db/repositories/mandates.js";
import { buildServer } from "./server.js";
import { DisputeService } from "./services/disputes.js";
import { HttpEvidenceClient } from "./services/evidence-client.js";
import { MandateService } from "./services/mandates.js";
import { buildAi } from "./services/adjudicator.js";

const { cfg, dbPath, arbiterKey, escrow, token } = loadApiConfig();
const logger = createLogger("api", { level: cfg.LOG_LEVEL });

const isDev = process.env.NODE_ENV !== "production";
const db = openDatabase(dbPath, { migrations: isDev ? "apply" : "check" });
const mandateRepo = new MandateRepository(db);
const disputeRepo = new DisputeRepository(db);

// The arbiter key signs `resolve`; it is held only by this process (docs/09 key roles).
const client = createEscrowClient({
  chainId: cfg.CHAIN_ID,
  rpcUrl: cfg.RPC_URL,
  escrow,
  account: privateKeyToAccount(arbiterKey),
});
const chain = Object.assign(client, { rpc: client.publicClient });

const ai = buildAi(cfg, logger);
const disputeService = new DisputeService({
  disputes: disputeRepo,
  mandates: mandateRepo,
  chain,
  evidence: new HttpEvidenceClient(cfg.GATEWAY_URL),
  adjudicator: ai.adjudicator,
  clock: systemClock,
  logger,
  reasonWaitSeconds: cfg.REASON_WAIT_SECONDS,
  adjudicationTimeoutSeconds: cfg.ADJUDICATION_TIMEOUT_SECONDS,
});

const app = await buildServer({
  mandates: new MandateService({
    repo: mandateRepo,
    chain,
    compiler: ai.compiler,
    clock: systemClock,
    chainId: cfg.CHAIN_ID,
    escrow,
    token,
    tokenDecimals: 6,
    tokenSymbol: "USDC",
  }),
  disputeService,
  disputes: disputeRepo,
  chain,
  clock: systemClock,
  logger,
  adminToken: cfg.API_ADMIN_TOKEN,
  corsOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"],
  rateLimitPerMinute: 120,
});

const unwatch = chain.watchDisputed((ev) => {
  disputeService
    .onDisputed(ev)
    .catch((e) => logger.error({ err: e, escrow_id: ev.escrowId }, "could not index dispute"));
});
const requeued = disputeService.recover();
if (requeued > 0) logger.info({ requeued }, "re-queued open disputes");

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, "shutting down");
  unwatch();
  await app.close();
  db.$client.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: cfg.API_PORT, host: "127.0.0.1" });
if (!cfg.API_ADMIN_TOKEN)
  logger.warn("API_ADMIN_TOKEN is not set: manual adjudication and human review are disabled");
