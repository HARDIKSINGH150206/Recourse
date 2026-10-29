import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FakeEscrow } from "@recourse/chain";
import { decodeReceiptHeader, verifyReceipt } from "@recourse/merchant-sdk";
import {
  ManualClock,
  MandateTypes,
  WeatherResponseSchema,
  canonicalHash,
  escrowDomain,
  mandateId as computeMandateId,
  merchantsHash,
  type MandateJson,
} from "@recourse/shared";
import { createMerchant, type MerchantApp } from "../src/app.js";
import type { Mode } from "../src/modes/bodies.js";

const K = {
  owner: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  agent: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  merchant: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  gateway: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  arbiter: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
} as const;
const owner = privateKeyToAccount(K.owner),
  agent = privateKeyToAccount(K.agent),
  merchant = privateKeyToAccount(K.merchant);
const gateway = privateKeyToAccount(K.gateway),
  arbiter = privateKeyToAccount(K.arbiter);
const T0 = 1_767_200_000;
const TOKEN: Address = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as any;

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

async function start(over: { timeoutDelayMs?: number; slaMs?: number } = {}) {
  const clock = new ManualClock(T0);
  const fake = new FakeEscrow(
    31337,
    { admin: owner.address, arbiter: arbiter.address, gateway: gateway.address },
    120,
    clock,
  );
  fake.mint(owner.address, 1_000_000_000n);
  const m: MandateJson = {
    owner: owner.address.toLowerCase(),
    agent: agent.address.toLowerCase(),
    token: TOKEN,
    maxPricePerCall: "5000000",
    totalBudget: "50000000",
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
      agent: agent.address,
      token: TOKEN,
      maxPricePerCall: 5000000n,
      totalBudget: 50000000n,
      expiresAt: BigInt(m.expiresAt),
      nonce: 1n,
      merchantsHash: m.merchantsHash as Hex,
      termsHash: m.termsHash as Hex,
    },
  });
  await fake.as(agent.address).registerMandate(m, [merchant.address], signature);
  const mandateId = computeMandateId(31337, fake.address, m);

  const merchantApp: MerchantApp = createMerchant({
    protect: {
      merchantPrivateKey: K.merchant,
      chainId: 31337,
      escrow: fake.address,
      token: TOKEN,
      price: "0.01",
      escrowClient: fake.as(agent.address),
      clock,
    },
    clock,
    ...over,
  });
  server = await new Promise<Server>((resolve) => {
    const s = merchantApp.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let n = 0;
  /** Quote, pay and retry with the given mode; returns the paid response. */
  async function buy(mode?: Mode, city = "Mumbai") {
    const requestId = keccak256(toHex(`req-${++n}`));
    const { escrowId } = await fake
      .as(agent.address)
      .createEscrow(mandateId, merchant.address, 10_000n, requestId);
    const headers: Record<string, string> = {
      "x-recourse-request-id": requestId,
      "x-payment": Buffer.from(
        JSON.stringify({ escrowId, txHash: keccak256(toHex("t")) }),
      ).toString("base64"),
    };
    if (mode) headers["x-demo-mode"] = mode;
    const t0 = Date.now();
    const r = await fetch(`${base}/api/weather?city=${city}`, { headers });
    const bytes = new Uint8Array(await r.arrayBuffer());
    const receipt = r.headers.get("x-recourse-receipt");
    return {
      r,
      bytes,
      text: new TextDecoder().decode(bytes),
      receipt: receipt ? decodeReceiptHeader(receipt) : undefined,
      ms: Date.now() - t0,
    };
  }
  return { base, merchantApp, buy, clock };
}

describe("demo merchant", () => {
  it("quotes 0.01 USDC without payment and exposes health and the manifest", async () => {
    const { base } = await start();
    const q = await fetch(`${base}/api/weather?city=Mumbai`, {
      headers: { "x-recourse-request-id": keccak256(toHex("q")) },
    });
    expect(q.status).toBe(402);
    expect((await json(q)).amount).toBe("0.01");
    expect((await json(await fetch(`${base}/health`))).ok).toBe(true);
    const man = await json(await fetch(`${base}/.well-known/recourse.json`));
    expect(man).toMatchObject({
      merchant: merchant.address,
      price: "0.01",
      scheme: "recourse-escrow",
      freshness_guarantee_seconds: 3600,
    });
  });

  it("honest: a healthy, schema-valid body with a receipt that verifies", async () => {
    const { buy } = await start();
    const { r, bytes, text, receipt } = await buy();
    expect(r.status).toBe(200);
    expect(WeatherResponseSchema.safeParse(JSON.parse(text)).success).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ city: "Mumbai", observed_at: T0 });
    expect(await verifyReceipt(31337, receipt, merchant.address, bytes)).toBe(true);
  });

  it("each failure mode behaves as documented and is still receipted", async () => {
    const { buy } = await start();
    const cases: Array<[Mode, number, (t: string) => void]> = [
      ["wrong_schema", 200, (t) => expect(JSON.parse(t)).toEqual({ temp: "hot" })],
      ["empty", 200, (t) => expect(t).toBe("")],
      ["http_error", 500, (t) => expect(JSON.parse(t).error.code).toBe("internal")],
      ["stale_timestamp", 200, (t) => expect(T0 - JSON.parse(t).observed_at).toBeGreaterThan(3600)],
      ["wrong_city", 200, (t) => expect(JSON.parse(t).city).not.toBe("Mumbai")],
      ["stale_in_text", 200, (t) => expect(JSON.parse(t).summary).toMatch(/yesterday/)],
      ["embedded_error", 200, (t) => expect(JSON.parse(t).summary).toMatch(/^Error:/)],
      ["implausible", 200, (t) => expect(JSON.parse(t).summary).toMatch(/snowfall/)],
      ["injection", 200, (t) => expect(JSON.parse(t).summary).toMatch(/SYSTEM:/)],
    ];
    for (const [mode, status, check] of cases) {
      const { r, bytes, text, receipt } = await buy(mode);
      expect(r.status, mode).toBe(status);
      check(text);
      expect(await verifyReceipt(31337, receipt, merchant.address, bytes), `${mode} receipt`).toBe(
        true,
      );
    }
  });

  it("timeout mode stalls past the SLA", async () => {
    const { buy } = await start({ slaMs: 20, timeoutDelayMs: 60 });
    const { r, ms } = await buy("timeout");
    expect(r.status).toBe(200);
    expect(ms).toBeGreaterThanOrEqual(55);
  });

  it("header mode overrides the global mode, an unknown header is ignored, admin sets the default", async () => {
    const { base, buy, merchantApp } = await start();
    const post = (mode: unknown) =>
      fetch(`${base}/admin/mode`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
    expect((await post("wrong_schema")).status).toBe(200);
    expect(merchantApp.getMode()).toBe("wrong_schema");
    expect(JSON.parse((await buy()).text)).toEqual({ temp: "hot" }); // global
    expect(JSON.parse((await buy("honest")).text).city).toBe("Mumbai"); // header wins
    expect(JSON.parse((await buy("not-a-mode" as Mode)).text)).toEqual({ temp: "hot" }); // ignored, global used
    expect((await post("nope")).status).toBe(400);
    expect((await post(undefined)).status).toBe(400);
    expect((await json(await fetch(`${base}/admin/mode`))).mode).toBe("wrong_schema");
  });

  it("admin routes refuse anything that came through the gateway", async () => {
    const { base, merchantApp } = await start();
    const r = await fetch(`${base}/admin/mode`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-recourse-request-id": keccak256(toHex("via-gateway")),
      },
      body: JSON.stringify({ mode: "empty" }),
    });
    expect(r.status).toBe(403);
    expect(merchantApp.getMode()).toBe("honest");
    expect(
      (
        await fetch(`${base}/admin/mode`, {
          headers: { "x-recourse-request-id": keccak256(toHex("x")) },
        })
      ).status,
    ).toBe(403);
  });

  it("echoes the requested city and caps its length", async () => {
    const { buy } = await start();
    expect(JSON.parse((await buy(undefined, "Pune")).text).city).toBe("Pune");
    expect(JSON.parse((await buy(undefined, "x".repeat(300))).text).city.length).toBe(100);
  });
});
