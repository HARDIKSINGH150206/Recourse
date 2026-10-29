import type { Hex } from "viem";
import type { ScenarioId } from "./scenarios/index.js";

export interface RunStep {
  name: string;
  ts: number;
  ok: boolean;
  /** Gateway log sequence number, when the step produced a log entry. */
  seq?: number;
  tx?: Hex;
  detail?: string;
}

export type RunStatus = "running" | "completed" | "blocked" | "failed";

export interface Run {
  run_id: string;
  scenario: ScenarioId;
  status: RunStatus;
  steps: RunStep[];
  request_id: Hex | null;
  mandate_id: Hex | null;
  escrow_id: Hex | null;
  tx_hashes: { escrow?: Hex; dispute?: Hex; resolve?: Hex };
  response: { status: number; body: string } | null;
  /** Contract error name when the escrow was refused. */
  reverted: string | null;
  dispute: { dispute_id: string | null; status: string } | null;
  error: string | null;
  created_at: number;
}

/** Bounded in-memory run history: oldest runs are dropped first. */
export class RunStore {
  private readonly runs = new Map<string, Run>();
  constructor(private readonly max = 200) {}

  add(run: Run): void {
    this.runs.set(run.run_id, run);
    while (this.runs.size > this.max) this.runs.delete(this.runs.keys().next().value!);
  }

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  get size(): number {
    return this.runs.size;
  }
}
