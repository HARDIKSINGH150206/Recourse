import { privateKeyToAccount } from "viem/accounts";
import { createEscrowClient } from "@recourse/chain";
import { createLogger, systemClock } from "@recourse/shared";
import { loadGatewayConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { LogRepository } from "./db/repositories/log.js";
import { escrowAnchor } from "./log/anchor.js";
import { Batcher } from "./log/batcher.js";
import { EvidenceLog } from "./log/evidence-log.js";
import { startScheduler } from "./scheduler.js";
import { buildServer } from "./server.js";

const { cfg, dbPath, merchants, gatewayKey, escrow } = loadGatewayConfig();
const logger = createLogger("gateway", { level: cfg.LOG_LEVEL });

const account = privateKeyToAccount(gatewayKey);
const client = createEscrowClient({ chainId: cfg.CHAIN_ID, rpcUrl: cfg.RPC_URL, escrow, account });

const isDev = process.env.NODE_ENV !== "production";
const db = openDatabase(dbPath, { migrations: isDev ? "apply" : "check" });
const repo = new LogRepository(db);

const deps = {
  repo,
  log: new EvidenceLog(repo, systemClock),
  batcher: new Batcher(repo, account, systemClock, {
    chainId: cfg.CHAIN_ID,
    maxEntries: cfg.BATCH_MAX_ENTRIES,
    maxSeconds: cfg.BATCH_MAX_SECONDS,
  }),
  anchor: escrowAnchor(client, async (hash) =>
    Number((await client.publicClient.getTransactionReceipt({ hash })).blockNumber),
  ),
  chain: {
    getEscrow: client.getEscrow,
    blockNumber: async () => Number(await client.publicClient.getBlockNumber()),
  },
  clock: systemClock,
  logger,
  merchants,
  chainId: cfg.CHAIN_ID,
  escrow,
  gatewayAddress: account.address,
  upstreamTimeoutMs: 15_000,
  maxResponseBytes: 5_000_000,
  devRoutes: cfg.ENABLE_DEV_ROUTES === "1",
  corsOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"],
};

const app = buildServer(deps);
const stopScheduler = startScheduler(deps);

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, "shutting down: closing and anchoring the last batch");
  await app.close();
  await stopScheduler().catch((e) => logger.error({ err: e }, "final flush failed"));
  db.$client.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: cfg.GATEWAY_PORT, host: "127.0.0.1" });
if (deps.devRoutes) logger.warn("ENABLE_DEV_ROUTES=1: /admin/tamper is exposed");
