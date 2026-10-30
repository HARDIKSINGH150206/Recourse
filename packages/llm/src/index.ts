import { createOllamaLlm } from "./ollama.js";
import type { StructuredChatOptions } from "./client.js";

export {
  DEFAULT_SETTINGS,
  LlmError,
  createLlm,
  type Llm,
  type LlmErrorCode,
  type LlmRequest,
  type LlmTransport,
  type StructuredChatOptions,
} from "./client.js";
export {
  createOllamaLlm,
  createOllamaTransport,
  createOllamaVersionLookup,
  type OllamaOptions,
} from "./ollama.js";
export { jsonSchemaOf } from "./schema.js";
export { createStubLlm, type StubLlm, type StubReply } from "./stub.js";

let defaultLlm: ReturnType<typeof createOllamaLlm> | undefined;

/** docs/04 section 7 entry point, against the Ollama server in `OLLAMA_URL`. */
export function structuredChat<T>(opts: StructuredChatOptions<T>): Promise<T> {
  defaultLlm ??= createOllamaLlm();
  return defaultLlm.structuredChat(opts);
}
