/**
 * Anvil's well-known development accounts 0 to 5. LOCAL CHAIN ONLY: these keys are public.
 * Never used for any other chain id (see assertLocalChain).
 */
export const ANVIL_KEYS = {
  DEPLOYER_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  OWNER_PRIVATE_KEY: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  AGENT_PRIVATE_KEY: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  MERCHANT_PRIVATE_KEY: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  GATEWAY_PRIVATE_KEY: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  ARBITER_PRIVATE_KEY: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
} as const;

export function assertLocalChain(chainId: number): void {
  if (chainId !== 31337) {
    throw new Error(`this operation is local-only (chain 31337); refusing on chain ${chainId}`);
  }
}
