import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { createEscrowClient } from "@recourse/chain";
import { createLogger, requireAddress, requireKey, systemClock } from "@recourse/shared";
import { loadAgentConfig } from "./config.js";
import { Payer } from "./payer.js";
import { DemoAgent } from "./service.js";

/** Wire the demo agent from .env and config/demo.json (shared by the HTTP service and the CLI). */
export function createDemoAgent() {
  const { cfg, demo } = loadAgentConfig();
  const logger = createLogger("demo-agent", { level: cfg.LOG_LEVEL });
  const escrow = requireAddress(cfg, "ESCROW_ADDRESS");
  const token = requireAddress(cfg, "TOKEN_ADDRESS");
  const agentAccount = privateKeyToAccount(requireKey(cfg, "AGENT_PRIVATE_KEY"));
  const chain = (account: ReturnType<typeof privateKeyToAccount>) =>
    createEscrowClient({ chainId: cfg.CHAIN_ID, rpcUrl: cfg.RPC_URL, escrow, account });

  const ownerAccount = cfg.OWNER_PRIVATE_KEY
    ? privateKeyToAccount(cfg.OWNER_PRIVATE_KEY as Hex)
    : undefined;
  const agent = new DemoAgent({
    ctx: {
      gatewayUrl: cfg.GATEWAY_URL,
      merchantId: demo.merchantId,
      city: demo.city,
      chainId: cfg.CHAIN_ID,
      escrow,
      token,
      agentAddress: agentAccount.address,
      overCapAmount: demo.overCapAmount,
      tokenDecimals: 6,
      payer: new Payer(chain(agentAccount)),
      clock: systemClock,
    },
    apiUrl: cfg.API_URL,
    clock: systemClock,
    owner: ownerAccount ? { address: ownerAccount.address, chain: chain(ownerAccount) } : undefined,
    mandateId: process.env.DEMO_MANDATE_ID as Hex | undefined,
  });
  return { agent, cfg, logger };
}
