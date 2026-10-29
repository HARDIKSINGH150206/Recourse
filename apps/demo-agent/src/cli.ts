// pnpm --filter @recourse/demo-agent cli -- run <scenarioId> [--dispute] [--reason "text"]
import { createDemoAgent } from "./build.js";
import { SCENARIOS } from "./scenarios/index.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const [command, scenarioId] = args;
if (command !== "run" || !scenarioId) {
  console.error(
    `usage: cli run <${Object.keys(SCENARIOS).join("|")}> [--dispute] [--reason "text"]`,
  );
  process.exit(2);
}
const reasonAt = args.indexOf("--reason");
const reason = reasonAt >= 0 ? args[reasonAt + 1] : undefined;

const { agent } = createDemoAgent();
const run = await agent.runToCompletion(scenarioId);
if (args.includes("--dispute") && run.status === "completed")
  await agent.dispute(run.run_id, reason);
console.log(JSON.stringify(run, null, 2));
process.exit(run.status === "completed" || run.status === "blocked" ? 0 : 1);
