import { isEvidenceValid, type AdjudicationInput, type BundleEntry } from "@recourse/shared";
import type { RuleInput } from "@recourse/rules-engine";

const lc = (s: string) => s.toLowerCase();

function field(e: BundleEntry | undefined, name: string): unknown {
  return e?.disclosed.find((d) => d.name === name)?.value;
}

/** Entries of this dispute's request, by type (the first of each). */
export function entriesOf(input: AdjudicationInput) {
  const mine = input.bundle.entries.filter(
    (e) => lc(e.entry.request_id ?? "") === lc(input.request_id),
  );
  const first = (t: string) => mine.find((e) => e.entry.type === t);
  return { mine, request: first("request"), response: first("response") };
}

export interface Prepared {
  ruleInput: RuleInput;
  /** Set when the data the rules need is missing from an otherwise valid bundle. */
  incomplete: string | null;
  /** The response body as text, or "" if none. Untrusted: it may only go to the extractor. */
  bodyText: string;
  requestedCity: string | undefined;
}

/**
 * Turns the verified bundle into the rules-engine input (docs/08 section 3). Only reads fields
 * the bundle discloses; never trusts a value that is not there.
 */
export function prepare(input: AdjudicationInput, aliasTable: Record<string, string[]>): Prepared {
  const { mine, request, response } = entriesOf(input);
  let incomplete: string | null = null;

  const query = field(request, "query");
  const requestedCity =
    typeof query === "string" ? (new URLSearchParams(query).get("city") ?? undefined) : undefined;
  if (!request) incomplete = "no request entry for this request id";

  let responseInput: RuleInput["response"];
  let bodyText = "";
  if (response) {
    const status = field(response, "status");
    const latency = field(response, "latency_ms");
    const bodyHash = field(response, "body_hash");
    const bodyLen = field(response, "body_len");
    if (typeof status !== "number" || typeof latency !== "number") {
      incomplete ??= "response entry lacks status or latency";
    } else {
      const blob =
        typeof bodyHash === "string"
          ? (input.blobs[bodyHash] ?? input.blobs[lc(bodyHash)])
          : undefined;
      if (blob) bodyText = new TextDecoder().decode(blob);
      else if (typeof bodyLen === "number" && bodyLen > 0) {
        incomplete ??= "response body was not available";
      }
      responseInput = { status, bodyText, latencyMs: latency, ts: response.entry.ts };
    }
  }

  const receipt = input.bundle.receipt;
  const responseBodyHash = field(response, "body_hash");
  const m = input.mandate;

  const ruleInput: RuleInput = {
    evidenceValid: isEvidenceValid(input.evidence_report),
    mandate: {
      maxPricePerCall: BigInt(m.mandate.maxPricePerCall),
      totalBudget: BigInt(m.mandate.totalBudget),
      expiresAt: m.mandate.expiresAt,
      merchants: m.merchants,
      terms: m.terms,
    },
    escrow: {
      amount: BigInt(input.escrow.amount),
      merchant: input.escrow.merchant,
      createdAt: input.escrow.createdAt,
      windowEnds: input.escrow.windowEnds,
    },
    request: {
      ...(requestedCity !== undefined ? { city: requestedCity } : {}),
      path: String(field(request, "path") ?? ""),
      ts: request?.entry.ts ?? input.now,
    },
    ...(responseInput ? { response: responseInput } : {}),
    ...(receipt
      ? {
          receipt: {
            valid: input.evidence_report.receipt_ok === true,
            responseHashMatches:
              typeof responseBodyHash === "string" &&
              lc(receipt.responseHash) === lc(responseBodyHash),
          },
        }
      : {}),
    aliasTable,
    cites: {
      request: request?.entry.seq ?? mine[0]?.entry.seq ?? input.bundle.entries[0]?.entry.seq ?? 1,
      ...(response ? { response: response.entry.seq } : {}),
    },
  };
  return { ruleInput, incomplete, bodyText, requestedCity };
}
