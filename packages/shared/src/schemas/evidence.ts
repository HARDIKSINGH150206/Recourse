import { z } from "zod";
import { AddressLc, Hex32, HexBytes, UnixSeconds } from "./common.js";

export const EntryTypeSchema = z.enum([
  "request",
  "payment_required",
  "payment_proof",
  "response",
  "receipt",
  "decision",
]);

/** Log entry (docs/03 section 4.1). */
export const LogEntrySchema = z
  .object({
    seq: z.number().int().positive(),
    ts: UnixSeconds,
    type: EntryTypeSchema,
    request_id: Hex32.nullable(),
    mandate_id: Hex32.nullable(),
    agent_id: AddressLc.nullable(),
    payload_commitment: Hex32,
    prev_hash: Hex32,
    entry_hash: Hex32,
  })
  .strict();

export const DisclosedFieldSchema = z
  .object({
    name: z.string().min(1),
    // JSON value; hashed via JCS so it must not contain floats.
    value: z.unknown(),
    salt: Hex32,
    proof: z.array(Hex32),
  })
  .strict();

export const TreeHeadSchema = z
  .object({
    root: Hex32,
    size: z.number().int().nonnegative(),
    batch_index: z.number().int().nonnegative(),
    timestamp: UnixSeconds,
    signature: HexBytes,
  })
  .strict();

export const ReceiptSchema = z
  .object({
    requestId: Hex32,
    responseHash: Hex32,
    timestamp: UnixSeconds,
    merchant: AddressLc,
    signature: HexBytes,
  })
  .strict();

export const AnchorSchema = z
  .object({
    root: Hex32,
    tx_hash: Hex32,
    block_number: z.number().int().nonnegative(),
    block_timestamp: UnixSeconds,
  })
  .strict();

export const BundleEntrySchema = z
  .object({
    entry: LogEntrySchema,
    disclosed: z.array(DisclosedFieldSchema),
    batch_proof: z
      .object({ batch_index: z.number().int().nonnegative(), proof: z.array(Hex32) })
      .strict(),
  })
  .strict();

/** Evidence bundle (docs/03 section 8). */
export const EvidenceBundleSchema = z
  .object({
    version: z.literal(1),
    chain: z
      .object({
        chain_id: z.number().int().positive(),
        escrow: AddressLc,
        gateway: AddressLc,
        merchant: AddressLc,
      })
      .strict(),
    request_id: Hex32,
    mandate_id: Hex32,
    escrow_id: Hex32,
    entries: z.array(BundleEntrySchema),
    tree_heads: z.array(TreeHeadSchema),
    anchors: z.array(AnchorSchema),
    receipt: ReceiptSchema.nullable(),
  })
  .strict();

export const VerificationReportSchema = z
  .object({
    entry_hash_ok: z.boolean(),
    fields_ok: z.boolean(),
    membership_ok: z.boolean(),
    tree_head_signature_ok: z.boolean(),
    anchor_ok: z.boolean().nullable(),
    receipt_ok: z.boolean().nullable(),
    chain_ok: z.boolean().nullable(),
    time_ok: z.boolean(),
    errors: z.array(z.string()),
  })
  .strict();
