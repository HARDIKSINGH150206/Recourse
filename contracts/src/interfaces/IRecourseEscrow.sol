// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Interface of record: docs/04-api-spec.md section 1.1. Change both in the same commit.
interface IRecourseEscrow {
    enum State { None, Held, Disputed, Released, Refunded }
    enum Outcome { REFUND, RELEASE }
    enum Fault { NONE, AGENT, MERCHANT }

    struct Mandate {
        address owner;
        address agent;
        address token;
        uint256 maxPricePerCall;
        uint256 totalBudget;
        uint64 expiresAt;
        uint256 nonce;
        bytes32 merchantsHash;
        bytes32 termsHash;
    }

    struct Escrow {
        bytes32 mandateId;
        address merchant;
        uint256 amount;
        bytes32 requestId;
        uint64 createdAt;
        uint64 windowEnds;
        State state;
    }

    struct Reputation {
        uint32 disputes;
        uint32 faults;
    }

    // --- events
    event MandateRegistered(bytes32 indexed mandateId, address indexed owner, address indexed agent, bytes32 termsHash);
    event EscrowCreated(
        bytes32 indexed escrowId,
        bytes32 indexed mandateId,
        address indexed merchant,
        uint256 amount,
        bytes32 requestId,
        uint64 windowEnds
    );
    event Released(bytes32 indexed escrowId);
    event Disputed(bytes32 indexed escrowId, address indexed by, bytes32 reasonHash);
    event Resolved(bytes32 indexed escrowId, Outcome outcome, Fault fault, bytes32 verdictCommitment);
    event RootAnchored(bytes32 indexed root, uint64 size, uint64 batchIndex, uint64 timestamp);

    // --- custom errors
    error BadSignature();
    error NonceUsed();
    error MandateUnknown();
    error MandateExpired();
    error NotAgent();
    error NotOwner();
    error NotArbiter();
    error NotGateway();
    error ExceedsMaxPrice();
    error ExceedsBudget();
    error MerchantNotAllowed();
    error DuplicateRequest();
    error WrongState();
    error WindowOpen();
    error WindowClosed();
    error MerchantsHashMismatch();
    error ZeroAmount();

    // --- mandate registry
    function registerMandate(Mandate calldata m, address[] calldata merchants, bytes calldata signature)
        external
        returns (bytes32 mandateId);

    // --- escrow lifecycle
    function createEscrow(bytes32 mandateId, address merchant, uint256 amount, bytes32 requestId)
        external
        returns (bytes32 escrowId);
    function release(bytes32 escrowId) external;
    function dispute(bytes32 escrowId, bytes32 reasonHash) external;
    function resolve(bytes32 escrowId, Outcome outcome, Fault fault, bytes32 verdictCommitment) external;

    // --- evidence anchoring
    function anchorRoot(bytes32 root, uint64 size, uint64 batchIndex) external;

    // --- admin
    function setArbiter(address a) external;
    function setGateway(address g) external;
    function pause() external;
    function unpause() external;

    // --- views
    function mandates(bytes32 mandateId) external view returns (Mandate memory);
    function spent(bytes32 mandateId) external view returns (uint256);
    function isMerchantAllowed(bytes32 mandateId, address merchant) external view returns (bool);
    function escrows(bytes32 escrowId) external view returns (Escrow memory);
    function anchoredAt(bytes32 root) external view returns (uint64);
    function agentReputation(address agent) external view returns (Reputation memory);
    function merchantReputation(address merchant) external view returns (Reputation memory);
    function disputeWindow() external view returns (uint64);
    function arbiter() external view returns (address);
    function gateway() external view returns (address);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
