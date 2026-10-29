import { describe, expect, it } from "vitest";
import {
  merchantsHash,
  recoverReceiptSigner,
  recoverTreeHeadSigner,
  signReceipt,
  signTreeHead,
  sortMerchants,
} from "../src/index.js";
import { CHAIN_ID, MANDATE_ID, REQUEST_ID, accounts, mandate, ESCROW } from "./fixture.js";
import { mandateId } from "../src/index.js";

describe("eip712", () => {
  it("merchantsHash is order independent and sorted ascending", () => {
    const a = "0x0000000000000000000000000000000000000002";
    const b = "0x0000000000000000000000000000000000000001";
    expect(sortMerchants([a, b])).toEqual([b, a]);
    expect(merchantsHash([a, b])).toBe(merchantsHash([b, a]));
  });

  it("mandateId is deterministic and domain separated by chain", () => {
    expect(mandateId(CHAIN_ID, ESCROW, mandate)).toBe(MANDATE_ID);
    expect(mandateId(1, ESCROW, mandate)).not.toBe(MANDATE_ID);
  });

  it("tree head round trip recovers the gateway", async () => {
    const head = { root: MANDATE_ID, size: 5, batch_index: 0, timestamp: 1 };
    const signature = await signTreeHead(accounts.gateway, CHAIN_ID, head);
    expect(await recoverTreeHeadSigner(CHAIN_ID, { ...head, signature })).toBe(
      accounts.gateway.address,
    );
    // wrong chain recovers a different address
    expect(await recoverTreeHeadSigner(1, { ...head, signature })).not.toBe(
      accounts.gateway.address,
    );
  });

  it("receipt round trip recovers the merchant", async () => {
    const r = {
      requestId: REQUEST_ID,
      responseHash: MANDATE_ID,
      timestamp: 5,
      merchant: accounts.merchant.address.toLowerCase(),
    };
    const signature = await signReceipt(accounts.merchant, CHAIN_ID, r);
    expect(await recoverReceiptSigner(CHAIN_ID, { ...r, signature })).toBe(
      accounts.merchant.address,
    );
  });
});
