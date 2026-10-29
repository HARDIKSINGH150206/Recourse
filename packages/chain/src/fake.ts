import {
  encodeAbiParameters,
  keccak256,
  recoverTypedDataAddress,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  MandateTypes,
  escrowDomain,
  mandateId as computeMandateId,
  merchantsHash,
  sortMerchants,
  systemClock,
  type Clock,
  type MandateJson,
} from "@recourse/shared";
import {
  EscrowRevert,
  type DisputedEvent,
  type EscrowApi,
  type EscrowRecord,
  type Fault,
  type Outcome,
  type ReputationRecord,
  type ResolvedEvent,
  type TxResult,
} from "./types.js";

export interface FakeRoles {
  admin: Address;
  arbiter: Address;
  gateway: Address;
}

const lc = (a: string) => a.toLowerCase();

/**
 * In-memory RecourseEscrow with the same rules as contracts/src/RecourseEscrow.sol, for other
 * lanes to develop and test against (GUIDE.md "fake for others to use"). Token balances are
 * tracked here too; the owner is assumed to have approved the escrow (infinite allowance).
 *
 * One fake is shared; `as(caller)` returns a view whose writes are sent from that address.
 * Behaviour must stay in step with the contract and docs/04 section 1.
 */
export class FakeEscrow {
  readonly balances = new Map<string, bigint>();
  private readonly mandates = new Map<Hex, MandateJson & { merchants: string[] }>();
  private readonly spentBy = new Map<Hex, bigint>();
  private readonly nonces = new Set<string>();
  private readonly escrowsById = new Map<Hex, EscrowRecord>();
  private readonly anchors = new Map<Hex, number>();
  private readonly agentRep = new Map<string, ReputationRecord>();
  private readonly merchantRep = new Map<string, ReputationRecord>();
  private readonly disputedLog = new Map<Hex, DisputedEvent>();
  private readonly disputedCbs: Array<(e: DisputedEvent) => void> = [];
  private readonly resolvedCbs: Array<(e: ResolvedEvent) => void> = [];
  private tx = 0;
  private paused = false;
  arbiter: Address;
  gateway: Address;
  readonly admin: Address;
  /** Escrow contract address used in the EIP-712 domain. */
  readonly address: Address;

  constructor(
    readonly chainId: number,
    roles: FakeRoles,
    readonly disputeWindow = 120,
    readonly clock: Clock = systemClock,
    address: Address = "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  ) {
    this.arbiter = roles.arbiter;
    this.gateway = roles.gateway;
    this.admin = roles.admin;
    this.address = address;
  }

  mint(to: Address, amount: bigint): void {
    this.balances.set(lc(to), this.balanceOf(to) + amount);
  }

  balanceOf(who: string): bigint {
    return this.balances.get(lc(who)) ?? 0n;
  }

  /** Balance held by the escrow contract itself. */
  get contractBalance(): bigint {
    return this.balanceOf(this.address);
  }

  setPaused(p: boolean): void {
    this.paused = p;
  }

  as(caller: Address): EscrowApi {
    return new FakeEscrowView(this, caller);
  }

  /** @internal */
  nextTx(): TxResult {
    this.tx += 1;
    return { txHash: keccak256(toHex(`fake-tx-${this.tx}`)) };
  }

  // ---- writes (called through a view)

  /** @internal */
  async registerMandate(m: MandateJson, merchants: Address[], signature: Hex) {
    if (this.paused) throw new EscrowRevert("Paused");
    if (this.nonces.has(`${lc(m.owner)}:${m.nonce}`)) throw new EscrowRevert("NonceUsed");
    const list = merchants.map(lc);
    for (let i = 1; i < list.length; i++) {
      if (BigInt(list[i - 1]!) >= BigInt(list[i]!)) throw new EscrowRevert("MerchantsHashMismatch");
    }
    if (
      merchantsHash(merchants) !== m.merchantsHash ||
      sortMerchants(merchants).join() !== merchants.join()
    ) {
      throw new EscrowRevert("MerchantsHashMismatch");
    }
    const id = computeMandateId(this.chainId, this.address, m);
    let signer: Address | null = null;
    try {
      signer = await recoverTypedDataAddress({
        domain: escrowDomain(this.chainId, this.address),
        types: MandateTypes,
        primaryType: "Mandate",
        message: {
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
        signature,
      });
    } catch {
      signer = null;
    }
    if (!signer || lc(signer) !== lc(m.owner)) throw new EscrowRevert("BadSignature");
    this.nonces.add(`${lc(m.owner)}:${m.nonce}`);
    this.mandates.set(id, { ...m, merchants: list });
    return { ...this.nextTx(), mandateId: id };
  }

  /** @internal */
  async createEscrow(
    caller: Address,
    mandateId: Hex,
    merchant: Address,
    amount: bigint,
    requestId: Hex,
  ) {
    if (this.paused) throw new EscrowRevert("Paused");
    const m = this.mandates.get(mandateId);
    if (!m) throw new EscrowRevert("MandateUnknown");
    if (lc(caller) !== lc(m.agent)) throw new EscrowRevert("NotAgent");
    const now = this.clock.now();
    if (now >= m.expiresAt) throw new EscrowRevert("MandateExpired");
    if (amount === 0n) throw new EscrowRevert("ZeroAmount");
    if (!m.merchants.includes(lc(merchant))) throw new EscrowRevert("MerchantNotAllowed");
    if (amount > BigInt(m.maxPricePerCall)) throw new EscrowRevert("ExceedsMaxPrice");
    const spent = this.spentBy.get(mandateId) ?? 0n;
    if (spent + amount > BigInt(m.totalBudget)) throw new EscrowRevert("ExceedsBudget");
    const escrowId = keccak256(
      encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [mandateId, requestId]),
    );
    if (this.escrowsById.has(escrowId)) throw new EscrowRevert("DuplicateRequest");
    if (this.balanceOf(m.owner) < amount) throw new EscrowRevert("InsufficientBalance");

    this.spentBy.set(mandateId, spent + amount);
    this.escrowsById.set(escrowId, {
      mandateId,
      merchant: lc(merchant) as Address,
      amount,
      requestId,
      createdAt: now,
      windowEnds: now + this.disputeWindow,
      state: "Held",
    });
    this.balances.set(lc(m.owner), this.balanceOf(m.owner) - amount);
    this.balances.set(lc(this.address), this.contractBalance + amount);
    return { ...this.nextTx(), escrowId };
  }

  private requireEscrow(id: Hex): EscrowRecord {
    const e = this.escrowsById.get(id);
    if (!e) throw new EscrowRevert("WrongState");
    return e;
  }

  private pay(to: string, amount: bigint) {
    this.balances.set(lc(this.address), this.contractBalance - amount);
    this.balances.set(lc(to), this.balanceOf(to) + amount);
  }

  /** @internal */
  async release(escrowId: Hex) {
    const e = this.requireEscrow(escrowId);
    if (e.state !== "Held") throw new EscrowRevert("WrongState");
    if (this.clock.now() < e.windowEnds) throw new EscrowRevert("WindowOpen");
    e.state = "Released";
    this.pay(e.merchant, e.amount);
    return this.nextTx();
  }

  /** @internal */
  async dispute(caller: Address, escrowId: Hex, reasonHash: Hex) {
    const e = this.requireEscrow(escrowId);
    if (e.state !== "Held") throw new EscrowRevert("WrongState");
    if (lc(caller) !== lc(this.mandates.get(e.mandateId)!.owner))
      throw new EscrowRevert("NotOwner");
    if (this.clock.now() >= e.windowEnds) throw new EscrowRevert("WindowClosed");
    e.state = "Disputed";
    const ev = { escrowId, by: caller, reasonHash };
    this.disputedLog.set(escrowId, ev);
    this.disputedCbs.forEach((cb) => cb(ev));
    return this.nextTx();
  }

  /** @internal */
  async resolve(
    caller: Address,
    escrowId: Hex,
    outcome: Outcome,
    fault: Fault,
    verdictCommitment: Hex,
  ) {
    if (lc(caller) !== lc(this.arbiter)) throw new EscrowRevert("NotArbiter");
    const e = this.requireEscrow(escrowId);
    if (e.state !== "Disputed") throw new EscrowRevert("WrongState");
    const m = this.mandates.get(e.mandateId)!;
    const bump = (map: Map<string, ReputationRecord>, who: string, isFault: boolean) => {
      const r = map.get(lc(who)) ?? { disputes: 0, faults: 0 };
      map.set(lc(who), { disputes: r.disputes + 1, faults: r.faults + (isFault ? 1 : 0) });
    };
    bump(this.agentRep, m.agent, fault === "AGENT");
    bump(this.merchantRep, e.merchant, fault === "MERCHANT");
    if (outcome === "REFUND") {
      e.state = "Refunded";
      this.pay(m.owner, e.amount);
    } else {
      e.state = "Released";
      this.pay(e.merchant, e.amount);
    }
    this.resolvedCbs.forEach((cb) => cb({ escrowId, outcome, fault, verdictCommitment }));
    return this.nextTx();
  }

  /** @internal */
  async anchorRoot(caller: Address, root: Hex) {
    if (lc(caller) !== lc(this.gateway)) throw new EscrowRevert("NotGateway");
    if (!this.anchors.has(root)) this.anchors.set(root, this.clock.now());
    return this.nextTx();
  }

  // ---- reads

  /** @internal */
  read = {
    escrow: (id: Hex): EscrowRecord => {
      const e = this.escrowsById.get(id);
      return e
        ? { ...e }
        : ({
            mandateId: "0x" + "00".repeat(32),
            merchant: "0x" + "00".repeat(20),
            amount: 0n,
            requestId: "0x" + "00".repeat(32),
            createdAt: 0,
            windowEnds: 0,
            state: "None",
          } as EscrowRecord);
    },
    mandate: (id: Hex): MandateJson => {
      const m = this.mandates.get(id);
      if (!m) throw new EscrowRevert("MandateUnknown");
      const rest: Partial<typeof m> = { ...m };
      delete rest.merchants;
      return rest as MandateJson;
    },
    disputed: (id: Hex): DisputedEvent | null => this.disputedLog.get(id) ?? null,
    spent: (id: Hex) => this.spentBy.get(id) ?? 0n,
    anchoredAt: (root: Hex) => this.anchors.get(root) ?? 0,
    agentRep: (a: string) => this.agentRep.get(lc(a)) ?? { disputes: 0, faults: 0 },
    merchantRep: (a: string) => this.merchantRep.get(lc(a)) ?? { disputes: 0, faults: 0 },
  };

  /** @internal */
  onDisputed(cb: (e: DisputedEvent) => void): () => void {
    this.disputedCbs.push(cb);
    return () => void this.disputedCbs.splice(this.disputedCbs.indexOf(cb), 1);
  }

  /** @internal */
  onResolved(cb: (e: ResolvedEvent) => void): () => void {
    this.resolvedCbs.push(cb);
    return () => void this.resolvedCbs.splice(this.resolvedCbs.indexOf(cb), 1);
  }
}

class FakeEscrowView implements EscrowApi {
  constructor(
    private readonly f: FakeEscrow,
    private readonly caller: Address,
  ) {}

  registerMandate(m: MandateJson, merchants: Address[], signature: Hex) {
    return this.f.registerMandate(m, merchants, signature);
  }
  createEscrow(mandateId: Hex, merchant: Address, amount: bigint, requestId: Hex) {
    return this.f.createEscrow(this.caller, mandateId, merchant, amount, requestId);
  }
  release(escrowId: Hex) {
    return this.f.release(escrowId);
  }
  dispute(escrowId: Hex, reasonHash: Hex) {
    return this.f.dispute(this.caller, escrowId, reasonHash);
  }
  resolve(escrowId: Hex, outcome: Outcome, fault: Fault, verdictCommitment: Hex) {
    return this.f.resolve(this.caller, escrowId, outcome, fault, verdictCommitment);
  }
  anchorRoot(root: Hex, _size: number, _batchIndex: number) {
    return this.f.anchorRoot(this.caller, root);
  }
  async getEscrow(id: Hex) {
    return this.f.read.escrow(id);
  }
  async getMandate(id: Hex) {
    return this.f.read.mandate(id);
  }
  async spent(id: Hex) {
    return this.f.read.spent(id);
  }
  async anchoredAt(root: Hex) {
    return this.f.read.anchoredAt(root);
  }
  async agentReputation(a: Address) {
    return this.f.read.agentRep(a);
  }
  async merchantReputation(a: Address) {
    return this.f.read.merchantRep(a);
  }
  async findDisputed(escrowId: Hex) {
    return this.f.read.disputed(escrowId);
  }
  watchDisputed(cb: (e: DisputedEvent) => void) {
    return this.f.onDisputed(cb);
  }
  watchResolved(cb: (e: ResolvedEvent) => void) {
    return this.f.onResolved(cb);
  }
}
