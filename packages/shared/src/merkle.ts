import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { Hex } from "viem";
import { ZERO32 } from "./hash.js";

// Batch tree over (seq uint256, entry_hash bytes32), docs/03 section 6.2.
const BATCH_TYPES = ["uint256", "bytes32"];

export interface BatchLeaf {
  seq: number;
  entry_hash: Hex;
}

export function buildBatchTree(entries: readonly BatchLeaf[]) {
  if (entries.length === 0) throw new Error("cannot build a batch tree with no entries");
  return StandardMerkleTree.of(
    entries.map((e) => [BigInt(e.seq), e.entry_hash] as [bigint, Hex]),
    BATCH_TYPES,
  );
}

export function batchProof(tree: ReturnType<typeof buildBatchTree>, leaf: BatchLeaf): Hex[] {
  return tree.getProof([BigInt(leaf.seq), leaf.entry_hash]) as Hex[];
}

export function verifyBatchProof(root: Hex, leaf: BatchLeaf, proof: readonly Hex[]): boolean {
  try {
    return StandardMerkleTree.verify(
      root,
      BATCH_TYPES,
      [BigInt(leaf.seq), leaf.entry_hash],
      [...proof],
    );
  } catch {
    return false;
  }
}

// Field-commitment tree over bytes32 leaves, docs/03 section 5.
const FIELD_TYPES = ["bytes32"];

/** Root of a payload commitment tree; an entry with no fields uses ZERO32. */
export function buildFieldTree(leaves: readonly Hex[]) {
  if (leaves.length === 0) return null;
  return StandardMerkleTree.of(
    leaves.map((l) => [l] as [Hex]),
    FIELD_TYPES,
  );
}

export function fieldTreeRoot(leaves: readonly Hex[]): Hex {
  return (buildFieldTree(leaves)?.root as Hex | undefined) ?? ZERO32;
}

export function verifyFieldProof(root: Hex, leaf: Hex, proof: readonly Hex[]): boolean {
  try {
    return StandardMerkleTree.verify(root, FIELD_TYPES, [leaf], [...proof]);
  } catch {
    return false;
  }
}
