import { zodToJsonSchema } from "zod-to-json-schema";

/** JSON Schema for Ollama's `format`, from the same zod schema that validates the reply. */
export function jsonSchemaOf(schema: Parameters<typeof zodToJsonSchema>[0]): object {
  const out = { ...zodToJsonSchema(schema, { $refStrategy: "none" }) } as Record<string, unknown>;
  delete out.$schema;
  return out;
}
