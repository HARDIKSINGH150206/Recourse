import {
  encodePacked,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import type { MandateJson, Receipt, TreeHead } from "./types.js";

/** EIP-712 type definitions (docs/03 sections 2.1, 6.3, 7). */
export const MandateTypes = {
  Mandate: [
    { name: "owner", type: "address" },
    { name: "agent", type: "address" },
    { name: "token", type: "address" },
    { name: "maxPricePerCall", type: "uint256" },
    { name: "totalBudget", type: "uint256" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "merchantsHash", type: "bytes32" },
    { name: "termsHash", type: "bytes32" },
  ],
} as const;

export const TreeHeadTypes = {
  TreeHead: [
    { name: "root", type: "bytes32" },
    { name: "size", type: "uint64" },
    { name: "batchIndex", type: "uint64" },
    { name: "timestamp", type: "uint64" },
  ],
} as const;

export const ReceiptTypes = {
  Receipt: [
    { name: "requestId", type: "bytes32" },
    { name: "responseHash", type: "bytes32" },
    { name: "timestamp", type: "uint64" },
    { name: "merchant", type: "address" },
  ],
} as const;

export function escrowDomain(chainId: number, verifyingContract: Address) {
  return { name: "RecourseEscrow", version: "1", chainId, verifyingContract } as const;
}
export function gatewayDomain(chainId: number) {
  return { name: "RecourseGateway", version: "1", chainId } as const;
}
export function receiptDomain(chainId: number) {
  return { name: "RecourseReceipt", version: "1", chainId } as const;
}

/** Allowlist sorted ascending (as numbers), the order the contract requires. */
export function sortMerchants(merchants: readonly Address[]): Address[] {
  return [...merchants].sort((a, b) => {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/** keccak256(abi.encodePacked(address[])) over the sorted allowlist. */
export function merchantsHash(merchants: readonly Address[]): Hex {
  return keccak256(encodePacked(["address[]"], [sortMerchants(merchants)]));
}

function mandateMessage(m: MandateJson) {
  return {
    owner: m.owner as Address,
    agent: m.agent as Address,
    token: m.token as Address,
    maxPricePerCall: BigInt(m.maxPricePerCall),
    totalBudget: BigInt(m.totalBudget),
    expiresAt: BigInt(m.expiresAt),
    nonce: BigInt(m.nonce),
    merchantsHash: m.merchantsHash as Hex,
    termsHash: m.termsHash as Hex,
  };
}

export function mandateTypedData(chainId: number, escrow: Address, m: MandateJson) {
  return {
    domain: escrowDomain(chainId, escrow),
    types: MandateTypes,
    primaryType: "Mandate" as const,
    message: mandateMessage(m),
  };
}

/** mandateId = the EIP-712 digest, same as the contract's `_hashTypedDataV4(structHash)`. */
export function mandateId(chainId: number, escrow: Address, m: MandateJson): Hex {
  return hashTypedData(mandateTypedData(chainId, escrow, m));
}

type TypedSigner = {
  signTypedData: (args: never) => Promise<Hex>;
};

function treeHeadTypedData(chainId: number, h: Omit<TreeHead, "signature">) {
  return {
    domain: gatewayDomain(chainId),
    types: TreeHeadTypes,
    primaryType: "TreeHead" as const,
    message: {
      root: h.root as Hex,
      size: BigInt(h.size),
      batchIndex: BigInt(h.batch_index),
      timestamp: BigInt(h.timestamp),
    },
  };
}

export function signTreeHead(
  signer: TypedSigner,
  chainId: number,
  h: Omit<TreeHead, "signature">,
): Promise<Hex> {
  return (signer.signTypedData as (a: unknown) => Promise<Hex>)(treeHeadTypedData(chainId, h));
}

export function recoverTreeHeadSigner(chainId: number, h: TreeHead): Promise<Address> {
  return recoverTypedDataAddress({
    ...treeHeadTypedData(chainId, h),
    signature: h.signature as Hex,
  });
}

function receiptTypedData(chainId: number, r: Omit<Receipt, "signature">) {
  return {
    domain: receiptDomain(chainId),
    types: ReceiptTypes,
    primaryType: "Receipt" as const,
    message: {
      requestId: r.requestId as Hex,
      responseHash: r.responseHash as Hex,
      timestamp: BigInt(r.timestamp),
      merchant: r.merchant as Address,
    },
  };
}

export function signReceipt(
  signer: TypedSigner,
  chainId: number,
  r: Omit<Receipt, "signature">,
): Promise<Hex> {
  return (signer.signTypedData as (a: unknown) => Promise<Hex>)(receiptTypedData(chainId, r));
}

export function recoverReceiptSigner(chainId: number, r: Receipt): Promise<Address> {
  return recoverTypedDataAddress({
    ...receiptTypedData(chainId, r),
    signature: r.signature as Hex,
  });
}
