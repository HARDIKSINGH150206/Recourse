import pino, { type DestinationStream, type Logger } from "pino";

/**
 * Keys whose values never reach a log line. Private keys and raw evidence bodies must not
 * be logged at info level (CLAUDE.md conventions), so they are censored at every level.
 */
export const REDACT_KEYS = [
  "privateKey",
  "private_key",
  "DEPLOYER_PRIVATE_KEY",
  "OWNER_PRIVATE_KEY",
  "AGENT_PRIVATE_KEY",
  "MERCHANT_PRIVATE_KEY",
  "GATEWAY_PRIVATE_KEY",
  "ARBITER_PRIVATE_KEY",
  "authorization",
  "cookie",
  "body",
  "reason_text",
  "bodyText",
  "salt",
] as const;

const paths = REDACT_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`, `headers.${k}`]);

export function createLogger(
  name: string,
  opts: { level?: string; destination?: DestinationStream } = {},
): Logger {
  return pino(
    {
      name,
      level: opts.level ?? "info",
      redact: { paths, censor: "[redacted]" },
      base: { service: name },
    },
    opts.destination,
  );
}
