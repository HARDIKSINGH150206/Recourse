// pnpm demo: runs the docs/05 golden path headlessly against the running stack (pnpm dev) and
// prints PASS / PENDING / FAIL per scene. PENDING = the AI lane's adjudicator is not installed yet.
//   pnpm demo [--strict] [--skip-release]
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address, Hex } from "viem";
import { createTestClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createEscrowClient } from "@recourse/chain";
import {
  MandateTypes,
  canonicalHash,
  escrowDomain,
  loadConfig,
  mandateId as computeMandateId,
  merchantsHash,
  requireAddress,
  requireKey,
  verifyUntrustedBundle,
  isEvidenceValid,
  type EvidenceBundle,
  type LogEntry,
  type MandateJson,
} from "@recourse/shared";
import { parseEnv } from "./lib/env.js";
import {
  TERMINAL,
  expectedReputationDelta,
  judgeDispute,
  overall,
  type DisputeView,
  type SceneResult,
} from "./lib/demo-checks.js";

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
if (!existsSync(envPath)) {
  console.error("no .env: run `pnpm env:local` (local chain) first");
  process.exit(2);
}
const cfg = loadConfig({ ...parseEnv(readFileSync(envPath, "utf8")), ...process.env });
const demo = JSON.parse(readFileSync(join(root, "config/demo.json"), "utf8")) as {
  pricePerCall: string;
  maxPricePerCall: string;
  totalBudget: string;
  mandateTtlSeconds: number;
  freshnessSeconds: number;
  slaMs: number;
  category: string;
};
const owner = privateKeyToAccount(requireKey(cfg, "OWNER_PRIVATE_KEY"));
const agent = privateKeyToAccount(requireKey(cfg, "AGENT_PRIVATE_KEY"));
const merchant = privateKeyToAccount(requireKey(cfg, "MERCHANT_PRIVATE_KEY"));
const escrow = requireAddress(cfg, "ESCROW_ADDRESS");
const token = requireAddress(cfg, "TOKEN_ADDRESS");
const ownerChain = createEscrowClient({
  chainId: cfg.CHAIN_ID,
  rpcUrl: cfg.RPC_URL,
  escrow,
  account: owner,
});

const GW = cfg.GATEWAY_URL,
  API = cfg.API_URL,
  AGENT = `http://localhost:${cfg.AGENT_PORT}`,
  MERCHANT = cfg.MERCHANT_URL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const units = (d: string) => BigInt(Math.round(Number(d) * 1_000_000));

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}
async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${text}`);
  return JSON.parse(text) as T;
}
async function until<T>(
  fn: () => Promise<T>,
  done: (v: T) => boolean,
  timeoutMs: number,
  everyMs = 500,
): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (done(v) || Date.now() > end) return v;
    await sleep(everyMs);
  }
}

interface Run {
  run_id: string;
  status: string;
  request_id: Hex;
  escrow_id: Hex | null;
  mandate_id: Hex;
  reverted: string | null;
  error: string | null;
  steps: Array<{ name: string; ok: boolean }>;
  response: { status: number; body: string } | null;
}
const startRun = async (id: string) => {
  const { run_id } = await post<{ run_id: string }>(`${AGENT}/scenarios/${id}/run`);
  return until(
    () => get<Run>(`${AGENT}/runs/${run_id}`),
    (r) => r.status !== "running",
    90_000,
    300,
  );
};

const rows: Array<{ scene: string; result: SceneResult; detail: string }> = [];
const record = (scene: string, result: SceneResult, detail: string) => {
  rows.push({ scene, result, detail });
  console.log(
    `${result === "PASS" ? "PASS   " : result === "PENDING" ? "PENDING" : "FAIL   "} ${scene}: ${detail}`,
  );
};
async function scene(name: string, fn: () => Promise<{ result: SceneResult; detail: string }>) {
  try {
    const r = await fn();
    record(name, r.result, r.detail);
  } catch (e) {
    record(name, "FAIL", (e as Error).message);
  }
}

// ---- pre-flight
console.log(`Recourse golden path on chain ${cfg.CHAIN_ID} (escrow ${escrow})\n`);
for (const [name, url] of [
  ["gateway", `${GW}/health`],
  ["api", `${API}/health`],
  ["demo-merchant", `${MERCHANT}/health`],
  ["demo-agent", `${AGENT}/health`],
] as const) {
  try {
    await get(url);
  } catch (e) {
    console.error(
      `${name} is not reachable at ${url}: ${(e as Error).message}\nStart the stack with \`pnpm dev\` (and \`pnpm chain:up\`, \`pnpm chain:deploy\`, \`pnpm seed\` first).`,
    );
    process.exit(2);
  }
}
if (!(await get<{ can_dispute: boolean }>(`${AGENT}/health`)).can_dispute) {
  console.error(
    "the demo agent does not hold the demo owner key, so it cannot file disputes; set OWNER_PRIVATE_KEY",
  );
  process.exit(2);
}

const merchantRep0 = await get<{ as_merchant: { disputes: number; faults: number } }>(
  `${API}/reputation/${merchant.address}`,
);

// ---- scene 0: mandate
let mandateId: Hex = "0x";
await scene("0 mandate", async () => {
  const existing = await get<{ mandates: Array<{ mandate_id: Hex; mandate: MandateJson }> }>(
    `${API}/mandates?owner=${owner.address}&limit=20`,
  );
  const now = Math.floor(Date.now() / 1000);
  for (const m of existing.mandates) {
    if (m.mandate.agent !== agent.address.toLowerCase() || m.mandate.expiresAt <= now + 600)
      continue;
    const full = await get<{ registered_onchain: boolean }>(`${API}/mandates/${m.mandate_id}`);
    if (full.registered_onchain) {
      mandateId = m.mandate_id;
      return {
        result: "PASS",
        detail: `reusing registered mandate ${m.mandate_id.slice(0, 12)}...`,
      };
    }
  }
  const terms = {
    version: 1,
    category: demo.category,
    defaults: {
      freshness_seconds: demo.freshnessSeconds,
      schema_required: true,
      substitutions: "not_allowed",
      sla_ms: demo.slaMs,
    },
    discretion: ["vendor_choice"],
  };
  const mandate: MandateJson = {
    owner: owner.address.toLowerCase(),
    agent: agent.address.toLowerCase(),
    token: token.toLowerCase(),
    maxPricePerCall: units(demo.maxPricePerCall).toString(),
    totalBudget: units(demo.totalBudget).toString(),
    expiresAt: now + demo.mandateTtlSeconds,
    nonce: BigInt(Date.now()).toString(),
    merchantsHash: merchantsHash([merchant.address]),
    termsHash: canonicalHash(terms),
  };
  const signature = await owner.signTypedData({
    domain: escrowDomain(cfg.CHAIN_ID, escrow),
    types: MandateTypes,
    primaryType: "Mandate",
    message: {
      owner: owner.address,
      agent: agent.address,
      token,
      maxPricePerCall: BigInt(mandate.maxPricePerCall),
      totalBudget: BigInt(mandate.totalBudget),
      expiresAt: BigInt(mandate.expiresAt),
      nonce: BigInt(mandate.nonce),
      merchantsHash: mandate.merchantsHash as Hex,
      termsHash: mandate.termsHash as Hex,
    },
  });
  await post(`${API}/mandates`, {
    mandate,
    terms,
    merchants: [merchant.address.toLowerCase()],
    signature,
    summary: `Demo mandate: up to ${demo.maxPricePerCall} per call, ${demo.totalBudget} total (created by pnpm demo)`,
  });
  await ownerChain.registerMandate(mandate, [merchant.address as Address], signature);
  mandateId = computeMandateId(cfg.CHAIN_ID, escrow, mandate);
  const check = await get<{ registered_onchain: boolean }>(`${API}/mandates/${mandateId}`);
  return check.registered_onchain
    ? { result: "PASS", detail: `registered ${mandateId.slice(0, 12)}...` }
    : { result: "FAIL", detail: "mandate not registered on-chain" };
});
if (mandateId === "0x") {
  console.error("\nno mandate; cannot continue");
  process.exit(1);
}

// ---- scene 1: happy path and prevention
let happy: Run | undefined;
await scene("1a happy path", async () => {
  happy = await startRun("happy");
  const receipt = happy.steps.find((s) => s.name === "receipt");
  if (happy.status !== "completed" || happy.response?.status !== 200 || !receipt?.ok) {
    return {
      result: "FAIL",
      detail: `status ${happy.status}${happy.error ? `: ${happy.error}` : ""}`,
    };
  }
  const e = await ownerChain.getEscrow(happy.escrow_id!);
  return e.state === "Held"
    ? { result: "PASS", detail: "402 -> escrow Held -> data + merchant receipt" }
    : { result: "FAIL", detail: `escrow is ${e.state}` };
});
await scene("1b over-cap blocked", async () => {
  const r = await startRun("over_cap");
  return r.status === "blocked" && r.reverted === "ExceedsMaxPrice"
    ? { result: "PASS", detail: "contract reverted ExceedsMaxPrice" }
    : { result: "FAIL", detail: `status ${r.status}, reverted ${r.reverted}` };
});

// ---- scenes 2 to 5: disputes
const resolvedOnChain: Array<{
  outcome: "REFUND" | "RELEASE";
  fault: "NONE" | "AGENT" | "MERCHANT";
}> = [];
let bundleRun: Run | undefined;
const disputed: Array<[string, string]> = [
  ["2 hard failure (rules)", "wrong_schema"],
  ["3 semantic failure (AI)", "stale_in_text"],
  ["4 injection", "injection"],
  ["5 buyer regret", "regret"],
];
for (const [name, scenario] of disputed) {
  await scene(name, async () => {
    const run = await startRun(scenario);
    if (run.status !== "completed" || !run.escrow_id)
      return { result: "FAIL", detail: `run ${run.status}: ${run.error}` };
    bundleRun ??= run;
    await post(`${AGENT}/runs/${run.run_id}/dispute`, {});
    const find = async () =>
      (
        await get<{ disputes: Array<DisputeView & { escrow_id: Hex }> }>(
          `${API}/disputes?mandateId=${run.mandate_id}&limit=100`,
        )
      ).disputes.find((d) => d.escrow_id === run.escrow_id);
    const d = await until(find, (v) => v !== undefined && TERMINAL.has(v.status), 90_000, 700);
    if (!d) return { result: "FAIL", detail: "the API never indexed the dispute" };
    const verdict = judgeDispute(scenario, d);
    if (verdict.result === "PASS" && d.verdict?.outcome && d.verdict.fault) {
      const state = (await ownerChain.getEscrow(run.escrow_id)).state;
      const want = d.verdict.outcome === "REFUND" ? "Refunded" : "Released";
      if (state !== want)
        return { result: "FAIL", detail: `verdict ${d.verdict.outcome} but escrow is ${state}` };
      resolvedOnChain.push({ outcome: d.verdict.outcome, fault: d.verdict.fault });
    }
    return verdict;
  });
}

// ---- scene 6: tamper test (what the browser verify page does)
await scene("6 tamper test", async () => {
  if (!bundleRun) return { result: "FAIL", detail: "no disputed run to verify" };
  await post(`${GW}/log/flush`);
  const bundle = await get<EvidenceBundle>(`${GW}/evidence/${bundleRun.request_id}`);
  const batchIndex = bundle.tree_heads[0]!.batch_index;
  const exported = await get<{ entries: LogEntry[] }>(`${GW}/log/batches/${batchIndex}`);
  const opts = { batchEntries: exported.entries };
  const clean = await verifyUntrustedBundle(bundle, opts);
  if (!isEvidenceValid(clean) || clean.chain_ok !== true)
    return { result: "FAIL", detail: `clean evidence did not verify: ${clean.errors.join("; ")}` };

  const forged = structuredClone(bundle);
  const target = forged.entries.find((e) => e.entry.type === "response")!;
  target.entry.ts += 1; // edit one byte-equivalent of one entry
  const forgedBatch = structuredClone(exported.entries);
  forgedBatch.find((e) => e.seq === target.entry.seq)!.ts += 1;
  const dirty = await verifyUntrustedBundle(forged, { batchEntries: forgedBatch });
  if (isEvidenceValid(dirty) || dirty.entry_hash_ok || dirty.chain_ok !== false) {
    return { result: "FAIL", detail: "an edited entry was NOT detected" };
  }
  return {
    result: "PASS",
    detail: "clean evidence verifies; one edited entry turns entry_hash and chain red",
  };
});

// ---- scene 7: reputation counters
await scene("7 reputation", async () => {
  const now = await get<{ as_merchant: { disputes: number; faults: number } }>(
    `${API}/reputation/${merchant.address}`,
  );
  const want = expectedReputationDelta(resolvedOnChain);
  const got = {
    disputes: now.as_merchant.disputes - merchantRep0.as_merchant.disputes,
    merchantFaults: now.as_merchant.faults - merchantRep0.as_merchant.faults,
  };
  if (got.disputes === want.disputes && got.merchantFaults === want.merchantFaults) {
    return resolvedOnChain.length === 0
      ? { result: "PENDING", detail: "no dispute resolved on-chain yet, nothing to compare" }
      : {
          result: "PASS",
          detail: `merchant +${got.disputes} disputes, +${got.merchantFaults} faults, as the verdicts say`,
        };
  }
  return {
    result: "FAIL",
    detail: `counters moved by ${JSON.stringify(got)}, expected ${JSON.stringify({ disputes: want.disputes, merchantFaults: want.merchantFaults })}`,
  };
});

// ---- finally: the happy-path escrow is released to the merchant after the dispute window
if (!args.has("--skip-release") && happy?.escrow_id) {
  await scene("1c merchant paid after the window", async () => {
    const e = await ownerChain.getEscrow(happy!.escrow_id!);
    const waitMs = Math.max(0, (e.windowEnds + 2) * 1000 - Date.now());
    if (waitMs > 0) {
      console.log(`      waiting ${Math.ceil(waitMs / 1000)}s for the dispute window to close...`);
      await sleep(waitMs);
    }
    if (cfg.CHAIN_ID === 31337) {
      // anvil only mines on demand and simulates against the last block's timestamp, which is still
      // inside the window: mine one block so the contract sees the current time
      await createTestClient({ mode: "anvil", transport: http(cfg.RPC_URL) }).mine({ blocks: 1 });
    }
    await ownerChain.release(happy!.escrow_id!);
    const after = await ownerChain.getEscrow(happy!.escrow_id!);
    return after.state === "Released"
      ? { result: "PASS", detail: "released to the merchant" }
      : { result: "FAIL", detail: `escrow is ${after.state}` };
  });
}

const counts = { PASS: 0, PENDING: 0, FAIL: 0 };
for (const r of rows) counts[r.result]++;
console.log(
  `\n${counts.PASS} passed, ${counts.PENDING} pending (AI lane), ${counts.FAIL} failed${strict ? " (strict: pending counts as failure)" : ""}`,
);
process.exit(
  overall(
    rows.map((r) => r.result),
    strict,
  ),
);
