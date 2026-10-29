import { describe, expect, it } from "vitest";
import { hashTypedData, type Hex } from "viem";
import { MandateTypes, escrowDomain, mandateId as computeMandateId } from "@recourse/shared";
import { renderSummary } from "../src/services/summary.js";
import { UnavailableCompiler } from "../src/services/stubs.js";
import {
  CHAIN_ID,
  ESCROW,
  MANDATE_ID,
  T0,
  TOKEN,
  accounts,
  lc,
  makeWorld,
  mandate,
  terms,
  type World,
} from "./helpers.js";

const compileBody = (over: Record<string, unknown> = {}) => ({
  text: "Buy weather data for Mumbai, max 5 cents per call, 2 USDC total, for one day",
  owner: lc(accounts.owner.address),
  agent: lc(accounts.agent.address),
  merchants: [lc(accounts.merchant.address)],
  chain_id: CHAIN_ID,
  escrow: ESCROW,
  token: TOKEN,
  ...over,
});
const compile = (w: World, over: Record<string, unknown> = {}) =>
  w.app.inject({ method: "POST", url: "/mandates/compile", payload: compileBody(over) });

describe("POST /mandates/compile", () => {
  it("returns an unsigned mandate in chain units, a template summary and signable typed data", async () => {
    const w = await makeWorld();
    const r = await compile(w);
    expect(r.statusCode).toBe(200);
    const b = w.json(r);
    expect(b.mandate).toMatchObject({
      maxPricePerCall: "50000",
      totalBudget: "2000000",
      nonce: "7",
      token: TOKEN,
      expiresAt: T0 + 86_400,
    });
    expect(b.display).toEqual({ maxPricePerCall: "0.05", totalBudget: "2", symbol: "USDC" });
    expect(b.merchants).toEqual([lc(accounts.merchant.address)]);
    expect(b.questions[0].id).toBe("inclusive_fees");
    expect(b.summary).toContain(
      "up to 0.05 USDC per call and 2 USDC in total on weather data API calls",
    );
    expect(b.summary).toContain(lc(accounts.merchant.address));

    // the typed data the wallet will sign hashes to the id the contract will compute
    const m = b.typed_data.message;
    const digest = hashTypedData({
      domain: escrowDomain(CHAIN_ID, ESCROW),
      types: MandateTypes,
      primaryType: "Mandate",
      message: {
        ...m,
        maxPricePerCall: BigInt(m.maxPricePerCall),
        totalBudget: BigInt(m.totalBudget),
        expiresAt: BigInt(m.expiresAt),
        nonce: BigInt(m.nonce),
      },
    });
    expect(digest).toBe(computeMandateId(CHAIN_ID, ESCROW, b.mandate));
    expect(b.typed_data.primaryType).toBe("Mandate");
  });

  it("round trip: compile, sign, store, read back", async () => {
    const w = await makeWorld();
    const b = w.json(await compile(w));
    const m = b.typed_data.message;
    const signature = await accounts.owner.signTypedData({
      domain: b.typed_data.domain,
      types: MandateTypes,
      primaryType: "Mandate",
      message: {
        ...m,
        maxPricePerCall: BigInt(m.maxPricePerCall),
        totalBudget: BigInt(m.totalBudget),
        expiresAt: BigInt(m.expiresAt),
        nonce: BigInt(m.nonce),
      },
    });
    const store = await w.app.inject({
      method: "POST",
      url: "/mandates",
      payload: {
        mandate: b.mandate,
        terms: b.terms,
        merchants: b.merchants,
        signature,
        summary: b.summary,
      },
    });
    expect(store.statusCode).toBe(201);
    const id = w.json(store).mandate_id as Hex;
    expect(id).toBe(computeMandateId(CHAIN_ID, ESCROW, b.mandate));
    const got = w.json(await w.app.inject({ url: `/mandates/${id}` }));
    expect(got).toMatchObject({ mandate_id: id, summary: b.summary, registered_onchain: false });
    expect(got.terms).toEqual(b.terms);
  });

  it("rejects requests for a different deployment and malformed input", async () => {
    const w = await makeWorld();
    for (const over of [
      { chain_id: 1 },
      { escrow: "0x" + "1".repeat(40) },
      { token: "0x" + "2".repeat(40) },
    ]) {
      expect((await compile(w, over)).statusCode).toBe(400);
    }
    expect((await compile(w, { text: "" })).statusCode).toBe(400);
    expect((await compile(w, { text: "x".repeat(2001) })).statusCode).toBe(400);
    expect((await compile(w, { owner: "nope" })).statusCode).toBe(400);
    expect((await compile(w, { extra: 1 })).statusCode).toBe(400);
  });

  it("validates what the compiler (an LLM boundary) returns", async () => {
    const w = await makeWorld();
    const good = {
      category: "weather_data_api",
      maxPricePerCall: "0.05",
      totalBudget: "2.00",
      expiresAt: T0 + 3600,
      merchants: [],
      questions: [],
    };
    const cases: Array<[string, unknown, number]> = [
      ["garbage", { hello: "world" }, 502],
      ["negative price", { ...good, maxPricePerCall: "-1" }, 400],
      ["too many decimals", { ...good, maxPricePerCall: "0.0000001" }, 400],
      ["zero budget", { ...good, totalBudget: "0" }, 400],
      ["budget below cap", { ...good, maxPricePerCall: "5", totalBudget: "1" }, 400],
      ["already expired", { ...good, expiresAt: T0 - 1 }, 400],
      ["expiry too far", { ...good, expiresAt: T0 + 400 * 86_400 }, 400],
      ["bad category", { ...good, category: "Weather Data!" }, 502],
    ];
    for (const [name, result, status] of cases) {
      w.compiler.result = () => result;
      expect((await compile(w)).statusCode, name).toBe(status);
    }
    w.compiler.result = () => good;
    expect((await compile(w, { merchants: [] })).statusCode).toBe(400); // no merchants anywhere
    expect((await compile(w)).statusCode).toBe(200);
  });

  it("is a clear 501 until the compiler is installed", async () => {
    const w = await makeWorld();
    w.deps.mandates["d"].compiler = new UnavailableCompiler();
    const r = await compile(w);
    expect(r.statusCode).toBe(501);
    expect(w.json(r).error.code).toBe("not_implemented");
  });

  it("allowlist from the compiler wins, and is deduplicated and sorted", async () => {
    const w = await makeWorld();
    const lo = "0x" + "00".repeat(19) + "01";
    const hi = "0x" + "ff".repeat(20);
    w.compiler.result = () => ({
      category: "weather_data_api",
      maxPricePerCall: "1",
      totalBudget: "2",
      expiresAt: T0 + 60,
      merchants: [hi, lo, hi],
      questions: [],
    });
    expect(w.json(await compile(w)).merchants).toEqual([lo, hi]);
  });
});

describe("POST /mandates (signed)", () => {
  async function signed(
    w: World,
    over: {
      mandate?: Record<string, unknown>;
      terms?: unknown;
      merchants?: string[];
      signWith?: typeof accounts.owner;
    } = {},
  ) {
    const m = { ...mandate, ...over.mandate };
    const signature = await (over.signWith ?? accounts.owner).signTypedData({
      domain: escrowDomain(CHAIN_ID, ESCROW),
      types: MandateTypes,
      primaryType: "Mandate",
      message: {
        owner: m.owner as Hex,
        agent: m.agent as Hex,
        token: m.token as Hex,
        maxPricePerCall: BigInt(m.maxPricePerCall),
        totalBudget: BigInt(m.totalBudget),
        expiresAt: BigInt(m.expiresAt),
        nonce: BigInt(m.nonce),
        merchantsHash: m.merchantsHash as Hex,
        termsHash: m.termsHash as Hex,
      },
    });
    return {
      mandate: m,
      terms: over.terms ?? terms,
      merchants: over.merchants ?? [lc(accounts.merchant.address)],
      signature,
      summary: "s",
    };
  }
  const post = (w: World, payload: unknown) =>
    w.app.inject({ method: "POST", url: "/mandates", payload: payload as object });

  it("stores once (201) and is idempotent (200)", async () => {
    const w = await makeWorld();
    const p = await signed(w);
    expect((await post(w, p)).statusCode).toBe(201);
    expect((await post(w, p)).statusCode).toBe(200);
  });

  it("rejects a signature by anyone but the owner, or over different fields", async () => {
    const w = await makeWorld();
    expect((await post(w, await signed(w, { signWith: accounts.agent }))).statusCode).toBe(400);
    const p = await signed(w);
    expect(
      (await post(w, { ...p, mandate: { ...p.mandate, totalBudget: "999999999" } })).statusCode,
    ).toBe(400);
    expect((await post(w, { ...p, signature: "0x" + "11".repeat(65) })).statusCode).toBe(400);
    expect((await post(w, { ...p, signature: "0x1234" })).statusCode).toBe(400);
  });

  it("rejects terms or merchants that do not match the signed hashes", async () => {
    const w = await makeWorld();
    const p = await signed(w);
    expect((await post(w, { ...p, terms: { ...terms, category: "other" } })).statusCode).toBe(400);
    expect((await post(w, { ...p, merchants: [lc(accounts.agent.address)] })).statusCode).toBe(400);
    expect((await post(w, { ...p, merchants: [] })).statusCode).toBe(400);
  });

  it("rejects expired mandates, a foreign token, and unsorted or duplicate merchants", async () => {
    const w = await makeWorld();
    expect((await post(w, await signed(w, { mandate: { expiresAt: T0 - 5 } }))).statusCode).toBe(
      400,
    );
    expect(
      (await post(w, await signed(w, { mandate: { token: "0x" + "9".repeat(40) } }))).statusCode,
    ).toBe(400);
    const a = lc(accounts.merchant.address);
    expect((await post(w, { ...(await signed(w)), merchants: [a, a] })).statusCode).toBe(400);
  });

  it("GET reports registered_onchain once the mandate is on the chain", async () => {
    const w = await makeWorld();
    const p = await signed(w);
    const id = w.json(await post(w, p)).mandate_id;
    expect(w.json(await w.app.inject({ url: `/mandates/${id}` })).registered_onchain).toBe(false);
    await w.fake
      .as(accounts.agent.address)
      .registerMandate(mandate, [accounts.merchant.address], p.signature);
    expect(w.json(await w.app.inject({ url: `/mandates/${id}` })).registered_onchain).toBe(true);
    expect(w.mandateRepo.get(id)!.registeredOnchain).toBe(true); // cached
    expect((await w.app.inject({ url: `/mandates/${"0x" + "00".repeat(32)}` })).statusCode).toBe(
      404,
    );
    expect((await w.app.inject({ url: "/mandates/nothex" })).statusCode).toBe(400);
  });
});

describe("GET /mandates?owner=", () => {
  it("lists an owner's stored mandates newest first", async () => {
    const w = await makeWorld();
    await w.storeMandate();
    const r = w.json(await w.app.inject({ url: `/mandates?owner=${accounts.owner.address}` }));
    expect(r.mandates).toHaveLength(1);
    expect(r.mandates[0]).toMatchObject({ mandate_id: MANDATE_ID, registered_onchain: false });
    expect(
      w.json(await w.app.inject({ url: `/mandates?owner=${accounts.agent.address}` })).mandates,
    ).toEqual([]);
    expect((await w.app.inject({ url: "/mandates" })).statusCode).toBe(400);
    expect((await w.app.inject({ url: "/mandates?owner=nope" })).statusCode).toBe(400);
  });
});

describe("summary template", () => {
  it("is deterministic plain English from validated values", () => {
    const s = renderSummary({
      maxPricePerCall: "0.05",
      totalBudget: "2",
      symbol: "USDC",
      expiresAt: 1_767_286_400,
      merchants: ["0xabc" as never],
      terms: {
        ...terms,
        discretion: ["vendor_choice"],
        defaults: { ...terms.defaults, freshness_seconds: 3600, sla_ms: 5000 },
      },
    });
    expect(s).toBe(
      "Your agent may spend up to 0.05 USDC per call and 2 USDC in total on weather data API calls until 2026-01-01 16:53 UTC. Allowed merchants: 0xabc. Any other field is not restricted: vendor_choice. Responses must be valid and fresher than 1 hour and arrive within 5000 ms. Substituting a different product is not allowed.",
    );
  });
});

describe("empty and malformed JSON bodies", () => {
  it("an action POST with a JSON content type and no body reaches the handler (here: 403 admin gate), bad JSON is a 400", async () => {
    const w = await makeWorld({ adminToken: null });
    const empty = await w.app.inject({
      method: "POST",
      url: "/disputes/x/adjudicate",
      headers: { "content-type": "application/json" },
    });
    expect(empty.statusCode).toBe(403); // not a 400 body error
    const bad = await w.app.inject({
      method: "POST",
      url: "/mandates",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(bad.statusCode).toBe(400);
  });
});
