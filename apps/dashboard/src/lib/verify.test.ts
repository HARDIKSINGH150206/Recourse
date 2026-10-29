import { describe, expect, it } from "vitest";
import { buildFixture } from "@recourse/shared/testkit";
import { changedPaths, checkState, leaves, setLeaf, verifyInBrowser } from "./verify";

describe("browser verification", () => {
  it("passes an untouched bundle with the offline checks", async () => {
    const { bundle } = await buildFixture();
    const r = await verifyInBrowser(bundle);
    expect(r.entry_hash_ok && r.fields_ok && r.membership_ok && r.tree_head_signature_ok).toBe(
      true,
    );
    expect(checkState(r, "anchor_ok")).toBe("pending");
    expect(checkState(r, "entry_hash_ok")).toBe("pass");
  });

  it("detects a changed entry timestamp (number leaf stays a number)", async () => {
    const { bundle } = await buildFixture();
    const ts = bundle.entries[0]!.entry.ts;
    const tampered = setLeaf(bundle, ["entries", 0, "entry", "ts"], String(ts + 1));
    expect(tampered.entries[0]!.entry.ts).toBe(ts + 1);
    const r = await verifyInBrowser(tampered);
    expect(checkState(r, "entry_hash_ok")).toBe("fail");
    expect(changedPaths(bundle, tampered)).toEqual([["entries", 0, "entry", "ts"]]);
  });

  it("detects a changed disclosed value and a changed tree head root", async () => {
    const { bundle } = await buildFixture();
    const idx = bundle.entries.findIndex((e) => e.disclosed.length > 0);
    const path = ["entries", idx, "disclosed", 0, "salt"];
    const salt = bundle.entries[idx]!.disclosed[0]!.salt;
    const bad = setLeaf(bundle, path, salt.replace(/.$/, salt.endsWith("0") ? "1" : "0"));
    expect(checkState(await verifyInBrowser(bad), "fields_ok")).toBe("fail");

    const root = bundle.tree_heads[0]!.root;
    const bad2 = setLeaf(
      bundle,
      ["tree_heads", 0, "root"],
      root.replace(/.$/, root.endsWith("0") ? "1" : "0"),
    );
    const r2 = await verifyInBrowser(bad2);
    expect(checkState(r2, "membership_ok")).toBe("fail");
  });

  it("never throws on garbage input", async () => {
    const r = await verifyInBrowser({ nope: 1 });
    expect(r.entry_hash_ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("does not mutate the original when editing", async () => {
    const { bundle } = await buildFixture();
    const before = JSON.stringify(bundle);
    setLeaf(bundle, ["entries", 0, "entry", "type"], "other");
    expect(JSON.stringify(bundle)).toBe(before);
    expect(leaves(bundle).length).toBeGreaterThan(20);
  });
});
