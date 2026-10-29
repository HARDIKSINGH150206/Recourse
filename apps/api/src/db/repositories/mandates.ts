import { desc, eq } from "drizzle-orm";
import type { Address } from "viem";
import type { MandateJson, Terms } from "@recourse/shared";
import type { ApiDb } from "../client.js";
import { mandates } from "../schema.js";

export interface MandateRecord {
  mandateId: string;
  mandate: MandateJson;
  terms: Terms;
  merchants: Address[];
  signature: string;
  summary: string;
  termsHash: string;
  registeredOnchain: boolean;
  createdAt: number;
}

function toRecord(r: typeof mandates.$inferSelect): MandateRecord {
  return {
    mandateId: r.mandateId,
    mandate: JSON.parse(r.mandateJson) as MandateJson,
    terms: JSON.parse(r.termsJson) as Terms,
    merchants: JSON.parse(r.merchantsJson) as Address[],
    signature: r.signature,
    summary: r.summary,
    termsHash: r.termsHash,
    registeredOnchain: r.registeredOnchain,
    createdAt: r.createdAt,
  };
}

export class MandateRepository {
  constructor(private readonly db: ApiDb) {}

  /** Insert; returns false when the mandate id already exists (stored mandates are not edited). */
  insert(m: Omit<MandateRecord, "registeredOnchain">): boolean {
    const res = this.db
      .insert(mandates)
      .values({
        mandateId: m.mandateId,
        owner: m.mandate.owner,
        agent: m.mandate.agent,
        mandateJson: JSON.stringify(m.mandate),
        termsJson: JSON.stringify(m.terms),
        termsHash: m.termsHash,
        merchantsJson: JSON.stringify(m.merchants),
        signature: m.signature,
        summary: m.summary,
        createdAt: m.createdAt,
      })
      .onConflictDoNothing()
      .run();
    return res.changes > 0;
  }

  get(mandateId: string): MandateRecord | null {
    const r = this.db.select().from(mandates).where(eq(mandates.mandateId, mandateId)).get();
    return r ? toRecord(r) : null;
  }

  listByOwner(owner: string, limit = 100): MandateRecord[] {
    return this.db
      .select()
      .from(mandates)
      .where(eq(mandates.owner, owner))
      .orderBy(desc(mandates.createdAt))
      .limit(limit)
      .all()
      .map(toRecord);
  }

  markRegistered(mandateId: string): void {
    this.db
      .update(mandates)
      .set({ registeredOnchain: true })
      .where(eq(mandates.mandateId, mandateId))
      .run();
  }
}
