import { describe, expect, it } from "vitest";
import { loadModelsConfig } from "@recourse/adjudicator";
import { isPlaceholder, resolveModels } from "../src/services/adjudicator.js";

describe("adjudicator wiring", () => {
  it("lets the environment override model names and keeps the pinned settings", () => {
    const base = loadModelsConfig();
    const m = resolveModels(base, { MODEL_EXTRACTOR: "qwen:7b", MODEL_JUDGE_1: "llama3.2:1b" });
    expect(m.extractor.name).toBe("qwen:7b");
    expect(m.judges[0]!.name).toBe("llama3.2:1b");
    expect({ ...m, extractor: 0, judges: 0 }).toEqual({ ...base, extractor: 0, judges: 0 });
  });
  it("keeps the file's names when the environment is empty", () => {
    const base = loadModelsConfig();
    const m = resolveModels(base, { MODEL_EXTRACTOR: undefined, MODEL_JUDGE_1: undefined });
    expect(m).toEqual(base);
  });
  it("recognises placeholder names", () => {
    expect(isPlaceholder("TBD-spike-S3")).toBe(true);
    expect(isPlaceholder("qwen:7b")).toBe(false);
  });
});
