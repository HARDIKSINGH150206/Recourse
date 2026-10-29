import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { createLogger, loadConfig, requireAddress, requireKey } from "@recourse/shared";
import { createMerchant } from "./app.js";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
try {
  process.loadEnvFile(resolve(root, ".env"));
} catch {
  // no .env: rely on the process environment
}
const cfg = loadConfig();
const logger = createLogger("demo-merchant", { level: cfg.LOG_LEVEL });
const demo = z
  .object({
    pricePerCall: z.string().default("0.01"),
    freshnessSeconds: z.number().int().positive().default(3600),
    slaMs: z.number().int().positive().default(5000),
  })
  .passthrough()
  .parse(JSON.parse(readFileSync(resolve(root, "config/demo.json"), "utf8")));

const { app } = createMerchant({
  protect: {
    merchantPrivateKey: requireKey(cfg, "MERCHANT_PRIVATE_KEY"),
    chainId: cfg.CHAIN_ID,
    rpcUrl: cfg.RPC_URL,
    escrow: requireAddress(cfg, "ESCROW_ADDRESS"),
    token: requireAddress(cfg, "TOKEN_ADDRESS"),
    price: demo.pricePerCall,
  },
  freshnessSeconds: demo.freshnessSeconds,
  slaMs: demo.slaMs,
});

const server = app.listen(cfg.MERCHANT_PORT, "127.0.0.1", () =>
  logger.info({ port: cfg.MERCHANT_PORT, price: demo.pricePerCall }, "demo merchant listening"),
);
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => server.close(() => process.exit(0)));
