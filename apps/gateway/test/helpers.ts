import pino from "pino";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FakeEscrow } from "@recourse/chain";
import {
  ManualClock,
  MandateTypes,
  canonicalHash,
  escrowDomain,
  mandateId as computeMandateId,
  merchantsHash,
  signReceipt,
  type MandateJson,
} from "@recourse/shared";
import { openDatabase } from "../src/db/client.js";
import { LogRepository } from "../src/db/repositories/log.js";
import type { GatewayDeps } from "../src/deps.js";
import { escrowAnchor } from "../src/log/anchor.js";
import { Batcher } from "../src/log/batcher.js";
import { EvidenceLog } from "../src/log/evidence-log.js";
import { buildServer } from "../src/server.js";

// Anvil dev keys: local and test use only.
export const owner = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
export const agent = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
export const merchant = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);
export const gateway = privateKeyToAccount(
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
);
export const arbiter = privateKeyToAccount(
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
);

export const CHAIN_ID = 31337;
export const T0 = 1_767_200_000;
export const WINDOW = 120;
export const PRICE = 10_000n;

export const lc = (a: string) => a.toLowerCase();

export type MerchantBehaviour = "honest" | "timeout" | "http_error" | "huge" | "redirect";

export interface Harness {
  deps: GatewayDeps;
  app: ReturnType<typeof buildServer>;
  clock: ManualClock;
  fake: FakeEscrow;
  mandateId: Hex;
  repo: LogRepository;
  merchantCalls: Array<{
    url: string;
    headers: Record<string, string>;
    method: string;
    redirect?: string;
  }>;
  setBehaviour(b: MerchantBehaviour): void;
  lines: string[];
}

export const BODY = JSON.stringify({
  city: "Mumbai",
  temp_c: 31,
  humidity: 68,
  observed_at: T0,
  summary: "Humid",
});

export async function makeHarness(
  opts: {
    devRoutes?: boolean;
    maxEntries?: number;
    merchants?: Record<string, string>;
    realFetch?: boolean;
    corsOrigins?: string[];
  } = {},
): Promise<Harness> {
  const clock = new ManualClock(T0);
  const db = openDatabase(":memory:");
  const repo = new LogRepository(db);

  const fake = new FakeEscrow(
    CHAIN_ID,
    { admin: owner.address, arbiter: arbiter.address, gateway: gateway.address },
    WINDOW,
    clock,
  );
  fake.mint(owner.address, 100_000_000n);

  const m: MandateJson = {
    owner: lc(owner.address),
    agent: lc(agent.address),
    token: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
    maxPricePerCall: "50000",
    totalBudget: "2000000",
    expiresAt: T0 + 86_400,
    nonce: "1",
    merchantsHash: merchantsHash([merchant.address]),
    termsHash: canonicalHash({ version: 1 }),
  };
  const signature = await owner.signTypedData({
    domain: escrowDomain(CHAIN_ID, fake.address),
    types: MandateTypes,
    primaryType: "Mandate",
    message: {
      owner: owner.address,
      agent: agent.address,
      token: m.token as Address,
      maxPricePerCall: 50000n,
      totalBudget: 2000000n,
      expiresAt: BigInt(m.expiresAt),
      nonce: 1n,
      merchantsHash: m.merchantsHash as Hex,
      termsHash: m.termsHash as Hex,
    },
  });
  await fake.as(agent.address).registerMandate(m, [merchant.address], signature);
  const mandateId = computeMandateId(CHAIN_ID, fake.address, m);

  const merchantCalls: Harness["merchantCalls"] = [];
  let behaviour: MerchantBehaviour = "honest";

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    merchantCalls.push({ url, headers, method: init?.method ?? "GET", redirect: init?.redirect });
    const requestId = headers["x-recourse-request-id"] as Hex;

    if (behaviour === "timeout") {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    }
    if (behaviour === "redirect")
      return new Response(null, { status: 302, headers: { location: "http://evil.invalid/" } });
    if (!headers["x-payment"]) {
      const requirements = {
        scheme: "recourse-escrow",
        chainId: CHAIN_ID,
        escrow: fake.address,
        token: m.token,
        merchant: lc(merchant.address),
        amount: PRICE.toString(),
        requestId,
        expiresAt: T0 + 60,
      };
      return new Response(JSON.stringify(requirements), {
        status: 402,
        headers: {
          "content-type": "application/json",
          "x-payment-required": Buffer.from(JSON.stringify(requirements)).toString("base64"),
        },
      });
    }
    if (behaviour === "http_error") return new Response("boom", { status: 500 });
    if (behaviour === "huge") return new Response(new Uint8Array(6_000_000), { status: 200 });

    const body = new TextEncoder().encode(BODY);
    const rb = {
      requestId,
      responseHash: keccak256(body),
      timestamp: clock.now(),
      merchant: lc(merchant.address),
    };
    const receipt = { ...rb, signature: await signReceipt(merchant, CHAIN_ID, rb) };
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-recourse-receipt": Buffer.from(JSON.stringify(receipt)).toString("base64"),
      },
    });
  };

  const lines: string[] = [];
  const logger = pino({ level: "warn" }, { write: (s: string) => void lines.push(s) });

  const deps: GatewayDeps = {
    repo,
    log: new EvidenceLog(repo, clock),
    batcher: new Batcher(repo, gateway, clock, {
      chainId: CHAIN_ID,
      maxEntries: opts.maxEntries ?? 16,
      maxSeconds: 30,
    }),
    anchor: escrowAnchor(fake.as(gateway.address)),
    chain: { getEscrow: (id) => fake.as(agent.address).getEscrow(id), blockNumber: async () => 7 },
    clock,
    logger,
    merchants: opts.merchants ?? { weather: "http://merchant.test:4200" },
    chainId: CHAIN_ID,
    escrow: fake.address,
    gatewayAddress: gateway.address,
    fetchImpl: opts.realFetch ? undefined : fetchImpl,
    upstreamTimeoutMs: 1000,
    maxResponseBytes: 5_000_000,
    devRoutes: opts.devRoutes ?? false,
    corsOrigins: opts.corsOrigins,
  };

  return {
    deps,
    app: buildServer(deps),
    clock,
    fake,
    mandateId,
    repo,
    merchantCalls,
    lines,
    setBehaviour: (b) => void (behaviour = b),
  };
}

export const agentHeaders = (h: Harness, extra: Record<string, string> = {}) => ({
  "x-recourse-agent": lc(agent.address),
  "x-recourse-mandate": h.mandateId,
  ...extra,
});

export const paymentHeader = (escrowId: Hex, txHash: Hex = keccak256(toHex("tx"))) =>
  Buffer.from(JSON.stringify({ escrowId, txHash })).toString("base64");

/** Run the whole two-step flow and return ids. */
export async function payAndFetch(h: Harness, path = "/proxy/weather/api/weather?city=Mumbai") {
  const first = await h.app.inject({ method: "GET", url: path, headers: agentHeaders(h) });
  const requestId = first.headers["x-recourse-request-id"] as Hex;
  const { escrowId, txHash } = await h.fake
    .as(agent.address)
    .createEscrow(h.mandateId, merchant.address, PRICE, requestId);
  const second = await h.app.inject({
    method: "GET",
    url: path,
    headers: agentHeaders(h, {
      "x-recourse-request-id": requestId,
      "x-payment": paymentHeader(escrowId, txHash),
    }),
  });
  return { first, second, requestId, escrowId };
}
