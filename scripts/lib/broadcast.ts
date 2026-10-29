import type { Address } from "viem";

export interface Deployed {
  escrow: Address;
  token: Address | null;
}

interface BroadcastTx {
  transactionType?: string;
  contractName?: string | null;
  contractAddress?: string | null;
}

/** Read contract addresses out of forge's broadcast/run-latest.json. */
export function parseBroadcast(json: unknown): Deployed {
  const txs = ((json as { transactions?: BroadcastTx[] } | null)?.transactions ?? []).filter(
    (t) => t.transactionType === "CREATE" && t.contractAddress,
  );
  const find = (name: string) =>
    txs.find((t) => t.contractName === name)?.contractAddress?.toLowerCase();
  const escrow = find("RecourseEscrow");
  if (!escrow) throw new Error("no RecourseEscrow CREATE transaction in broadcast file");
  return { escrow: escrow as Address, token: (find("MockUSDC") as Address | undefined) ?? null };
}
