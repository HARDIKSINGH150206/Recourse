import { parseAbi } from "viem";

/** ABI of RecourseEscrow, kept in step with docs/04-api-spec.md section 1.1. */
export const escrowAbi = parseAbi([
  "struct Mandate { address owner; address agent; address token; uint256 maxPricePerCall; uint256 totalBudget; uint64 expiresAt; uint256 nonce; bytes32 merchantsHash; bytes32 termsHash; }",
  "struct Escrow { bytes32 mandateId; address merchant; uint256 amount; bytes32 requestId; uint64 createdAt; uint64 windowEnds; uint8 state; }",
  "struct Reputation { uint32 disputes; uint32 faults; }",

  "event MandateRegistered(bytes32 indexed mandateId, address indexed owner, address indexed agent, bytes32 termsHash)",
  "event EscrowCreated(bytes32 indexed escrowId, bytes32 indexed mandateId, address indexed merchant, uint256 amount, bytes32 requestId, uint64 windowEnds)",
  "event Released(bytes32 indexed escrowId)",
  "event Disputed(bytes32 indexed escrowId, address indexed by, bytes32 reasonHash)",
  "event Resolved(bytes32 indexed escrowId, uint8 outcome, uint8 fault, bytes32 verdictCommitment)",
  "event RootAnchored(bytes32 indexed root, uint64 size, uint64 batchIndex, uint64 timestamp)",

  "error BadSignature()",
  "error NonceUsed()",
  "error MandateUnknown()",
  "error MandateExpired()",
  "error NotAgent()",
  "error NotOwner()",
  "error NotArbiter()",
  "error NotGateway()",
  "error ExceedsMaxPrice()",
  "error ExceedsBudget()",
  "error MerchantNotAllowed()",
  "error DuplicateRequest()",
  "error WrongState()",
  "error WindowOpen()",
  "error WindowClosed()",
  "error MerchantsHashMismatch()",
  "error ZeroAmount()",

  "function registerMandate(Mandate m, address[] merchants, bytes signature) returns (bytes32 mandateId)",
  "function createEscrow(bytes32 mandateId, address merchant, uint256 amount, bytes32 requestId) returns (bytes32 escrowId)",
  "function release(bytes32 escrowId)",
  "function dispute(bytes32 escrowId, bytes32 reasonHash)",
  "function resolve(bytes32 escrowId, uint8 outcome, uint8 fault, bytes32 verdictCommitment)",
  "function anchorRoot(bytes32 root, uint64 size, uint64 batchIndex)",

  "function mandates(bytes32 mandateId) view returns (Mandate)",
  "function spent(bytes32 mandateId) view returns (uint256)",
  "function isMerchantAllowed(bytes32 mandateId, address merchant) view returns (bool)",
  "function escrows(bytes32 escrowId) view returns (Escrow)",
  "function anchoredAt(bytes32 root) view returns (uint64)",
  "function agentReputation(address agent) view returns (Reputation)",
  "function merchantReputation(address merchant) view returns (Reputation)",
  "function disputeWindow() view returns (uint64)",
  "function arbiter() view returns (address)",
  "function gateway() view returns (address)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const REVERT_NAMES = [
  "BadSignature",
  "NonceUsed",
  "MandateUnknown",
  "MandateExpired",
  "NotAgent",
  "NotOwner",
  "NotArbiter",
  "NotGateway",
  "ExceedsMaxPrice",
  "ExceedsBudget",
  "MerchantNotAllowed",
  "DuplicateRequest",
  "WrongState",
  "WindowOpen",
  "WindowClosed",
  "MerchantsHashMismatch",
  "ZeroAmount",
] as const;
export type RevertName = (typeof REVERT_NAMES)[number];
