import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, post, request } from "./api";

const reply = (status: number, body: string) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status })));

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("returns parsed JSON", async () => {
    reply(200, '{"ok":true}');
    expect(await request("http://x", "/h")).toEqual({ ok: true });
  });
  it("surfaces the standard error shape", async () => {
    reply(400, '{"error":{"code":"bad_request","message":"nope"}}');
    await expect(post("http://x", "/m", {})).rejects.toMatchObject({
      code: "bad_request",
      message: "nope",
      status: 400,
    });
  });
  it("handles non-JSON error pages and unreachable servers", async () => {
    reply(502, "<html>bad gateway</html>");
    await expect(request("http://x", "/h")).rejects.toMatchObject({ code: "http_error" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fail")));
    await expect(request("http://x", "/h")).rejects.toBeInstanceOf(ApiError);
  });
});
