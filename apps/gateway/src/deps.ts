import type { Address } from "viem";
import type { Logger } from "pino";
import type { EscrowApi } from "@recourse/chain";
import type { Clock } from "@recourse/shared";
import type { LogRepository } from "./db/repositories/log.js";
import type { ChainAnchor } from "./log/anchor.js";
import type { Batcher } from "./log/batcher.js";
import type { EvidenceLog } from "./log/evidence-log.js";

/** What the proxy needs to read from the chain (the escrow behind a payment proof). */
export type GatewayChain = Pick<EscrowApi, "getEscrow"> & { blockNumber(): Promise<number> };

export interface GatewayDeps {
  repo: LogRepository;
  log: EvidenceLog;
  batcher: Batcher;
  anchor: ChainAnchor;
  chain: GatewayChain;
  clock: Clock;
  logger: Logger;
  /** merchant id -> base URL. Only these upstreams can ever be called (no SSRF). */
  merchants: Record<string, string>;
  chainId: number;
  escrow: Address;
  gatewayAddress: Address;
  fetchImpl?: typeof fetch;
  upstreamTimeoutMs: number;
  maxResponseBytes: number;
  devRoutes: boolean;
}
