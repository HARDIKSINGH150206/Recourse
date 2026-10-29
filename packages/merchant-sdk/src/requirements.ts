import type { Address, Hex } from "viem";
import { parseUnits } from "viem";

/** Payment requirements returned with HTTP 402 (docs/04 section 4.1). */
export interface PaymentRequirements {
  scheme: "recourse-escrow";
  chain_id: number;
  escrow: Address;
  token: Address;
  merchant: Address;
  /** Decimal string in token units, e.g. "0.01". */
  amount: string;
  request_id: Hex;
  expires_at: number;
  resource: string;
}

export interface RequirementsInput {
  chainId: number;
  escrow: Address;
  token: Address;
  merchant: Address;
  price: string;
  requestId: Hex;
  now: number;
  ttlSeconds: number;
  resource: string;
}

export function buildRequirements(i: RequirementsInput): PaymentRequirements {
  return {
    scheme: "recourse-escrow",
    chain_id: i.chainId,
    // JSON convention (docs/03 section 1): addresses are lowercase on the wire
    escrow: i.escrow.toLowerCase() as Address,
    token: i.token.toLowerCase() as Address,
    merchant: i.merchant.toLowerCase() as Address,
    amount: i.price,
    request_id: i.requestId,
    expires_at: i.now + i.ttlSeconds,
    resource: i.resource,
  };
}

/** "0.01" -> 10000n for a 6-decimal token. Rejects negatives, zero, junk and excess precision. */
export function priceToUnits(price: string, decimals = 6): bigint {
  if (!/^\d+(\.\d+)?$/.test(price)) throw new Error(`invalid price: ${price}`);
  const frac = price.split(".")[1] ?? "";
  if (frac.length > decimals) throw new Error(`price has more than ${decimals} decimals: ${price}`);
  const units = parseUnits(price, decimals);
  if (units <= 0n) throw new Error("price must be positive");
  return units;
}
