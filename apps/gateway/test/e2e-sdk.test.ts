// Real gateway in front of a real merchant built with @recourse/merchant-sdk, over HTTP.
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { type Hex } from "viem";
import { protect } from "@recourse/merchant-sdk";
import { isEvidenceValid, verifyUntrustedBundle, type EvidenceBundle } from "@recourse/shared";
import {
  CHAIN_ID,
  PRICE,
  agentHeaders,
  agent,
  lc,
  makeHarness,
  merchant,
  paymentHeader,
  type Harness,
} from "./helpers.js";

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

async function setup() {
  const BODY = {
    city: "Mumbai",
    temp_c: 31,
    humidity: 68,
    observed_at: 1_767_200_000,
    summary: "Humid",
  };
  // Merchant app first (its port is needed by the gateway's registry); escrow client wired after.
  const ref = {} as { h: Harness };
  const app = express();
  const mw = protect({
    merchantPrivateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    chainId: CHAIN_ID,
    escrow: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
    token: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
    price: "0.01",
    escrowClient: {
      getEscrow: (id) => ref.h.fake.as(agent.address).getEscrow(id),
      getMandate: (id) => ref.h.fake.as(agent.address).getMandate(id),
    },
    clock: { now: () => ref.h.clock.now() },
  });
  app.get("/api/weather", mw, (_req, res) => void res.json(BODY));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const merchantUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ref.h = await makeHarness({ merchants: { weather: merchantUrl }, realFetch: true });
  return ref.h;
}

describe("gateway + merchant SDK", () => {
  it("full flow: quote, escrow, paid retry, then a bundle that fully verifies", async () => {
    const h = await setup();
    const url = "/proxy/weather/api/weather?city=Mumbai";

    const first = await h.app.inject({ url, headers: agentHeaders(h) });
    expect(first.statusCode).toBe(402);
    const requestId = first.headers["x-recourse-request-id"] as Hex;
    const quote = JSON.parse(first.body);
    expect(quote.request_id).toBe(requestId); // the gateway forwarded its generated id to the merchant
    expect(quote.merchant).toBe(lc(merchant.address));

    const { escrowId, txHash } = await h.fake
      .as(agent.address)
      .createEscrow(h.mandateId, merchant.address, PRICE, requestId);
    const paid = await h.app.inject({
      url,
      headers: agentHeaders(h, {
        "x-recourse-request-id": requestId,
        "x-payment": paymentHeader(escrowId, txHash),
      }),
    });
    expect(paid.statusCode).toBe(200);
    expect(JSON.parse(paid.body).city).toBe("Mumbai");

    // the receipt header reached the agent and was logged by the gateway
    expect(paid.headers["x-recourse-receipt"]).toBeTruthy();
    expect(h.repo.listEntries({ requestId }).map((e) => e.type)).toEqual([
      "request",
      "payment_required",
      "request",
      "payment_proof",
      "response",
      "receipt",
    ]);

    await h.app.inject({ method: "POST", url: "/log/flush" });
    const bundle = (await h.app.inject({ url: `/evidence/${requestId}` })).json() as EvidenceBundle;
    const batch = (await h.app.inject({ url: "/log/batches/0" })).json();
    const report = await verifyUntrustedBundle(bundle, {
      batchEntries: batch.entries,
      blobs: { [bundle.receipt!.responseHash]: new TextEncoder().encode(paid.body) },
      rpc: { readContract: async () => BigInt(bundle.anchors[0]!.block_timestamp) } as never,
    });
    expect(report.errors).toEqual([]);
    expect(isEvidenceValid(report)).toBe(true);
    expect(report).toMatchObject({ receipt_ok: true, chain_ok: true, anchor_ok: true });
  });

  it("the merchant refuses a second paid call for the same request, and the gateway logs both", async () => {
    const h = await setup();
    const url = "/proxy/weather/api/weather?city=Mumbai";
    const first = await h.app.inject({ url, headers: agentHeaders(h) });
    const requestId = first.headers["x-recourse-request-id"] as Hex;
    const { escrowId } = await h.fake
      .as(agent.address)
      .createEscrow(h.mandateId, merchant.address, PRICE, requestId);
    const headers = agentHeaders(h, {
      "x-recourse-request-id": requestId,
      "x-payment": paymentHeader(escrowId),
    });
    expect((await h.app.inject({ url, headers })).statusCode).toBe(200);
    expect((await h.app.inject({ url, headers })).statusCode).toBe(409);
  });
});
