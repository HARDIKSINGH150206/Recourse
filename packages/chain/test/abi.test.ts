import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { escrowAbi, REVERT_NAMES } from "../src/index.js";

const sol = readFileSync(
  new URL("../../../contracts/src/interfaces/IRecourseEscrow.sol", import.meta.url),
  "utf8",
);

function names(re: RegExp): string[] {
  return [...sol.matchAll(re)].map((m) => m[1]!).sort();
}

describe("ABI stays in step with IRecourseEscrow.sol", () => {
  it("has every function in the interface, and nothing extra", () => {
    const inSol = names(/^\s*function (\w+)\(/gm);
    const inAbi = escrowAbi
      .filter((i) => i.type === "function")
      .map((i) => i.name)
      .sort();
    expect(inAbi).toEqual(
      inSol.filter((n) => !["pause", "unpause", "setArbiter", "setGateway"].includes(n)),
    );
  });

  it("has every event", () => {
    const inSol = names(/^\s*event (\w+)\(/gm);
    const inAbi = escrowAbi
      .filter((i) => i.type === "event")
      .map((i) => i.name)
      .sort();
    expect(inAbi).toEqual(inSol);
  });

  it("has every custom error", () => {
    const inSol = names(/^\s*error (\w+)\(\)/gm);
    expect([...REVERT_NAMES].sort()).toEqual(inSol);
    const inAbi = escrowAbi
      .filter((i) => i.type === "error")
      .map((i) => i.name)
      .sort();
    expect(inAbi).toEqual(inSol);
  });
});
