import { relative, resolve, sep } from "node:path";

/** Refuse to delete anything that is not strictly inside the repo (or is the repo itself). */
export function assertInsideRepo(repoRoot: string, target: string): string {
  const abs = resolve(repoRoot, target);
  const rel = relative(resolve(repoRoot), abs);
  if (rel === "" || rel.startsWith("..") || rel.split(sep)[0] === "..") {
    throw new Error(`refusing to touch ${abs}: not strictly inside the repository`);
  }
  return abs;
}
