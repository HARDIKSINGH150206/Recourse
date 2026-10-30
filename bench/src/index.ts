export { CATEGORY_COUNTS, TERMS, generateCases, type Category } from "./generate.js";
export { buildInput, CHAIN_ID, type BuiltCase } from "./evidence.js";
export { rng, fnv1a, type Rng } from "./prng.js";
export {
  BenchCaseSchema,
  GENERATOR_VERSION,
  T0,
  TruthSchema,
  responseTs,
  type BenchCase,
  type Truth,
} from "./types.js";
export * from "./metrics.js";
export { instrument, loadCache, saveCache, type Instrumented } from "./cache.js";
export { prepareInputs, runConfig, type RunOptions } from "./runner.js";
export { assembleRun, renderReport, cell, type RunFile } from "./report.js";
