import { RecourseError } from "@recourse/shared";
import type { CompileContext, CompiledIntent, LlmIntent } from "./schema.js";

export const MIN_DURATION_SECONDS = 60;
export const MAX_DURATION_SECONDS = 366 * 86_400;
const MAX_FRESHNESS_SECONDS = 7 * 86_400;
const MAX_SLA_MS = 600_000;
const MAX_DISCRETION = 5;
const MAX_QUESTIONS = 3;
const DECIMAL = /^\d{1,15}(\.\d{1,18})?$/;

/** Scales a validated decimal string to an integer, for comparing two amounts exactly. */
function scaled(d: string): bigint {
  const [i = "0", f = ""] = d.split(".");
  return BigInt(i + f.padEnd(18, "0"));
}

const slug = (s: string, max: number) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max);

/**
 * Checks everything the model produced and turns it into a `CompiledIntent`. The model only
 * extracts; every limit is validated here and anything missing or out of range is rejected, with
 * a message telling the owner what to state. Nothing is guessed or defaulted for the hard limits.
 */
export function buildIntent(m: LlmIntent, ctx: Pick<CompileContext, "now">): CompiledIntent {
  const problems: string[] = [];

  const category = slug(m.category, 64);
  if (!category) problems.push("what is being bought");

  const price = m.max_price_per_call?.trim() ?? "";
  const budget = m.total_budget?.trim() ?? "";
  if (!DECIMAL.test(price) || !/[1-9]/.test(price)) problems.push("a maximum price per call");
  if (!DECIMAL.test(budget) || !/[1-9]/.test(budget)) problems.push("a total budget");

  const duration = m.duration_seconds;
  if (duration === null || duration < MIN_DURATION_SECONDS || duration > MAX_DURATION_SECONDS) {
    problems.push("how long the permission lasts (between 1 minute and 366 days)");
  }

  const d = {
    freshness_seconds: m.freshness_seconds,
    sla_ms: m.sla_ms,
  };
  if (
    d.freshness_seconds !== null &&
    (d.freshness_seconds < 1 || d.freshness_seconds > MAX_FRESHNESS_SECONDS)
  ) {
    problems.push("a freshness window between 1 second and 7 days");
  }
  if (d.sla_ms !== null && (d.sla_ms < 1 || d.sla_ms > MAX_SLA_MS)) {
    problems.push("a response-time limit between 1 ms and 10 minutes");
  }

  if (problems.length === 0 && scaled(price) > scaled(budget)) {
    problems.push("a total budget that is at least the maximum price per call");
  }
  if (problems.length > 0) {
    throw new RecourseError(
      "bad_request",
      `Could not build a mandate. Please state: ${problems.join("; ")}.`,
      { missing: problems },
    );
  }

  const defaults: NonNullable<CompiledIntent["defaults"]> = {};
  if (m.freshness_seconds !== null) defaults.freshness_seconds = m.freshness_seconds;
  if (m.sla_ms !== null) defaults.sla_ms = m.sla_ms;
  if (m.schema_required !== null) defaults.schema_required = m.schema_required;
  if (m.substitutions !== null) defaults.substitutions = m.substitutions;

  const discretion = [...new Set(m.discretion.map((x) => slug(x, 64)).filter(Boolean))].slice(
    0,
    MAX_DISCRETION,
  );

  const seen = new Set<string>();
  const questions: CompiledIntent["questions"] = [];
  for (const q of m.questions) {
    const id = slug(q.id, 64);
    const options = [
      ...new Set(q.options.map((o) => o.trim().slice(0, 100)).filter(Boolean)),
    ].slice(0, 4);
    const text = q.text.trim().slice(0, 300);
    if (!id || !text || options.length < 2 || seen.has(id)) continue;
    seen.add(id);
    questions.push({ id, text, options });
    if (questions.length === MAX_QUESTIONS) break;
  }

  return {
    category,
    maxPricePerCall: price,
    totalBudget: budget,
    expiresAt: ctx.now + (duration as number),
    merchants: [],
    defaults,
    discretion,
    questions,
  };
}
