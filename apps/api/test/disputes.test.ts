import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import { canonicalHash, type Verdict } from "@recourse/shared";
import {
  ADMIN_TOKEN,
  ESCROW_ID,
  MANDATE_ID,
  REASON,
  REQUEST_ID,
  accounts,
  makeVerdict,
  makeWorld,
  lc,
  BODY_HASH,
} from "./helpers.js";

const admin = { authorization: `Bearer ${ADMIN_TOKEN}` };

describe("dispute pipeline: happy paths", () => {
  it("refund: reason, evidence, adjudication and an on-chain resolve", async () => {
    const w = await makeWorld();
    await w.storeMandate();
    const escrowId = await w.payAndDispute();
    expect(escrowId).toBe(ESCROW_ID);
    expect(w.disputeRepo.byEscrow(escrowId)!.status).toBe("opened");

    const post = await w.app.inject({
      method: "POST",
      url: "/disputes",
      payload: { escrow_id: escrowId, reason_text: REASON },
    });
    expect(post.statusCode).toBe(202);
    await w.runScheduled();

    const d = w.json(await w.app.inject({ url: "/disputes/dispute-1" }));
    expect(d).toMatchObject({
      status: "resolved",
      escrow_id: escrowId,
      mandate_id: MANDATE_ID,
      request_id: REQUEST_ID,
    });
    expect(d.verdict).toMatchObject({ outcome: "REFUND", fault: "MERCHANT" });
    expect(d.txs.resolve).toMatch(/^0x/);
    expect(d.evidence_report).toMatchObject({
      entry_hash_ok: true,
      membership_ok: true,
      receipt_ok: true,
      chain_ok: true,
    });

    // on-chain effects
    expect((await w.chain.getEscrow(escrowId)).state).toBe("Refunded");
    expect(w.fake.balanceOf(accounts.owner.address)).toBe(100_000_000n);
    expect((await w.chain.merchantReputation(accounts.merchant.address)).faults).toBe(1);
    expect(w.evidence.flushes).toBeGreaterThanOrEqual(1);
  });

  it("gives the adjudicator everything it needs, with the reason text kept as data", async () => {
    const w = await makeWorld();
    await w.storeMandate();
    const escrowId = await w.payAndDispute();
    await w.app.inject({
      method: "POST",
      url: "/disputes",
      payload: { escrow_id: escrowId, reason_text: REASON },
    });
    await w.runScheduled();

    const input = w.adjudicator.calls[0]!;
    expect(input).toMatchObject({
      dispute_id: "dispute-1",
      escrow_id: escrowId,
      request_id: REQUEST_ID,
      reason_text: REASON,
    });
    expect(input.mandate.terms.category).toBe("weather_data_api");
    expect(input.mandate.merchants).toEqual([lc(accounts.merchant.address)]);
    expect(input.escrow).toMatchObject({
      amount: "10000",
      merchant: lc(accounts.merchant.address),
    });
    expect(input.evidence_report.errors).toEqual([]);
    expect(Object.keys(input.blobs)).toEqual([BODY_HASH]); // the gateway's blob, re-hashed by the API
  });

  it("buyer regret: RELEASE pays the merchant and blames no one", async () => {
    const w = await makeWorld({
      decide: (i) => makeVerdict(i, { outcome: "RELEASE", fault: "NONE" }),
    });
    await w.storeMandate();
    const escrowId = await w.payAndDispute();
    await w.app.inject({
      method: "POST",
      url: "/disputes",
      payload: { escrow_id: escrowId, reason_text: REASON },
    });
    await w.runScheduled();
    expect((await w.chain.getEscrow(escrowId)).state).toBe("Released");
    expect(w.fake.balanceOf(accounts.merchant.address)).toBe(10_000n);
    expect((await w.chain.merchantReputation(accounts.merchant.address)).faults).toBe(0);
  });

  it("adjudicates without a reason once the wait elapses", async () => {
    const w = await makeWorld({ reasonWaitSeconds: 3 });
    await w.storeMandate();
    await w.payAndDispute();
    expect(w.scheduled.map((s) => s.ms)).toEqual([3000]); // the reason-wait timer
    await w.runScheduled();
    expect(w.adjudicator.calls[0]!.reason_text).toBeNull();
    expect(w.disputeRepo.get("dispute-1")!.status).toBe("resolved");
  });

  it("indexes a dispute on demand when the event was missed", async () => {
    const w = await makeWorld();
    await w.storeMandate();
    // remove the watcher's record to simulate a missed event
    const escrowId = await w.payAndDispute();
    w.scheduled.length = 0;
    const db = w.disputeRepo as unknown as {
      db: { $client: { prepare: (s: string) => { run: () => void } } };
    };
    db.db.$client.prepare("delete from disputes").run();
    const r = await w.app.inject({
      method: "POST",
      url: "/disputes",
      payload: { escrow_id: escrowId, reason_text: REASON },
    });
    expect(r.statusCode).toBe(202);
  });
});

describe("POST /disputes validation", () => {
  it("rejects a reason that does not hash to the on-chain reasonHash", async () => {
    const w = await makeWorld();
    await w.storeMandate();
    const escrowId = await w.payAndDispute();
    const r = await w.app.inject({
      method: "POST",
      url: "/disputes",
      payload: { escrow_id: escrowId, reason_text: "a different story" },
    });
    expect(r.statusCode).toBe(400);
    expect(w.json(r).error.message).toMatch(/reasonHash/);
  });

  it("404s for an escrow that was never disputed, and validates the body", async () => {
    const w = await makeWorld();
    await w.storeMandate();
    const { escrowId } = await w.fake
      .as(accounts.agent.address)
      .createEscrow(MANDATE_ID, accounts.merchant.address, 10_000n, REQUEST_ID);
    expect(
      (
        await w.app.inject({
          method: "POST",
          url: "/disputes",
          payload: { escrow_id: escrowId, reason_text: REASON },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await w.app.inject({
          method: "POST",
          url: "/disputes",
          payload: { escrow_id: "0x12", reason_text: "x" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await w.app.inject({
          method: "POST",
          url: "/disputes",
          payload: { escrow_id: escrowId, reason_text: "x".repeat(2001) },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await w.app.inject({
          method: "POST",
          url: "/disputes",
          payload: { escrow_id: escrowId, reason_text: "x", extra: 1 },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("is idempotent, and refuses a reason that arrives after adjudication started", async () => {
    const w = await makeWorld();
    await w.storeMandate();
    const escrowId = await w.payAndDispute();
    const body = { escrow_id: escrowId, reason_text: REASON };
    expect(
      (await w.app.inject({ method: "POST", url: "/disputes", payload: body })).statusCode,
    ).toBe(202);
    expect(
      (await w.app.inject({ method: "POST", url: "/disputes", payload: body })).statusCode,
    ).toBe(202);
    await w.runScheduled();
    // already resolved: the same text is still an idempotent no-op ...
    expect(
      (await w.app.inject({ method: "POST", url: "/disputes", payload: body })).statusCode,
    ).toBe(202);
  });

  it("a late reason (after the run began without it) is a conflict, not silently dropped", async () => {
    const w = await makeWorld();
    await w.storeMandate();
    const escrowId = await w.payAndDispute();
    await w.runScheduled(); // the reason-wait timer fires and the dispute is adjudicated without a reason
    const r = await w.app.inject({
      method: "POST",
      url: "/disputes",
      payload: { escrow_id: escrowId, reason_text: REASON },
    });
    expect(r.statusCode).toBe(409);
  });
});

describe("the API refuses to act when it should not", () => {
  async function disputed(decide?: Parameters<typeof makeWorld>[0]) {
    const w = await makeWorld(decide);
    await w.storeMandate();
    const escrowId = await w.payAndDispute();
    await w.app.inject({
      method: "POST",
      url: "/disputes",
      payload: { escrow_id: escrowId, reason_text: REASON },
    });
    return { w, escrowId };
  }
  const status = (w: Awaited<ReturnType<typeof makeWorld>>) => w.disputeRepo.get("dispute-1")!;

  it("tampered evidence -> needs_human_review, even if the adjudicator says REFUND", async () => {
    const { w, escrowId } = await disputed();
    w.evidence.bundle.entries[3]!.entry.ts += 1; // break an entry hash
    await w.runScheduled();
    expect(status(w).status).toBe("needs_human_review");
    expect(status(w).note).toMatch(/evidence did not verify/);
    expect((await w.chain.getEscrow(escrowId)).state).toBe("Disputed");
  });

  it("a bundle for the wrong request -> needs_human_review before anything is judged", async () => {
    const { w } = await disputed();
    w.evidence.bundle.request_id = ("0x" + "11".repeat(32)) as `0x${string}`;
    await w.runScheduled();
    expect(status(w).status).toBe("needs_human_review");
    expect(w.adjudicator.calls).toHaveLength(0);
  });

  it("garbage from the gateway -> needs_human_review", async () => {
    const { w } = await disputed();
    w.evidence.getBundle = (async () => ({ nope: true })) as never;
    await w.runScheduled();
    expect(status(w).note).toMatch(/schema validation/);
  });

  it("a blob that does not hash to its key is discarded, not passed on", async () => {
    const { w } = await disputed();
    w.evidence.blobs[BODY_HASH] = new TextEncoder().encode("swapped body");
    await w.runScheduled();
    expect(w.adjudicator.calls[0]!.blobs).toEqual({});
  });

  it("unknown mandate or terms that do not match the on-chain hash -> needs_human_review", async () => {
    const w = await makeWorld();
    // chain has the mandate, the API does not
    const signature = await accounts.owner.signTypedData({
      domain: {
        name: "RecourseEscrow",
        version: "1",
        chainId: 31337,
        verifyingContract: w.fake.address,
      },
      types: (await import("@recourse/shared")).MandateTypes,
      primaryType: "Mandate",
      message: {
        owner: accounts.owner.address,
        agent: accounts.agent.address,
        token: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
        maxPricePerCall: 50000n,
        totalBudget: 2000000n,
        expiresAt: BigInt((await import("./helpers.js")).mandate.expiresAt),
        nonce: 1n,
        merchantsHash: (await import("./helpers.js")).mandate.merchantsHash as `0x${string}`,
        termsHash: (await import("./helpers.js")).mandate.termsHash as `0x${string}`,
      },
    });
    await w.fake
      .as(accounts.agent.address)
      .registerMandate(
        (await import("./helpers.js")).mandate,
        [accounts.merchant.address],
        signature,
      );
    await w.payAndDispute();
    await w.runScheduled();
    expect(status(w).status).toBe("needs_human_review");
    expect(status(w).note).toMatch(/not known/);
  });

  it("the adjudicator abstaining -> needs_human_review, nothing sent on-chain", async () => {
    const { w, escrowId } = await disputed({
      decide: (i) => makeVerdict(i, { outcome: null, fault: null }),
    });
    await w.runScheduled();
    expect(status(w)).toMatchObject({ status: "needs_human_review" });
    expect(status(w).note).toMatch(/no_quorum/);
    expect((await w.chain.getEscrow(escrowId)).state).toBe("Disputed");
  });

  const bad: Array<[string, (v: Verdict) => Partial<Verdict> | Verdict, RegExp]> = [
    [
      "a commitment that does not match the verdict",
      () => ({ commitment: canonicalHash("forged") }),
      /commitment/,
    ],
    ["REFUND with no fault", () => ({ fault: "NONE" }), /inconsistent/],
    [
      "RELEASE blaming the merchant",
      () => ({ outcome: "RELEASE", fault: "MERCHANT" }),
      /inconsistent/,
    ],
    [
      "a verdict over different evidence roots",
      () => ({ evidence_root: [canonicalHash("other-root")] }),
      /different evidence roots/,
    ],
    ["a verdict for another dispute", () => ({ dispute_id: "someone-else" }), /different dispute/],
    ["a malformed verdict", () => ({ commitment: "nope" }) as never, /invalid verdict/],
  ];
  it.each(bad)("%s -> failed, not resolved", async (_name, tweak, re) => {
    const { w, escrowId } = await disputed({
      decide: (i) =>
        ({
          ...makeVerdict(i, { outcome: "REFUND", fault: "MERCHANT" }),
          ...tweak(makeVerdict(i, { outcome: "REFUND", fault: "MERCHANT" })),
        }) as Verdict,
    });
    await w.runScheduled();
    expect(status(w).status).toBe("failed");
    expect(status(w).note).toMatch(re);
    expect((await w.chain.getEscrow(escrowId)).state).toBe("Disputed");
  });

  it("an adjudicator that throws or hangs -> failed, and can be retried", async () => {
    const { w } = await disputed({
      decide: () => {
        throw new Error("model crashed");
      },
    });
    await w.runScheduled();
    expect(status(w)).toMatchObject({ status: "failed", note: "model crashed" });

    const slow = await disputed({
      timeoutSeconds: 0.05,
      decide: () => new Promise(() => undefined),
    });
    await slow.w.runScheduled();
    await new Promise((r) => setTimeout(r, 150));
    expect(slow.w.disputeRepo.get("dispute-1")!.note).toMatch(/timed out/);
  });
});

describe("recovery and concurrency", () => {
  it("a failed resolve transaction is retried from the stored verdict without re-adjudicating", async () => {
    const w = await makeWorld();
    await w.storeMandate();
    const escrowId = await w.payAndDispute();
    await w.app.inject({
      method: "POST",
      url: "/disputes",
      payload: { escrow_id: escrowId, reason_text: REASON },
    });

    const realResolve = w.chain.resolve.bind(w.chain);
    let fail = true;
    w.chain.resolve = async (...a) => {
      if (fail) throw new Error("rpc dropped the tx");
      return realResolve(...a);
    };
    await w.runScheduled();
    expect(w.disputeRepo.get("dispute-1")).toMatchObject({
      status: "failed",
      note: "rpc dropped the tx",
    });
    expect(w.adjudicator.calls).toHaveLength(1);

    fail = false;
    const r = await w.app.inject({
      method: "POST",
      url: "/disputes/dispute-1/adjudicate",
      headers: admin,
    });
    expect(w.json(r).status).toBe("resolved");
    expect(w.adjudicator.calls).toHaveLength(1); // not asked again
  });

  it("two simultaneous runs adjudicate once", async () => {
    const w = await makeWorld();
    await w.storeMandate();
    const escrowId = await w.payAndDispute();
    await w.app.inject({
      method: "POST",
      url: "/disputes",
      payload: { escrow_id: escrowId, reason_text: REASON },
    });
    w.scheduled.length = 0;
    await Promise.all([
      w.service.process("dispute-1"),
      w.service.process("dispute-1"),
      w.service.process("dispute-1"),
    ]);
    expect(w.adjudicator.calls).toHaveLength(1);
    expect(w.disputeRepo.get("dispute-1")!.status).toBe("resolved");
  });

  it("an escrow already settled on-chain is marked resolved without a second transaction", async () => {
    const w = await makeWorld();
    await w.storeMandate();
    const escrowId = await w.payAndDispute();
    await w.fake
      .as(accounts.arbiter.address)
      .resolve(escrowId, "RELEASE", "NONE", keccak256(toHex("manual")));
    await w.runScheduled();
    expect(w.disputeRepo.get("dispute-1")).toMatchObject({
      status: "resolved",
      note: expect.stringMatching(/already settled/),
    });
    expect(w.adjudicator.calls).toHaveLength(0);
  });

  it("recover() re-queues a dispute left adjudicating by a crash", async () => {
    const w = await makeWorld();
    await w.storeMandate();
    await w.payAndDispute();
    w.scheduled.length = 0;
    expect(w.disputeRepo.transition("dispute-1", ["opened"], "adjudicating", 1)).toBe(true);
    expect(w.service.recover()).toBe(1);
    await w.runScheduled();
    expect(w.disputeRepo.get("dispute-1")!.status).toBe("resolved");
  });

  it("an unreachable gateway fails the run so it can be retried", async () => {
    const w = await makeWorld();
    await w.storeMandate();
    await w.payAndDispute();
    w.evidence.failFlush = true;
    await w.runScheduled();
    expect(w.disputeRepo.get("dispute-1")).toMatchObject({
      status: "failed",
      note: "gateway down",
    });
  });
});

describe("human review and privileged routes", () => {
  async function inReview(token: string | null = ADMIN_TOKEN) {
    const w = await makeWorld({
      adminToken: token,
      decide: (i) => makeVerdict(i, { outcome: null, fault: null }),
    });
    await w.storeMandate();
    const escrowId = await w.payAndDispute();
    await w.runScheduled();
    return { w, escrowId };
  }
  const review = { outcome: "REFUND", fault: "MERCHANT", note: "checked the logs by hand" };

  it("an operator can settle an abstained dispute, with the review recorded immutably", async () => {
    const { w, escrowId } = await inReview();
    const r = await w.app.inject({
      method: "POST",
      url: "/disputes/dispute-1/review",
      headers: admin,
      payload: review,
    });
    expect(r.statusCode).toBe(200);
    expect(w.json(r)).toMatchObject({
      status: "resolved",
      review: { outcome: "REFUND", note: review.note },
    });
    expect((await w.chain.getEscrow(escrowId)).state).toBe("Refunded");
    expect(w.json(r).verdict.outcome).toBeNull(); // the original abstention is preserved
    // a second review is a conflict
    expect(
      (
        await w.app.inject({
          method: "POST",
          url: "/disputes/dispute-1/review",
          headers: admin,
          payload: review,
        })
      ).statusCode,
    ).toBe(409);
  });

  it("requires the admin token; with none configured the routes are off", async () => {
    const { w } = await inReview();
    for (const url of ["/disputes/dispute-1/review", "/disputes/dispute-1/adjudicate"]) {
      expect((await w.app.inject({ method: "POST", url, payload: review })).statusCode).toBe(401);
      expect(
        (
          await w.app.inject({
            method: "POST",
            url,
            headers: { authorization: "Bearer wrong" },
            payload: review,
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await w.app.inject({
            method: "POST",
            url,
            headers: { authorization: `bearer ${ADMIN_TOKEN}` },
            payload: review,
          })
        ).statusCode,
      ).toBe(401);
    }
    const off = await inReview(null);
    expect(
      (
        await off.w.app.inject({
          method: "POST",
          url: "/disputes/dispute-1/review",
          headers: admin,
          payload: review,
        })
      ).statusCode,
    ).toBe(403);
  });

  it("rejects nonsense reviews and reviews of disputes that are not in review", async () => {
    const { w } = await inReview();
    const post = (payload: unknown) =>
      w.app.inject({
        method: "POST",
        url: "/disputes/dispute-1/review",
        headers: admin,
        payload: payload as object,
      });
    expect((await post({ ...review, fault: "NONE" })).statusCode).toBe(400);
    expect((await post({ outcome: "RELEASE", fault: "AGENT", note: "x" })).statusCode).toBe(400);
    expect((await post({ outcome: "REFUND", fault: "MERCHANT" })).statusCode).toBe(400);
    expect(
      (
        await w.app.inject({
          method: "POST",
          url: "/disputes/nope/review",
          headers: admin,
          payload: review,
        })
      ).statusCode,
    ).toBe(404);

    const happy = await makeWorld();
    await happy.storeMandate();
    await happy.payAndDispute();
    await happy.runScheduled(); // resolved
    expect(
      (
        await happy.app.inject({
          method: "POST",
          url: "/disputes/dispute-1/review",
          headers: admin,
          payload: review,
        })
      ).statusCode,
    ).toBe(409);
  });
});

describe("read routes", () => {
  it("lists with filters and reports reputation from the chain", async () => {
    const w = await makeWorld();
    await w.storeMandate();
    await w.payAndDispute();
    await w.runScheduled();
    expect(w.json(await w.app.inject({ url: "/disputes?status=resolved" })).disputes).toHaveLength(
      1,
    );
    expect(w.json(await w.app.inject({ url: "/disputes?status=failed" })).disputes).toHaveLength(0);
    expect(
      w.json(await w.app.inject({ url: `/disputes?mandateId=${MANDATE_ID}` })).disputes,
    ).toHaveLength(1);
    expect((await w.app.inject({ url: "/disputes?status=bogus" })).statusCode).toBe(400);
    expect((await w.app.inject({ url: "/disputes/missing" })).statusCode).toBe(404);

    const rep = w.json(await w.app.inject({ url: `/reputation/${accounts.merchant.address}` }));
    expect(rep).toMatchObject({
      address: lc(accounts.merchant.address),
      as_merchant: { disputes: 1, faults: 1 },
      as_agent: { disputes: 0, faults: 0 },
    });
    expect((await w.app.inject({ url: "/reputation/nothex" })).statusCode).toBe(400);
  });

  it("serves benchmark runs when present and 404s otherwise", async () => {
    const w = await makeWorld();
    expect((await w.app.inject({ url: "/bench/latest" })).statusCode).toBe(404);
    w.disputeRepo.insertBenchRun({
      runId: "r1",
      configJson: '{"config":"A1"}',
      resultsJson: '{"accuracy":0.9}',
      createdAt: 5,
    });
    expect(w.json(await w.app.inject({ url: "/bench/latest" }))).toMatchObject({
      run_id: "r1",
      results: { accuracy: 0.9 },
    });
    expect(w.json(await w.app.inject({ url: "/bench/runs/r1" })).config).toEqual({ config: "A1" });
    expect((await w.app.inject({ url: "/bench/runs/nope" })).statusCode).toBe(404);
  });

  it("uses the standard error shape, CORS for the dashboard only, and rate limits", async () => {
    const w = await makeWorld({ rateLimit: 5 });
    const nf = await w.app.inject({ url: "/nope" });
    expect(w.json(nf).error.code).toBe("not_found");
    const ok = await w.app.inject({ url: "/health", headers: { origin: "http://localhost:5173" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const evil = await w.app.inject({ url: "/health", headers: { origin: "http://evil.example" } });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
    let last = 200;
    for (let i = 0; i < 10; i++) last = (await w.app.inject({ url: "/health" })).statusCode;
    expect(last).toBe(429);
  });
});
