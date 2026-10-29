import { randomUUID } from "node:crypto";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { EscrowRevert, type EscrowApi } from "@recourse/chain";
import { RecourseError, type Clock } from "@recourse/shared";
import { executeRun, type AgentContext } from "./agent.js";
import { RunStore, type Run } from "./runs.js";
import { SCENARIOS, isScenarioId, type Scenario, type ScenarioId } from "./scenarios/index.js";

export interface DemoAgentDeps {
  ctx: Omit<AgentContext, "resolveMandate">;
  apiUrl: string;
  clock: Clock;
  /**
   * The demo owner, used only to file disputes (docs/05: the owner opens disputes). Absent in any
   * setup where this process should not hold the owner key.
   */
  owner?: { address: Address; chain: Pick<EscrowApi, "dispute"> };
  /** Fixed mandate to spend under; otherwise the newest registered one for the owner is used. */
  mandateId?: Hex;
  fetchImpl?: typeof fetch;
  newId?: () => string;
  store?: RunStore;
}

interface ApiMandateList {
  mandates: Array<{
    mandate_id: Hex;
    mandate: { agent: string; expiresAt: number };
    registered_onchain: boolean;
  }>;
}

/** The demo agent service: starts scenario runs, tracks them, and lets the demo owner dispute one. */
export class DemoAgent {
  readonly store: RunStore;
  private readonly doFetch: typeof fetch;
  private readonly newId: () => string;

  constructor(private readonly d: DemoAgentDeps) {
    this.store = d.store ?? new RunStore();
    this.doFetch = d.fetchImpl ?? fetch;
    this.newId = d.newId ?? randomUUID;
  }

  get canDispute(): boolean {
    return this.d.owner !== undefined;
  }

  listScenarios() {
    return Object.values(SCENARIOS).map((s) => ({
      id: s.id,
      description: s.description,
      mode: s.mode,
      disputable: s.disputeReason !== undefined,
    }));
  }

  /** Newest registered, unexpired mandate of the owner that names this agent. */
  private async resolveMandate(override?: Hex): Promise<Hex> {
    const fixed = override ?? this.d.mandateId;
    if (fixed) return fixed;
    if (!this.d.owner)
      throw new Error("no mandate configured: set DEMO_MANDATE_ID or provide the demo owner key");
    const list = await this.api<ApiMandateList>(
      `/mandates?owner=${this.d.owner.address.toLowerCase()}&limit=20`,
    );
    const now = this.d.clock.now();
    const agent = this.d.ctx.agentAddress.toLowerCase();
    for (const m of list.mandates) {
      if (m.mandate.agent !== agent || m.mandate.expiresAt <= now) continue;
      const fresh = await this.api<{ registered_onchain: boolean }>(`/mandates/${m.mandate_id}`);
      if (fresh.registered_onchain) return m.mandate_id;
    }
    throw new Error(
      "no registered mandate found for this agent; register one first (pnpm demo or the dashboard)",
    );
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await this.doFetch(new URL(path, this.d.apiUrl), {
      ...init,
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await r.json().catch(() => null)) as T & { error?: { message?: string } };
    if (!r.ok) throw new Error(body?.error?.message ?? `API returned ${r.status}`);
    return body;
  }

  /** Create the run and execute it in the background; poll with `getRun`. */
  startRun(scenarioId: string, opts: { mandateId?: Hex } = {}): Run {
    if (!isScenarioId(scenarioId))
      throw new RecourseError("not_found", `unknown scenario: ${scenarioId}`);
    const scenario: Scenario = SCENARIOS[scenarioId];
    const run: Run = {
      run_id: this.newId(),
      scenario: scenarioId as ScenarioId,
      status: "running",
      steps: [],
      request_id: null,
      mandate_id: null,
      escrow_id: null,
      tx_hashes: {},
      response: null,
      reverted: null,
      dispute: null,
      error: null,
      created_at: this.d.clock.now(),
    };
    this.store.add(run);
    void executeRun(
      { ...this.d.ctx, resolveMandate: () => this.resolveMandate(opts.mandateId) },
      scenario,
      run,
    );
    return run;
  }

  /** Start a run and wait for it to leave `running` (used by the CLI and the demo script). */
  async runToCompletion(
    scenarioId: string,
    opts: { mandateId?: Hex; pollMs?: number; timeoutMs?: number } = {},
  ): Promise<Run> {
    const run = this.startRun(scenarioId, opts);
    const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
    while (run.status === "running") {
      if (Date.now() > deadline) throw new RecourseError("upstream_error", "run timed out");
      await new Promise((r) => setTimeout(r, opts.pollMs ?? 50));
    }
    return run;
  }

  getRun(runId: string): Run {
    const run = this.store.get(runId);
    if (!run) throw new RecourseError("not_found", "no such run");
    return run;
  }

  /**
   * The demo owner disputes this run's escrow on-chain, then files the reason text with the API
   * (which binds it to the on-chain reasonHash). Works in either order thanks to the API's
   * pending-reason handling.
   */
  async dispute(runId: string, reasonText?: string): Promise<Run> {
    const owner = this.d.owner;
    if (!owner)
      throw new RecourseError(
        "forbidden",
        "this agent service does not hold the demo owner key; dispute from the dashboard",
      );
    const run = this.getRun(runId);
    if (run.status !== "completed" || !run.escrow_id)
      throw new RecourseError(
        "conflict",
        `run is ${run.status}; only a completed, paid run can be disputed`,
      );
    if (run.dispute) throw new RecourseError("conflict", "this run was already disputed");
    const reason = reasonText ?? SCENARIOS[run.scenario].disputeReason;
    if (!reason)
      throw new RecourseError("bad_request", "reason_text is required for this scenario");

    let tx: Hex;
    try {
      ({ txHash: tx } = await owner.chain.dispute(run.escrow_id, keccak256(toBytes(reason))));
    } catch (e) {
      if (e instanceof EscrowRevert)
        throw new RecourseError("conflict", `the contract refused the dispute: ${e.code}`, {
          reverted: e.code,
        });
      throw e;
    }
    run.tx_hashes.dispute = tx;
    const posted = await this.api<{ dispute_id?: string; status: string }>("/disputes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ escrow_id: run.escrow_id, reason_text: reason }),
    });
    run.dispute = { dispute_id: posted.dispute_id ?? null, status: posted.status };
    run.steps.push({ name: "dispute", ts: this.d.clock.now(), ok: true, tx, detail: reason });
    return run;
  }
}
