import type { z } from "zod";
import type {
  AnchorSchema,
  BundleEntrySchema,
  DisclosedFieldSchema,
  EvidenceBundleSchema,
  LogEntrySchema,
  ReceiptSchema,
  TreeHeadSchema,
  VerificationReportSchema,
} from "./schemas/evidence.js";
import type { MandateSchema, TermsSchema } from "./schemas/mandate.js";
import type { ExtractedFactsSchema } from "./schemas/facts.js";
import type { RuleResultsSchema } from "./schemas/rules.js";
import type { JudgeOutputSchema, VerdictSchema } from "./schemas/verdict.js";

export type Terms = z.infer<typeof TermsSchema>;
export type MandateJson = z.infer<typeof MandateSchema>;
export type LogEntry = z.infer<typeof LogEntrySchema>;
export type DisclosedField = z.infer<typeof DisclosedFieldSchema>;
export type TreeHead = z.infer<typeof TreeHeadSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
export type Anchor = z.infer<typeof AnchorSchema>;
export type BundleEntry = z.infer<typeof BundleEntrySchema>;
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
export type VerificationReport = z.infer<typeof VerificationReportSchema>;
export type RuleResults = z.infer<typeof RuleResultsSchema>;
export type ExtractedFacts = z.infer<typeof ExtractedFactsSchema>;
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
