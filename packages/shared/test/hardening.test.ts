import { beforeAll, describe, expect, it } from "vitest";
import {
  MAX_BUNDLE_ENTRIES,
  isEvidenceValid,
  verifyBundle,
  verifyUntrustedBundle,
  type EvidenceBundle,
} from "../src/index.js";
import { buildFixture, type Fixture } from "./fixture.js";

let fx: Fixture;
beforeAll(async () => {
  fx = await buildFixture();
});
const clone = (b: EvidenceBundle): EvidenceBundle => structuredClone(b);

describe("verifyUntrustedBundle", () => {
  it("accepts the fixture", async () => {
    const r = await verifyUntrustedBundle(fx.bundle);
    expect(isEvidenceValid(r)).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it.each([null, undefined, 42, "x", [], {}, { version: 2 }])(
    "rejects non-bundle %j without throwing",
    async (v) => {
      const r = await verifyUntrustedBundle(v);
      expect(isEvidenceValid(r)).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    },
  );

  it("rejects unknown extra fields (strict schema)", async () => {
    const b = { ...clone(fx.bundle), extra: 1 };
    expect(isEvidenceValid(await verifyUntrustedBundle(b))).toBe(false);
  });

  it("rejects uppercase hex and short signatures", async () => {
    const b = clone(fx.bundle);
    b.request_id = b.request_id.toUpperCase().replace("0X", "0x") as `0x${string}`;
    expect(isEvidenceValid(await verifyUntrustedBundle(b))).toBe(false);
    const c = clone(fx.bundle);
    c.tree_heads[0]!.signature = "0x1234";
    expect(isEvidenceValid(await verifyUntrustedBundle(c))).toBe(false);
  });

  it("rejects oversized bundles", async () => {
    const b = clone(fx.bundle);
    b.entries = Array.from({ length: MAX_BUNDLE_ENTRIES + 1 }, () => b.entries[0]!);
    const r = await verifyUntrustedBundle(b);
    expect(isEvidenceValid(r)).toBe(false);
  });

  it("does not crash on a float inside a disclosed value", async () => {
    const b = clone(fx.bundle);
    b.entries[3]!.disclosed[0]!.value = 1.5;
    const r = await verifyUntrustedBundle(b);
    expect(r.fields_ok).toBe(false);
    expect(isEvidenceValid(r)).toBe(false);
  });
});

describe("verifyBundle structural checks", () => {
  it("rejects an empty bundle", async () => {
    const b = clone(fx.bundle);
    b.entries = [];
    expect(isEvidenceValid(await verifyBundle(b))).toBe(false);
  });

  it("rejects an entry from a different request or mandate", async () => {
    const other = clone(fx.bundle);
    other.request_id = ("0x" + "11".repeat(32)) as `0x${string}`;
    expect((await verifyBundle(other)).entry_hash_ok).toBe(false);
    const m = clone(fx.bundle);
    m.mandate_id = ("0x" + "22".repeat(32)) as `0x${string}`;
    expect((await verifyBundle(m)).entry_hash_ok).toBe(false);
  });

  it("rejects duplicate seq and duplicate tree heads", async () => {
    const dup = clone(fx.bundle);
    dup.entries.push(clone(fx.bundle).entries[0]!);
    expect((await verifyBundle(dup)).membership_ok).toBe(false);
    const heads = clone(fx.bundle);
    heads.tree_heads.push(heads.tree_heads[0]!);
    expect((await verifyBundle(heads)).tree_head_signature_ok).toBe(false);
  });

  it("rejects a duplicated disclosed field name", async () => {
    const b = clone(fx.bundle);
    b.entries[0]!.disclosed.push(b.entries[0]!.disclosed[0]!);
    expect((await verifyBundle(b)).fields_ok).toBe(false);
  });

  it("rejects a disclosure moved to a different entry", async () => {
    const b = clone(fx.bundle);
    b.entries[1]!.disclosed = b.entries[0]!.disclosed;
    expect((await verifyBundle(b)).fields_ok).toBe(false);
  });

  it("reports a failed anchor lookup instead of throwing", async () => {
    const rpc = {
      readContract: async () => {
        throw new Error("rpc down");
      },
    } as never;
    const r = await verifyBundle(fx.bundle, { rpc });
    expect(r.anchor_ok).toBe(false);
  });

  it("checks anchors against the chain when an rpc is given", async () => {
    const claimed = BigInt(fx.bundle.anchors[0]!.block_timestamp);
    const good = { readContract: async () => claimed } as never;
    const zero = { readContract: async () => 0n } as never;
    const wrong = { readContract: async () => claimed + 1n } as never;
    expect((await verifyBundle(fx.bundle, { rpc: good })).anchor_ok).toBe(true);
    expect((await verifyBundle(fx.bundle, { rpc: zero })).anchor_ok).toBe(false);
    expect((await verifyBundle(fx.bundle, { rpc: wrong })).anchor_ok).toBe(false);
  });

  it("flags an anchor earlier than the entries it covers", async () => {
    const b = clone(fx.bundle);
    b.anchors[0]!.block_timestamp = 1;
    expect((await verifyBundle(b)).time_ok).toBe(false);
  });
});

describe("WeatherResponseSchema", () => {
  const ok = {
    city: "Mumbai",
    temp_c: 31,
    humidity: 68,
    observed_at: 1_767_200_000,
    summary: "Humid",
  };
  it("accepts a healthy body and rejects wrong types and out-of-range values", async () => {
    const { WeatherResponseSchema } = await import("../src/index.js");
    expect(WeatherResponseSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { temp: "hot" },
      {},
      { ...ok, temp_c: 61 },
      { ...ok, temp_c: "31" },
      { ...ok, humidity: 101 },
      { ...ok, humidity: -1 },
      { ...ok, observed_at: 1.5 },
      { ...ok, city: "" },
    ]) {
      expect(WeatherResponseSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("parseLenientJson", () => {
  it("treats an empty body as {} and rejects malformed JSON", async () => {
    const { parseLenientJson } = await import("../src/index.js");
    expect(parseLenientJson("")).toEqual({});
    expect(parseLenientJson("  \n")).toEqual({});
    expect(parseLenientJson(Buffer.alloc(0))).toEqual({});
    expect(parseLenientJson('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseLenientJson("{bad")).toThrow(/not valid JSON/);
  });
});
