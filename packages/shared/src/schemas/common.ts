import { z } from "zod";

export const Hex32 = z.string().regex(/^0x[0-9a-f]{64}$/, "expected lowercase 0x bytes32");
export const AddressLc = z.string().regex(/^0x[0-9a-f]{40}$/, "expected lowercase 0x address");
export const HexBytes = z.string().regex(/^0x([0-9a-f]{2})*$/, "expected lowercase 0x hex");
/** Non-negative integer as a decimal string (token base units, uint256 values). */
export const UintString = z.string().regex(/^(0|[1-9][0-9]*)$/, "expected decimal integer string");
/** Unix seconds. */
export const UnixSeconds = z.number().int().nonnegative();
