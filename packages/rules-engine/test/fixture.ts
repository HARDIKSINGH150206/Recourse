import type { RuleInput } from "../src/index.js";

export const MERCHANT = "0x00000000000000000000000000000000000000aa";
export const NOW = 1_767_200_000;

export const ALIASES = {
  mumbai: ["bombay", "mumbai in"],
  bengaluru: ["bangalore"],
};

export const goodBody = {
  city: "Mumbai",
  temp_c: 31,
  humidity: 70,
  observed_at: NOW - 60,
  summary: "Hazy sunshine",
};

/** A fully valid case: every rule passes and none is decisive. Tests override one field. */
export function baseInput(over: Partial<RuleInput> = {}): RuleInput {
  return {
    evidenceValid: true,
    mandate: {
      maxPricePerCall: 50_000n,
      totalBudget: 2_000_000n,
      expiresAt: NOW + 86_400,
      merchants: [MERCHANT],
      terms: {
        version: 1,
        category: "weather_data_api",
        defaults: {
          freshness_seconds: 3600,
          schema_required: true,
          substitutions: "not_allowed",
          sla_ms: 5000,
        },
        discretion: [],
      },
    },
    escrow: { amount: 10_000n, merchant: MERCHANT, createdAt: NOW - 100, windowEnds: NOW + 30 },
    request: { city: "Mumbai", path: "/api/weather", ts: NOW - 5 },
    response: {
      status: 200,
      bodyText: JSON.stringify(goodBody),
      latencyMs: 400,
      ts: NOW - 4,
    },
    receipt: { valid: true, responseHashMatches: true },
    aliasTable: ALIASES,
    cites: { request: 3, response: 4 },
    ...over,
  };
}

export function withBody(body: unknown, extra: Partial<NonNullable<RuleInput["response"]>> = {}) {
  return {
    response: {
      status: 200,
      bodyText: typeof body === "string" ? body : JSON.stringify(body),
      latencyMs: 400,
      ts: NOW - 4,
      ...extra,
    },
  };
}
