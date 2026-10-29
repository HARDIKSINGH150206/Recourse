/** Minimal .env helpers: update keys in place, keep comments and order, append new keys. */
export function upsertEnv(text: string, updates: Record<string, string>): string {
  const lines = text.split("\n");
  const remaining = new Map(Object.entries(updates));
  const out = lines.map((line) => {
    const m = /^([A-Z0-9_]+)=/.exec(line);
    if (m && remaining.has(m[1]!)) {
      const v = remaining.get(m[1]!)!;
      remaining.delete(m[1]!);
      return `${m[1]}=${v}`;
    }
    return line;
  });
  if (remaining.size > 0) {
    if (out.length > 0 && out[out.length - 1] === "") out.pop();
    for (const [k, v] of remaining) out.push(`${k}=${v}`);
    out.push("");
  }
  return out.join("\n");
}

export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) env[m[1]!] = m[2]!.replace(/\s+#.*$/, "").trim();
  }
  return env;
}
