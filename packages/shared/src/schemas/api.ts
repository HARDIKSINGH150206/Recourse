import { z } from "zod";

/** Error body returned by every HTTP API (docs/04 conventions). */
export const ApiErrorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.unknown()).optional(),
    }),
  })
  .strict();
