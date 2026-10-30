import { createLlm, type Llm, type LlmRequest } from "./client.js";

/** What a stub answers with: a string is returned verbatim, anything else is JSON-encoded. */
export type StubReply = string | object;

export interface StubLlm extends Llm {
  /** Every request the stub received, in order (retries included). */
  readonly calls: readonly LlmRequest[];
}

/**
 * Deterministic stand-in for a model (GUIDE.md section 4.1). It goes through the same validation
 * and retry path as the real client, so it passes the same interface tests.
 * `respond` may be a function of the request, or a queue consumed one reply per call.
 */
export function createStubLlm(
  respond: ((req: LlmRequest) => StubReply | Promise<StubReply>) | StubReply[],
  version = "stub-1",
): StubLlm {
  const calls: LlmRequest[] = [];
  const queue = Array.isArray(respond) ? [...respond] : null;
  const llm = createLlm(
    async (req) => {
      calls.push(req);
      let reply: StubReply | undefined;
      if (queue) reply = queue.shift();
      else if (typeof respond === "function") reply = await respond(req);
      if (reply === undefined) throw new Error("stub llm: no reply queued for this call");
      return typeof reply === "string" ? reply : JSON.stringify(reply);
    },
    async () => version,
  );
  return Object.assign(llm, { calls });
}
