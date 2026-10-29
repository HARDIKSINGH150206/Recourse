import { keccak256, type Address, type Hex } from "viem";
import {
  ReceiptSchema,
  recoverReceiptSigner,
  signReceipt as signReceiptSig,
  type Receipt,
} from "@recourse/shared";

export interface ReceiptSigner {
  signTypedData: (args: never) => Promise<Hex>;
}

export interface ReceiptInput {
  requestId: Hex;
  /** Raw bytes of the response body exactly as sent on the wire. */
  body: Uint8Array;
  timestamp: number;
  merchant: Address;
}

/** EIP-712 `Receipt` over (requestId, keccak256(body), timestamp, merchant); docs/03 section 7. */
export async function signReceipt(
  signer: ReceiptSigner,
  chainId: number,
  input: ReceiptInput,
): Promise<Receipt> {
  const base = {
    requestId: input.requestId,
    responseHash: keccak256(input.body),
    timestamp: input.timestamp,
    merchant: input.merchant.toLowerCase(),
  };
  const signature = await signReceiptSig(signer, chainId, base);
  return { ...base, signature };
}

/**
 * True when the receipt is well formed, signed by `merchant`, and (if `body` is given) its
 * responseHash is the hash of that body.
 */
export async function verifyReceipt(
  chainId: number,
  receipt: unknown,
  merchant: Address,
  body?: Uint8Array,
): Promise<boolean> {
  const parsed = ReceiptSchema.safeParse(receipt);
  if (!parsed.success) return false;
  const r = parsed.data;
  if (r.merchant !== merchant.toLowerCase()) return false;
  if (body && keccak256(body) !== r.responseHash) return false;
  try {
    return (await recoverReceiptSigner(chainId, r)).toLowerCase() === r.merchant;
  } catch {
    return false;
  }
}

/** Header value for `X-Recourse-Receipt`: base64(JSON(receipt)). */
export function encodeReceiptHeader(r: Receipt): string {
  return Buffer.from(JSON.stringify(r)).toString("base64");
}

export function decodeReceiptHeader(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}
