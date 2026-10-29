import { describe, expect, it } from "vitest";
import { ManualClock, createLogger, isHex32, newRequestId, systemClock } from "../src/index.js";

describe("ids", () => {
  it("is a lowercase bytes32 and deterministic for a given uuid", () => {
    const a = newRequestId(() => "uuid-1");
    expect(isHex32(a)).toBe(true);
    expect(a).toBe(newRequestId(() => "uuid-1"));
    expect(a).not.toBe(newRequestId(() => "uuid-2"));
  });

  it("random ids do not collide", () => {
    const s = new Set(Array.from({ length: 200 }, () => newRequestId()));
    expect(s.size).toBe(200);
  });
});

describe("clock", () => {
  it("manual clock only moves when told", () => {
    const c = new ManualClock(100);
    expect(c.now()).toBe(100);
    c.advance(5);
    expect(c.now()).toBe(105);
    expect(() => c.advance(-1)).toThrow();
    expect(() => c.advance(1.5)).toThrow();
  });

  it("system clock returns integer unix seconds", () => {
    const t = systemClock.now();
    expect(Number.isInteger(t)).toBe(true);
    expect(t).toBeGreaterThan(1_700_000_000);
  });
});

describe("logger redaction", () => {
  function capture() {
    const lines: string[] = [];
    const destination = { write: (s: string) => void lines.push(s) };
    return { lines, log: createLogger("test", { destination }) };
  }

  it("censors private keys, bodies and salts, at top level and nested", () => {
    const { lines, log } = capture();
    const key = "0x" + "ab".repeat(32);
    log.info(
      { GATEWAY_PRIVATE_KEY: key, cfg: { privateKey: key }, body: "secret text", salt: "0x1" },
      "x",
    );
    const out = lines.join("");
    expect(out).not.toContain(key);
    expect(out).not.toContain("secret text");
    expect(out).toContain("[redacted]");
  });

  it("keeps non-sensitive fields", () => {
    const { lines, log } = capture();
    log.info({ request_id: "r1", dispute_id: "d1" }, "hello");
    const rec = JSON.parse(lines[0]!);
    expect(rec).toMatchObject({
      request_id: "r1",
      dispute_id: "d1",
      msg: "hello",
      service: "test",
    });
  });
});
