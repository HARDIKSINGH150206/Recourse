import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Hex } from "viem";
import {
  AddressLc,
  Hex32,
  ReceiptSchema,
  RecourseError,
  ZERO32,
  canonicalHash,
  keccakBytes,
  newRequestId,
  type LogEntry,
} from "@recourse/shared";
import type { GatewayDeps } from "./deps.js";

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "content-length",
  "accept-encoding",
  "x-recourse-agent",
  "x-recourse-mandate",
]);
/** Upstream response headers passed back to the agent. */
const PASS_BACK = ["content-type", "x-payment-required", "x-recourse-receipt", "retry-after"];

const PaymentHeaderSchema = z.object({ escrowId: Hex32, txHash: Hex32 }).strict();

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function flattenHeaders(h: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(h).sort()) {
    const v = h[k];
    if (v !== undefined) out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

function decodeB64Json(v: string | undefined): unknown {
  if (!v) return undefined;
  try {
    return JSON.parse(Buffer.from(v, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

interface Upstream {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  latencyMs: number;
}

async function readCapped(res: Response, cap: number): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function callUpstream(
  deps: GatewayDeps,
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer | undefined,
): Promise<Upstream> {
  const doFetch = deps.fetchImpl ?? fetch;
  const t0 = performance.now();
  const latency = () => Math.round(performance.now() - t0);
  try {
    const res = await doFetch(url, {
      method,
      headers,
      body: body && body.length > 0 && method !== "GET" && method !== "HEAD" ? body : undefined,
      redirect: "manual", // never follow redirects to hosts we did not register
      signal: AbortSignal.timeout(deps.upstreamTimeoutMs),
    });
    const bytes = await readCapped(res, deps.maxResponseBytes);
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (resHeaders[k] = v));
    if (bytes === null) {
      return { status: 502, headers: {}, body: new Uint8Array(), latencyMs: latency() };
    }
    return { status: res.status, headers: resHeaders, body: bytes, latencyMs: latency() };
  } catch (e) {
    const timedOut = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
    return {
      status: timedOut ? 504 : 502,
      headers: {},
      body: new Uint8Array(),
      latencyMs: latency(),
    };
  }
}

function sendError(reply: FastifyReply, err: RecourseError, requestId?: Hex) {
  if (requestId) reply.header("x-recourse-request-id", requestId);
  return reply.code(err.status).send(err.toBody());
}

/**
 * ANY /proxy/:merchantId/* (docs/04 section 2.1). Everything the agent does passes through here and
 * is logged by the gateway; the agent has no other way to write to the log.
 */
export function registerProxy(app: FastifyInstance, deps: GatewayDeps): void {
  // Raw bytes for every content type: the hashes must cover exactly what the merchant receives.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 1_000_000 }, (_req, body, done) =>
    done(null, body),
  );

  app.all("/proxy/:merchantId/*", async (req, reply) => {
    const { merchantId } = req.params as { merchantId: string };
    const wildcard = (req.params as Record<string, string>)["*"] ?? "";

    const base = Object.hasOwn(deps.merchants, merchantId) ? deps.merchants[merchantId] : undefined;
    if (!base) return sendError(reply, new RecourseError("not_found", "unknown merchant"));

    // ---- validate agent-supplied headers
    const agent = AddressLc.safeParse(header(req, "x-recourse-agent")?.toLowerCase());
    const mandate = Hex32.safeParse(header(req, "x-recourse-mandate")?.toLowerCase());
    if (!agent.success || !mandate.success) {
      return sendError(
        reply,
        new RecourseError(
          "bad_request",
          "X-Recourse-Agent (address) and X-Recourse-Mandate (bytes32) are required",
        ),
      );
    }
    const givenId = header(req, "x-recourse-request-id");
    let requestId: Hex;
    if (givenId !== undefined) {
      const parsed = Hex32.safeParse(givenId.toLowerCase());
      if (!parsed.success)
        return sendError(reply, new RecourseError("bad_request", "invalid X-Recourse-Request-Id"));
      requestId = parsed.data as Hex;
    } else {
      requestId = newRequestId();
    }

    // ---- build the upstream URL from the registered base only
    const search = new URL(req.url, "http://gateway.invalid").search;
    const baseUrl = new URL(base);
    const upstreamUrl = new URL(
      `${baseUrl.pathname.replace(/\/$/, "")}/${wildcard}${search}`,
      baseUrl.origin,
    );
    if (upstreamUrl.origin !== baseUrl.origin || wildcard.includes("\\")) {
      return sendError(reply, new RecourseError("bad_request", "invalid path"), requestId);
    }

    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const base9 = { requestId, mandateId: mandate.data as Hex, agentId: agent.data };
    const append = (type: LogEntry["type"], fields: Record<string, unknown>) =>
      deps.log.append({ type, fields, ...base9 });

    // 1. request
    append("request", {
      method: req.method,
      path: `/${wildcard}`,
      query: search.replace(/^\?/, ""),
      headers_hash: canonicalHash(flattenHeaders(req.headers)),
      body_hash: body.length > 0 ? keccakBytes(body) : ZERO32,
      merchant_id: merchantId,
    });

    // 2. payment proof, verified against the chain before anything is forwarded
    const paymentHeader = header(req, "x-payment");
    if (paymentHeader !== undefined) {
      const parsed = PaymentHeaderSchema.safeParse(decodeB64Json(paymentHeader));
      if (!parsed.success) {
        return sendError(
          reply,
          new RecourseError("payment_required", "malformed X-Payment header"),
          requestId,
        );
      }
      const esc = await deps.chain.getEscrow(parsed.data.escrowId as Hex).catch(() => null);
      if (!esc) {
        return sendError(
          reply,
          new RecourseError("upstream_error", "could not read the escrow from the chain"),
          requestId,
        );
      }
      const block = await deps.chain.blockNumber().catch(() => 0);
      const proofSeq = append("payment_proof", {
        escrow_id: parsed.data.escrowId,
        tx_hash: parsed.data.txHash,
        chain_state: {
          state: esc.state,
          amount: esc.amount.toString(),
          merchant: esc.merchant.toLowerCase(),
          windowEnds: esc.windowEnds,
          block,
        },
      }).seq;
      const valid =
        esc.state === "Held" && esc.requestId === requestId && esc.mandateId === mandate.data;
      if (!valid) {
        deps.logger.warn(
          { request_id: requestId, seq: proofSeq, state: esc.state },
          "rejected payment proof",
        );
        return sendError(
          reply,
          new RecourseError("payment_required", "escrow is not Held for this request and mandate"),
          requestId,
        );
      }
    }

    // 3. forward
    const fwdHeaders: Record<string, string> = {
      "accept-encoding": "identity",
      "x-recourse-request-id": requestId,
    };
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined && !HOP_BY_HOP.has(k) && k !== "x-recourse-request-id") {
        fwdHeaders[k] = Array.isArray(v) ? v.join(", ") : v;
      }
    }
    const up = await callUpstream(deps, upstreamUrl.toString(), req.method, fwdHeaders, body);

    // 4. log what came back
    let responseSeq: number;
    if (up.status === 402) {
      const fromHeader = decodeB64Json(up.headers["x-payment-required"]);
      let requirements: unknown = fromHeader;
      if (requirements === undefined) {
        try {
          requirements = JSON.parse(Buffer.from(up.body).toString("utf8"));
        } catch {
          requirements = null;
        }
      }
      const obj = requirements !== null && typeof requirements === "object" ? requirements : null;
      responseSeq = append("payment_required", { status: 402, requirements: obj }).seq;
    } else {
      const bodyHash = keccakBytes(up.body);
      deps.repo.putBlob(bodyHash, up.body);
      responseSeq = append("response", {
        status: up.status,
        headers_hash: canonicalHash(up.headers),
        body_hash: bodyHash,
        body_len: up.body.length,
        content_type: up.headers["content-type"] ?? null,
        latency_ms: up.latencyMs,
      }).seq;

      const rawReceipt = up.headers["x-recourse-receipt"];
      if (rawReceipt !== undefined) {
        const decoded = decodeB64Json(rawReceipt) as Record<string, unknown> | undefined;
        const receipt = ReceiptSchema.safeParse(
          decoded && typeof decoded === "object"
            ? {
                ...decoded,
                requestId: String(decoded.requestId ?? "").toLowerCase(),
                responseHash: String(decoded.responseHash ?? "").toLowerCase(),
                merchant: String(decoded.merchant ?? "").toLowerCase(),
                signature: String(decoded.signature ?? "").toLowerCase(),
              }
            : undefined,
        );
        if (receipt.success && receipt.data.requestId === requestId) {
          append("receipt", {
            request_id: receipt.data.requestId,
            response_hash: receipt.data.responseHash,
            timestamp: receipt.data.timestamp,
            merchant: receipt.data.merchant,
            signature: receipt.data.signature,
          });
        } else {
          deps.logger.warn(
            { request_id: requestId },
            "ignored malformed or mismatched receipt header",
          );
        }
      }
    }

    // 5. answer the agent
    reply.header("x-recourse-request-id", requestId).header("x-recourse-seq", String(responseSeq));
    for (const h of PASS_BACK) if (up.headers[h] !== undefined) reply.header(h, up.headers[h]);
    return reply.code(up.status).send(Buffer.from(up.body));
  });
}
