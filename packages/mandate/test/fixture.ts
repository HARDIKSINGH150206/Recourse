import type { LlmIntent } from "../src/index.js";

export const good: LlmIntent = {
  category: "weather_data_api",
  max_price_per_call: "0.05",
  total_budget: "2.00",
  duration_seconds: 86_400,
  freshness_seconds: null,
  sla_ms: null,
  schema_required: null,
  substitutions: null,
  discretion: [],
  questions: [],
};
