// Local chain only: tops up ETH, mints MockUSDC to the owner and approves the escrow.
// Usage: pnpm seed   (reads .env)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  parseAbi,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, requireAddress, requireKey } from "@recourse/shared";
import { parseEnv } from "./lib/env.js";
import { assertLocalChain } from "./lib/keys.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const fileEnv = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
const cfg = loadConfig({ ...fileEnv, ...process.env });
assertLocalChain(cfg.CHAIN_ID);

const chain = {
  id: cfg.CHAIN_ID,
  name: "local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [cfg.RPC_URL] } },
} as const;
const transport = http(cfg.RPC_URL);
const pub = createPublicClient({ chain, transport });
const test = createTestClient({ chain, transport, mode: "anvil" });

const token = requireAddress(cfg, "TOKEN_ADDRESS");
const escrow = requireAddress(cfg, "ESCROW_ADDRESS");
const owner = privateKeyToAccount(requireKey(cfg, "OWNER_PRIVATE_KEY"));
const abi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

for (const k of ["OWNER", "AGENT", "MERCHANT", "GATEWAY", "ARBITER"] as const) {
  const a = privateKeyToAccount(requireKey(cfg, `${k}_PRIVATE_KEY`));
  await test.setBalance({ address: a.address, value: parseEther("100") });
}

const wallet = createWalletClient({ account: owner, chain, transport });
const hash1 = await wallet.writeContract({
  address: token,
  abi,
  functionName: "mint",
  args: [owner.address, 1_000n * 10n ** 6n],
});
await pub.waitForTransactionReceipt({ hash: hash1 });
const hash2 = await wallet.writeContract({
  address: token,
  abi,
  functionName: "approve",
  args: [escrow, 2n ** 256n - 1n],
});
await pub.waitForTransactionReceipt({ hash: hash2 });

const bal = await pub.readContract({
  address: token,
  abi,
  functionName: "balanceOf",
  args: [owner.address],
});
console.log(`seeded: owner ${owner.address} holds ${bal} base units of mock USDC; escrow approved`);
