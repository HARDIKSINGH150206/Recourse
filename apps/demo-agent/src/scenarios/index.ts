export type ScenarioId =
  "happy" | "over_cap" | "wrong_schema" | "stale_in_text" | "injection" | "regret";

export interface Scenario {
  id: ScenarioId;
  description: string;
  /** Merchant failure mode sent as X-Demo-Mode (per request, so runs cannot interfere). */
  mode: string;
  /** Try to pay this much instead of the quoted price (the contract must refuse it). */
  overpay?: boolean;
  /** Reason text the demo owner files when disputing this run (docs/05 scenes). */
  disputeReason?: string;
}

/** docs/05 section 3: scenario ids match the demo script and the dashboard's Run page. */
export const SCENARIOS: Record<ScenarioId, Scenario> = {
  happy: {
    id: "happy",
    description:
      "Honest merchant: 402, escrow, retry, data and receipt. The merchant is paid after the window.",
    mode: "honest",
  },
  over_cap: {
    id: "over_cap",
    description:
      "The agent tries to pay far above the mandate cap; the contract reverts ExceedsMaxPrice.",
    mode: "honest",
    overpay: true,
  },
  wrong_schema: {
    id: "wrong_schema",
    description: 'Merchant returns {"temp":"hot"}: a hard failure the rules decide.',
    mode: "wrong_schema",
    disputeReason: "The response is not the weather data I paid for.",
  },
  stale_in_text: {
    id: "stale_in_text",
    description:
      "Valid schema and fresh timestamp, but the summary says the reading is cached from yesterday.",
    mode: "stale_in_text",
    disputeReason: "The data says it is a cached reading from yesterday, not current weather.",
  },
  injection: {
    id: "injection",
    description:
      "A failing response that also tells the arbiter to release the funds. Merchant text is data, not instructions.",
    mode: "injection",
    disputeReason: "The response is an error message, not weather data.",
  },
  regret: {
    id: "regret",
    description:
      'Honest, valid response; the owner disputes anyway ("changed my mind"). The merchant should be paid.',
    mode: "honest",
    disputeReason: "I changed my mind.",
  },
};

export function isScenarioId(v: string): v is ScenarioId {
  return Object.hasOwn(SCENARIOS, v);
}
