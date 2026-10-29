import { z } from "zod";
import { getAddress, type Address, type Hex } from "viem";
import { priceToUnits } from "@recourse/merchant-sdk";
import { Hex32, newRequestId, type Clock } from "@recourse/shared";
import type { Payer } from "./payer.js";
import type { Run, RunStep } from "./runs.js";
import type { Scenario } from "./scenarios/index.js";

/** The merchant's 402 quote (docs/04 section 4.1). */
/** Addresses may arrive in any case (checksummed or not); compare them lowercased. */
const AddressAnyCase = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((a) => a.toLowerCase());

const RequirementsSchema = z.object({
  scheme: z.literal("recourse-escrow"),
  chain_id: z.number().int(),
  escrow: AddressAnyCase,
  token: AddressAnyCase,
  merchant: AddressAnyCase,
  amount: z.string(),
  request_id: Hex32,
  expires_at: z.number().int(),
});

export interface AgentContext {
  gatewayUrl: string;
  merchantId: string;
  city: string;
  chainId: number;
  escrow: Address;
  token: Address;
  agentAddress: Address;
  overCapAmount: string;
  tokenDecimals: number;
  payer: Payer;
  clock: Clock;
  fetchImpl?: typeof fetch;
  /** Resolves the registered mandate this agent may spend under. */
  resolveMandate(): Promise<Hex>;
}

class StepFailed extends Error {}

/**
 * One scenario run (docs/06 section 2.3): every call goes through the gateway, the agent never
 * talks to the merchant directly, and the decision record is logged before paying. The run object
 * is updated in place so a poller sees progress.
 */
export async function executeRun(ctx: AgentContext, scenario: Scenario, run: Run): Promise<void> {
  const doFetch = ctx.fetchImpl ?? fetch;
  const step = (name: string, ok: boolean, extra: Partial<RunStep> = {}) =>
    void run.steps.push({ name, ts: ctx.clock.now(), ok, ...extra });
  const fail = (name: string, detail: string): never => {
    step(name, false, { detail });
    throw new StepFailed(detail);
  };

  try {
    // 1. mandate
    const mandateId = await ctx.resolveMandate().catch((e: Error) => fail("mandate", e.message));
    run.mandate_id = mandateId;
    step("mandate", true, { detail: mandateId });

    // 2. quote
    const requestId = newRequestId();
    run.request_id = requestId;
    const path = `/proxy/${ctx.merchantId}/api/weather?city=${encodeURIComponent(ctx.city)}`;
    const headers = {
      "x-recourse-agent": ctx.agentAddress.toLowerCase(),
      "x-recourse-mandate": mandateId,
      "x-recourse-request-id": requestId,
      "x-demo-mode": scenario.mode,
    };
    const quote = await doFetch(new URL(path, ctx.gatewayUrl), {
      headers,
      signal: AbortSignal.timeout(20_000),
    }).catch((e: Error) => fail("quote", `gateway unreachable: ${e.message}`));
    const quoteSeq = Number(quote.headers.get("x-recourse-seq")) || undefined;
    if (quote.status !== 402) fail("quote", `expected 402, got ${quote.status}`);
    const reqs = RequirementsSchema.safeParse(decodeQuote(quote.headers.get("x-payment-required")));
    if (!reqs.success) fail("quote", "the 402 quote is malformed");
    const q = reqs.data!;
    step("402 quote", true, { seq: quoteSeq, detail: `${q.amount} to ${q.merchant}` });

    // The agent checks the quote points at the contract it was configured for before paying anything.
    if (
      q.chain_id !== ctx.chainId ||
      q.escrow !== ctx.escrow.toLowerCase() ||
      q.token !== ctx.token.toLowerCase()
    ) {
      fail("verify quote", "the quote names a different chain, escrow or token than configured");
    }
    if (q.request_id !== requestId) fail("verify quote", "the quote is for a different request id");
    step("verify quote", true);

    // 3. rationale, logged as agent-claimed before any money moves
    const decision = await doFetch(new URL("/log/decision", ctx.gatewayUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request_id: requestId,
        mandate_id: mandateId,
        agent_id: ctx.agentAddress.toLowerCase(),
        kind: "rationale",
        data: {
          why: "single approved merchant",
          merchant_id: ctx.merchantId,
          quoted_amount: q.amount,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch((e: Error) => fail("rationale", e.message));
    if (!decision.ok)
      fail("rationale", `gateway rejected the decision record (${decision.status})`);
    step("rationale", true, { seq: ((await decision.json()) as { seq: number }).seq });

    // 4. pay through the escrow
    const amount = priceToUnits(scenario.overpay ? ctx.overCapAmount : q.amount, ctx.tokenDecimals);
    const paid = await ctx.payer.pay(mandateId, getAddress(q.merchant), amount, requestId);
    if (!paid.ok) {
      run.reverted = paid.reverted;
      step("createEscrow", false, { detail: `reverted: ${paid.reverted}` });
      if (scenario.overpay) {
        run.status = "blocked"; // prevention worked: the contract refused (docs/06 section 2.3)
        return;
      }
      throw new StepFailed(`escrow refused: ${paid.reverted}`);
    }
    if (scenario.overpay)
      fail("createEscrow", "the over-cap payment was NOT refused by the contract");
    run.escrow_id = paid.escrowId;
    run.tx_hashes.escrow = paid.txHash;
    step("createEscrow", true, { tx: paid.txHash, detail: paid.escrowId });

    // 5. retry with proof of payment
    const xPayment = Buffer.from(
      JSON.stringify({ escrowId: paid.escrowId, txHash: paid.txHash }),
    ).toString("base64");
    const res = await doFetch(new URL(path, ctx.gatewayUrl), {
      headers: { ...headers, "x-payment": xPayment },
      signal: AbortSignal.timeout(30_000),
    }).catch((e: Error) => fail("paid retry", e.message));
    const body = await res.text();
    run.response = { status: res.status, body: body.slice(0, 2000) };
    step("response", res.status >= 200 && res.status < 300, {
      seq: Number(res.headers.get("x-recourse-seq")) || undefined,
      detail: `HTTP ${res.status}, ${body.length} bytes`,
    });
    step("receipt", res.headers.has("x-recourse-receipt"), {
      detail: res.headers.has("x-recourse-receipt") ? "signed by merchant" : "none",
    });
    run.status = "completed";
  } catch (e) {
    run.status = "failed";
    run.error = (e as Error).message;
    if (!(e instanceof StepFailed)) step("error", false, { detail: run.error });
  }
}

function decodeQuote(header: string | null): unknown {
  if (!header) return undefined;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}
