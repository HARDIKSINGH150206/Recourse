import type { GatewayDeps } from "./deps.js";
import { anchorPending } from "./log/anchor.js";

/** Closes batches on the size/age triggers and keeps retrying anchoring. Returns a stop function. */
export function startScheduler(deps: GatewayDeps, intervalMs = 1000): () => Promise<void> {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (deps.batcher.shouldClose()) await deps.batcher.closeBatch();
      if (deps.repo.unanchoredBatches().length > 0) {
        const r = await anchorPending(deps.repo, deps.anchor);
        if (r.failed.length > 0)
          deps.logger.warn({ failed: r.failed }, "anchoring failed; will retry");
      }
    } catch (e) {
      deps.logger.error({ err: e }, "scheduler tick failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  return async () => {
    clearInterval(timer);
    while (running) await new Promise((r) => setTimeout(r, 20));
    await deps.batcher.flush();
    await anchorPending(deps.repo, deps.anchor);
  };
}
