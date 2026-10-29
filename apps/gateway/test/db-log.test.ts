import { beforeEach, describe, expect, it } from "vitest";
import { keccak256, toHex, type Hex } from "viem";
import { ZERO32, entryHash, verifyBatchProof, recoverTreeHeadSigner } from "@recourse/shared";
import { openDatabase, pendingMigrations } from "../src/db/client.js";
import { LogRepository } from "../src/db/repositories/log.js";
import { anchorPending, escrowAnchor, type ChainAnchor } from "../src/log/anchor.js";
import { Batcher, treeHeadOf } from "../src/log/batcher.js";
import { EvidenceLog } from "../src/log/evidence-log.js";
import { CHAIN_ID, T0, gateway, makeHarness } from "./helpers.js";
import { ManualClock, type LogEntry } from "@recourse/shared";

const RID = keccak256(toHex("r1"));
const MID = keccak256(toHex("m1"));

function setup(maxEntries = 4) {
  const clock = new ManualClock(T0);
  const db = openDatabase(":memory:");
  const repo = new LogRepository(db);
  const log = new EvidenceLog(repo, clock, (seq, name) => keccak256(toHex(`salt-${seq}-${name}`)));
  const batcher = new Batcher(repo, gateway, clock, {
    chainId: CHAIN_ID,
    maxEntries,
    maxSeconds: 30,
  });
  const add = (type: LogEntry["type"] = "request", fields: Record<string, unknown> = { a: 1 }) =>
    log.append({ type, requestId: RID, mandateId: MID, agentId: null, fields });
  return { clock, db, repo, log, batcher, add };
}

describe("database", () => {
  it("creates the expected tables, index and append-only triggers", () => {
    const { db } = setup();
    const names = (type: string) =>
      (
        db.$client.prepare("select name from sqlite_master where type = ?").all(type) as Array<{
          name: string;
        }>
      ).map((r) => r.name);
    expect(names("table")).toEqual(
      expect.arrayContaining(["entries", "fields", "blobs", "batches"]),
    );
    expect(names("index")).toContain("entries_request");
    expect(names("trigger")).toEqual(
      expect.arrayContaining([
        "entries_no_update",
        "entries_no_delete",
        "fields_no_update",
        "blobs_no_delete",
        "batches_immutable_core",
      ]),
    );
    expect(pendingMigrations(db.$client)).toBe(0);
  });

  it("exposes no update or delete functions for log tables (GUIDE 6.4 rule 5)", () => {
    const methods = Object.getOwnPropertyNames(LogRepository.prototype);
    expect(methods.filter((m) => /^(update|delete|remove|set|put)/i.test(m)).sort()).toEqual([
      "putBlob",
      "setAnchor",
    ]);
  });

  it("the database itself rejects rewriting history", () => {
    const { db, add } = setup();
    add();
    const sql = db.$client;
    expect(() => sql.prepare("update entries set ts = 1").run()).toThrow(/append-only/);
    expect(() => sql.prepare("delete from entries").run()).toThrow(/append-only/);
    expect(() => sql.prepare("update fields set salt = 'x'").run()).toThrow(/append-only/);
    expect(() => sql.prepare("delete from fields").run()).toThrow(/append-only/);
    sql.prepare("insert into blobs values ('h', x'00')").run();
    expect(() => sql.prepare("update blobs set content = x'01'").run()).toThrow(/append-only/);
    expect(() => sql.prepare("delete from blobs").run()).toThrow(/append-only/);
  });

  it("refuses to start with pending migrations in check mode", () => {
    // an empty file db has no migrations table
    expect(() =>
      openDatabase(`${process.env.TMPDIR ?? "/tmp"}/gw-check-${Date.now()}.db`, {
        migrations: "check",
      }),
    ).toThrow(/pending migrations/);
  });
});

describe("EvidenceLog", () => {
  it("is gapless and hash-chained from ZERO32", () => {
    const { add } = setup();
    const a = add(),
      b = add("response"),
      c = add("receipt");
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    expect(a.prev_hash).toBe(ZERO32);
    expect(b.prev_hash).toBe(a.entry_hash);
    expect(c.prev_hash).toBe(b.entry_hash);
    for (const e of [a, b, c]) expect(entryHash(e)).toBe(e.entry_hash);
  });

  it("never lets ts go backwards", () => {
    const { add, clock } = setup();
    clock.set(T0 + 100);
    const a = add();
    clock.set(T0 + 50);
    expect(add().ts).toBe(a.ts);
  });

  it("stores fields with salts for later disclosure and rolls back on failure", () => {
    const { add, repo } = setup();
    const e = add("response", { status: 200, body_len: 5 });
    expect(repo.fieldsFor(e.seq).map((f) => f.name)).toEqual(["body_len", "status"]);
    expect(() => add("request", { bad: 1.5 })).toThrow(/float/);
    expect(repo.headSeq()).toBe(1); // failed append left nothing behind
  });
});

describe("Batcher", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => void (s = setup(4)));

  it("does nothing with no pending entries", async () => {
    expect(s.batcher.shouldClose()).toBe(false);
    expect(await s.batcher.closeBatch()).toBeNull();
  });

  it("triggers on size or age", () => {
    s.add();
    s.add();
    expect(s.batcher.shouldClose()).toBe(false);
    s.clock.advance(30);
    expect(s.batcher.shouldClose()).toBe(true);
    const t = setup(4);
    for (let i = 0; i < 4; i++) t.add();
    expect(t.batcher.shouldClose()).toBe(true);
  });

  it("closes contiguous batches with cumulative size and signed heads", async () => {
    for (let i = 0; i < 6; i++) s.add();
    const b0 = (await s.batcher.closeBatch())!;
    const b1 = (await s.batcher.closeBatch())!;
    expect([b0.batchIndex, b0.firstSeq, b0.lastSeq, b0.size]).toEqual([0, 1, 4, 4]);
    expect([b1.batchIndex, b1.firstSeq, b1.lastSeq, b1.size]).toEqual([1, 5, 6, 6]);
    expect(await s.batcher.closeBatch()).toBeNull();
    for (const b of [b0, b1]) {
      expect(await recoverTreeHeadSigner(CHAIN_ID, treeHeadOf(b))).toBe(gateway.address);
    }
  });

  it("flush drains the backlog; proofs verify against the root", async () => {
    for (let i = 0; i < 9; i++) s.add();
    expect((await s.batcher.flush()).map((b) => b.batchIndex)).toEqual([0, 1, 2]);
    for (let seq = 1; seq <= 9; seq++) {
      const p = s.batcher.proofFor(seq)!;
      const e = s.repo.getEntry(seq)!;
      expect(
        verifyBatchProof(p.batch.root, { seq, entry_hash: e.entry_hash as Hex }, p.proof),
      ).toBe(true);
    }
    expect(s.batcher.proofFor(99)).toBeNull();
  });

  it("serialises concurrent closes without overlap or gaps", async () => {
    for (let i = 0; i < 8; i++) s.add();
    const rs = await Promise.all([
      s.batcher.closeBatch(),
      s.batcher.closeBatch(),
      s.batcher.closeBatch(),
    ]);
    expect(rs.filter(Boolean).map((b) => [b!.firstSeq, b!.lastSeq])).toEqual([
      [1, 4],
      [5, 8],
    ]);
  });

  it("batch content is immutable; the anchor can be set exactly once", async () => {
    s.add();
    const b = (await s.batcher.closeBatch())!;
    const sql = s.db.$client;
    expect(() => sql.prepare("update batches set root = ?").run(ZERO32)).toThrow(/immutable/);
    expect(() => sql.prepare("delete from batches").run()).toThrow(/append-only/);
    s.repo.setAnchor(b.batchIndex, { tx: keccak256(toHex("t1")), block: 1, ts: T0 });
    s.repo.setAnchor(b.batchIndex, { tx: keccak256(toHex("t2")), block: 2, ts: T0 + 1 }); // ignored
    expect(s.repo.getBatch(0)!.anchorTx).toBe(keccak256(toHex("t1")));
    expect(() =>
      sql.prepare("update batches set anchor_tx = ?").run(keccak256(toHex("t3"))),
    ).toThrow(/immutable/);
  });
});

describe("anchoring", () => {
  it("anchors pending batches in order and records the result", async () => {
    const h = await makeHarness();
    for (let i = 0; i < 3; i++)
      h.deps.log.append({
        type: "request",
        requestId: RID,
        mandateId: MID,
        agentId: null,
        fields: {},
      });
    await h.deps.batcher.flush();
    const r = await anchorPending(h.repo, h.deps.anchor);
    expect(r).toEqual({ anchored: [0], failed: [] });
    const b = h.repo.getBatch(0)!;
    expect(b.anchorTs).toBe(await h.fake.as(gateway.address).anchoredAt(b.root));
    expect(h.repo.unanchoredBatches()).toEqual([]);
  });

  it("reports failures, stops at the first, and retries later", async () => {
    const h = await makeHarness();
    for (let i = 0; i < 2; i++) {
      h.deps.log.append({
        type: "request",
        requestId: RID,
        mandateId: MID,
        agentId: null,
        fields: {},
      });
      await h.deps.batcher.closeBatch();
    }
    let fail = true;
    const good = escrowAnchor(h.fake.as(gateway.address));
    const flaky: ChainAnchor = {
      anchor: (...a) => (fail ? Promise.reject(new Error("rpc down")) : good.anchor(...a)),
    };
    const r1 = await anchorPending(h.repo, flaky);
    expect(r1.anchored).toEqual([]);
    expect(r1.failed).toEqual([{ batchIndex: 0, error: "rpc down" }]);
    fail = false;
    expect((await anchorPending(h.repo, flaky)).anchored).toEqual([0, 1]);
  });
});
