import { ANVIL_KEYS } from "./keys.js";

export interface Finding {
  path: string;
  line: number;
  reason: string;
}

// Anvil dev account 5 and 6 are used by tests; accounts 0 to 4 are in ANVIL_KEYS.
const ALLOWED = new Set(
  [
    ...Object.values(ANVIL_KEYS),
    "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  ].map((k) => k.toLowerCase()),
);

const KEY_ASSIGNMENT =
  /(private[_-]?key|secret|mnemonic|seed[_-]?phrase)\w*["']?\s*[=:]\s*["']?(0x[0-9a-fA-F]{64})\b/gi;
const PEM = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/;
const ENV_FILE = /(^|\/)\.env(\.[^/]+)?$/;

/** Scan file contents for committed secrets. Anvil's public dev keys are allowed. */
export function findSecrets(files: Array<{ path: string; text: string }>): Finding[] {
  const out: Finding[] = [];
  for (const { path, text } of files) {
    if (ENV_FILE.test(path) && !path.endsWith(".env.example")) {
      out.push({ path, line: 0, reason: "environment file must not be committed" });
    }
    text.split("\n").forEach((line, i) => {
      if (PEM.test(line)) out.push({ path, line: i + 1, reason: "PEM private key" });
      for (const m of line.matchAll(KEY_ASSIGNMENT)) {
        if (!ALLOWED.has(m[2]!.toLowerCase())) {
          out.push({
            path,
            line: i + 1,
            reason: "private key assignment that is not an anvil dev key",
          });
        }
      }
    });
  }
  return out;
}
