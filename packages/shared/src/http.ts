import { RecourseError } from "./errors.js";

/**
 * JSON body parser for Fastify servers: an empty body is `{}` (a POST with a JSON content type
 * and no body is common for action routes such as /log/flush), malformed JSON is a 400.
 */
export function parseLenientJson(body: string | Buffer): unknown {
  const text = typeof body === "string" ? body : body.toString("utf8");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new RecourseError("bad_request", "request body is not valid JSON");
  }
}
