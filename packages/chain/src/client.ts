import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { REVERT_NAMES, escrowAbi, type RevertName } from "./abi.js";
import {
  ESTATES,
  EscrowRevert,
  FAULT_CODE,
  OUTCOME_CODE,
  type EscrowApi,
  type EscrowRecord,
} from "./types.js";
import type { MandateJson } from "@recourse/shared";

export interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  escrow: Address;
  /** Signer for write calls. Read-only clients omit it. */
  account?: Account;
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/** Map a viem error to the contract custom error name when there is one. */
export function decodeRevert(err: unknown): EscrowRevert | null {
  if (!(err instanceof BaseError)) return null;
  const rev = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (rev instanceof ContractFunctionRevertedError) {
    const name = rev.data?.errorName;
    if (name && (REVERT_NAMES as readonly string[]).includes(name))
      return new EscrowRevert(name as RevertName);
    if (name === "EnforcedPause") return new EscrowRevert("Paused");
    if (name === "OwnableUnauthorizedAccount") return new EscrowRevert("Unauthorized");
  }
  return null;
}

export function createEscrowClient(cfg: ChainConfig): EscrowApi & {
  publicClient: PublicClient;
  walletClient: WalletClient | null;
} {
  const chain: Chain = {
    id: cfg.chainId,
    name: `chain-${cfg.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  };
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const walletClient = cfg.account
    ? createWalletClient({ account: cfg.account, chain, transport: http(cfg.rpcUrl) })
    : null;
  const address = cfg.escrow;

  function wallet(): WalletClient {
    if (!walletClient) throw new Error("this escrow client is read-only (no account configured)");
    return walletClient;
  }

  /** Simulate first so reverts surface as decoded custom errors, then send and wait. */
  async function write(
    functionName: string,
    args: readonly unknown[],
  ): Promise<{ txHash: Hex; result: unknown }> {
    const w = wallet();
    try {
      const { request, result } = await publicClient.simulateContract({
        address,
        abi: escrowAbi,
        functionName: functionName as never,
        args: args as never,
        account: w.account,
      });
      const txHash = await w.writeContract(request as never);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error(`transaction ${txHash} reverted`);
      return { txHash, result };
    } catch (e) {
      throw decodeRevert(e) ?? e;
    }
  }

  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    publicClient.readContract({
      address,
      abi: escrowAbi,
      functionName: functionName as never,
      args: args as never,
    }) as Promise<T>;

  return {
    publicClient,
    walletClient,

    async registerMandate(m: MandateJson, merchants, signature) {
      const struct = {
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
      const { txHash, result } = await write("registerMandate", [struct, merchants, signature]);
      return { txHash, mandateId: result as Hex };
    },

    async createEscrow(mandateId, merchant, amount, requestId) {
      const { txHash, result } = await write("createEscrow", [
        mandateId,
        merchant,
        amount,
        requestId,
      ]);
      return { txHash, escrowId: result as Hex };
    },

    async release(escrowId) {
      return { txHash: (await write("release", [escrowId])).txHash };
    },
    async dispute(escrowId, reasonHash) {
      return { txHash: (await write("dispute", [escrowId, reasonHash])).txHash };
    },
    async resolve(escrowId, outcome, fault, verdictCommitment) {
      return {
        txHash: (
          await write("resolve", [
            escrowId,
            OUTCOME_CODE[outcome],
            FAULT_CODE[fault],
            verdictCommitment,
          ])
        ).txHash,
      };
    },
    async anchorRoot(root, size, batchIndex) {
      return {
        txHash: (await write("anchorRoot", [root, BigInt(size), BigInt(batchIndex)])).txHash,
      };
    },

    async getEscrow(escrowId): Promise<EscrowRecord> {
      const e = await read<{
        mandateId: Hex;
        merchant: Address;
        amount: bigint;
        requestId: Hex;
        createdAt: bigint;
        windowEnds: bigint;
        state: number;
      }>("escrows", [escrowId]);
      return {
        mandateId: e.mandateId,
        merchant: e.merchant,
        amount: e.amount,
        requestId: e.requestId,
        createdAt: Number(e.createdAt),
        windowEnds: Number(e.windowEnds),
        state: ESTATES[e.state] ?? "None",
      };
    },

    async getMandate(mandateId): Promise<MandateJson> {
      const m = await read<{
        owner: Address;
        agent: Address;
        token: Address;
        maxPricePerCall: bigint;
        totalBudget: bigint;
        expiresAt: bigint;
        nonce: bigint;
        merchantsHash: Hex;
        termsHash: Hex;
      }>("mandates", [mandateId]);
      if (m.owner === ZERO_ADDR) throw new EscrowRevert("MandateUnknown");
      return {
        owner: m.owner.toLowerCase(),
        agent: m.agent.toLowerCase(),
        token: m.token.toLowerCase(),
        maxPricePerCall: m.maxPricePerCall.toString(),
        totalBudget: m.totalBudget.toString(),
        expiresAt: Number(m.expiresAt),
        nonce: m.nonce.toString(),
        merchantsHash: m.merchantsHash,
        termsHash: m.termsHash,
      };
    },

    spent: (mandateId) => read<bigint>("spent", [mandateId]),
    async anchoredAt(root) {
      return Number(await read<bigint>("anchoredAt", [root]));
    },
    agentReputation: (a) => read("agentReputation", [a]),
    merchantReputation: (a) => read("merchantReputation", [a]),

    watchDisputed(cb) {
      return publicClient.watchContractEvent({
        address,
        abi: escrowAbi,
        eventName: "Disputed",
        onLogs: (logs) =>
          logs.forEach((l) =>
            cb({ escrowId: l.args.escrowId!, by: l.args.by!, reasonHash: l.args.reasonHash! }),
          ),
      });
    },
    watchResolved(cb) {
      return publicClient.watchContractEvent({
        address,
        abi: escrowAbi,
        eventName: "Resolved",
        onLogs: (logs) =>
          logs.forEach((l) =>
            cb({
              escrowId: l.args.escrowId!,
              outcome: l.args.outcome === 0 ? "REFUND" : "RELEASE",
              fault: (["NONE", "AGENT", "MERCHANT"] as const)[l.args.fault ?? 0]!,
              verdictCommitment: l.args.verdictCommitment!,
            }),
          ),
      });
    },
  };
}
