const env = import.meta.env;

const str = (v: unknown, fallback: string): string =>
  typeof v === "string" && v !== "" ? v : fallback;

/** Browser configuration from VITE_* variables (docs/06 section 1.1). */
export const config = {
  apiUrl: str(env.VITE_API_URL, "http://localhost:4100"),
  gatewayUrl: str(env.VITE_GATEWAY_URL, "http://localhost:4000"),
  agentUrl: str(env.VITE_AGENT_URL, "http://localhost:4300"),
  chainId: Number(str(env.VITE_CHAIN_ID, "31337")),
  rpcUrl: str(env.VITE_RPC_URL, "http://127.0.0.1:8545"),
  escrow: str(env.VITE_ESCROW_ADDRESS, ""),
  token: str(env.VITE_TOKEN_ADDRESS, ""),
  // Merchant and agent addresses to prefill; the owner comes from the wallet.
  merchant: str(env.VITE_MERCHANT_ADDRESS, ""),
  agent: str(env.VITE_AGENT_ADDRESS, ""),
} as const;
