import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { erc20Abi, escrowAbi } from "@recourse/chain";
import { config } from "./config";
import type { CompileResponse } from "./types";

export const chain: Chain = {
  id: config.chainId,
  name: config.chainId === 31337 ? "Local anvil" : `Chain ${config.chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
};

export const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function provider(): Eip1193 {
  const p = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!p) throw new Error("no browser wallet found: install MetaMask or another EIP-1193 wallet");
  return p;
}

/** Connect the injected wallet and make sure it is on the configured chain. */
export async function connect(): Promise<Address> {
  const p = provider();
  const accounts = (await p.request({ method: "eth_requestAccounts" })) as Address[];
  const account = accounts[0];
  if (!account) throw new Error("the wallet returned no account");
  const chainIdHex = `0x${chain.id.toString(16)}`;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
  } catch {
    await p.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [config.rpcUrl],
        },
      ],
    });
  }
  return account;
}

const walletFor = (account: Address) =>
  createWalletClient({ account, chain, transport: custom(provider()) });

/** EIP-712 signature over the compiled mandate; the wallet shows the fields to the owner. */
export async function signMandate(account: Address, c: CompileResponse): Promise<Hex> {
  const { domain, types, primaryType, message } = c.typed_data;
  return walletFor(account).signTypedData({
    domain: domain as never,
    types,
    primaryType,
    message: {
      ...message,
      maxPricePerCall: BigInt(c.mandate.maxPricePerCall),
      totalBudget: BigInt(c.mandate.totalBudget),
      expiresAt: BigInt(c.mandate.expiresAt),
      nonce: BigInt(c.mandate.nonce),
    },
  });
}

/** approve(escrow, budget) then registerMandate; returns the on-chain mandate id. */
export async function registerOnChain(
  account: Address,
  c: CompileResponse,
  signature: Hex,
): Promise<{ approveTx: Hex; registerTx: Hex; mandateId: Hex }> {
  const wallet = walletFor(account);
  const escrow = config.escrow as Address;
  const m = c.mandate;

  const approveTx = await wallet.writeContract({
    address: m.token as Address,
    abi: erc20Abi,
    functionName: "approve",
    args: [escrow, BigInt(m.totalBudget)],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  const args = [
    {
      owner: m.owner as Address,
      agent: m.agent as Address,
      token: m.token as Address,
      maxPricePerCall: BigInt(m.maxPricePerCall),
      totalBudget: BigInt(m.totalBudget),
      expiresAt: BigInt(m.expiresAt),
      nonce: BigInt(m.nonce),
      merchantsHash: m.merchantsHash as Hex,
      termsHash: m.termsHash as Hex,
    },
    c.merchants as Address[],
    signature,
  ] as const;
  // Simulate first so a revert shows its decoded name instead of a gas-estimation error.
  const { request: req, result } = await publicClient.simulateContract({
    account,
    address: escrow,
    abi: escrowAbi,
    functionName: "registerMandate",
    args,
  });
  const registerTx = await wallet.writeContract(req);
  await publicClient.waitForTransactionReceipt({ hash: registerTx });
  return { approveTx, registerTx, mandateId: result };
}
