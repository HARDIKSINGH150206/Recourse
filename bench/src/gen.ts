import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORY_COUNTS, generateCases } from "./generate.js";
import { GENERATOR_VERSION } from "./types.js";

/**
 * `pnpm --filter @recourse/bench gen [seed]`: writes every case to bench/results/cases (ignored by
 * git, reproducible from the seed) and the committed manifest plus a one-per-category sample to
 * bench/cases (docs/08 section 5.4).
 */
const seed = Number(process.argv[2] ?? 1);
if (!Number.isInteger(seed)) throw new Error("seed must be an integer");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const all = join(root, "results", "cases");
const sample = join(root, "cases", "sample");
mkdirSync(all, { recursive: true });
mkdirSync(sample, { recursive: true });

const cases = generateCases(seed);
const seen = new Set<string>();
for (const c of cases) {
  const json = `${JSON.stringify(c, null, 2)}\n`;
  writeFileSync(join(all, `${c.id}.json`), json);
  if (!seen.has(c.category) && !c.control) {
    seen.add(c.category);
    writeFileSync(join(sample, `${c.id}.json`), json);
  }
}
writeFileSync(
  join(root, "cases", "manifest.json"),
  `${JSON.stringify(
    {
      seed,
      generator_version: GENERATOR_VERSION,
      headline_cases: cases.filter((c) => !c.control).length,
      controls: cases.filter((c) => c.control).length,
      categories: CATEGORY_COUNTS,
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${cases.length} cases to ${all}`);
