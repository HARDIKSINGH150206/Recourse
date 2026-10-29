import type { Hex } from "viem";
import { keccakBytes } from "./hash.js";

/** requestId = keccak256(utf8(uuidv4)), docs/03 section 3. `uuid` is injectable for tests. */
export function newRequestId(uuid: () => string = () => crypto.randomUUID()): Hex {
  return keccakBytes(uuid());
}
