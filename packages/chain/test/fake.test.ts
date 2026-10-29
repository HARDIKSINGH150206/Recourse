import { beforeEach, describe, expect, it } from "vitest";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ManualClock,
  MandateTypes,
  canonicalHash,
  escrowDomain,
  mandateId as computeMandateId,
  merchantsHash,
  type MandateJson,
} from "@recourse/shared";
import { EscrowRevert, FakeEscrow, type EscrowApi } from "../src/index.js";

const owner = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const agent = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const merchant = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);
const merchant2 = privateKeyToAccount(
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
);
const arbiter = privateKeyToAccount(
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
);
const gateway = privateKeyToAccount(
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
);
const stranger = privateKeyToAccount(
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
);

const WINDOW = 120;
const T0 = 1_767_200_000;
const REQ = keccak256(toHex("req-1"));
const reason = keccak256(toHex("reason"));

async function setup(overrides: Partial<MandateJson> = {}) {
  const clock = new ManualClock(T0);
  const fake = new FakeEscrow(
    31337,
    { admin: owner.address, arbiter: arbiter.address, gateway: gateway.address },
    WINDOW,
    clock,
  );
  fake.mint(owner.address, 100_000_000n);
  const merchants = [merchant.address, merchant2.address].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : 1,
  );
  const m: MandateJson = {
    owner: owner.address.toLowerCase(),
    agent: agent.address.toLowerCase(),
    token: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
    maxPricePerCall: "50000",
    totalBudget: "2000000",
    expiresAt: T0 + 86_400,
    nonce: "1",
    merchantsHash: merchantsHash(merchants),
    termsHash: canonicalHash({ version: 1 }),
    ...overrides,
  };
  const sign = (x: MandateJson) =>
    owner.signTypedData({
      domain: escrowDomain(31337, fake.address),
      types: MandateTypes,
      primaryType: "Mandate",
      message: {
        owner: x.owner as Address,
        agent: x.agent as Address,
        token: x.token as Address,
        maxPricePerCall: BigInt(x.maxPricePerCall),
        totalBudget: BigInt(x.totalBudget),
        expiresAt: BigInt(x.expiresAt),
        nonce: BigInt(x.nonce),
        merchantsHash: x.merchantsHash as Hex,
        termsHash: x.termsHash as Hex,
      },
    });
  const { mandateId } = await fake
    .as(stranger.address)
    .registerMandate(m, merchants, await sign(m));
  return { fake, clock, m, merchants, mandateId, sign };
}

async function reverts(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ name: "EscrowRevert", code });
}

describe("FakeEscrow: mandates", () => {
  it("registers a mandate whose id matches the shared EIP-712 digest", async () => {
    const { fake, m, mandateId } = await setup();
    expect(mandateId).toBe(computeMandateId(31337, fake.address, m));
    expect(await fake.as(agent.address).getMandate(mandateId)).toEqual(m);
  });

  it("rejects replayed nonce, bad signature, tampered fields, hash mismatch, unsorted list", async () => {
    const { fake, m, merchants, sign } = await setup();
    const api = fake.as(stranger.address);
    await reverts(api.registerMandate(m, merchants, await sign(m)), "NonceUsed");

    const m2 = { ...m, nonce: "2" };
    const sig2 = await sign(m2);
    await reverts(
      api.registerMandate({ ...m2, totalBudget: "9999999" }, merchants, sig2),
      "BadSignature",
    );
    await reverts(api.registerMandate(m2, merchants, "0x1234"), "BadSignature");
    await reverts(api.registerMandate(m2, [agent.address], sig2), "MerchantsHashMismatch");
    await reverts(api.registerMandate(m2, [...merchants].reverse(), sig2), "MerchantsHashMismatch");
  });

  it("blocks registration while paused", async () => {
    const { fake, m, merchants, sign } = await setup();
    fake.setPaused(true);
    const m2 = { ...m, nonce: "2" };
    await reverts(
      fake.as(stranger.address).registerMandate(m2, merchants, await sign(m2)),
      "Paused",
    );
  });
});

describe("FakeEscrow: createEscrow enforcement", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let a: EscrowApi;
  beforeEach(async () => {
    ctx = await setup();
    a = ctx.fake.as(agent.address);
  });

  it("holds funds and records state", async () => {
    const { escrowId } = await a.createEscrow(ctx.mandateId, merchant.address, 10_000n, REQ);
    const e = await a.getEscrow(escrowId);
    expect(e).toMatchObject({ state: "Held", amount: 10_000n, windowEnds: T0 + WINDOW });
    expect(await a.spent(ctx.mandateId)).toBe(10_000n);
    expect(ctx.fake.contractBalance).toBe(10_000n);
    expect(ctx.fake.balanceOf(owner.address)).toBe(100_000_000n - 10_000n);
  });

  it("enforces every limit", async () => {
    const id = ctx.mandateId;
    await reverts(
      a.createEscrow(keccak256(toHex("nope")), merchant.address, 1n, REQ),
      "MandateUnknown",
    );
    await reverts(
      ctx.fake.as(owner.address).createEscrow(id, merchant.address, 1n, REQ),
      "NotAgent",
    );
    await reverts(a.createEscrow(id, merchant.address, 0n, REQ), "ZeroAmount");
    await reverts(a.createEscrow(id, stranger.address, 1n, REQ), "MerchantNotAllowed");
    await reverts(a.createEscrow(id, merchant.address, 50_001n, REQ), "ExceedsMaxPrice");
    for (let i = 0; i < 40; i++)
      await a.createEscrow(id, merchant.address, 50_000n, keccak256(toHex(`r${i}`)));
    await reverts(a.createEscrow(id, merchant.address, 1n, REQ), "ExceedsBudget");
    expect(await a.spent(id)).toBe(2_000_000n);
  });

  it("rejects duplicate request ids and expired mandates", async () => {
    await a.createEscrow(ctx.mandateId, merchant.address, 1_000n, REQ);
    await reverts(a.createEscrow(ctx.mandateId, merchant.address, 1_000n, REQ), "DuplicateRequest");
    ctx.clock.set(T0 + 86_400);
    await reverts(
      a.createEscrow(ctx.mandateId, merchant.address, 1_000n, keccak256(toHex("r2"))),
      "MandateExpired",
    );
  });

  it("blocks while paused", async () => {
    ctx.fake.setPaused(true);
    await reverts(a.createEscrow(ctx.mandateId, merchant.address, 1_000n, REQ), "Paused");
  });
});

describe("FakeEscrow: lifecycle", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let escrowId: Hex;
  beforeEach(async () => {
    ctx = await setup();
    escrowId = (
      await ctx.fake.as(agent.address).createEscrow(ctx.mandateId, merchant.address, 10_000n, REQ)
    ).escrowId;
  });

  it("release pays the merchant only after the window", async () => {
    const api = ctx.fake.as(stranger.address);
    await reverts(api.release(escrowId), "WindowOpen");
    ctx.clock.advance(WINDOW);
    await api.release(escrowId);
    expect(ctx.fake.balanceOf(merchant.address)).toBe(10_000n);
    expect(ctx.fake.contractBalance).toBe(0n);
    await reverts(api.release(escrowId), "WrongState");
  });

  it("dispute is owner-only and only inside the window", async () => {
    await reverts(ctx.fake.as(agent.address).dispute(escrowId, reason), "NotOwner");
    ctx.clock.advance(WINDOW);
    await reverts(ctx.fake.as(owner.address).dispute(escrowId, reason), "WindowClosed");
  });

  it("dispute then refund returns funds and blames the merchant", async () => {
    const seen: string[] = [];
    ctx.fake.as(arbiter.address).watchDisputed((e) => seen.push(`d:${e.escrowId}`));
    ctx.fake.as(arbiter.address).watchResolved((e) => seen.push(`r:${e.outcome}:${e.fault}`));
    await ctx.fake.as(owner.address).dispute(escrowId, reason);
    await reverts(ctx.fake.as(stranger.address).release(escrowId), "WrongState");
    await reverts(
      ctx.fake.as(owner.address).resolve(escrowId, "REFUND", "MERCHANT", reason),
      "NotArbiter",
    );
    await ctx.fake.as(arbiter.address).resolve(escrowId, "REFUND", "MERCHANT", reason);
    expect(ctx.fake.balanceOf(owner.address)).toBe(100_000_000n);
    expect((await ctx.fake.as(owner.address).getEscrow(escrowId)).state).toBe("Refunded");
    expect(await ctx.fake.as(owner.address).merchantReputation(merchant.address)).toEqual({
      disputes: 1,
      faults: 1,
    });
    expect(await ctx.fake.as(owner.address).agentReputation(agent.address)).toEqual({
      disputes: 1,
      faults: 0,
    });
    expect(seen).toEqual([`d:${escrowId}`, "r:REFUND:MERCHANT"]);
    await reverts(
      ctx.fake.as(arbiter.address).resolve(escrowId, "RELEASE", "NONE", reason),
      "WrongState",
    );
  });

  it("dispute then release (buyer regret) pays the merchant and blames no one", async () => {
    await ctx.fake.as(owner.address).dispute(escrowId, reason);
    await ctx.fake.as(arbiter.address).resolve(escrowId, "RELEASE", "NONE", reason);
    expect(ctx.fake.balanceOf(merchant.address)).toBe(10_000n);
    expect(await ctx.fake.as(owner.address).merchantReputation(merchant.address)).toEqual({
      disputes: 1,
      faults: 0,
    });
  });

  it("resolve still works while paused", async () => {
    await ctx.fake.as(owner.address).dispute(escrowId, reason);
    ctx.fake.setPaused(true);
    await ctx.fake.as(arbiter.address).resolve(escrowId, "REFUND", "MERCHANT", reason);
  });

  it("anchorRoot is gateway-only and idempotent", async () => {
    const root = keccak256(toHex("root"));
    await reverts(ctx.fake.as(stranger.address).anchorRoot(root, 5, 0), "NotGateway");
    await ctx.fake.as(gateway.address).anchorRoot(root, 5, 0);
    const first = await ctx.fake.as(gateway.address).anchoredAt(root);
    ctx.clock.advance(100);
    await ctx.fake.as(gateway.address).anchorRoot(root, 5, 0);
    expect(await ctx.fake.as(gateway.address).anchoredAt(root)).toBe(first);
  });

  it("conserves value across a random walk of actions", async () => {
    const total = () =>
      ctx.fake.contractBalance +
      ctx.fake.balanceOf(owner.address) +
      ctx.fake.balanceOf(merchant.address);
    const before = total();
    const ids = [escrowId];
    for (let i = 0; i < 6; i++) {
      ids.push(
        (
          await ctx.fake
            .as(agent.address)
            .createEscrow(ctx.mandateId, merchant.address, 1_000n, keccak256(toHex(`w${i}`)))
        ).escrowId,
      );
    }
    await ctx.fake.as(owner.address).dispute(ids[1]!, reason);
    await ctx.fake.as(arbiter.address).resolve(ids[1]!, "REFUND", "MERCHANT", reason);
    await ctx.fake.as(owner.address).dispute(ids[2]!, reason);
    ctx.clock.advance(WINDOW);
    for (const id of [ids[0]!, ids[3]!, ids[4]!]) await ctx.fake.as(stranger.address).release(id);
    expect(total()).toBe(before);
    expect(ctx.fake.contractBalance).toBe(1_000n * 3n); // ids[2] disputed, ids[5], ids[6] held
  });
});

it("EscrowRevert carries the contract error name", () => {
  expect(new EscrowRevert("WrongState").message).toContain("WrongState");
});
