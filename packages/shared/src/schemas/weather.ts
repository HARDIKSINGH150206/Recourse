import { z } from "zod";

/**
 * Response contract of the demo weather API (docs/04 section 4): types and bounds the rules engine
 * checks in R4. `temp_c` is -60..60 and `humidity` 0..100; `observed_at` is unix seconds.
 */
export const WeatherResponseSchema = z.object({
  city: z.string().min(1).max(100),
  temp_c: z.number().min(-60).max(60),
  humidity: z.number().min(0).max(100),
  observed_at: z.number().int().nonnegative(),
  summary: z.string().max(500),
});

export type WeatherResponse = z.infer<typeof WeatherResponseSchema>;
