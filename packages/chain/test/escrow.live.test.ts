// Live test against a local anvil with contracts deployed (pnpm chain:up, env:local, chain:deploy, seed).
// Excluded from the default run; use `pnpm test:live`. Skips itself when no chain is reachable.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  createTestClient,
  http,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  MandateTypes,
  buildBatchTree,
  canonicalHash,
  escrowDomain,
  mandateId as computeMandateId,
  merchantsHash,
  type MandateJson,
} from "@recourse/shared";
import { EscrowRevert, createEscrowClient } from "../src/index.js";

const root = new URL("../../../", import.meta.url);
const deployPath = new URL("deployments/31337.json", root);
const envPath = new URL(".env", root);

async function chainUp(): Promise<boolean> {
  try {
    const r = await fetch("http://127.0.0.1:8545", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return r.ok && existsSync(deployPath) && existsSync(envPath);
  } catch {
    return false;
  }
}

const up = await chainUp();

function envKey(name: string): Hex {
  const m = new RegExp(`^${name}=(0x[0-9a-fA-F]{64})`, "m").exec(readFileSync(envPath, "utf8"));
  return m![1] as Hex;
}

describe.skipIf(!up)("RecourseEscrow on local anvil", () => {
  const dep = up ? JSON.parse(readFileSync(deployPath, "utf8")) : {};
  const escrow = dep.escrow as Address;
  const token = dep.token as Address;
  const rpcUrl = "http://127.0.0.1:8545";
  const chain = {
    id: 31337,
    name: "anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  } as const;
  const owner = up ? privateKeyToAccount(envKey("OWNER_PRIVATE_KEY")) : (null as never);
  const agent = up ? privateKeyToAccount(envKey("AGENT_PRIVATE_KEY")) : (null as never);
  const merchant = up ? privateKeyToAccount(envKey("MERCHANT_PRIVATE_KEY")) : (null as never);
  const gateway = up ? privateKeyToAccount(envKey("GATEWAY_PRIVATE_KEY")) : (null as never);
  const arbiter = up ? privateKeyToAccount(envKey("ARBITER_PRIVATE_KEY")) : (null as never);
  const as = (account: typeof owner) =>
    createEscrowClient({ chainId: 31337, rpcUrl, escrow, account });
  const testClient = createTestClient({ chain, transport: http(rpcUrl), mode: "anvil" });
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });

  async function newMandate(nonce: bigint) {
    const now = Number((await pub.getBlock()).timestamp);
    const m: MandateJson = {
      owner: owner.address.toLowerCase(),
      agent: agent.address.toLowerCase(),
      token: token.toLowerCase(),
      maxPricePerCall: "50000",
      totalBudget: "200000",
      expiresAt: now + 86_400,
      nonce: nonce.toString(),
      merchantsHash: merchantsHash([merchant.address]),
      termsHash: canonicalHash({ version: 1 }),
    };
    const signature = await owner.signTypedData({
      domain: escrowDomain(31337, escrow),
      types: MandateTypes,
      primaryType: "Mandate",
      message: {
        owner: owner.address,
        agent: agent.address,
        token,
        maxPricePerCall: 50000n,
        totalBudget: 200000n,
        expiresAt: BigInt(m.expiresAt),
        nonce,
        merchantsHash: m.merchantsHash as Hex,
        termsHash: m.termsHash as Hex,
      },
    });
    return { m, signature };
  }

  it("TypeScript mandate digest equals the contract's (spike S5)", async () => {
    const { m, signature } = await newMandate(BigInt(Date.now()));
    const { mandateId } = await as(agent).registerMandate(m, [merchant.address], signature);
    expect(mandateId).toBe(computeMandateId(31337, escrow, m));
    expect(await as(agent).getMandate(mandateId)).toEqual(m);
  });

  it("full lifecycle: pay, dispute, refund, reputation, anchoring", async () => {
    const { m, signature } = await newMandate(BigInt(Date.now()) + 1n);
    const { mandateId } = await as(agent).registerMandate(m, [merchant.address], signature);
    const requestId = keccak256(toHex(`live-${Date.now()}`));

    const { escrowId } = await as(agent).createEscrow(
      mandateId,
      merchant.address,
      10_000n,
      requestId,
    );
    expect(escrowId).toBe(keccak256(`0x${mandateId.slice(2)}${requestId.slice(2)}`));
    expect((await as(agent).getEscrow(escrowId)).state).toBe("Held");
    expect(await as(agent).spent(mandateId)).toBe(10_000n);

    // decoded custom errors, same names the fake throws
    await expect(
      as(agent).createEscrow(mandateId, merchant.address, 50_001n, keccak256(toHex("x"))),
    ).rejects.toMatchObject({ code: "ExceedsMaxPrice" });
    await expect(
      as(agent).createEscrow(mandateId, merchant.address, 1n, requestId),
    ).rejects.toBeInstanceOf(EscrowRevert);
    await expect(as(agent).dispute(escrowId, keccak256(toHex("r")))).rejects.toMatchObject({
      code: "NotOwner",
    });

    expect(await as(agent).findDisputed(escrowId)).toBeNull();
    await as(owner).dispute(escrowId, keccak256(toHex("bad data")));
    expect(await as(agent).findDisputed(escrowId)).toMatchObject({
      escrowId,
      reasonHash: keccak256(toHex("bad data")),
    });
    await expect(
      as(owner).resolve(escrowId, "REFUND", "MERCHANT", keccak256(toHex("v"))),
    ).rejects.toMatchObject({ code: "NotArbiter" });
    await as(arbiter).resolve(escrowId, "REFUND", "MERCHANT", keccak256(toHex("v")));
    expect((await as(agent).getEscrow(escrowId)).state).toBe("Refunded");
    expect((await as(agent).merchantReputation(merchant.address)).faults).toBeGreaterThanOrEqual(1);

    const tree = buildBatchTree([{ seq: 1, entry_hash: keccak256(toHex("e1")) }]);
    await as(gateway).anchorRoot(tree.root as Hex, 1, 0);
    expect(await as(agent).anchoredAt(tree.root as Hex)).toBeGreaterThan(0);
    await expect(as(agent).anchorRoot(tree.root as Hex, 1, 0)).rejects.toMatchObject({
      code: "NotGateway",
    });
  });

  it("release after the window pays the merchant", async () => {
    const { m, signature } = await newMandate(BigInt(Date.now()) + 2n);
    const { mandateId } = await as(agent).registerMandate(m, [merchant.address], signature);
    const { escrowId } = await as(agent).createEscrow(
      mandateId,
      merchant.address,
      5_000n,
      keccak256(toHex(`rel-${Date.now()}`)),
    );
    await expect(as(owner).release(escrowId)).rejects.toMatchObject({ code: "WindowOpen" });
    await testClient.increaseTime({ seconds: 3600 });
    await testClient.mine({ blocks: 1 });
    await as(owner).release(escrowId);
    expect((await as(agent).getEscrow(escrowId)).state).toBe("Released");
  });
});
