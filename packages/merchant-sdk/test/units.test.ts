import { describe, expect, it } from "vitest";
import { MemoryServedStore, buildRequirements, priceToUnits } from "../src/index.js";
import { CHAIN_ID, TOKEN, merchant, rid } from "./helpers.js";

describe("priceToUnits", () => {
  it("converts decimal prices", () => {
    expect(priceToUnits("0.01")).toBe(10_000n);
    expect(priceToUnits("1")).toBe(1_000_000n);
    expect(priceToUnits("0.000001")).toBe(1n);
    expect(priceToUnits("2.5", 18)).toBe(2_500_000_000_000_000_000n);
  });
  it.each(["", "-1", "0", "0.0", "abc", "1e3", "0.0000001", "1.", ".5", " 1"])(
    "rejects %j",
    (p) => {
      expect(() => priceToUnits(p)).toThrow();
    },
  );
});

describe("buildRequirements", () => {
  it("matches docs/04 section 4.1", () => {
    const r = buildRequirements({
      chainId: CHAIN_ID,
      escrow: TOKEN,
      token: TOKEN,
      merchant: merchant.address,
      price: "0.01",
      requestId: rid("a"),
      now: 1000,
      ttlSeconds: 300,
      resource: "/api/weather?city=Mumbai",
    });
    expect(Object.keys(r).sort()).toEqual([
      "amount",
      "chain_id",
      "escrow",
      "expires_at",
      "merchant",
      "request_id",
      "resource",
      "scheme",
      "token",
    ]);
    expect(r).toMatchObject({ scheme: "recourse-escrow", amount: "0.01", expires_at: 1300 });
  });
});

describe("MemoryServedStore", () => {
  it("claims once, frees after expiry, and stays bounded", () => {
    const s = new MemoryServedStore(3);
    expect(s.claim("a", 100, 0)).toBe(true);
    expect(s.claim("a", 100, 50)).toBe(false);
    expect(s.claim("a", 200, 100)).toBe(true); // expired entry can be claimed again
    for (const id of ["b", "c", "d", "e", "f"]) s.claim(id, 10_000, 0);
    expect(s.size).toBeLessThanOrEqual(3);
  });
});
