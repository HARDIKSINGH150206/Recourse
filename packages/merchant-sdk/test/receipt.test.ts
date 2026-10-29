import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import {
  decodeReceiptHeader,
  encodeReceiptHeader,
  signReceipt,
  verifyReceipt,
} from "../src/index.js";
import { CHAIN_ID, T0, merchant, merchant2, rid } from "./helpers.js";

const body = new TextEncoder().encode('{"city":"Mumbai"}');
const input = { requestId: rid("r1"), body, timestamp: T0, merchant: merchant.address };

describe("receipts", () => {
  it("signs over the keccak of the exact body and verifies", async () => {
    const r = await signReceipt(merchant, CHAIN_ID, input);
    expect(r.responseHash).toBe(keccak256(body));
    expect(r.merchant).toBe(merchant.address.toLowerCase());
    expect(await verifyReceipt(CHAIN_ID, r, merchant.address, body)).toBe(true);
    expect(await verifyReceipt(CHAIN_ID, r, merchant.address)).toBe(true);
  });

  it("fails for a different body, merchant, chain or edited field", async () => {
    const r = await signReceipt(merchant, CHAIN_ID, input);
    expect(
      await verifyReceipt(CHAIN_ID, r, merchant.address, new TextEncoder().encode("other")),
    ).toBe(false);
    expect(await verifyReceipt(CHAIN_ID, r, merchant2.address)).toBe(false);
    expect(await verifyReceipt(1, r, merchant.address)).toBe(false);
    expect(
      await verifyReceipt(CHAIN_ID, { ...r, timestamp: r.timestamp + 1 }, merchant.address),
    ).toBe(false);
    expect(await verifyReceipt(CHAIN_ID, { ...r, requestId: rid("r2") }, merchant.address)).toBe(
      false,
    );
  });

  it("a receipt signed by someone else does not verify as the merchant", async () => {
    const r = await signReceipt(merchant2, CHAIN_ID, { ...input, merchant: merchant.address });
    expect(await verifyReceipt(CHAIN_ID, r, merchant.address)).toBe(false);
  });

  it("rejects malformed receipts without throwing", async () => {
    for (const bad of [null, undefined, 1, {}, { requestId: "x" }, "str"]) {
      expect(await verifyReceipt(CHAIN_ID, bad, merchant.address)).toBe(false);
    }
  });

  it("header encoding round trips and tolerates junk", async () => {
    const r = await signReceipt(merchant, CHAIN_ID, input);
    expect(decodeReceiptHeader(encodeReceiptHeader(r))).toEqual(r);
    expect(decodeReceiptHeader("!!!")).toBeUndefined();
    expect(toHex(new Uint8Array())).toBe("0x");
  });
});
