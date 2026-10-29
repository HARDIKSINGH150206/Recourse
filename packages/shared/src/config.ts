import { z } from "zod";
import { AddressLc } from "./schemas/common.js";
import { RecourseError } from "./errors.js";

const optionalKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "expected 0x-prefixed 32-byte private key")
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalAddress = AddressLc.optional().or(z.literal("").transform(() => undefined));

export type KeyName =
  | "DEPLOYER_PRIVATE_KEY"
  | "OWNER_PRIVATE_KEY"
  | "AGENT_PRIVATE_KEY"
  | "MERCHANT_PRIVATE_KEY"
  | "GATEWAY_PRIVATE_KEY"
  | "ARBITER_PRIVATE_KEY";

const port = (def: number) => z.coerce.number().int().min(1).max(65535).default(def);

export const ConfigSchema = z.object({
  CHAIN_ID: z.coerce.number().int().positive().default(31337),
  RPC_URL: z.string().url().default("http://127.0.0.1:8545"),
  ESCROW_ADDRESS: optionalAddress,
  TOKEN_ADDRESS: optionalAddress,

  DEPLOYER_PRIVATE_KEY: optionalKey,
  OWNER_PRIVATE_KEY: optionalKey,
  AGENT_PRIVATE_KEY: optionalKey,
  MERCHANT_PRIVATE_KEY: optionalKey,
  GATEWAY_PRIVATE_KEY: optionalKey,
  ARBITER_PRIVATE_KEY: optionalKey,

  DISPUTE_WINDOW_SECONDS: z.coerce.number().int().positive().default(120),
  BATCH_MAX_ENTRIES: z.coerce.number().int().positive().default(16),
  BATCH_MAX_SECONDS: z.coerce.number().int().positive().default(30),

  GATEWAY_PORT: port(4000),
  API_PORT: port(4100),
  MERCHANT_PORT: port(4200),
  AGENT_PORT: port(4300),
  GATEWAY_URL: z.string().url().default("http://localhost:4000"),
  API_URL: z.string().url().default("http://localhost:4100"),
  MERCHANT_URL: z.string().url().default("http://localhost:4200"),
  DB_DIR: z.string().default("./data"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  ENABLE_DEV_ROUTES: z.enum(["0", "1"]).default("0"),

  /** Bearer token for the API's privileged routes (manual adjudication, human review). Unset disables them. */
  API_ADMIN_TOKEN: z
    .string()
    .min(16, "API_ADMIN_TOKEN must be at least 16 characters")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** How long the API waits for the owner's reason text before adjudicating without it. */
  REASON_WAIT_SECONDS: z.coerce.number().int().min(0).max(600).default(3),
  ADJUDICATION_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),

  OLLAMA_URL: z.string().url().default("http://localhost:11434"),
  JUDGE_COUNT: z.coerce.number().int().min(1).max(3).default(1),
  AGENT_LLM: z.enum(["0", "1"]).default("0"),
  DEMO_REPLAY: z.enum(["0", "1"]).default("0"),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Parse and validate env; throws a RecourseError listing every problem (fail fast at startup). */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new RecourseError("bad_request", `invalid environment: ${issues.join("; ")}`, { issues });
  }
  return parsed.data;
}

/** Each process asks only for the key of its own role; a missing key fails fast. */
export function requireKey(cfg: Config, name: KeyName): `0x${string}` {
  const v = cfg[name];
  if (!v) throw new RecourseError("bad_request", `${name} is required for this process`);
  return v as `0x${string}`;
}

export function requireAddress(
  cfg: Config,
  name: "ESCROW_ADDRESS" | "TOKEN_ADDRESS",
): `0x${string}` {
  const v = cfg[name];
  if (!v) throw new RecourseError("bad_request", `${name} is required for this process`);
  return v as `0x${string}`;
}
