import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import pino from "pino";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FakeEscrow } from "@recourse/chain";
import { protect } from "@recourse/merchant-sdk";
import {
  ManualClock,
  MandateTypes,
  canonicalHash,
  escrowDomain,
  mandateId as computeMandateId,
  merchantsHash,
  type MandateJson,
} from "@recourse/shared";
import { Payer } from "../src/payer.js";
import { RunStore } from "../src/runs.js";
import { DemoAgent } from "../src/service.js";
import { buildServer } from "../src/server.js";

// Anvil dev keys: local and test use only.
const K = {
  owner: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  agent: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  merchant: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  gateway: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  arbiter: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
} as const;
export const owner = privateKeyToAccount(K.owner);
export const agentAcct = privateKeyToAccount(K.agent);
export const merchant = privateKeyToAccount(K.merchant);
const gatewayAcct = privateKeyToAccount(K.gateway);
const arbiter = privateKeyToAccount(K.arbiter);

export const T0 = 1_767_200_000;
export const TOKEN: Address = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
export const lc = (a: string) => a.toLowerCase();

const listen = (app: express.Express) =>
  new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
const urlOf = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

export interface Harness {
  agent: DemoAgent;
  fake: FakeEscrow;
  clock: ManualClock;
  mandateId: Hex;
  /** Ordered log of what reached the fake gateway ("quote", "decision", "paid") and API posts. */
  gwLog: string[];
  apiPosts: Array<{ path: string; body: unknown }>;
  mandateList: { value: unknown[] };
  registered: Set<string>;
  http: Awaited<ReturnType<typeof buildServer>>;
  close(): Promise<void>;
}

export async function makeHarness(
  o: {
    owner?: boolean;
    merchantEscrow?: Address;
    gatewayDown?: boolean;
    fixedMandate?: boolean;
    storeMax?: number;
  } = {},
): Promise<Harness> {
  const clock = new ManualClock(T0);
  const fake = new FakeEscrow(
    31337,
    { admin: owner.address, arbiter: arbiter.address, gateway: gatewayAcct.address },
    120,
    clock,
  );
  fake.mint(owner.address, 1_000_000_000n);

  const m: MandateJson = {
    owner: lc(owner.address),
    agent: lc(agentAcct.address),
    token: TOKEN,
    maxPricePerCall: "50000",
    totalBudget: "2000000",
    expiresAt: T0 + 86_400,
    nonce: "1",
    merchantsHash: merchantsHash([merchant.address]),
    termsHash: canonicalHash({ version: 1 }),
  };
  const signature = await owner.signTypedData({
    domain: escrowDomain(31337, fake.address),
    types: MandateTypes,
    primaryType: "Mandate",
    message: {
      owner: owner.address,
      agent: agentAcct.address,
      token: TOKEN,
      maxPricePerCall: 50000n,
      totalBudget: 2000000n,
      expiresAt: BigInt(m.expiresAt),
      nonce: 1n,
      merchantsHash: m.merchantsHash as Hex,
      termsHash: m.termsHash as Hex,
    },
  });
  await fake.as(agentAcct.address).registerMandate(m, [merchant.address], signature);
  const mandateId = computeMandateId(31337, fake.address, m);

  // ---- merchant (real SDK) behind a fake gateway
  const gwLog: string[] = [];
  let seq = 0;
  const merchantApp = express();
  merchantApp.get(
    "/api/weather",
    protect({
      merchantPrivateKey: K.merchant,
      chainId: 31337,
      escrow: o.merchantEscrow ?? fake.address,
      token: TOKEN,
      price: "0.01",
      escrowClient: fake.as(agentAcct.address),
      clock,
    }),
    (req, res) => {
      if (req.header("x-demo-mode") === "wrong_schema") res.json({ temp: "hot" });
      else
        res.json({
          city: req.query.city,
          temp_c: 31,
          humidity: 68,
          observed_at: T0,
          summary: "ok",
        });
    },
  );
  const merchantServer = await listen(merchantApp);

  const gw = express();
  gw.use(express.json());
  gw.post("/log/decision", (req, res) => {
    gwLog.push("decision");
    res.json({ seq: ++seq, echoed: req.body.kind });
  });
  gw.get("/proxy/weather/*splat", async (req, res) => {
    const paid = req.header("x-payment") !== undefined;
    gwLog.push(paid ? "paid" : "quote");
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers))
      if (
        typeof v === "string" &&
        !["host", "connection", "x-recourse-agent", "x-recourse-mandate"].includes(k)
      )
        headers[k] = v;
    const up = await fetch(
      `${urlOf(merchantServer)}/api/weather?${new URLSearchParams(req.query as Record<string, string>)}`,
      { headers },
    );
    res.status(up.status).set("x-recourse-seq", String(++seq));
    for (const h of ["x-payment-required", "x-recourse-receipt", "content-type"])
      if (up.headers.get(h)) res.set(h, up.headers.get(h)!);
    res.send(Buffer.from(await up.arrayBuffer()));
  });
  const gwServer = await listen(gw);

  // ---- fake API
  const apiPosts: Harness["apiPosts"] = [];
  const mandateList: Harness["mandateList"] = {
    value: [{ mandate_id: mandateId, mandate: m, registered_onchain: false }],
  };
  const registered = new Set<string>([mandateId]);
  const api = express();
  api.use(express.json());
  api.get("/mandates", (_req, res) => void res.json({ mandates: mandateList.value }));
  api.get(
    "/mandates/:id",
    (req, res) => void res.json({ registered_onchain: registered.has(req.params.id) }),
  );
  api.post("/disputes", (req, res) => {
    apiPosts.push({ path: "/disputes", body: req.body });
    res.status(202).json({ dispute_id: "d-1", status: "opened" });
  });
  const apiServer = await listen(api);

  const store = new RunStore(o.storeMax);
  let n = 0;
  const agent = new DemoAgent({
    ctx: {
      gatewayUrl: urlOf(gwServer),
      merchantId: "weather",
      city: "Mumbai",
      chainId: 31337,
      escrow: fake.address,
      token: TOKEN,
      agentAddress: agentAcct.address,
      overCapAmount: "0.50",
      tokenDecimals: 6,
      payer: new Payer(fake.as(agentAcct.address)),
      clock,
      fetchImpl: o.gatewayDown
        ? async () => {
            throw new Error("connect ECONNREFUSED");
          }
        : undefined,
    },
    apiUrl: urlOf(apiServer),
    clock,
    owner:
      o.owner === false ? undefined : { address: owner.address, chain: fake.as(owner.address) },
    mandateId: o.fixedMandate ? mandateId : undefined,
    newId: () => `run-${++n}`,
    store,
  });
  const http = await buildServer(agent, pino({ level: "silent" }), ["http://localhost:5173"]);

  return {
    agent,
    fake,
    clock,
    mandateId,
    gwLog,
    apiPosts,
    mandateList,
    registered,
    http,
    close: async () => {
      await http.close();
      await Promise.all(
        [merchantServer, gwServer, apiServer].map(
          (s) => new Promise<void>((r) => s.close(() => r())),
        ),
      );
    },
  };
}

export const rid = (s: string): Hex => keccak256(toHex(s));
