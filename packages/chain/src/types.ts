import type { Address, Hex } from "viem";
import type { MandateJson } from "@recourse/shared";
import type { RevertName } from "./abi.js";

export type EscrowState = "None" | "Held" | "Disputed" | "Released" | "Refunded";
export const ESTATES: readonly EscrowState[] = ["None", "Held", "Disputed", "Released", "Refunded"];

export type Outcome = "REFUND" | "RELEASE";
export type Fault = "NONE" | "AGENT" | "MERCHANT";
export const OUTCOME_CODE: Record<Outcome, number> = { REFUND: 0, RELEASE: 1 };
export const FAULT_CODE: Record<Fault, number> = { NONE: 0, AGENT: 1, MERCHANT: 2 };

export interface EscrowRecord {
  mandateId: Hex;
  merchant: Address;
  amount: bigint;
  requestId: Hex;
  createdAt: number;
  windowEnds: number;
  state: EscrowState;
}

export interface ReputationRecord {
  disputes: number;
  faults: number;
}

export interface TxResult {
  txHash: Hex;
}

/** A contract custom error, decoded to its name. Thrown by both the real client and the fake. */
export class EscrowRevert extends Error {
  constructor(readonly code: RevertName | "Paused" | "Unauthorized" | "InsufficientBalance") {
    super(`escrow reverted: ${code}`);
    this.name = "EscrowRevert";
  }
}

export interface DisputedEvent {
  escrowId: Hex;
  by: Address;
  reasonHash: Hex;
}
export interface ResolvedEvent {
  escrowId: Hex;
  outcome: Outcome;
  fault: Fault;
  verdictCommitment: Hex;
}

/** What the rest of the system may do with the escrow. Real client and fake implement it. */
export interface EscrowApi {
  registerMandate(
    m: MandateJson,
    merchants: Address[],
    signature: Hex,
  ): Promise<TxResult & { mandateId: Hex }>;
  createEscrow(
    mandateId: Hex,
    merchant: Address,
    amount: bigint,
    requestId: Hex,
  ): Promise<TxResult & { escrowId: Hex }>;
  release(escrowId: Hex): Promise<TxResult>;
  dispute(escrowId: Hex, reasonHash: Hex): Promise<TxResult>;
  resolve(escrowId: Hex, outcome: Outcome, fault: Fault, verdictCommitment: Hex): Promise<TxResult>;
  anchorRoot(root: Hex, size: number, batchIndex: number): Promise<TxResult>;

  getEscrow(escrowId: Hex): Promise<EscrowRecord>;
  getMandate(mandateId: Hex): Promise<MandateJson>;
  spent(mandateId: Hex): Promise<bigint>;
  anchoredAt(root: Hex): Promise<number>;
  agentReputation(agent: Address): Promise<ReputationRecord>;
  merchantReputation(merchant: Address): Promise<ReputationRecord>;

  watchDisputed(cb: (e: DisputedEvent) => void): () => void;
  watchResolved(cb: (e: ResolvedEvent) => void): () => void;
}
