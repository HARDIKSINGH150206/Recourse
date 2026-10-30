import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAliasTable, loadModelsConfig } from "@recourse/adjudicator";
import { createOllamaLlm } from "@recourse/llm";
import { loadCache, saveCache } from "./cache.js";
import { generateCases } from "./generate.js";
import type { CaseResult, ConfigId } from "./metrics.js";
import { assembleRun, renderReport } from "./report.js";
import { prepareInputs, runConfig } from "./runner.js";
import { GENERATOR_VERSION } from "./types.js";
import type { Verdict } from "@recourse/shared";

/**
 * `pnpm --filter @recourse/bench bench -- --config all|A1,A2,B,C [--seed N] [--limit N] [--out DIR]`
 * Reads models from config/models.json (docs/08 section 5.4), runs the real adjudicator on the
 * generated cases, caches model outputs by input hash, and writes results, verdicts, summary.json
 * and report.md under bench/results/<run>/ (git-ignored).
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "cases", "manifest.json"), "utf8")) as {
  seed: number;
};
const seed = Number(arg("seed") ?? manifest.seed);
const wanted =
  (arg("config") ?? "all") === "all"
    ? (["A1", "A2", "B", "C"] as ConfigId[])
    : (arg("config")!.split(",") as ConfigId[]);
const limit = arg("limit") ? Number(arg("limit")) : undefined;

const models = loadModelsConfig();
const needsModel = wanted.some((c) => c === "B" || c === "C");
if (needsModel && models.extractor.name.startsWith("TBD")) {
  throw new Error(
    "config/models.json still has placeholder model names: run spike S3 (P2-01) and pin them first",
  );
}

let cases = generateCases(seed);
if (limit) {
  const keep = new Set(
    cases
      .filter((c) => !c.control)
      .slice(0, limit)
      .map((c) => c.id),
  );
  cases = cases.filter((c) => keep.has(c.id) || (c.pair_id !== null && keep.has(c.pair_id)));
}

const runId = `run-${seed}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const out = arg("out") ?? join(root, "results", runId);
mkdirSync(out, { recursive: true });
const cachePath = join(root, "results", "cache.json");
const cache = loadCache(cachePath);

const inputs = await prepareInputs(cases);
const llm = createOllamaLlm();
const runs: Partial<Record<ConfigId, { results: CaseResult[]; verdicts: Verdict[] }>> = {};
for (const config of wanted) {
  let done = 0;
  runs[config] = await runConfig({
    config,
    cases,
    inputs,
    llm,
    models,
    aliasTable: loadAliasTable(),
    cache,
    onCase: () => {
      done += 1;
      if (done % 20 === 0) console.log(`${config}: ${done}/${cases.length}`);
    },
  });
  writeFileSync(join(out, `cases.${config}.json`), JSON.stringify(runs[config]!.results, null, 2));
  writeFileSync(
    join(out, `verdicts.${config}.json`),
    JSON.stringify(runs[config]!.verdicts, null, 2),
  );
  saveCache(cachePath, cache);
}

const run = assembleRun({
  runId,
  seed,
  generatorVersion: GENERATOR_VERSION,
  createdAt: Math.floor(Date.now() / 1000),
  judges: models.judges.length,
  runs,
});
writeFileSync(join(out, "summary.json"), JSON.stringify(run, null, 2));
writeFileSync(join(out, "report.md"), renderReport(run));
console.log(`wrote ${out}`);
