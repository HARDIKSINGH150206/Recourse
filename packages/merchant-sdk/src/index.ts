import { protect } from "./protect.js";

export { protect, type ProtectOptions, type RecourseLocals } from "./protect.js";
export {
  signReceipt,
  verifyReceipt,
  encodeReceiptHeader,
  decodeReceiptHeader,
  type ReceiptInput,
  type ReceiptSigner,
} from "./receipt.js";
export {
  buildRequirements,
  priceToUnits,
  type PaymentRequirements,
  type RequirementsInput,
} from "./requirements.js";
export { MemoryServedStore, type ServedStore } from "./served-store.js";

/** `recourse.protect(opts)` as in docs/04 section 5. */
export const recourse = { protect };
