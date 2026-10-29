import pino from "pino";
import { encodeAbiParameters, keccak256, toHex, type Address, type Hex } from "viem";
import { FakeEscrow } from "@recourse/chain";
import {
  ManualClock,
  MandateTypes,
  ZERO32,
  computeVerdictCommitment,
  escrowDomain,
  isEvidenceValid,
  canonicalHash,
  type Adjudicator,
  type AdjudicationInput,
  type EvidenceBundle,
  type LogEntry,
  type Verdict,
} from "@recourse/shared";
import {
  BODY,
  BODY_HASH,
  CHAIN_ID,
  ESCROW,
  MANDATE_ID,
  REQUEST_ID,
  TOKEN,
  accounts,
  buildFixture,
  mandate,
  terms,
  T0,
  type Fixture,
} from "@recourse/shared/testkit";
import { openDatabase } from "../src/db/client.js";
import { DisputeRepository } from "../src/db/repositories/disputes.js";
import { MandateRepository } from "../src/db/repositories/mandates.js";
import type { ApiDeps } from "../src/deps.js";
import type { CompiledIntent, EvidencePort, MandateCompilerPort } from "../src/ports.js";
import { buildServer } from "../src/server.js";
import { DisputeService } from "../src/services/disputes.js";
import { MandateService } from "../src/services/mandates.js";

export {
  CHAIN_ID,
  ESCROW,
  MANDATE_ID,
  REQUEST_ID,
  TOKEN,
  accounts,
  mandate,
  terms,
  T0,
  BODY,
  BODY_HASH,
};
export const ADMIN_TOKEN = "test-admin-token-123456";
export const REASON = "the returned city does not match my request";
export const REASON_HASH: Hex = keccak256(toHex(REASON));

export const ESCROW_ID: Hex = keccak256(
  encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [MANDATE_ID, REQUEST_ID]),
);

export const lc = (a: string) => a.toLowerCase();

/** The gateway, served from a signed fixture bundle. Tamper by editing `bundle`. */
export class FakeEvidence implements EvidencePort {
  flushes = 0;
  failFlush = false;
  constructor(
    public bundle: EvidenceBundle,
    public batch: LogEntry[],
    public blobs: Record<string, Uint8Array>,
  ) {}
  async flush() {
    this.flushes++;
    if (this.failFlush) throw new Error("gateway down");
  }
  async getBundle() {
    return structuredClone(this.bundle);
  }
  async getBlob(hash: Hex) {
    return this.blobs[hash] ?? null;
  }
  async getBatchEntries() {
    return structuredClone(this.batch);
  }
}

export interface VerdictSpec {
  outcome: "REFUND" | "RELEASE" | null;
  fault: "NONE" | "AGENT" | "MERCHANT" | null;
}

/** Builds a schema-valid verdict with a correct commitment for the given input. */
export function makeVerdict(
  input: AdjudicationInput,
  v: VerdictSpec,
  over: Partial<Verdict> = {},
): Verdict {
  const roots = input.bundle.tree_heads.map((h) => h.root) as Hex[];
  const base = {
    dispute_id: input.dispute_id,
    escrow_id: input.escrow_id,
    rule_results: {
      evidence_valid: isEvidenceValid(input.evidence_report),
      within_mandate: true,
      delivered: true,
      http_status: 200,
      within_sla: true,
      receipt_present: true,
      receipt_valid: true,
      schema_valid: true,
      schema_errors: [],
      fresh_by_timestamp: true,
      entity_match: "exact" as const,
      injection_suspected: false,
      decisive: null,
    },
    claims: v.outcome ? [{ text: "cited", cites: [4] }] : [],
    models: [{ role: "judge", name: "test-model", version: "1" }],
    prompt_hash: canonicalHash("prompt"),
    settings_hash: canonicalHash({ temperature: 0, seed: 42 }),
  };
  const commitment =
    v.outcome && v.fault
      ? computeVerdictCommitment({
          ...base,
          evidence_root: roots,
          outcome: v.outcome,
          fault: v.fault,
        })
      : ZERO32;
  return {
    ...base,
    class: v.outcome === "REFUND" ? 3 : v.outcome === "RELEASE" ? 4 : null,
    class_name:
      v.outcome === "REFUND" ? "merchant_failure" : v.outcome === "RELEASE" ? "buyer_regret" : null,
    outcome: v.outcome,
    fault: v.fault,
    decided_by: "rules",
    facts: null,
    explanation: "test verdict",
    injection_detected: false,
    evidence_root: roots,
    commitment,
    ...(v.outcome === null ? { review_reason: "no_quorum" as const } : {}),
    created_at: input.now,
    ...over,
  } as Verdict;
}

export class ScriptedAdjudicator implements Adjudicator {
  calls: AdjudicationInput[] = [];
  constructor(public decide: (input: AdjudicationInput) => Promise<Verdict> | Verdict) {}
  async adjudicate(input: AdjudicationInput) {
    this.calls.push(input);
    return this.decide(input);
  }
}

export class FakeCompiler implements MandateCompilerPort {
  calls: string[] = [];
  constructor(public result: () => unknown) {}
  async compile(text: string) {
    this.calls.push(text);
    return this.result() as CompiledIntent;
  }
}

export interface World {
  app: Awaited<ReturnType<typeof buildServer>>;
  deps: ApiDeps;
  service: DisputeService;
  fake: FakeEscrow;
  /** arbiter-signed view, as the API sees the chain */
  chain: ReturnType<FakeEscrow["as"]>;
  clock: ManualClock;
  evidence: FakeEvidence;
  adjudicator: ScriptedAdjudicator;
  compiler: FakeCompiler;
  fx: Fixture;
  mandateRepo: MandateRepository;
  disputeRepo: DisputeRepository;
  /** Run everything the service scheduled (reason-wait timers, post-reason kicks). */
  runScheduled(): Promise<void>;
  scheduled: Array<{ fn: () => void; ms: number }>;
  /** Sign and store the fixture mandate in the API (POST /mandates). */
  storeMandate(): Promise<void>;
  /** Register on the fake chain, pay for REQUEST_ID, open a dispute. Returns the escrow id. */
  payAndDispute(opts?: { reason?: string }): Promise<Hex>;
  json(res: { body: string }): any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function makeWorld(
  o: {
    decide?: (input: AdjudicationInput) => Promise<Verdict> | Verdict;
    adminToken?: string | null;
    timeoutSeconds?: number;
    rateLimit?: number;
    reasonWaitSeconds?: number;
  } = {},
): Promise<World> {
  const clock = new ManualClock(T0);
  const fake = new FakeEscrow(
    CHAIN_ID,
    {
      admin: accounts.owner.address,
      arbiter: accounts.arbiter.address,
      gateway: accounts.gateway.address,
    },
    120,
    clock,
  );
  fake.mint(accounts.owner.address, 100_000_000n);
  const chain = fake.as(accounts.arbiter.address);

  const db = openDatabase(":memory:");
  const mandateRepo = new MandateRepository(db);
  const disputeRepo = new DisputeRepository(db);
  const fx = await buildFixture({ escrowId: ESCROW_ID });
  const evidence = new FakeEvidence(fx.bundle, fx.batch, { [BODY_HASH]: BODY_BYTES });
  const adjudicator = new ScriptedAdjudicator(
    o.decide ?? ((input) => makeVerdict(input, { outcome: "REFUND", fault: "MERCHANT" })),
  );
  const compiler = new FakeCompiler(() => ({
    category: "weather_data_api",
    maxPricePerCall: "0.05",
    totalBudget: "2.00",
    expiresAt: T0 + 86_400,
    merchants: [],
    questions: [
      { id: "inclusive_fees", text: "Is the budget inclusive of gas?", options: ["yes", "no"] },
    ],
  }));

  const logger = pino({ level: "silent" });
  const scheduled: World["scheduled"] = [];
  let seq = 0;
  const service = new DisputeService({
    disputes: disputeRepo,
    mandates: mandateRepo,
    chain,
    evidence,
    adjudicator,
    clock,
    logger,
    reasonWaitSeconds: o.reasonWaitSeconds ?? 3,
    adjudicationTimeoutSeconds: o.timeoutSeconds ?? 30,
    schedule: (fn, ms) => void scheduled.push({ fn, ms }),
    newId: () => `dispute-${++seq}`,
  });
  const mandates = new MandateService({
    repo: mandateRepo,
    chain,
    compiler,
    clock,
    chainId: CHAIN_ID,
    escrow: ESCROW,
    token: TOKEN,
    tokenDecimals: 6,
    tokenSymbol: "USDC",
    nonce: () => 7n,
  });

  const deps: ApiDeps = {
    mandates,
    disputeService: service,
    disputes: disputeRepo,
    chain,
    clock,
    logger,
    adminToken: o.adminToken === null ? undefined : (o.adminToken ?? ADMIN_TOKEN),
    corsOrigins: ["http://localhost:5173"],
    rateLimitPerMinute: o.rateLimit ?? 10_000,
  };
  const app = await buildServer(deps);
  chain.watchDisputed((ev) => void service.onDisputed(ev));

  const world: World = {
    app,
    deps,
    service,
    fake,
    chain,
    clock,
    evidence,
    adjudicator,
    compiler,
    fx,
    mandateRepo,
    disputeRepo,
    scheduled,
    async runScheduled() {
      while (scheduled.length > 0) await scheduled.shift()!.fn();
      // fire-and-forget processing started by the callbacks: let microtasks and timers settle
      await new Promise((r) => setTimeout(r, 25));
    },
    async storeMandate() {
      const signature = await accounts.owner.signTypedData({
        domain: escrowDomain(CHAIN_ID, ESCROW),
        types: MandateTypes,
        primaryType: "Mandate",
        message: {
          owner: accounts.owner.address,
          agent: accounts.agent.address,
          token: TOKEN,
          maxPricePerCall: BigInt(mandate.maxPricePerCall),
          totalBudget: BigInt(mandate.totalBudget),
          expiresAt: BigInt(mandate.expiresAt),
          nonce: BigInt(mandate.nonce),
          merchantsHash: mandate.merchantsHash as Hex,
          termsHash: mandate.termsHash as Hex,
        },
      });
      const res = await app.inject({
        method: "POST",
        url: "/mandates",
        payload: {
          mandate,
          terms,
          merchants: [lc(accounts.merchant.address)],
          signature,
          summary: "summary text",
        },
      });
      if (res.statusCode >= 300) throw new Error(`storeMandate failed: ${res.body}`);
      // register on the fake chain too so on-chain checks (termsHash) pass
      await fake
        .as(accounts.agent.address)
        .registerMandate(mandate, [accounts.merchant.address], signature);
    },
    async payAndDispute(opts = {}) {
      const { escrowId } = await fake
        .as(accounts.agent.address)
        .createEscrow(MANDATE_ID, accounts.merchant.address, 10_000n, REQUEST_ID);
      clock.advance(20);
      await fake
        .as(accounts.owner.address)
        .dispute(escrowId, keccak256(toHex(opts.reason ?? REASON)));
      await new Promise((r) => setTimeout(r, 5)); // the watcher callback indexes the dispute asynchronously
      return escrowId;
    },
    json: (res) => JSON.parse(res.body),
  };
  return world;
}

export const BODY_BYTES = BODY;
export type { Address };
