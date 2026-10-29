import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, toHex } from "viem";
import { RecourseError } from "@recourse/shared";
import { openDatabase, pendingMigrations } from "../src/db/client.js";
import { HttpEvidenceClient } from "../src/services/evidence-client.js";
import { decimalToUnits, unitsToDecimal } from "../src/services/summary.js";

describe("database", () => {
  it("creates tables and the immutability triggers", () => {
    const db = openDatabase(":memory:");
    const names = (type: string) =>
      (
        db.$client.prepare("select name from sqlite_master where type = ?").all(type) as Array<{
          name: string;
        }>
      ).map((r) => r.name);
    expect(names("table")).toEqual(
      expect.arrayContaining(["mandates", "disputes", "verdicts", "reviews", "bench_runs"]),
    );
    expect(names("trigger")).toEqual(
      expect.arrayContaining([
        "verdicts_no_update",
        "verdicts_no_delete",
        "reviews_no_update",
        "reviews_no_delete",
      ]),
    );
    expect(pendingMigrations(db.$client)).toBe(0);
  });

  it("verdicts cannot be rewritten or deleted", () => {
    const db = openDatabase(":memory:");
    const sql = db.$client;
    sql
      .prepare(
        "insert into disputes (dispute_id, escrow_id, mandate_id, request_id, reason_hash, status, created_at, updated_at) values ('d','e','m','r','h','opened',1,1)",
      )
      .run();
    sql.prepare("insert into verdicts values ('d','{}','c',1)").run();
    expect(() => sql.prepare("update verdicts set commitment = 'x'").run()).toThrow(/immutable/);
    expect(() => sql.prepare("delete from verdicts").run()).toThrow(/immutable/);
  });

  it("enforces one dispute per escrow", () => {
    const db = openDatabase(":memory:");
    const ins = () =>
      db.$client
        .prepare(
          "insert into disputes (dispute_id, escrow_id, mandate_id, request_id, reason_hash, status, created_at, updated_at) values (?,'e','m','r','h','opened',1,1)",
        )
        .run(Math.random().toString());
    ins();
    expect(ins).toThrow(/UNIQUE/);
  });

  it("refuses to start with pending migrations in check mode", () => {
    expect(() =>
      openDatabase(join(tmpdir(), `api-check-${Date.now()}.db`), { migrations: "check" }),
    ).toThrow(/pending migrations/);
  });
});

describe("amount helpers", () => {
  it("round trip decimal <-> units", () => {
    expect(decimalToUnits("0.05", 6)).toBe(50_000n);
    expect(decimalToUnits("2", 6)).toBe(2_000_000n);
    expect(unitsToDecimal(50_000n, 6)).toBe("0.05");
    expect(unitsToDecimal(2_000_000n, 6)).toBe("2");
    expect(unitsToDecimal(1n, 6)).toBe("0.000001");
    for (const bad of ["", "-1", "0", "0.0000001", "1e3", ".5", "1.", "abc"])
      expect(() => decimalToUnits(bad, 6), bad).toThrow();
  });
});

describe("HttpEvidenceClient", () => {
  async function server(handler: Parameters<typeof createServer>[1]) {
    const s = createServer(handler);
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    return { url, close: () => new Promise<void>((r) => s.close(() => r())) };
  }

  it("talks to the gateway routes and treats 404 blobs as absent", async () => {
    const seen: string[] = [];
    const srv = await server((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      if (req.url === "/log/flush") return void res.end("{}");
      if (req.url?.startsWith("/evidence/blob/")) return void res.writeHead(404).end();
      if (req.url?.startsWith("/log/batches/"))
        return void res.end(JSON.stringify({ entries: [{ seq: 1 }] }));
      res.end(JSON.stringify({ hello: "bundle" }));
    });
    const c = new HttpEvidenceClient(srv.url);
    const id = keccak256(toHex("r"));
    await c.flush();
    expect(await c.getBundle(id)).toEqual({ hello: "bundle" });
    expect(await c.getBlob(id)).toBeNull();
    expect(await c.getBatchEntries(0)).toEqual([{ seq: 1 }]);
    expect(seen).toEqual([
      "POST /log/flush",
      `GET /evidence/${id}`,
      `GET /evidence/blob/${id}`,
      "GET /log/batches/0",
    ]);
    await srv.close();
  });

  it("turns gateway errors, timeouts and oversized blobs into upstream_error", async () => {
    const srv = await server((req, res) => {
      if (req.url === "/log/flush") return void res.writeHead(500).end();
      if (req.url?.startsWith("/evidence/blob/")) return void res.end(Buffer.alloc(100));
      setTimeout(() => res.end("{}"), 300);
    });
    const id = keccak256(toHex("r"));
    await expect(new HttpEvidenceClient(srv.url).flush()).rejects.toMatchObject({
      code: "upstream_error",
    });
    await expect(new HttpEvidenceClient(srv.url, fetch, 50).getBundle(id)).rejects.toBeInstanceOf(
      RecourseError,
    );
    await expect(
      new HttpEvidenceClient(srv.url, fetch, 1000, 10).getBlob(id),
    ).rejects.toMatchObject({ code: "upstream_error" });
    await srv.close();
    await expect(new HttpEvidenceClient("http://127.0.0.1:1").flush()).rejects.toMatchObject({
      code: "upstream_error",
    });
  });
});
