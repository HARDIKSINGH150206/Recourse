import { describe, expect, it } from "vitest";
import { RecourseError, loadConfig, requireKey } from "../src/index.js";

describe("config", () => {
  it("applies defaults", () => {
    const c = loadConfig({});
    expect(c.CHAIN_ID).toBe(31337);
    expect(c.GATEWAY_PORT).toBe(4000);
    expect(c.JUDGE_COUNT).toBe(1);
  });

  it("treats empty strings as unset and fails fast on a missing required key", () => {
    const c = loadConfig({ GATEWAY_PRIVATE_KEY: "", ESCROW_ADDRESS: "" });
    expect(() => requireKey(c, "GATEWAY_PRIVATE_KEY")).toThrow(RecourseError);
  });

  it("rejects malformed values with all issues listed", () => {
    expect(() =>
      loadConfig({ CHAIN_ID: "abc", RPC_URL: "nope", OWNER_PRIVATE_KEY: "0x12" }),
    ).toThrow(/CHAIN_ID.*RPC_URL|RPC_URL.*CHAIN_ID/s);
  });
});
