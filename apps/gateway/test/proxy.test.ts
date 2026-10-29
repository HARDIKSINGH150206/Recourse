import { describe, expect, it } from "vitest";
import { keccak256, toHex, type Hex } from "viem";
import { isEvidenceValid, verifyUntrustedBundle, type EvidenceBundle } from "@recourse/shared";
import {
  BODY,
  PRICE,
  agent,
  agentHeaders,
  lc,
  makeHarness,
  merchant,
  paymentHeader,
  payAndFetch,
} from "./helpers.js";

const WEATHER = "/proxy/weather/api/weather?city=Mumbai";

describe("proxy: happy path", () => {
  it("402 first, then paid retry returns the merchant body and logs every step", async () => {
    const h = await makeHarness();
    const { first, second, requestId } = await payAndFetch(h);

    expect(first.statusCode).toBe(402);
    expect(first.headers["x-payment-required"]).toBeTruthy();
    expect(second.statusCode).toBe(200);
    expect(second.body).toBe(BODY);
    expect(second.headers["x-recourse-request-id"]).toBe(requestId);

    const types = h.repo.listEntries({ requestId }).map((e) => e.type);
    expect(types).toEqual([
      "request",
      "payment_required",
      "request",
      "payment_proof",
      "response",
      "receipt",
    ]);
    expect(second.headers["x-recourse-seq"]).toBe(
      String(h.repo.listEntries({ requestId }).find((e) => e.type === "response")!.seq),
    );
    // every entry is attributed to the agent and mandate that were claimed in the headers
    for (const e of h.repo.listEntries({ requestId })) {
      expect(e.mandate_id).toBe(h.mandateId);
      expect(e.agent_id).toBe(lc(agent.address));
    }
  });

  it("stores the response body as a content-addressed blob", async () => {
    const h = await makeHarness();
    const { second } = await payAndFetch(h);
    const bodyHash = keccak256(toHex(BODY));
    const r = await h.app.inject({ url: `/evidence/blob/${bodyHash}` });
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe(second.body);
    expect(
      (await h.app.inject({ url: `/evidence/blob/${"0x" + "0".repeat(64)}` })).statusCode,
    ).toBe(404);
    expect((await h.app.inject({ url: "/evidence/blob/nothex" })).statusCode).toBe(400);
  });

  it("produces a bundle that verifies completely after flush and anchoring", async () => {
    const h = await makeHarness();
    const { requestId, escrowId } = await payAndFetch(h);

    // not batched yet
    expect((await h.app.inject({ url: `/evidence/${requestId}` })).statusCode).toBe(409);

    const flush = await h.app.inject({ method: "POST", url: "/log/flush" });
    expect(flush.statusCode).toBe(200);
    expect(flush.json().anchor_tx).toBeTruthy();

    const res = await h.app.inject({ url: `/evidence/${requestId}` });
    expect(res.statusCode).toBe(200);
    const bundle = res.json() as EvidenceBundle;
    expect(bundle.escrow_id).toBe(escrowId);
    expect(bundle.chain.merchant).toBe(lc(merchant.address));
    expect(bundle.receipt?.requestId).toBe(requestId);

    const batch = await h.app.inject({ url: "/log/batches/0" });
    const blob = new TextEncoder().encode(BODY);
    const report = await verifyUntrustedBundle(bundle, {
      batchEntries: batch.json().entries,
      blobs: { [bundle.receipt!.responseHash]: blob },
      rpc: { readContract: async () => BigInt(bundle.anchors[0]!.block_timestamp) } as never,
    });
    expect(report.errors).toEqual([]);
    expect(isEvidenceValid(report)).toBe(true);
    expect(report).toMatchObject({
      chain_ok: true,
      anchor_ok: true,
      receipt_ok: true,
      time_ok: true,
    });
  });
});

describe("proxy: payment verification", () => {
  it("rejects an escrow created for a different request id, without calling the merchant", async () => {
    const h = await makeHarness();
    const other = keccak256(toHex("someone-elses-request"));
    const { escrowId } = await h.fake
      .as(agent.address)
      .createEscrow(h.mandateId, merchant.address, PRICE, other);
    const before = h.merchantCalls.length;
    const r = await h.app.inject({
      url: WEATHER,
      headers: agentHeaders(h, {
        "x-recourse-request-id": keccak256(toHex("mine")),
        "x-payment": paymentHeader(escrowId),
      }),
    });
    expect(r.statusCode).toBe(402);
    expect(h.merchantCalls.length).toBe(before);
    // the failed attempt is still evidence
    expect(h.repo.listEntries({}).map((e) => e.type)).toEqual(["request", "payment_proof"]);
  });

  it("rejects a disputed or released escrow and a nonexistent one", async () => {
    const h = await makeHarness();
    const rid = keccak256(toHex("r"));
    const { escrowId } = await h.fake
      .as(agent.address)
      .createEscrow(h.mandateId, merchant.address, PRICE, rid);
    h.clock.advance(200);
    await h.fake.as(agent.address).release(escrowId);
    const headers = agentHeaders(h, {
      "x-recourse-request-id": rid,
      "x-payment": paymentHeader(escrowId),
    });
    expect((await h.app.inject({ url: WEATHER, headers })).statusCode).toBe(402);

    const ghost = agentHeaders(h, { "x-payment": paymentHeader(keccak256(toHex("ghost"))) });
    expect((await h.app.inject({ url: WEATHER, headers: ghost })).statusCode).toBe(402);
  });

  it("rejects a malformed X-Payment header", async () => {
    const h = await makeHarness();
    for (const bad of [
      "!!!",
      Buffer.from("{}").toString("base64"),
      Buffer.from('{"escrowId":"0x1","txHash":"0x2"}').toString("base64"),
    ]) {
      const r = await h.app.inject({
        url: WEATHER,
        headers: agentHeaders(h, { "x-payment": bad }),
      });
      expect(r.statusCode).toBe(402);
    }
    expect(h.merchantCalls).toHaveLength(0);
  });

  it("reports an unreadable chain as 502 rather than trusting the claim", async () => {
    const h = await makeHarness();
    h.deps.chain.getEscrow = async () => {
      throw new Error("rpc down");
    };
    const r = await h.app.inject({
      url: WEATHER,
      headers: agentHeaders(h, { "x-payment": paymentHeader(keccak256(toHex("e"))) }),
    });
    expect(r.statusCode).toBe(502);
  });
});

describe("proxy: request validation and safety", () => {
  it("requires agent and mandate headers and a valid request id", async () => {
    const h = await makeHarness();
    expect((await h.app.inject({ url: WEATHER })).statusCode).toBe(400);
    expect(
      (
        await h.app.inject({
          url: WEATHER,
          headers: { "x-recourse-agent": "nope", "x-recourse-mandate": h.mandateId },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await h.app.inject({
          url: WEATHER,
          headers: agentHeaders(h, { "x-recourse-request-id": "0x12" }),
        })
      ).statusCode,
    ).toBe(400);
    expect(h.repo.headSeq()).toBe(0); // nothing logged for rejected requests
  });

  it("404s unknown merchants, including prototype keys", async () => {
    const h = await makeHarness();
    for (const id of ["nope", "__proto__", "constructor", "toString"]) {
      expect(
        (await h.app.inject({ url: `/proxy/${id}/x`, headers: agentHeaders(h) })).statusCode,
      ).toBe(404);
    }
    expect(h.merchantCalls).toHaveLength(0);
  });

  it("cannot be steered to another host by the path", async () => {
    const h = await makeHarness();
    for (const p of [
      "/proxy/weather//evil.test/x",
      "/proxy/weather/..%2f..%2fx",
      "/proxy/weather/%5Cevil.test",
    ]) {
      await h.app.inject({ url: p, headers: agentHeaders(h) });
    }
    for (const c of h.merchantCalls)
      expect(new URL(c.url).origin).toBe("http://merchant.test:4200");
  });

  it("does not forward agent control headers and asks for an unencoded body", async () => {
    const h = await makeHarness();
    await h.app.inject({ url: WEATHER, headers: agentHeaders(h, { authorization: "Bearer t" }) });
    const sent = h.merchantCalls[0]!.headers;
    expect(sent["x-recourse-mandate"]).toBeUndefined();
    expect(sent["x-recourse-agent"]).toBeUndefined();
    expect(sent["accept-encoding"]).toBe("identity");
    expect(sent["authorization"]).toBe("Bearer t");
    expect(sent["x-recourse-request-id"]).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("never follows redirects: a 302 is returned to the agent and logged as-is", async () => {
    const h = await makeHarness();
    const first = await h.app.inject({ url: WEATHER, headers: agentHeaders(h) });
    const requestId = first.headers["x-recourse-request-id"] as Hex;
    const { escrowId } = await h.fake
      .as(agent.address)
      .createEscrow(h.mandateId, merchant.address, PRICE, requestId);
    h.setBehaviour("redirect");
    const r = await h.app.inject({
      url: WEATHER,
      headers: agentHeaders(h, {
        "x-recourse-request-id": requestId,
        "x-payment": paymentHeader(escrowId),
      }),
    });
    expect(r.statusCode).toBe(302);
    expect(h.merchantCalls.every((c) => c.redirect === "manual")).toBe(true);
    expect(
      h.merchantCalls.every((c) => new URL(c.url).origin === "http://merchant.test:4200"),
    ).toBe(true);
    const resp = h.repo.listEntries({ requestId }).find((e) => e.type === "response")!;
    expect(h.repo.fieldsFor(resp.seq).find((f) => f.name === "status")!.value).toBe(302);
  });

  it("passes the request body through byte-for-byte and logs its hash", async () => {
    const h = await makeHarness();
    const payload = Buffer.from('{"a":1,  "b":[1,2]}');
    await h.app.inject({
      method: "POST",
      url: "/proxy/weather/api/x",
      headers: agentHeaders(h, { "content-type": "application/json" }),
      payload,
    });
    const e = h.repo.listEntries({})[0]!;
    const fields = Object.fromEntries(h.repo.fieldsFor(e.seq).map((f) => [f.name, f.value]));
    expect(fields.method).toBe("POST");
    expect(fields.body_hash).toBe(keccak256(payload));
  });
});

describe("proxy: upstream failures are evidence too", () => {
  async function failing(behaviour: "timeout" | "http_error" | "huge") {
    const h = await makeHarness();
    const first = await h.app.inject({ url: WEATHER, headers: agentHeaders(h) });
    const requestId = first.headers["x-recourse-request-id"] as Hex;
    const { escrowId } = await h.fake
      .as(agent.address)
      .createEscrow(h.mandateId, merchant.address, PRICE, requestId);
    h.setBehaviour(behaviour);
    const r = await h.app.inject({
      url: WEATHER,
      headers: agentHeaders(h, {
        "x-recourse-request-id": requestId,
        "x-payment": paymentHeader(escrowId),
      }),
    });
    const resp = h.repo.listEntries({ requestId }).find((e) => e.type === "response")!;
    const fields = Object.fromEntries(h.repo.fieldsFor(resp.seq).map((f) => [f.name, f.value]));
    return { r, fields };
  }

  it("timeout -> 504 logged with status and latency", async () => {
    const { r, fields } = await failing("timeout");
    expect(r.statusCode).toBe(504);
    expect(fields.status).toBe(504);
    expect(typeof fields.latency_ms).toBe("number");
  });

  it("merchant 500 -> passed through and logged", async () => {
    const { r, fields } = await failing("http_error");
    expect(r.statusCode).toBe(500);
    expect(fields.status).toBe(500);
  });

  it("oversized response -> 502, never buffered or logged as a body", async () => {
    const { r, fields } = await failing("huge");
    expect(r.statusCode).toBe(502);
    expect(fields).toMatchObject({ status: 502, body_len: 0 });
  });
});

describe("log and evidence routes", () => {
  it("serves health, head, entries, proofs and batch exports", async () => {
    const h = await makeHarness();
    expect((await h.app.inject({ url: "/log/head" })).statusCode).toBe(404);
    const { requestId } = await payAndFetch(h);
    await h.app.inject({ method: "POST", url: "/log/flush" });

    expect((await h.app.inject({ url: "/health" })).json()).toMatchObject({
      ok: true,
      head_seq: 6,
      last_batch: 0,
    });
    expect((await h.app.inject({ url: "/log/head" })).json()).toMatchObject({
      size: 6,
      batch_index: 0,
      anchored: true,
    });
    const list = (await h.app.inject({ url: `/log/entries?request_id=${requestId}` })).json();
    expect(list.entries).toHaveLength(6);
    expect((await h.app.inject({ url: "/log/entries/3" })).json().seq).toBe(3);
    expect((await h.app.inject({ url: "/log/entries/999" })).statusCode).toBe(404);
    expect((await h.app.inject({ url: "/log/entries?from=abc" })).statusCode).toBe(400);
    expect((await h.app.inject({ url: "/log/entries?bogus=1" })).statusCode).toBe(400);
    const proof = (await h.app.inject({ url: "/log/proof/2" })).json();
    expect(proof).toMatchObject({ seq: 2, batch_index: 0 });
    const batch = (await h.app.inject({ url: "/log/batches/0" })).json();
    expect(batch.entries).toHaveLength(6);
    expect(batch.anchor.tx_hash).toBeTruthy();
    expect((await h.app.inject({ url: "/log/batches/5" })).statusCode).toBe(404);
  });

  it("flush with nothing pending is a harmless no-op", async () => {
    const h = await makeHarness();
    expect((await h.app.inject({ method: "POST", url: "/log/flush" })).json()).toEqual({
      batch_index: null,
      root: null,
      anchor_tx: null,
    });
  });

  it("flush reports anchoring failure but keeps the batch for retry", async () => {
    const h = await makeHarness();
    await payAndFetch(h);
    const real = h.deps.anchor;
    h.deps.anchor = { anchor: () => Promise.reject(new Error("rpc down")) };
    const r = await h.app.inject({ method: "POST", url: "/log/flush" });
    expect(r.statusCode).toBe(502);
    expect(h.repo.unanchoredBatches()).toHaveLength(1);
    h.deps.anchor = real;
    expect((await h.app.inject({ method: "POST", url: "/log/flush" })).statusCode).toBe(200);
    expect(h.repo.unanchoredBatches()).toHaveLength(0);
  });

  it("selective disclosure returns verifiable fields only for the right request", async () => {
    const h = await makeHarness();
    const { requestId } = await payAndFetch(h);
    const respSeq = h.repo.listEntries({ requestId }).find((e) => e.type === "response")!.seq;
    const ok = await h.app.inject({
      method: "POST",
      url: `/evidence/${requestId}/disclose`,
      payload: { fields: [{ seq: respSeq, name: "status" }] },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().disclosed[0]).toMatchObject({ seq: respSeq, name: "status", value: 200 });

    const wrongReq = keccak256(toHex("other"));
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: `/evidence/${wrongReq}/disclose`,
          payload: { fields: [{ seq: respSeq, name: "status" }] },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: `/evidence/${requestId}/disclose`,
          payload: { fields: [{ seq: respSeq, name: "nope" }] },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: `/evidence/${requestId}/disclose`,
          payload: { fields: [] },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("accepts agent decision records flagged as agent-claimed, and rejects floats", async () => {
    const h = await makeHarness();
    const rid = keccak256(toHex("r"));
    const ok = await h.app.inject({
      method: "POST",
      url: "/log/decision",
      payload: { request_id: rid, kind: "choice", data: { vendor: "weather", n: 1 } },
    });
    expect(ok.statusCode).toBe(200);
    const f = Object.fromEntries(h.repo.fieldsFor(ok.json().seq).map((x) => [x.name, x.value]));
    expect(f).toMatchObject({ kind: "choice", claimed_by: "agent" });
    expect(h.repo.getEntry(ok.json().seq)!.type).toBe("decision");
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/log/decision",
          payload: { request_id: rid, kind: "choice", data: { x: 1.5 } },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/log/decision",
          payload: { request_id: rid, kind: "bogus", data: {} },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/log/decision",
          payload: { request_id: rid, kind: "choice", data: { pad: "x".repeat(20_000) } },
        })
      ).statusCode,
    ).toBe(413);
  });

  it("returns the standard error shape for unknown routes and bad input", async () => {
    const h = await makeHarness();
    const r = await h.app.inject({ url: "/nope" });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("not_found");
    expect((await h.app.inject({ url: "/evidence/zzz" })).json().error.code).toBe("bad_request");
  });
});

describe("tamper test (dev route)", () => {
  it("is not available unless ENABLE_DEV_ROUTES=1", async () => {
    const h = await makeHarness();
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/admin/tamper",
          payload: { seq: 1, field: "ts", value: 1 },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("rewriting a stored entry is detected by bundle verification", async () => {
    const h = await makeHarness({ devRoutes: true });
    const { requestId } = await payAndFetch(h);
    await h.app.inject({ method: "POST", url: "/log/flush" });
    const clean = await verifyUntrustedBundle(
      (await h.app.inject({ url: `/evidence/${requestId}` })).json(),
    );
    expect(isEvidenceValid(clean)).toBe(true);

    const respSeq = h.repo.listEntries({ requestId }).find((e) => e.type === "response")!.seq;
    const t = await h.app.inject({
      method: "POST",
      url: "/admin/tamper",
      payload: { seq: respSeq, field: "ts", value: 42 },
    });
    expect(t.json()).toEqual({ ok: true });

    const dirty = await verifyUntrustedBundle(
      (await h.app.inject({ url: `/evidence/${requestId}` })).json(),
    );
    expect(isEvidenceValid(dirty)).toBe(false);
    expect(dirty.entry_hash_ok).toBe(false);

    // the trigger is back: normal code still cannot rewrite history
    expect(() => h.repo.db.$client.prepare("update entries set ts = 1").run()).toThrow(
      /append-only/,
    );
    expect(h.lines.join("")).toContain("DEV tamper applied");
  });
});
