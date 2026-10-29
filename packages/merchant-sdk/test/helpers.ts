import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
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
  type MandateJson,
} from "@recourse/shared";
import { protect, type ProtectOptions } from "../src/index.js";

// Anvil dev keys: local and test use only.
export const KEYS = {
  owner: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  agent: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  merchant: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  merchant2: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  gateway: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  arbiter: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
} as const;
export const owner = privateKeyToAccount(KEYS.owner);
export const agent = privateKeyToAccount(KEYS.agent);
export const merchant = privateKeyToAccount(KEYS.merchant);
export const merchant2 = privateKeyToAccount(KEYS.merchant2);
export const gateway = privateKeyToAccount(KEYS.gateway);
export const arbiter = privateKeyToAccount(KEYS.arbiter);

export const CHAIN_ID = 31337;
export const T0 = 1_767_200_000;
export const TOKEN: Address = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
export const PRICE_UNITS = 10_000n; // "0.01" USDC
export const lc = (a: string) => a.toLowerCase();

export interface World {
  fake: FakeEscrow;
  clock: ManualClock;
  mandateId: Hex;
  base: string;
  hits: { count: number };
  close(): Promise<void>;
  /** Create an escrow as the agent for `requestId` paying `to` (default: our merchant). */
  pay(
    requestId: Hex,
    opts?: { to?: Address; amount?: bigint },
  ): Promise<{ escrowId: Hex; txHash: Hex }>;
}

export const paymentHeader = (escrowId: Hex, txHash: Hex = keccak256(toHex("tx"))) =>
  Buffer.from(JSON.stringify({ escrowId, txHash })).toString("base64");

async function registerMandate(
  fake: FakeEscrow,
  token: Address,
  nonce: bigint,
  merchants: Address[],
): Promise<Hex> {
  const sorted = [...merchants].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  const m: MandateJson = {
    owner: lc(owner.address),
    agent: lc(agent.address),
    token: token,
    maxPricePerCall: "5000000",
    totalBudget: "50000000",
    expiresAt: T0 + 86_400,
    nonce: nonce.toString(),
    merchantsHash: merchantsHash(sorted),
    termsHash: canonicalHash({ version: 1 }),
  };
  const signature = await owner.signTypedData({
    domain: escrowDomain(CHAIN_ID, fake.address),
    types: MandateTypes,
    primaryType: "Mandate",
    message: {
      owner: owner.address,
      agent: agent.address,
      token,
      maxPricePerCall: BigInt(m.maxPricePerCall),
      totalBudget: BigInt(m.totalBudget),
      expiresAt: BigInt(m.expiresAt),
      nonce,
      merchantsHash: m.merchantsHash as Hex,
      termsHash: m.termsHash as Hex,
    },
  });
  await fake.as(agent.address).registerMandate(m, sorted, signature);
  return computeMandateId(CHAIN_ID, fake.address, m);
}

/**
 * Starts an express app on an ephemeral port with `GET /api/weather` behind `protect`.
 * `routes` can add more routes (after `protect`) to exercise body-writing styles.
 */
export async function startWorld(
  opts: Partial<ProtectOptions> = {},
  routes?: (app: Express, protectMw: ReturnType<typeof protect>) => void,
): Promise<World> {
  const clock = new ManualClock(T0);
  const fake = new FakeEscrow(
    CHAIN_ID,
    { admin: owner.address, arbiter: arbiter.address, gateway: gateway.address },
    120,
    clock,
  );
  fake.mint(owner.address, 1_000_000_000n);
  const mandateId = await registerMandate(fake, TOKEN, 1n, [merchant.address, merchant2.address]);
  const otherTokenMandate = await registerMandate(
    fake,
    "0x000000000000000000000000000000000000dead",
    2n,
    [merchant.address],
  );
  void otherTokenMandate;

  const mw = protect({
    merchantPrivateKey: KEYS.merchant,
    chainId: CHAIN_ID,
    escrow: fake.address,
    token: TOKEN,
    price: "0.01",
    escrowClient: fake.as(agent.address),
    clock,
    ...opts,
  });

  const hits = { count: 0 };
  const app = express();
  app.get("/api/weather", mw, (_req, res) => {
    hits.count++;
    res.json({ city: "Mumbai", temp_c: 31, observed_at: T0 });
  });
  routes?.(app, mw);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    fake,
    clock,
    mandateId,
    base,
    hits,
    close: () => new Promise((r) => server.close(() => r())),
    pay: (requestId, o = {}) =>
      fake
        .as(agent.address)
        .createEscrow(mandateId, o.to ?? merchant.address, o.amount ?? PRICE_UNITS, requestId),
  };
}

export const rid = (s: string): Hex => keccak256(toHex(s));
