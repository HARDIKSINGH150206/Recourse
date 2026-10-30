import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderReport, type RunFile } from "./report.js";

/** `pnpm --filter @recourse/bench report <run-dir>`: re-renders report.md from summary.json. */
const dir = process.argv[2];
if (!dir) throw new Error("usage: report <run-dir>");
const run = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")) as RunFile;
writeFileSync(join(dir, "report.md"), renderReport(run));
console.log(`wrote ${join(dir, "report.md")}`);
