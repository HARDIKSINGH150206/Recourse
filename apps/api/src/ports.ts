import type { Address, Hex, PublicClient } from "viem";
import type { EscrowApi } from "@recourse/chain";
import type { LogEntry, Terms } from "@recourse/shared";

/** The arbiter-signed chain connection. `rpc` enables the on-chain anchor check in verifyBundle. */
export type ArbiterChain = EscrowApi & { rpc?: PublicClient };

/** The gateway as the API uses it (docs/04 section 2.2). */
export interface EvidencePort {
  /** Close the open batch and anchor it, so the evidence is complete. */
  flush(): Promise<void>;
  /** Untrusted JSON: the caller parses it with the bundle schema. */
  getBundle(requestId: Hex): Promise<unknown>;
  getBlob(bodyHash: Hex): Promise<Uint8Array | null>;
  /** Full batch export (used for the chain_ok continuity check). */
  getBatchEntries(batchIndex: number): Promise<LogEntry[] | null>;
}

export interface Question {
  id: string;
  text: string;
  options: string[];
}

/** What the mandate compiler (LLM, owned by the AI lane) extracts from the owner's text. */
export interface CompiledIntent {
  category: string;
  /** Decimal token units, for example "0.05". */
  maxPricePerCall: string;
  totalBudget: string;
  /** Unix seconds. */
  expiresAt: number;
  /** Empty means "use the allowlist the caller supplied". */
  merchants: Address[];
  defaults?: Partial<Terms["defaults"]>;
  discretion?: string[];
  questions: Question[];
}

export interface CompileContext {
  owner: Address;
  agent: Address;
  merchants: Address[];
  chainId: number;
  escrow: Address;
  token: Address;
  now: number;
}

export interface MandateCompilerPort {
  compile(text: string, ctx: CompileContext): Promise<CompiledIntent>;
}
