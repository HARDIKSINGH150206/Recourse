import { createDemoAgent } from "./build.js";
import { buildServer } from "./server.js";

const { agent, cfg, logger } = createDemoAgent();
const app = await buildServer(agent, logger, ["http://localhost:5173", "http://127.0.0.1:5173"]);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => void app.close().then(() => process.exit(0)));
}
await app.listen({ port: cfg.AGENT_PORT, host: "127.0.0.1" });
if (agent.canDispute)
  logger.warn("this process holds the demo OWNER key so it can file disputes (demo mode only)");
