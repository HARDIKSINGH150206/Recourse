// Fails if a tracked file looks like it contains a real secret. Usage: pnpm check:secrets
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findSecrets } from "./lib/secrets.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter((p) => p && p !== "pnpm-lock.yaml");

const files = tracked.flatMap((path) => {
  try {
    const abs = join(root, path);
    if (statSync(abs).size > 1_000_000) return [];
    const text = readFileSync(abs, "utf8");
    return text.includes("\0") ? [] : [{ path, text }];
  } catch {
    return [];
  }
});

const findings = findSecrets(files);
for (const f of findings) console.error(`${f.path}:${f.line}: ${f.reason}`);
if (findings.length > 0) process.exit(1);
console.log(`secret scan clean (${files.length} files)`);
