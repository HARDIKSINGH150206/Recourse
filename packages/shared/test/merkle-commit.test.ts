import { describe, expect, it } from "vitest";
import {
  ZERO32,
  batchProof,
  buildBatchTree,
  buildFieldCommitments,
  discloseField,
  keccakBytes,
  verifyBatchProof,
  verifyDisclosure,
} from "../src/index.js";

const salt = (n: string) => keccakBytes(`s:${n}`);

describe("batch merkle", () => {
  const leaves = [1, 2, 3, 4, 5].map((seq) => ({ seq, entry_hash: keccakBytes(`e${seq}`) }));
  const tree = buildBatchTree(leaves);

  it("proves membership of each leaf", () => {
    for (const l of leaves)
      expect(verifyBatchProof(tree.root as `0x${string}`, l, batchProof(tree, l))).toBe(true);
  });

  it("rejects a modified leaf", () => {
    const l = leaves[2]!;
    const proof = batchProof(tree, l);
    expect(
      verifyBatchProof(tree.root as `0x${string}`, { ...l, entry_hash: keccakBytes("x") }, proof),
    ).toBe(false);
    expect(verifyBatchProof(tree.root as `0x${string}`, { ...l, seq: 99 }, proof)).toBe(false);
  });

  it("supports a single-entry batch", () => {
    const one = buildBatchTree([leaves[0]!]);
    expect(
      verifyBatchProof(one.root as `0x${string}`, leaves[0]!, batchProof(one, leaves[0]!)),
    ).toBe(true);
  });
});

describe("field commitments", () => {
  const fields = { status: 200, body_len: 42, content_type: "application/json" };
  const { root, leaves } = buildFieldCommitments(fields, salt);

  it("discloses and verifies each field", () => {
    for (const name of Object.keys(fields))
      expect(verifyDisclosure(root, discloseField(leaves, name))).toBe(true);
  });

  it("rejects tampered value, name or salt", () => {
    const d = discloseField(leaves, "status");
    expect(verifyDisclosure(root, { ...d, value: 500 })).toBe(false);
    expect(verifyDisclosure(root, { ...d, name: "other" })).toBe(false);
    expect(verifyDisclosure(root, { ...d, salt: keccakBytes("bad") })).toBe(false);
  });

  it("is independent of field insertion order", () => {
    const b = buildFieldCommitments(
      { content_type: "application/json", status: 200, body_len: 42 },
      salt,
    );
    expect(b.root).toBe(root);
  });

  it("uses ZERO32 for no fields", () => {
    expect(buildFieldCommitments({}).root).toBe(ZERO32);
  });

  it("random salts hide guessable values", () => {
    expect(buildFieldCommitments({ status: 200 }).root).not.toBe(
      buildFieldCommitments({ status: 200 }).root,
    );
  });
});
