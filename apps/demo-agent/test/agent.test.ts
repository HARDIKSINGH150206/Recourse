import { afterEach, describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { makeHarness, lc, agentAcct, owner, T0, TOKEN, type Harness } from "./harness.js";

let h: Harness;
afterEach(async () => void (await h?.close()));

const names = (run: { steps: Array<{ name: string }> }) => run.steps.map((s) => s.name);

describe("scenarios", () => {
  it("happy: quote, verify, rationale BEFORE paying, escrow Held, response and receipt", async () => {
    h = await makeHarness();
    const run = await h.agent.runToCompletion("happy");
    expect(run.status).toBe("completed");
    expect(names(run)).toEqual([
      "mandate",
      "402 quote",
      "verify quote",
      "rationale",
      "createEscrow",
      "response",
      "receipt",
    ]);
    expect(run.steps.every((s) => s.ok)).toBe(true);
    expect(h.gwLog).toEqual(["quote", "decision", "paid"]); // the rationale is logged before the paid retry
    expect(run.response).toMatchObject({ status: 200 });
    expect(JSON.parse(run.response!.body)).toMatchObject({ city: "Mumbai" });
    expect(run.mandate_id).toBe(h.mandateId);
    expect(run.request_id).toMatch(/^0x[0-9a-f]{64}$/);
    const escrow = await h.fake.as(agentAcct.address).getEscrow(run.escrow_id!);
    expect(escrow).toMatchObject({ state: "Held", amount: 10_000n });
    expect(run.tx_hashes.escrow).toMatch(/^0x/);
    expect(run.steps.find((s) => s.name === "receipt")!.detail).toBe("signed by merchant");
  });

  it("over_cap: the contract refuses; the run is blocked, not failed, and the merchant is never called with payment", async () => {
    h = await makeHarness();
    const run = await h.agent.runToCompletion("over_cap");
    expect(run).toMatchObject({
      status: "blocked",
      reverted: "ExceedsMaxPrice",
      escrow_id: null,
      error: null,
    });
    expect(h.gwLog).toEqual(["quote", "decision"]);
    expect(await h.fake.as(agentAcct.address).spent(h.mandateId)).toBe(0n);
    expect(run.steps.at(-1)).toMatchObject({
      name: "createEscrow",
      ok: false,
      detail: "reverted: ExceedsMaxPrice",
    });
  });

  it("wrong_schema: the merchant's bad body is delivered and recorded", async () => {
    h = await makeHarness();
    const run = await h.agent.runToCompletion("wrong_schema");
    expect(run.status).toBe("completed");
    expect(JSON.parse(run.response!.body)).toEqual({ temp: "hot" });
  });

  it("each run is independent and ids are unique", async () => {
    h = await makeHarness();
    const [a, b] = await Promise.all([
      h.agent.runToCompletion("happy"),
      h.agent.runToCompletion("wrong_schema"),
    ]);
    expect(a.request_id).not.toBe(b.request_id);
    expect(a.escrow_id).not.toBe(b.escrow_id);
    expect(JSON.parse(a.response!.body).city).toBe("Mumbai");
    expect(JSON.parse(b.response!.body)).toEqual({ temp: "hot" });
  });
});

describe("the agent protects itself", () => {
  it("refuses to pay a quote that names a different escrow contract", async () => {
    h = await makeHarness({ merchantEscrow: "0x000000000000000000000000000000000000dEaD" });
    const run = await h.agent.runToCompletion("happy");
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/different chain, escrow or token/);
    expect(await h.fake.as(agentAcct.address).spent(h.mandateId)).toBe(0n);
    expect(h.gwLog).toEqual(["quote"]); // nothing logged as a decision, nothing paid
  });

  it("accepts a quote whose addresses are checksummed", async () => {
    h = await makeHarness();
    // SDK lowercases now; simulate an older merchant that sends checksummed addresses
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const r = await orig(input, init);
      const raw = r.headers.get("x-payment-required");
      if (r.status !== 402 || !raw) return r;
      const q = JSON.parse(Buffer.from(raw, "base64").toString());
      q.escrow = getAddress(q.escrow);
      q.token = getAddress(q.token);
      const headers = new Headers(r.headers);
      headers.set("x-payment-required", Buffer.from(JSON.stringify(q)).toString("base64"));
      return new Response(await r.arrayBuffer(), { status: 402, headers });
    }) as typeof fetch;
    try {
      expect((await h.agent.runToCompletion("happy")).status).toBe("completed");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("fails cleanly when the gateway is unreachable, without paying", async () => {
    h = await makeHarness({ gatewayDown: true });
    const run = await h.agent.runToCompletion("happy");
    expect(run).toMatchObject({ status: "failed" });
    expect(run.error).toMatch(/gateway unreachable/);
    expect(run.escrow_id).toBeNull();
  });

  it("an unknown scenario is a 404-style error", async () => {
    h = await makeHarness();
    expect(() => h.agent.startRun("nope")).toThrow(/unknown scenario/);
    expect(() => h.agent.startRun("__proto__")).toThrow(/unknown scenario/);
  });
});

describe("mandate resolution", () => {
  const entry = (id: string, over: Record<string, unknown> = {}) => ({
    mandate_id: id,
    mandate: { agent: lc(agentAcct.address), expiresAt: T0 + 1000, ...over },
    registered_onchain: false,
  });

  it("uses the newest registered, unexpired mandate that names this agent", async () => {
    h = await makeHarness();
    const real = h.mandateId;
    const other = "0x" + "aa".repeat(32);
    h.mandateList.value = [
      entry("0x" + "01".repeat(32), { agent: lc(owner.address) }), // another agent
      entry("0x" + "02".repeat(32), { expiresAt: T0 - 1 }), // expired
      entry("0x" + "03".repeat(32)), // not registered on-chain
      entry(real),
      entry(other),
    ];
    h.registered.add(other);
    const run = await h.agent.runToCompletion("happy");
    expect(run.mandate_id).toBe(real);
    expect(run.status).toBe("completed");
  });

  it("fails with a helpful error when nothing is registered", async () => {
    h = await makeHarness();
    h.registered.clear();
    const run = await h.agent.runToCompletion("happy");
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/no registered mandate/);
  });

  it("a fixed mandate id skips the lookup", async () => {
    h = await makeHarness({ fixedMandate: true });
    h.mandateList.value = [];
    expect((await h.agent.runToCompletion("happy")).status).toBe("completed");
  });
});

describe("disputes", () => {
  it("the demo owner disputes on-chain and files the reason with the API", async () => {
    h = await makeHarness();
    const run = await h.agent.runToCompletion("wrong_schema");
    const d = await h.agent.dispute(run.run_id);
    expect(d.dispute).toEqual({ dispute_id: "d-1", status: "opened" });
    expect(d.tx_hashes.dispute).toMatch(/^0x/);
    expect((await h.fake.as(owner.address).getEscrow(run.escrow_id!)).state).toBe("Disputed");
    expect(h.apiPosts).toEqual([
      {
        path: "/disputes",
        body: {
          escrow_id: run.escrow_id,
          reason_text: "The response is not the weather data I paid for.",
        },
      },
    ]);
    expect(names(d).at(-1)).toBe("dispute");
  });

  it("regret uses the 'changed my mind' reason, and an explicit reason overrides the default", async () => {
    h = await makeHarness();
    const regret = await h.agent.runToCompletion("regret");
    await h.agent.dispute(regret.run_id);
    expect((h.apiPosts[0]!.body as { reason_text: string }).reason_text).toBe("I changed my mind.");
    const inj = await h.agent.runToCompletion("injection");
    await h.agent.dispute(inj.run_id, "custom words");
    expect((h.apiPosts[1]!.body as { reason_text: string }).reason_text).toBe("custom words");
  });

  it("rejects: double dispute, blocked runs, scenarios with no default reason, unknown run, late dispute", async () => {
    h = await makeHarness();
    const run = await h.agent.runToCompletion("wrong_schema");
    await h.agent.dispute(run.run_id);
    await expect(h.agent.dispute(run.run_id)).rejects.toMatchObject({ code: "conflict" });

    const blocked = await h.agent.runToCompletion("over_cap");
    await expect(h.agent.dispute(blocked.run_id)).rejects.toMatchObject({ code: "conflict" });

    const happy = await h.agent.runToCompletion("happy");
    await expect(h.agent.dispute(happy.run_id)).rejects.toMatchObject({ code: "bad_request" });

    await expect(h.agent.dispute("nope")).rejects.toMatchObject({ code: "not_found" });

    const late = await h.agent.runToCompletion("regret");
    h.clock.advance(500); // past the dispute window
    await expect(h.agent.dispute(late.run_id)).rejects.toMatchObject({
      code: "conflict",
      details: { reverted: "WindowClosed" },
    });
  });

  it("without the owner key the service refuses to dispute", async () => {
    h = await makeHarness({ owner: false });
    const run = await h.agent.runToCompletion("wrong_schema");
    await expect(h.agent.dispute(run.run_id)).rejects.toMatchObject({ code: "forbidden" });
    expect(h.agent.canDispute).toBe(false);
  });
});

describe("HTTP API", () => {
  const json = (r: { body: string }) => JSON.parse(r.body);

  it("lists scenarios, runs one asynchronously and serves its steps", async () => {
    h = await makeHarness();
    const list = json(await h.http.inject({ url: "/scenarios" })).scenarios;
    expect(list.map((s: { id: string }) => s.id)).toEqual([
      "happy",
      "over_cap",
      "wrong_schema",
      "stale_in_text",
      "injection",
      "regret",
    ]);
    expect(list.find((s: { id: string }) => s.id === "happy").disputable).toBe(false);

    const started = await h.http.inject({ method: "POST", url: "/scenarios/wrong_schema/run" });
    expect(started.statusCode).toBe(202);
    const { run_id } = json(started);
    let run;
    for (let i = 0; i < 100; i++) {
      run = json(await h.http.inject({ url: `/runs/${run_id}` }));
      if (run.status !== "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(run.status).toBe("completed");

    const disputed = await h.http.inject({
      method: "POST",
      url: `/runs/${run_id}/dispute`,
      payload: {},
    });
    expect(disputed.statusCode).toBe(200);
    expect(json(disputed).dispute.status).toBe("opened");
  });

  it("validates input and uses the standard error shape", async () => {
    h = await makeHarness();
    expect((await h.http.inject({ method: "POST", url: "/scenarios/nope/run" })).statusCode).toBe(
      404,
    );
    expect(
      (
        await h.http.inject({
          method: "POST",
          url: "/scenarios/happy/run",
          payload: { mandate_id: "0x12" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await h.http.inject({ method: "POST", url: "/scenarios/happy/run", payload: { extra: 1 } }))
        .statusCode,
    ).toBe(400);
    expect((await h.http.inject({ url: "/runs/missing" })).statusCode).toBe(404);
    expect(
      (
        await h.http.inject({
          method: "POST",
          url: "/runs/x/dispute",
          payload: { reason_text: "" },
        })
      ).statusCode,
    ).toBe(400);
    const nf = json(await h.http.inject({ url: "/nope" }));
    expect(nf.error.code).toBe("not_found");
    expect(json(await h.http.inject({ url: "/health" }))).toEqual({ ok: true, can_dispute: true });
  });

  it("CORS only for the dashboard origin", async () => {
    h = await makeHarness();
    const ok = await h.http.inject({
      url: "/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(
      (await h.http.inject({ url: "/health", headers: { origin: "http://evil.example" } })).headers[
        "access-control-allow-origin"
      ],
    ).toBeUndefined();
  });
});

describe("run store", () => {
  it("drops the oldest runs beyond its bound", async () => {
    h = await makeHarness({ storeMax: 2, fixedMandate: true });
    const a = await h.agent.runToCompletion("happy");
    const b = await h.agent.runToCompletion("happy");
    const c = await h.agent.runToCompletion("happy");
    expect(h.agent.store.size).toBe(2);
    expect(() => h.agent.getRun(a.run_id)).toThrow();
    expect(h.agent.getRun(b.run_id)).toBeTruthy();
    expect(h.agent.getRun(c.run_id)).toBeTruthy();
    void TOKEN;
  });
});
