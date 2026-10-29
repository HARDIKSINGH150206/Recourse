import { describe, expect, it } from "vitest";
import { ZERO32, canonicalHash, canonicalJson, keccakBytes } from "../src/index.js";

describe("hash", () => {
  it("ZERO32 is 32 zero bytes", () => {
    expect(ZERO32).toBe("0x" + "00".repeat(32));
  });

  it("canonical JSON is key-order independent (RFC 8785)", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
  });

  it("hashes the JCS utf8 bytes with keccak256", () => {
    expect(canonicalHash({ a: 1 })).toBe(keccakBytes('{"a":1}'));
    // keccak256("") known value
    expect(keccakBytes("")).toBe(
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
  });

  it("rejects floats and bigints", () => {
    expect(() => canonicalHash({ x: 1.5 })).toThrow(/float/);
    expect(() => canonicalHash({ x: 10n })).toThrow(/bigint/);
  });
});
