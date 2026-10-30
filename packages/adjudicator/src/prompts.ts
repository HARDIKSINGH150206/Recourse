import { readFileSync } from "node:fs";
import { keccakBytes } from "@recourse/shared";

const dir = new URL("../prompts/", import.meta.url);

/** Fixed order: the prompt hash covers these files, concatenated (docs/03 section 10). */
export const PROMPT_FILES = ["extractor.v1.md", "judge.v1.md"] as const;

export interface Prompts {
  extractor: string;
  judge: string;
  hash: `0x${string}`;
}

export function loadPrompts(): Prompts {
  const [extractor, judge] = PROMPT_FILES.map((f) => readFileSync(new URL(f, dir), "utf8")) as [
    string,
    string,
  ];
  return { extractor, judge, hash: keccakBytes(extractor + judge) };
}
