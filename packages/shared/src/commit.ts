import { encodePacked, keccak256, toBytes, type Hex } from "viem";
import { canonicalHash } from "./hash.js";
import { buildFieldTree, fieldTreeRoot, verifyFieldProof } from "./merkle.js";
import type { DisclosedField } from "./types.js";

export interface FieldLeaf {
  name: string;
  value: unknown;
  salt: Hex;
  leaf: Hex;
}

/** leaf = keccak256(abi.encodePacked(salt, keccak256(utf8(name)), keccak256(utf8(JCS(value))))) */
export function fieldLeafHash(salt: Hex, name: string, value: unknown): Hex {
  return keccak256(
    encodePacked(
      ["bytes32", "bytes32", "bytes32"],
      [salt, keccak256(toBytes(name)), canonicalHash(value)],
    ),
  );
}

export function randomSalt(): Hex {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Salted commitments for one payload (docs/03 section 5). Fields are sorted by name.
 * Inject `salt` for deterministic tests; production uses random salts.
 */
export function buildFieldCommitments(
  fields: Record<string, unknown>,
  salt: (name: string) => Hex = randomSalt,
): { root: Hex; leaves: FieldLeaf[] } {
  const leaves = Object.keys(fields)
    .sort()
    .map((name) => {
      const s = salt(name);
      const value = fields[name];
      return { name, value, salt: s, leaf: fieldLeafHash(s, name, value) };
    });
  return { root: fieldTreeRoot(leaves.map((l) => l.leaf)), leaves };
}

/** Disclosure of one field: value, salt and Merkle proof against the payload commitment. */
export function discloseField(leaves: readonly FieldLeaf[], name: string): DisclosedField {
  const target = leaves.find((l) => l.name === name);
  if (!target) throw new Error(`no such field: ${name}`);
  const tree = buildFieldTree(leaves.map((l) => l.leaf));
  if (!tree) throw new Error("no fields committed");
  return {
    name,
    value: target.value,
    salt: target.salt,
    proof: tree.getProof([target.leaf]) as Hex[],
  };
}

export function verifyDisclosure(payloadCommitment: Hex, d: DisclosedField): boolean {
  const leaf = fieldLeafHash(d.salt as Hex, d.name, d.value);
  return verifyFieldProof(payloadCommitment, leaf, d.proof as Hex[]);
}
