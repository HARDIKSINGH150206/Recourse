import type { Logger } from "pino";
import type { Clock } from "@recourse/shared";
import type { DisputeRepository } from "./db/repositories/disputes.js";
import type { ArbiterChain } from "./ports.js";
import type { DisputeService } from "./services/disputes.js";
import type { MandateService } from "./services/mandates.js";

export interface ApiDeps {
  mandates: MandateService;
  disputeService: DisputeService;
  disputes: DisputeRepository;
  chain: ArbiterChain;
  clock: Clock;
  logger: Logger;
  /** Bearer token for privileged routes; undefined disables them. */
  adminToken?: string;
  corsOrigins: string[];
  /** Requests per minute per client for every route (compile is LLM-backed and costs money). */
  rateLimitPerMinute: number;
}
