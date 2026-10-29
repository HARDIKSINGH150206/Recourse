import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Source of truth for the API database (GUIDE.md section 6); logical design in docs/ARCHITECTURE.md s5.2. */
export const mandates = sqliteTable(
  "mandates",
  {
    mandateId: text("mandate_id").primaryKey(),
    owner: text("owner").notNull(),
    agent: text("agent").notNull(),
    mandateJson: text("mandate_json").notNull(),
    termsJson: text("terms_json").notNull(),
    termsHash: text("terms_hash").notNull(),
    merchantsJson: text("merchants_json").notNull(),
    signature: text("signature").notNull(),
    summary: text("summary").notNull(),
    registeredOnchain: integer("registered_onchain", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("mandates_owner").on(t.owner)],
);

export const disputes = sqliteTable(
  "disputes",
  {
    disputeId: text("dispute_id").primaryKey(),
    escrowId: text("escrow_id").notNull().unique(),
    mandateId: text("mandate_id").notNull(),
    requestId: text("request_id").notNull(),
    /** Untrusted owner text; only the extractor model ever sees it. */
    reasonText: text("reason_text"),
    /** keccak256(reason) as emitted by the on-chain Disputed event. */
    reasonHash: text("reason_hash").notNull(),
    status: text("status", {
      enum: [
        "opened",
        "evidence_ready",
        "adjudicating",
        "resolved",
        "needs_human_review",
        "failed",
      ],
    }).notNull(),
    /** Why a dispute is in needs_human_review or failed. */
    note: text("note"),
    /** VerificationReport (docs/03 s9) of the evidence used, as JSON. */
    evidenceReportJson: text("evidence_report_json"),
    openedTx: text("opened_tx"),
    resolvedTx: text("resolved_tx"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("disputes_status").on(t.status), index("disputes_mandate").on(t.mandateId)],
);

export const verdicts = sqliteTable("verdicts", {
  disputeId: text("dispute_id")
    .primaryKey()
    .references(() => disputes.disputeId),
  verdictJson: text("verdict_json").notNull(),
  commitment: text("commitment").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const benchRuns = sqliteTable("bench_runs", {
  runId: text("run_id").primaryKey(),
  configJson: text("config_json").notNull(),
  resultsJson: text("results_json").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** A human override of a needs_human_review dispute. The original verdict row stays untouched. */
export const reviews = sqliteTable("reviews", {
  disputeId: text("dispute_id")
    .primaryKey()
    .references(() => disputes.disputeId),
  outcome: text("outcome", { enum: ["REFUND", "RELEASE"] }).notNull(),
  fault: text("fault", { enum: ["NONE", "AGENT", "MERCHANT"] }).notNull(),
  note: text("note").notNull(),
  commitment: text("commitment").notNull(),
  createdAt: integer("created_at").notNull(),
});
