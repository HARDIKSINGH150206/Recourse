import type { Hex } from "viem";
import {
  ZERO32,
  buildFieldCommitments,
  entryHash,
  randomSalt,
  type Clock,
  type LogEntry,
} from "@recourse/shared";
import type { LogRepository } from "../db/repositories/log.js";

export interface AppendInput {
  type: LogEntry["type"];
  requestId: Hex;
  mandateId: Hex | null;
  agentId: string | null;
  fields: Record<string, unknown>;
}

/**
 * The hash-chained evidence log (docs/03 section 4). `append` is the only write path and runs in
 * one transaction, so seq stays gapless and `prev_hash` always links to the true previous entry.
 */
export class EvidenceLog {
  constructor(
    private readonly repo: LogRepository,
    private readonly clock: Clock,
    private readonly salt: (seq: number, name: string) => Hex = () => randomSalt(),
  ) {}

  append(input: AppendInput): LogEntry {
    return this.repo.transaction(() => {
      const prev = this.repo.lastEntry();
      const seq = (prev?.seq ?? 0) + 1;
      const { root, leaves } = buildFieldCommitments(input.fields, (name) => this.salt(seq, name));
      const base = {
        seq,
        // never goes backwards even if the system clock does
        ts: Math.max(this.clock.now(), prev?.ts ?? 0),
        type: input.type,
        request_id: input.requestId,
        mandate_id: input.mandateId,
        agent_id: input.agentId,
        payload_commitment: root,
        prev_hash: (prev?.entry_hash ?? ZERO32) as Hex,
      };
      const entry: LogEntry = { ...base, entry_hash: entryHash(base) };
      this.repo.insertEntry(entry, leaves);
      return entry;
    });
  }
}
