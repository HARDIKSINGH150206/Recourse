import { WeatherResponseSchema, type RuleResults } from "@recourse/shared";
import { matchEntity } from "./entity.js";
import { looksLikeInjection } from "./injection.js";
import type { RuleDecision, RuleInput } from "./types.js";

export { matchEntity, normalizeName, type EntityMatch } from "./entity.js";
export { looksLikeInjection } from "./injection.js";
export type { RuleDecision, RuleInput } from "./types.js";

const MAX_SCHEMA_ERRORS = 10;

function parseBody(r: NonNullable<RuleInput["response"]>): unknown {
  if (r.bodyJson !== undefined) return r.bodyJson;
  if (r.bodyText === undefined) return undefined;
  try {
    return JSON.parse(r.bodyText);
  } catch {
    return undefined;
  }
}

/**
 * Runs R0 to R8 (docs/08 section 3). Pure and deterministic. R8 is computed for every case,
 * whatever else fails. Rules that cannot be evaluated (for example R4 with no response) report
 * the failing value, but the first decisive rule in the order R0, R7, R1 to R6 is the one that
 * ends the pipeline, so those values are never the reason for a verdict.
 */
export function runRules(input: RuleInput): RuleResults {
  const { mandate, escrow, request, response, receipt } = input;
  const reqCites = [input.cites.request];
  const bothCites = input.cites.response ? [input.cites.request, input.cites.response] : reqCites;

  const injection_suspected = looksLikeInjection(response?.bodyText);

  // R7 mandate
  const merchants = mandate.merchants.map((m) => m.toLowerCase());
  const within_mandate =
    escrow.amount <= mandate.maxPricePerCall &&
    merchants.includes(escrow.merchant.toLowerCase()) &&
    escrow.createdAt < mandate.expiresAt;

  // R1 delivery
  const delivered =
    response !== undefined &&
    response.status >= 200 &&
    response.status < 300 &&
    (response.bodyText ?? "").length > 0;
  const http_status = response?.status ?? null;

  // R2 timeliness
  const within_sla = response !== undefined && response.latencyMs <= mandate.terms.defaults.sla_ms;

  // R3 receipt
  const receipt_present = receipt !== undefined;
  const receipt_valid = receipt !== undefined && receipt.valid && receipt.responseHashMatches;

  // R4 schema
  let schema_valid = false;
  const schema_errors: string[] = [];
  let body: ReturnType<typeof WeatherResponseSchema.safeParse> | undefined;
  if (response) {
    const json = parseBody(response);
    if (json === undefined) {
      schema_errors.push("body is not valid JSON");
    } else {
      body = WeatherResponseSchema.safeParse(json);
      schema_valid = body.success;
      if (!body.success) {
        for (const i of body.error.issues.slice(0, MAX_SCHEMA_ERRORS)) {
          schema_errors.push(`${i.path.join(".") || "(root)"}: ${i.message}`);
        }
      }
    }
  }
  const weather = body?.success ? body.data : undefined;

  // R5 freshness
  const fresh_by_timestamp =
    response !== undefined &&
    weather !== undefined &&
    response.ts - weather.observed_at <= mandate.terms.defaults.freshness_seconds;

  // R6 entity
  const entity_match =
    request.city !== undefined && weather !== undefined
      ? matchEntity(request.city, weather.city, input.aliasTable)
      : "ambiguous";

  const results: RuleResults = {
    evidence_valid: input.evidenceValid,
    within_mandate,
    delivered,
    http_status,
    within_sla,
    receipt_present,
    receipt_valid,
    schema_valid,
    schema_errors,
    fresh_by_timestamp,
    entity_match,
    injection_suspected,
    decisive: null,
    abstain: null,
  };

  const refund3 = (reason: string, cites: number[]): RuleResults["decisive"] => ({
    class: 3,
    outcome: "REFUND",
    fault: "MERCHANT",
    reason,
    cites,
  });

  if (!input.evidenceValid) {
    results.abstain = { reason: "evidence_invalid", cites: [] };
  } else if (!within_mandate) {
    results.decisive = {
      class: 1,
      outcome: "REFUND",
      fault: "AGENT",
      reason: "R7: the payment breached a hard mandate limit",
      cites: reqCites,
    };
  } else if (!delivered) {
    results.decisive = refund3("R1: no successful, non-empty response was delivered", bothCites);
  } else if (!within_sla) {
    results.decisive = refund3("R2: the response arrived after the SLA", bothCites);
  } else if (!receipt_present || !receipt_valid) {
    results.abstain = { reason: "evidence_incomplete", cites: bothCites };
  } else if (!schema_valid) {
    results.decisive = refund3("R4: the response does not match the required schema", bothCites);
  } else if (!fresh_by_timestamp) {
    results.decisive = refund3("R5: the response timestamp is older than allowed", bothCites);
  } else if (entity_match === "different") {
    results.decisive = refund3(
      "R6: the response is about a different place than requested",
      bothCites,
    );
  }

  return results;
}

/** Turns rule results into a settled outcome, or `null` when the case must go to the AI stage. */
export function decide(results: RuleResults): RuleDecision | null {
  if (results.abstain) {
    return { kind: "review", reason: results.abstain.reason, cites: results.abstain.cites };
  }
  if (results.decisive) return { kind: "verdict", ...results.decisive };
  return null;
}
