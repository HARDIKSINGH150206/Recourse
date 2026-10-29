import { and, asc, eq, gt, gte, isNull, lte, sql } from "drizzle-orm";
import type { Hex } from "viem";
import type { FieldLeaf, LogEntry } from "@recourse/shared";
import type { GatewayDb } from "../client.js";
import { batches, blobs, entries, fields } from "../schema.js";

/**
 * All gateway queries live here (GUIDE.md section 6.2). There are deliberately no update or
 * delete functions for `entries`, `fields` or `blobs` (a test asserts this, and database
 * triggers enforce it). The only mutation of `batches` is `setAnchor`, which fills the anchor
 * columns once.
 */
export interface BatchRow {
  batchIndex: number;
  firstSeq: number;
  lastSeq: number;
  root: Hex;
  size: number;
  ts: number;
  treeDump: string;
  signature: Hex;
  anchorTx: Hex | null;
  anchorBlock: number | null;
  anchorTs: number | null;
}

export interface StoredField {
  seq: number;
  name: string;
  value: unknown;
  salt: Hex;
}

function toEntry(r: typeof entries.$inferSelect): LogEntry {
  return {
    seq: r.seq,
    ts: r.ts,
    type: r.type,
    request_id: r.requestId as Hex,
    mandate_id: r.mandateId as Hex | null,
    agent_id: r.agentId as string | null,
    payload_commitment: r.payloadCommitment as Hex,
    prev_hash: r.prevHash as Hex,
    entry_hash: r.entryHash as Hex,
  };
}

function toBatch(r: typeof batches.$inferSelect): BatchRow {
  return {
    ...r,
    root: r.root as Hex,
    signature: r.signature as Hex,
    anchorTx: r.anchorTx as Hex | null,
  };
}

export class LogRepository {
  constructor(readonly db: GatewayDb) {}

  /** Run `fn` in one SQLite transaction (synchronous; better-sqlite3). */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  // ---- entries (append-only)

  lastEntry(): LogEntry | null {
    const r = this.db
      .select()
      .from(entries)
      .orderBy(sql`${entries.seq} desc`)
      .limit(1)
      .get();
    return r ? toEntry(r) : null;
  }

  insertEntry(e: LogEntry, leaves: readonly FieldLeaf[]): void {
    this.db
      .insert(entries)
      .values({
        seq: e.seq,
        ts: e.ts,
        type: e.type,
        requestId: e.request_id as string,
        mandateId: e.mandate_id,
        agentId: e.agent_id,
        payloadCommitment: e.payload_commitment,
        prevHash: e.prev_hash,
        entryHash: e.entry_hash,
      })
      .run();
    for (const l of leaves) {
      this.db
        .insert(fields)
        .values({ seq: e.seq, name: l.name, valueJson: JSON.stringify(l.value), salt: l.salt })
        .run();
    }
  }

  getEntry(seq: number): LogEntry | null {
    const r = this.db.select().from(entries).where(eq(entries.seq, seq)).get();
    return r ? toEntry(r) : null;
  }

  listEntries(q: { from?: number; to?: number; requestId?: string; limit?: number }): LogEntry[] {
    const conds = [
      q.from !== undefined ? gte(entries.seq, q.from) : undefined,
      q.to !== undefined ? lte(entries.seq, q.to) : undefined,
      q.requestId ? eq(entries.requestId, q.requestId) : undefined,
    ].filter((c) => c !== undefined);
    return this.db
      .select()
      .from(entries)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(entries.seq))
      .limit(Math.min(q.limit ?? 500, 1000))
      .all()
      .map(toEntry);
  }

  entriesInRange(firstSeq: number, lastSeq: number): LogEntry[] {
    return this.db
      .select()
      .from(entries)
      .where(and(gte(entries.seq, firstSeq), lte(entries.seq, lastSeq)))
      .orderBy(asc(entries.seq))
      .all()
      .map(toEntry);
  }

  /** Entries after the last batched seq, oldest first. */
  unbatchedEntries(afterSeq: number, limit: number): LogEntry[] {
    return this.db
      .select()
      .from(entries)
      .where(gt(entries.seq, afterSeq))
      .orderBy(asc(entries.seq))
      .limit(limit)
      .all()
      .map(toEntry);
  }

  headSeq(): number {
    return this.lastEntry()?.seq ?? 0;
  }

  // ---- fields (private; used for disclosure)

  fieldsFor(seq: number): StoredField[] {
    return this.db
      .select()
      .from(fields)
      .where(eq(fields.seq, seq))
      .orderBy(asc(fields.name))
      .all()
      .map((r) => ({
        seq: r.seq,
        name: r.name,
        value: JSON.parse(r.valueJson) as unknown,
        salt: r.salt as Hex,
      }));
  }

  // ---- blobs (append-only, content-addressed)

  putBlob(bodyHash: Hex, content: Uint8Array): void {
    this.db
      .insert(blobs)
      .values({ bodyHash, content: Buffer.from(content) })
      .onConflictDoNothing()
      .run();
  }

  getBlob(bodyHash: string): Buffer | null {
    return this.db.select().from(blobs).where(eq(blobs.bodyHash, bodyHash)).get()?.content ?? null;
  }

  // ---- batches

  lastBatch(): BatchRow | null {
    const r = this.db
      .select()
      .from(batches)
      .orderBy(sql`${batches.batchIndex} desc`)
      .limit(1)
      .get();
    return r ? toBatch(r) : null;
  }

  insertBatch(b: Omit<BatchRow, "anchorTx" | "anchorBlock" | "anchorTs">): void {
    this.db.insert(batches).values(b).run();
  }

  getBatch(index: number): BatchRow | null {
    const r = this.db.select().from(batches).where(eq(batches.batchIndex, index)).get();
    return r ? toBatch(r) : null;
  }

  batchForSeq(seq: number): BatchRow | null {
    const r = this.db
      .select()
      .from(batches)
      .where(and(lte(batches.firstSeq, seq), gte(batches.lastSeq, seq)))
      .get();
    return r ? toBatch(r) : null;
  }

  unanchoredBatches(): BatchRow[] {
    return this.db
      .select()
      .from(batches)
      .where(isNull(batches.anchorTx))
      .orderBy(asc(batches.batchIndex))
      .all()
      .map(toBatch);
  }

  setAnchor(index: number, a: { tx: Hex; block: number; ts: number }): void {
    this.db
      .update(batches)
      .set({ anchorTx: a.tx, anchorBlock: a.block, anchorTs: a.ts })
      .where(and(eq(batches.batchIndex, index), isNull(batches.anchorTx)))
      .run();
  }
}
