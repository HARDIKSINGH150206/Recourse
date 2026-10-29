import { z } from "zod";
import { AddressLc, Hex32, UintString, UnixSeconds } from "./common.js";

/** Off-chain terms bound by termsHash (docs/03 section 2.2). */
export const TermsSchema = z
  .object({
    version: z.literal(1),
    category: z.string().min(1),
    defaults: z
      .object({
        freshness_seconds: z.number().int().positive(),
        schema_required: z.boolean(),
        substitutions: z.enum(["allowed", "not_allowed"]),
        sla_ms: z.number().int().positive(),
      })
      .strict(),
    discretion: z.array(z.string()),
  })
  .strict();

/** On-chain Mandate struct, JSON form (uint256 as decimal strings). */
export const MandateSchema = z
  .object({
    owner: AddressLc,
    agent: AddressLc,
    token: AddressLc,
    maxPricePerCall: UintString,
    totalBudget: UintString,
    expiresAt: UnixSeconds,
    nonce: UintString,
    merchantsHash: Hex32,
    termsHash: Hex32,
  })
  .strict();
