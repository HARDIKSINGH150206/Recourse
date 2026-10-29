import { afterEach, describe, expect, it } from "vitest";
import { type Hex } from "viem";
import { decodeReceiptHeader, verifyReceipt } from "../src/index.js";
import {
  CHAIN_ID,
  PRICE_UNITS,
  TOKEN,
  merchant,
  merchant2,
  paymentHeader,
  rid,
  startWorld,
  type World,
} from "./helpers.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (r: Response) => r.json() as Promise<any>;

let w: World;
afterEach(async () => void (await w?.close()));

const get = (path: string, headers: Record<string, string> = {}, method = "GET") =>
  fetch(`${w.base}${path}`, { method, headers });

describe("402 quote", () => {
  it("returns requirements in header and body", async () => {
    w = await startWorld();
    const r = await get("/api/weather?city=Mumbai", { "x-recourse-request-id": rid("q1") });
    expect(r.status).toBe(402);
    const body = await json(r);
    const header = JSON.parse(
      Buffer.from(r.headers.get("x-payment-required")!, "base64").toString(),
    );
    expect(header).toEqual(body);
    expect(body).toMatchObject({
      scheme: "recourse-escrow",
      chain_id: CHAIN_ID,
      token: TOKEN,
      amount: "0.01",
      merchant: merchant.address.toLowerCase(),
      request_id: rid("q1"),
      resource: "/api/weather?city=Mumbai",
    });
    expect(body.expires_at).toBeGreaterThan(1_767_200_000);
    expect(w.hits.count).toBe(0);
  });

  it("generates a request id when called directly, and rejects a malformed one", async () => {
    w = await startWorld();
    const r = await get("/api/weather");
    expect((await json(r)).request_id).toMatch(/^0x[0-9a-f]{64}$/);
    const bad = await get("/api/weather", { "x-recourse-request-id": "0x12" });
    expect(bad.status).toBe(400);
  });
});

describe("paid request", () => {
  it("serves the body with a receipt that verifies against the exact bytes", async () => {
    w = await startWorld();
    const id = rid("p1");
    const { escrowId } = await w.pay(id);
    const r = await get("/api/weather?city=Mumbai", {
      "x-recourse-request-id": id,
      "x-payment": paymentHeader(escrowId),
    });
    expect(r.status).toBe(200);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const receipt = decodeReceiptHeader(r.headers.get("x-recourse-receipt")!) as { requestId: Hex };
    expect(receipt.requestId).toBe(id);
    expect(await verifyReceipt(CHAIN_ID, receipt, merchant.address, bytes)).toBe(true);
    expect(w.hits.count).toBe(1);
  });

  it("exposes request and escrow ids to the handler", async () => {
    let seen: unknown;
    w = await startWorld({}, (app, mw) =>
      app.get("/api/locals", mw, (_req, res) => {
        seen = res.locals.recourse;
        res.send("ok");
      }),
    );
    const id = rid("loc");
    const { escrowId } = await w.pay(id);
    await get("/api/locals", { "x-recourse-request-id": id, "x-payment": paymentHeader(escrowId) });
    expect(seen).toEqual({ requestId: id, escrowId });
  });

  it("accepts an overpayment", async () => {
    w = await startWorld();
    const id = rid("over");
    const { escrowId } = await w.pay(id, { amount: PRICE_UNITS * 3n });
    expect(
      (
        await get("/api/weather", {
          "x-recourse-request-id": id,
          "x-payment": paymentHeader(escrowId),
        })
      ).status,
    ).toBe(200);
  });
});

describe("payment verification", () => {
  async function attempt(setup: (id: Hex) => Promise<Hex>, header?: string) {
    const id = rid(`v-${Math.random()}`);
    const escrowId = await setup(id);
    const r = await get("/api/weather", {
      "x-recourse-request-id": id,
      "x-payment": header ?? paymentHeader(escrowId),
    });
    return { r, id, escrowId };
  }

  it("rejects a malformed X-Payment header", async () => {
    w = await startWorld();
    for (const bad of [
      "!!!",
      Buffer.from("{}").toString("base64"),
      Buffer.from('{"escrowId":"0x1","txHash":"0x2"}').toString("base64"),
    ]) {
      const { r } = await attempt(async () => rid("e"), bad);
      expect(r.status).toBe(402);
      expect((await json(r)).error.details.reason).toMatch(/malformed/);
    }
    expect(w.hits.count).toBe(0);
  });

  it("rejects unknown escrows, wrong merchant, underpayment and wrong request id", async () => {
    w = await startWorld();
    const cases: Array<[string, (id: Hex) => Promise<Hex>, RegExp]> = [
      ["unknown", async () => rid("ghost"), /None, not Held/],
      [
        "other merchant",
        async (id) => (await w.pay(id, { to: merchant2.address })).escrowId,
        /different merchant/,
      ],
      [
        "underpaid",
        async (id) => (await w.pay(id, { amount: PRICE_UNITS - 1n })).escrowId,
        /below the price/,
      ],
      [
        "other request",
        async () => (await w.pay(rid("other-request"))).escrowId,
        /different request/,
      ],
    ];
    for (const [name, setup, re] of cases) {
      const { r } = await attempt(setup);
      expect(r.status, name).toBe(402);
      const body = await json(r);
      expect(body.error.details.reason, name).toMatch(re);
      expect(body.requirements.scheme).toBe("recourse-escrow"); // agent can retry correctly
    }
    expect(w.hits.count).toBe(0);
  });

  it("rejects an escrow that is no longer Held", async () => {
    w = await startWorld();
    const { id, escrowId } = await (async () => {
      const id = rid("disputed");
      return { id, escrowId: (await w.pay(id)).escrowId };
    })();
    await w.fake.as((await import("./helpers.js")).owner.address).dispute(escrowId, rid("why"));
    const r = await get("/api/weather", {
      "x-recourse-request-id": id,
      "x-payment": paymentHeader(escrowId),
    });
    expect(r.status).toBe(402);
    expect((await json(r)).error.details.reason).toMatch(/Disputed/);
  });

  it("rejects an old payment proof after the TTL", async () => {
    w = await startWorld({ requestTtlSeconds: 60 });
    const id = rid("old");
    const { escrowId } = await w.pay(id);
    w.clock.advance(61);
    const r = await get("/api/weather", {
      "x-recourse-request-id": id,
      "x-payment": paymentHeader(escrowId),
    });
    expect(r.status).toBe(402);
    expect((await json(r)).error.details.reason).toMatch(/expired/);
  });

  it("rejects payment made under a mandate in a different token", async () => {
    w = await startWorld({ token: "0x000000000000000000000000000000000000dead" });
    const id = rid("tok");
    const { escrowId } = await w.pay(id); // mandate token is TOKEN, SDK expects 0x...dead
    const r = await get("/api/weather", {
      "x-recourse-request-id": id,
      "x-payment": paymentHeader(escrowId),
    });
    expect(r.status).toBe(402);
    expect((await json(r)).error.details.reason).toMatch(/different token/);
  });

  it("reports an unreadable chain as 502, never serves", async () => {
    w = await startWorld({
      escrowClient: {
        getEscrow: async () => {
          throw new Error("rpc down");
        },
        getMandate: async () => {
          throw new Error("rpc down");
        },
      },
    });
    const r = await get("/api/weather", {
      "x-recourse-request-id": rid("x"),
      "x-payment": paymentHeader(rid("e")),
    });
    expect(r.status).toBe(502);
    expect(w.hits.count).toBe(0);
  });
});

describe("replay protection", () => {
  it("serves a request id once", async () => {
    w = await startWorld();
    const id = rid("replay");
    const { escrowId } = await w.pay(id);
    const h = { "x-recourse-request-id": id, "x-payment": paymentHeader(escrowId) };
    expect((await get("/api/weather", h)).status).toBe(200);
    const again = await get("/api/weather", h);
    expect(again.status).toBe(409);
    expect((await json(again)).error.details.reason).toBe("already_served");
    expect(w.hits.count).toBe(1);
  });

  it("only one of many concurrent retries is served", async () => {
    w = await startWorld();
    const id = rid("race");
    const { escrowId } = await w.pay(id);
    const h = { "x-recourse-request-id": id, "x-payment": paymentHeader(escrowId) };
    const statuses = (await Promise.all(Array.from({ length: 8 }, () => get("/api/weather", h))))
      .map((r) => r.status)
      .sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    expect(w.hits.count).toBe(1);
  });

  it("a bogus proof cannot burn someone else's request id", async () => {
    w = await startWorld();
    const id = rid("grief");
    await get("/api/weather", {
      "x-recourse-request-id": id,
      "x-payment": paymentHeader(rid("fake-escrow")),
    });
    const { escrowId } = await w.pay(id);
    expect(
      (
        await get("/api/weather", {
          "x-recourse-request-id": id,
          "x-payment": paymentHeader(escrowId),
        })
      ).status,
    ).toBe(200);
  });
});

describe("receipt covers whatever the handler writes", () => {
  async function paidGet(path: string, method = "GET") {
    const id = rid(`rcpt-${path}-${Math.random()}`);
    const { escrowId } = await w.pay(id);
    const r = await get(
      path,
      { "x-recourse-request-id": id, "x-payment": paymentHeader(escrowId) },
      method,
    );
    const bytes = new Uint8Array(await r.arrayBuffer());
    const raw = r.headers.get("x-recourse-receipt");
    return { r, bytes, receipt: raw ? decodeReceiptHeader(raw) : undefined, id };
  }

  const routes = (app: import("express").Express, mw: import("express").RequestHandler) => {
    app.get("/api/chunks", mw, (_req, res) => {
      res.setHeader("content-type", "text/plain");
      res.write("hello ");
      res.write(Buffer.from("wor"));
      res.end("ld");
    });
    app.get("/api/utf8", mw, (_req, res) => void res.send("héllo ✓"));
    app.get("/api/empty", mw, (_req, res) => void res.status(204).end());
    app.get("/api/fail", mw, (_req, res) => void res.status(500).json({ error: "boom" }));
    app.get("/api/throw", mw, () => {
      throw new Error("handler exploded");
    });
  };

  it("multi-write bodies, utf8, empty bodies and error statuses all carry a valid receipt", async () => {
    w = await startWorld({}, routes);
    for (const [path, status, text] of [
      ["/api/chunks", 200, "hello world"],
      ["/api/utf8", 200, "héllo ✓"],
      ["/api/empty", 204, ""],
      ["/api/fail", 500, '{"error":"boom"}'],
    ] as const) {
      const { r, bytes, receipt } = await paidGet(path);
      expect(r.status, path).toBe(status);
      expect(new TextDecoder().decode(bytes), path).toBe(text);
      expect(await verifyReceipt(CHAIN_ID, receipt, merchant.address, bytes), path).toBe(true);
    }
  });

  it("an exception in the handler still yields a receipted error response", async () => {
    w = await startWorld({}, routes);
    const { r, bytes, receipt } = await paidGet("/api/throw");
    expect(r.status).toBe(500);
    expect(await verifyReceipt(CHAIN_ID, receipt, merchant.address, bytes)).toBe(true);
  });

  it("HEAD requests are receipted over the empty body", async () => {
    w = await startWorld();
    const { r, bytes, receipt } = await paidGet("/api/weather", "HEAD");
    expect(r.status).toBe(200);
    expect(bytes.length).toBe(0);
    expect(await verifyReceipt(CHAIN_ID, receipt, merchant.address, bytes)).toBe(true);
  });

  it("402 responses carry no receipt (nothing was delivered)", async () => {
    w = await startWorld();
    const r = await get("/api/weather", { "x-recourse-request-id": rid("n") });
    expect(r.headers.get("x-recourse-receipt")).toBeNull();
  });
});
