import type { Address, Hex } from "viem";
import { EscrowRevert, type EscrowApi } from "@recourse/chain";

export type PayResult = { ok: true; escrowId: Hex; txHash: Hex } | { ok: false; reverted: string };

/**
 * Pays through the escrow with the agent key. A contract refusal (ExceedsMaxPrice, ExceedsBudget,
 * MerchantNotAllowed, ...) is an expected outcome, returned as data; anything else is a real error.
 */
export class Payer {
  constructor(private readonly escrow: Pick<EscrowApi, "createEscrow">) {}

  async pay(mandateId: Hex, merchant: Address, amount: bigint, requestId: Hex): Promise<PayResult> {
    try {
      const r = await this.escrow.createEscrow(mandateId, merchant, amount, requestId);
      return { ok: true, escrowId: r.escrowId, txHash: r.txHash };
    } catch (e) {
      if (e instanceof EscrowRevert) return { ok: false, reverted: e.code };
      throw e;
    }
  }
}
