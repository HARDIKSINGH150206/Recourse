/**
 * Replay protection: a request id can be served once. `claim` is synchronous so two concurrent
 * paid requests cannot both win. In-memory only: after a restart the escrow-age check in
 * `protect` bounds how long an old payment proof stays usable.
 */
export interface ServedStore {
  /** Returns true if this call claimed the id, false if it was already claimed. */
  claim(requestId: string, expiresAt: number, now: number): boolean;
}

export class MemoryServedStore implements ServedStore {
  private readonly ids = new Map<string, number>();

  constructor(private readonly maxEntries = 100_000) {}

  claim(requestId: string, expiresAt: number, now: number): boolean {
    const existing = this.ids.get(requestId);
    if (existing !== undefined && existing > now) return false;
    if (this.ids.size >= this.maxEntries) this.prune(now);
    if (this.ids.size >= this.maxEntries) {
      // still full of live entries: drop the oldest insertion rather than refuse to serve
      const oldest = this.ids.keys().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    this.ids.set(requestId, expiresAt);
    return true;
  }

  private prune(now: number): void {
    for (const [id, exp] of this.ids) if (exp <= now) this.ids.delete(id);
  }

  get size(): number {
    return this.ids.size;
  }
}
