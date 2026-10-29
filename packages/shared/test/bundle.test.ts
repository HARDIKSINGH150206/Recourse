import { beforeAll, describe, expect, it } from "vitest";
import {
  EvidenceBundleSchema,
  entryHash,
  isEvidenceValid,
  verifyBundle,
  type EvidenceBundle,
} from "../src/index.js";
import { buildFixture, type Fixture } from "./fixture.js";

let fx: Fixture;
beforeAll(async () => {
  fx = await buildFixture();
});

const clone = (b: EvidenceBundle): EvidenceBundle => structuredClone(b);

describe("verifyBundle", () => {
  it("fixture bundle matches the zod schema", () => {
    expect(EvidenceBundleSchema.safeParse(fx.bundle).success).toBe(true);
  });

  it("accepts a valid bundle", async () => {
    const r = await verifyBundle(fx.bundle, {
      batchEntries: fx.batch,
      blobs: { [fx.bundle.receipt!.responseHash]: fx.blob },
      disputeTs: 1_767_200_100,
    });
    expect(r.errors).toEqual([]);
    expect(isEvidenceValid(r)).toBe(true);
    expect(r).toMatchObject({
      entry_hash_ok: true,
      fields_ok: true,
      membership_ok: true,
      tree_head_signature_ok: true,
      receipt_ok: true,
      chain_ok: true,
      time_ok: true,
      anchor_ok: null,
    });
  });

  it("detects a tampered entry field (entry_hash and membership fail)", async () => {
    const b = clone(fx.bundle);
    b.entries[3]!.entry.ts += 1;
    const r = await verifyBundle(b);
    expect(r.entry_hash_ok).toBe(false);
    expect(isEvidenceValid(r)).toBe(false);
  });

  it("detects a re-hashed forged entry via batch membership", async () => {
    const b = clone(fx.bundle);
    const e = b.entries[3]!.entry;
    e.ts += 1;
    e.entry_hash = entryHash(e);
    const r = await verifyBundle(b);
    expect(r.entry_hash_ok).toBe(true);
    expect(r.membership_ok).toBe(false);
  });

  it("detects a tampered disclosed field", async () => {
    const b = clone(fx.bundle);
    b.entries[3]!.disclosed.find((d) => d.name === "status")!.value = 500;
    const r = await verifyBundle(b);
    expect(r.fields_ok).toBe(false);
  });

  it("detects a forged tree head signature", async () => {
    const b = clone(fx.bundle);
    b.tree_heads[0]!.size += 1;
    const r = await verifyBundle(b);
    expect(r.tree_head_signature_ok).toBe(false);
  });

  it("detects a receipt for a different body", async () => {
    const r = await verifyBundle(fx.bundle, {
      blobs: { [fx.bundle.receipt!.responseHash]: new TextEncoder().encode("different") },
    });
    expect(r.receipt_ok).toBe(false);
  });

  it("detects a receipt not signed by the merchant", async () => {
    const b = clone(fx.bundle);
    b.chain.merchant = b.chain.gateway;
    const r = await verifyBundle(b);
    expect(r.receipt_ok).toBe(false);
  });

  it("detects a gap or broken link in the batch export", async () => {
    const gap = fx.batch.filter((e) => e.seq !== 3);
    expect((await verifyBundle(fx.bundle, { batchEntries: gap })).chain_ok).toBe(false);
    const edited = structuredClone(fx.batch);
    edited[1]!.prev_hash = edited[2]!.prev_hash;
    expect((await verifyBundle(fx.bundle, { batchEntries: edited })).chain_ok).toBe(false);
  });

  it("flags a dispute before payment", async () => {
    const r = await verifyBundle(fx.bundle, { disputeTs: 1 });
    expect(r.time_ok).toBe(false);
  });
});

describe("committed test vectors", () => {
  it("expected_report matches a fresh verification of the committed bundle", async () => {
    const { readFileSync } = await import("node:fs");
    const v = JSON.parse(readFileSync(new URL("./vectors.json", import.meta.url), "utf8"));
    const r = await verifyBundle(v.bundle, {
      batchEntries: v.entries,
      blobs: { [v.bundle.receipt.responseHash]: fx.blob },
      disputeTs: 1_767_200_100,
    });
    expect(r).toEqual(v.expected_report);
  });
});
