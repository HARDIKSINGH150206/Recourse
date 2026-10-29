import { index, integer, primaryKey, sqliteTable, text, blob } from "drizzle-orm/sqlite-core";

/**
 * Source of truth for the gateway database (GUIDE.md section 6). The SQL in
 * docs/ARCHITECTURE.md section 5.1 is the logical design.
 *
 * Deviation from the logical design: `entries` has NO `batch_index` column. Batches cover
 * contiguous seq ranges, so an entry's batch is derived from `batches.first_seq/last_seq`.
 * This keeps `entries` strictly append-only (no UPDATE ever), which a trigger also enforces.
 */
export const entries = sqliteTable(
  "entries",
  {
    seq: integer("seq").primaryKey(),
    ts: integer("ts").notNull(),
    type: text("type", {
      enum: ["request", "payment_required", "payment_proof", "response", "receipt", "decision"],
    }).notNull(),
    requestId: text("request_id").notNull(),
    mandateId: text("mandate_id"),
    agentId: text("agent_id"),
    payloadCommitment: text("payload_commitment").notNull(),
    prevHash: text("prev_hash").notNull(),
    entryHash: text("entry_hash").notNull(),
  },
  (t) => [index("entries_request").on(t.requestId)],
);

/** Private: values and salts for selective disclosure. */
export const fields = sqliteTable(
  "fields",
  {
    seq: integer("seq")
      .notNull()
      .references(() => entries.seq),
    name: text("name").notNull(),
    valueJson: text("value_json").notNull(),
    salt: text("salt").notNull(),
  },
  (t) => [primaryKey({ columns: [t.seq, t.name] })],
);

/** Raw response bodies keyed by keccak256(body). */
export const blobs = sqliteTable("blobs", {
  bodyHash: text("body_hash").primaryKey(),
  content: blob("content", { mode: "buffer" }).notNull(),
});

export const batches = sqliteTable("batches", {
  batchIndex: integer("batch_index").primaryKey(),
  firstSeq: integer("first_seq").notNull(),
  lastSeq: integer("last_seq").notNull(),
  root: text("root").notNull().unique(),
  size: integer("size").notNull(),
  ts: integer("ts").notNull(),
  treeDump: text("tree_dump").notNull(),
  signature: text("signature").notNull(),
  anchorTx: text("anchor_tx"),
  anchorBlock: integer("anchor_block"),
  anchorTs: integer("anchor_ts"),
});
