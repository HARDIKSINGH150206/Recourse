import { randomBytes } from "node:crypto";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import {
  AddressLc,
  MandateSchema,
  MandateTypes,
  RecourseError,
  Signature65,
  TermsSchema,
  canonicalHash,
  escrowDomain,
  mandateId as computeMandateId,
  mandateTypedData,
  merchantsHash,
  sortMerchants,
  type Clock,
  type MandateJson,
  type Terms,
} from "@recourse/shared";
import type { EscrowApi } from "@recourse/chain";
import type { MandateRecord, MandateRepository } from "../db/repositories/mandates.js";
import type { CompiledIntent, MandateCompilerPort } from "../ports.js";
import { decimalToUnits, renderSummary, unitsToDecimal } from "./summary.js";

const MAX_MERCHANTS = 50;
const MAX_LIFETIME_SECONDS = 366 * 86_400;

export const CompileRequestSchema = z
  .object({
    text: z.string().min(1).max(2000),
    owner: AddressLc,
    agent: AddressLc,
    merchants: z.array(AddressLc).max(MAX_MERCHANTS).default([]),
    chain_id: z.number().int().positive(),
    escrow: AddressLc,
    token: AddressLc,
  })
  .strict();

/** The compiler is an LLM boundary: whatever it returns is re-validated here. */
const CompiledIntentSchema = z.object({
  category: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/),
  maxPricePerCall: z.string(),
  totalBudget: z.string(),
  expiresAt: z.number().int(),
  merchants: z.array(AddressLc).max(MAX_MERCHANTS),
  defaults: TermsSchema.shape.defaults.partial().optional(),
  discretion: z.array(z.string().max(64)).max(20).optional(),
  questions: z
    .array(
      z.object({
        id: z.string().max(64),
        text: z.string().max(300),
        options: z.array(z.string().max(100)).min(2).max(6),
      }),
    )
    .max(10),
});

export const StoreRequestSchema = z
  .object({
    mandate: MandateSchema,
    terms: TermsSchema,
    merchants: z.array(AddressLc).min(1).max(MAX_MERCHANTS),
    signature: Signature65,
    summary: z.string().min(1).max(4000),
  })
  .strict();

export interface MandateServiceDeps {
  repo: MandateRepository;
  chain: Pick<EscrowApi, "getMandate">;
  compiler: MandateCompilerPort;
  clock: Clock;
  chainId: number;
  escrow: Address;
  token: Address;
  tokenDecimals: number;
  tokenSymbol: string;
  /** Overridable for deterministic tests. */
  nonce?: () => bigint;
}

const randomNonce = () => BigInt(`0x${randomBytes(8).toString("hex")}`);

export class MandateService {
  constructor(private readonly d: MandateServiceDeps) {}

  /** Natural language -> unsigned mandate, terms, plain-English summary and EIP-712 typed data. */
  async compile(input: unknown) {
    const req = CompileRequestSchema.parse(input);
    if (
      req.chain_id !== this.d.chainId ||
      req.escrow !== this.d.escrow.toLowerCase() ||
      req.token !== this.d.token.toLowerCase()
    ) {
      throw new RecourseError(
        "bad_request",
        "chain_id, escrow or token do not match this deployment",
      );
    }
    const now = this.d.clock.now();
    const raw = await this.d.compiler.compile(req.text, {
      owner: req.owner as Address,
      agent: req.agent as Address,
      merchants: req.merchants as Address[],
      chainId: req.chain_id,
      escrow: req.escrow as Address,
      token: req.token as Address,
      now,
    });
    const parsed = CompiledIntentSchema.safeParse(raw);
    if (!parsed.success)
      throw new RecourseError("upstream_error", "the mandate compiler returned an invalid result");
    const intent: CompiledIntent = parsed.data as CompiledIntent;

    const merchants = sortMerchants([
      ...new Set(
        (intent.merchants.length > 0 ? intent.merchants : req.merchants).map((m) =>
          m.toLowerCase(),
        ),
      ),
    ] as Address[]);
    if (merchants.length === 0)
      throw new RecourseError("bad_request", "no merchants: name at least one allowed merchant");

    let maxUnits: bigint;
    let budgetUnits: bigint;
    try {
      maxUnits = decimalToUnits(intent.maxPricePerCall, this.d.tokenDecimals);
      budgetUnits = decimalToUnits(intent.totalBudget, this.d.tokenDecimals);
    } catch (e) {
      throw new RecourseError("bad_request", (e as Error).message);
    }
    if (budgetUnits < maxUnits)
      throw new RecourseError("bad_request", "total budget is below the per-call cap");
    if (intent.expiresAt <= now || intent.expiresAt > now + MAX_LIFETIME_SECONDS) {
      throw new RecourseError("bad_request", "expiry must be in the future and within a year");
    }

    const terms: Terms = TermsSchema.parse({
      version: 1,
      category: intent.category,
      defaults: {
        freshness_seconds: 3600,
        schema_required: true,
        substitutions: "not_allowed",
        sla_ms: 5000,
        ...intent.defaults,
      },
      discretion: intent.discretion ?? [],
    });
    const mandate: MandateJson = {
      owner: req.owner,
      agent: req.agent,
      token: req.token,
      maxPricePerCall: maxUnits.toString(),
      totalBudget: budgetUnits.toString(),
      expiresAt: intent.expiresAt,
      nonce: (this.d.nonce ?? randomNonce)().toString(),
      merchantsHash: merchantsHash(merchants),
      termsHash: canonicalHash(terms),
    };

    const typed = mandateTypedData(this.d.chainId, this.d.escrow, mandate);
    return {
      mandate,
      display: {
        maxPricePerCall: unitsToDecimal(maxUnits, this.d.tokenDecimals),
        totalBudget: unitsToDecimal(budgetUnits, this.d.tokenDecimals),
        symbol: this.d.tokenSymbol,
      },
      terms,
      merchants,
      summary: renderSummary({
        maxPricePerCall: unitsToDecimal(maxUnits, this.d.tokenDecimals),
        totalBudget: unitsToDecimal(budgetUnits, this.d.tokenDecimals),
        symbol: this.d.tokenSymbol,
        expiresAt: intent.expiresAt,
        merchants,
        terms,
      }),
      questions: intent.questions,
      typed_data: {
        domain: typed.domain,
        types: typed.types,
        primaryType: typed.primaryType,
        // JSON-safe: uint values as decimal strings
        message: Object.fromEntries(
          Object.entries(typed.message).map(([k, v]) => [
            k,
            typeof v === "bigint" ? v.toString() : v,
          ]),
        ),
      },
    };
  }

  /** Verify and store a mandate the owner signed. Idempotent per mandate id. */
  async store(input: unknown): Promise<{ mandate_id: Hex; created: boolean }> {
    const req = StoreRequestSchema.parse(input);
    const m = req.mandate;
    const now = this.d.clock.now();

    const merchants = req.merchants.map((a) => a.toLowerCase()) as Address[];
    if (
      sortMerchants(merchants).join() !== merchants.join() ||
      new Set(merchants).size !== merchants.length
    ) {
      throw new RecourseError("bad_request", "merchants must be unique and sorted ascending");
    }
    if (merchantsHash(merchants) !== m.merchantsHash)
      throw new RecourseError("bad_request", "merchantsHash does not match merchants");
    if (canonicalHash(req.terms) !== m.termsHash)
      throw new RecourseError("bad_request", "termsHash does not match terms");
    if (m.token !== this.d.token.toLowerCase())
      throw new RecourseError("bad_request", "mandate token does not match this deployment");
    if (m.expiresAt <= now) throw new RecourseError("bad_request", "mandate has already expired");

    const mandateId = computeMandateId(this.d.chainId, this.d.escrow, m);
    let signer: Address | null = null;
    try {
      signer = await recoverTypedDataAddress({
        domain: escrowDomain(this.d.chainId, this.d.escrow),
        types: MandateTypes,
        primaryType: "Mandate",
        message: mandateTypedData(this.d.chainId, this.d.escrow, m).message,
        signature: req.signature as Hex,
      });
    } catch {
      signer = null;
    }
    // EOA owners only: smart-account (ERC-1271) signatures are verified by the contract at registration.
    if (!signer || signer.toLowerCase() !== m.owner)
      throw new RecourseError("bad_request", "signature was not made by the mandate owner");

    const created = this.d.repo.insert({
      mandateId,
      mandate: m,
      terms: req.terms,
      merchants,
      signature: req.signature,
      summary: req.summary,
      termsHash: m.termsHash,
      createdAt: now,
    });
    return { mandate_id: mandateId, created };
  }

  listByOwner(owner: string, limit?: number): MandateRecord[] {
    return this.d.repo.listByOwner(owner, limit);
  }

  /** Stored mandate plus its on-chain registration status (cached once true). */
  async get(mandateId: string): Promise<(MandateRecord & { registeredOnchain: boolean }) | null> {
    const rec = this.d.repo.get(mandateId);
    if (!rec) return null;
    if (!rec.registeredOnchain) {
      const onchain = await this.d.chain.getMandate(mandateId as Hex).catch(() => null);
      if (onchain && onchain.termsHash === rec.termsHash) {
        this.d.repo.markRegistered(mandateId);
        return { ...rec, registeredOnchain: true };
      }
    }
    return rec;
  }
}
