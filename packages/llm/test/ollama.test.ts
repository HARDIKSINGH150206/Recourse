import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createOllamaLlm } from "../src/index.js";

const schema = z.object({ ok: z.boolean() }).strict();
const jsonSchema = { type: "object", properties: { ok: { type: "boolean" } } };
const opts = { model: "qwen:7b", system: "s", user: "u", schema, jsonSchema, seed: 42 };

type Call = { url: string; body: Record<string, unknown> | undefined };
function fakeFetch(handler: (url: string) => Response | Promise<Response>, calls: Call[] = []) {
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({
      url: u,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
    });
    return handler(u);
  }) as typeof fetch;
  return f;
}
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

describe("ollama transport", () => {
  it("posts the pinned options and the JSON schema as `format`", async () => {
    const calls: Call[] = [];
    const llm = createOllamaLlm({
      baseUrl: "http://ollama.test/",
      fetch: fakeFetch(() => json({ message: { content: '{"ok":true}' } }), calls),
    });
    await expect(llm.structuredChat(opts)).resolves.toEqual({ ok: true });
    expect(calls[0]?.url).toBe("http://ollama.test/api/chat");
    expect(calls[0]?.body).toEqual({
      model: "qwen:7b",
      stream: false,
      format: jsonSchema,
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "u" },
      ],
      options: { temperature: 0, seed: 42, top_p: 1, num_ctx: 4096 },
    });
  });

  it("maps HTTP errors, network errors and odd replies to transport errors", async () => {
    const cases = [
      fakeFetch(() => json({}, 500)),
      fakeFetch(() => {
        throw new TypeError("fetch failed");
      }),
      fakeFetch(() => json({ nope: 1 })),
      fakeFetch(() => new Response("<html>", { status: 200 })),
    ];
    for (const f of cases) {
      const llm = createOllamaLlm({ baseUrl: "http://ollama.test", fetch: f });
      await expect(llm.structuredChat(opts)).rejects.toMatchObject({ code: "transport" });
    }
  });

  it("returns the model digest as its version", async () => {
    const llm = createOllamaLlm({
      baseUrl: "http://ollama.test",
      fetch: fakeFetch(() => json({ models: [{ name: "qwen:7b", digest: "abc123" }] })),
    });
    await expect(llm.modelVersion("qwen:7b")).resolves.toBe("abc123");
    await expect(llm.modelVersion("missing")).rejects.toMatchObject({ code: "transport" });
  });

  it("matches a bare name to its :latest tag", async () => {
    const llm = createOllamaLlm({
      baseUrl: "http://ollama.test",
      fetch: fakeFetch(() => json({ models: [{ name: "phi3:latest", digest: "d1" }] })),
    });
    await expect(llm.modelVersion("phi3")).resolves.toBe("d1");
  });

  it("version lookup surfaces HTTP and network failures", async () => {
    const bad = createOllamaLlm({ baseUrl: "http://o", fetch: fakeFetch(() => json({}, 503)) });
    await expect(bad.modelVersion("m")).rejects.toMatchObject({ code: "transport" });
    const down = createOllamaLlm({
      baseUrl: "http://o",
      fetch: fakeFetch(() => {
        throw new TypeError("x");
      }),
    });
    await expect(down.modelVersion("m")).rejects.toMatchObject({ code: "transport" });
  });
});
