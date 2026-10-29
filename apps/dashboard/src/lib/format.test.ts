import { describe, expect, it } from "vitest";
import { errMessage, short } from "./format";

describe("format", () => {
  it("truncates long hex and keeps short values", () => {
    const h = `0x${"ab".repeat(32)}`;
    expect(short(h)).toBe("0xababab…ababab");
    expect(short("0x12")).toBe("0x12");
  });
  it("prefers viem's shortMessage", () => {
    expect(errMessage(Object.assign(new Error("long"), { shortMessage: "short" }))).toBe("short");
    expect(errMessage("x")).toBe("x");
  });
});
