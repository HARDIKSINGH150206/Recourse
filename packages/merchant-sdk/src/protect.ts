import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { createEscrowClient, type EscrowApi } from "@recourse/chain";
import { Hex32, RecourseError, newRequestId, systemClock, type Clock } from "@recourse/shared";
import { encodeReceiptHeader, signReceipt } from "./receipt.js";
import { buildRequirements, priceToUnits, type PaymentRequirements } from "./requirements.js";
import { MemoryServedStore, type ServedStore } from "./served-store.js";

export interface ProtectOptions {
  merchantPrivateKey: Hex;
  chainId: number;
  /** Required unless `escrowClient` is given. */
  rpcUrl?: string;
  escrow: Address;
  token: Address;
  /** Decimal string in token units, for example "0.01". */
  price: string;
  tokenDecimals?: number;
  /** How long a 402 quote and a payment proof stay valid. Default 300. */
  requestTtlSeconds?: number;
  /** Chain reads. Defaults to a read-only viem client; tests inject a fake. */
  escrowClient?: Pick<EscrowApi, "getEscrow" | "getMandate">;
  clock?: Clock;
  servedStore?: ServedStore;
}

/** What handlers can read from `res.locals.recourse` once payment is verified. */
export interface RecourseLocals {
  requestId: Hex;
  escrowId: Hex;
}

const PaymentHeaderSchema = z.object({ escrowId: Hex32, txHash: Hex32 }).strict();

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

function decodePayment(header: string): z.infer<typeof PaymentHeaderSchema> | null {
  try {
    const parsed = PaymentHeaderSchema.safeParse(
      JSON.parse(Buffer.from(header, "base64").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toBuffer(chunk: unknown, encoding?: unknown): Buffer {
  if (chunk === undefined || chunk === null) return Buffer.alloc(0);
  if (typeof chunk === "string")
    return Buffer.from(chunk, typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8");
  return Buffer.from(chunk as Uint8Array);
}

/**
 * Express middleware: 402 with escrow requirements, on-chain verification of the payment proof,
 * replay protection, and a merchant-signed receipt over the exact response bytes
 * (docs/04 sections 4.1 and 5; docs/03 section 7).
 *
 * The response body is buffered until `end` so the receipt (an HTTP header) can cover it. This
 * means streaming responses are not supported, and compression middleware must run after this
 * one (the gateway asks for identity encoding, so the receipt hash matches what it stores).
 */
export function protect(opts: ProtectOptions): RequestHandler {
  const account = privateKeyToAccount(opts.merchantPrivateKey);
  const merchant = account.address.toLowerCase() as Address;
  const clock = opts.clock ?? systemClock;
  const ttl = opts.requestTtlSeconds ?? 300;
  const price = priceToUnits(opts.price, opts.tokenDecimals ?? 6);
  const served = opts.servedStore ?? new MemoryServedStore();
  const token = opts.token.toLowerCase();
  const chain =
    opts.escrowClient ??
    (() => {
      if (!opts.rpcUrl) throw new Error("protect: rpcUrl or escrowClient is required");
      return createEscrowClient({
        chainId: opts.chainId,
        rpcUrl: opts.rpcUrl,
        escrow: opts.escrow,
      });
    })();

  function requirementsFor(req: Request, requestId: Hex): PaymentRequirements {
    return buildRequirements({
      chainId: opts.chainId,
      escrow: opts.escrow,
      token: opts.token,
      merchant,
      price: opts.price,
      requestId,
      now: clock.now(),
      ttlSeconds: ttl,
      resource: req.originalUrl,
    });
  }

  function demandPayment(res: Response, reqs: PaymentRequirements, reason?: string): void {
    res.status(402).set("X-Payment-Required", b64(reqs)).type("application/json");
    if (!reason) {
      res.send(JSON.stringify(reqs));
      return;
    }
    const err = new RecourseError("payment_required", `payment not accepted: ${reason}`, {
      reason,
    });
    res.send(JSON.stringify({ ...err.toBody(), requirements: reqs }));
  }

  function sendError(res: Response, err: RecourseError): void {
    res.status(err.status).type("application/json").send(JSON.stringify(err.toBody()));
  }

  /** From here on, the final body is buffered, hashed and signed into X-Recourse-Receipt. */
  function installReceipt(res: Response, requestId: Hex): void {
    const chunks: Buffer[] = [];
    const origEnd = res.end.bind(res) as (...a: unknown[]) => Response;
    let finishing = false;

    res.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
      chunks.push(toBuffer(chunk, encoding));
      const done = typeof encoding === "function" ? encoding : cb;
      if (typeof done === "function") (done as () => void)();
      return true;
    }) as typeof res.write;

    res.end = ((chunk?: unknown, encoding?: unknown, cb?: unknown) => {
      if (finishing || res.writableEnded) return res;
      finishing = true;
      if (typeof chunk === "function") {
        cb = chunk;
        chunk = undefined;
      } else if (typeof encoding === "function") {
        cb = encoding;
        encoding = undefined;
      }
      chunks.push(toBuffer(chunk, encoding));
      const body = Buffer.concat(chunks);

      signReceipt(account, opts.chainId, { requestId, body, timestamp: clock.now(), merchant })
        .then((receipt) => {
          if (!res.headersSent) res.setHeader("X-Recourse-Receipt", encodeReceiptHeader(receipt));
          origEnd(body, cb);
        })
        .catch(() => {
          // Never deliver a body we could not receipt: the buyer would be unprotected.
          res.statusCode = 500;
          res.removeHeader("content-length");
          origEnd(
            JSON.stringify(new RecourseError("internal", "could not sign receipt").toBody()),
            cb,
          );
        });
      return res;
    }) as typeof res.end;
  }

  async function handle(req: Request, res: Response, next: NextFunction): Promise<void> {
    const given = req.header("x-recourse-request-id");
    let requestId: Hex;
    if (given !== undefined) {
      const parsed = Hex32.safeParse(given.toLowerCase());
      if (!parsed.success)
        return sendError(res, new RecourseError("bad_request", "invalid X-Recourse-Request-Id"));
      requestId = parsed.data as Hex;
    } else {
      requestId = newRequestId();
    }

    const paymentHeader = req.header("x-payment");
    if (paymentHeader === undefined) return demandPayment(res, requirementsFor(req, requestId));

    const reqs = requirementsFor(req, requestId);
    const payment = decodePayment(paymentHeader);
    if (!payment) return demandPayment(res, reqs, "malformed X-Payment header");

    let escrow;
    let mandate;
    try {
      escrow = await chain.getEscrow(payment.escrowId as Hex);
      if (escrow.state === "Held") mandate = await chain.getMandate(escrow.mandateId);
    } catch {
      return sendError(
        res,
        new RecourseError("upstream_error", "could not read the escrow from the chain"),
      );
    }

    const now = clock.now();
    if (escrow.state !== "Held")
      return demandPayment(res, reqs, `escrow is ${escrow.state}, not Held`);
    if (escrow.merchant.toLowerCase() !== merchant)
      return demandPayment(res, reqs, "escrow pays a different merchant");
    if (escrow.amount < price) return demandPayment(res, reqs, "escrow amount is below the price");
    if (escrow.requestId !== requestId)
      return demandPayment(res, reqs, "escrow was created for a different request");
    if (mandate && mandate.token.toLowerCase() !== token)
      return demandPayment(res, reqs, "escrow uses a different token");
    if (now > escrow.createdAt + ttl) return demandPayment(res, reqs, "payment proof has expired");

    // Claim synchronously after validation: only the first of any concurrent retries is served,
    // and a bogus proof cannot burn someone else's request id.
    if (!served.claim(requestId, escrow.createdAt + ttl, now)) {
      return sendError(
        res,
        new RecourseError("conflict", "this request was already served", {
          reason: "already_served",
        }),
      );
    }

    const locals: RecourseLocals = { requestId, escrowId: payment.escrowId as Hex };
    res.locals.recourse = locals;
    installReceipt(res, requestId);
    next();
  }

  return (req, res, next) => {
    handle(req, res, next).catch(next);
  };
}
