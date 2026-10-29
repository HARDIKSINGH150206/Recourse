// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRecourseEscrow} from "./interfaces/IRecourseEscrow.sol";

/// Mandate-enforcing escrow with a dispute window, arbiter resolution and evidence-root anchoring.
/// Spec: docs/04-api-spec.md section 1, docs/03-crypto-and-merkle-spec.md section 2.
/// Known limits: no refund after Released (no clawback), no arbiter timeout (MVP).
contract RecourseEscrow is IRecourseEscrow, EIP712, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant MANDATE_TYPEHASH = keccak256(
        "Mandate(address owner,address agent,address token,uint256 maxPricePerCall,uint256 totalBudget,uint64 expiresAt,uint256 nonce,bytes32 merchantsHash,bytes32 termsHash)"
    );

    uint64 public immutable override disputeWindow;
    address public override arbiter;
    address public override gateway;

    mapping(bytes32 => Mandate) private _mandates;
    mapping(bytes32 => uint256) private _spent;
    mapping(bytes32 => mapping(address => bool)) private _allowed;
    mapping(address => mapping(uint256 => bool)) public nonceUsed;
    mapping(bytes32 => Escrow) private _escrows;
    mapping(bytes32 => uint64) private _anchoredAt;
    mapping(address => Reputation) private _agentRep;
    mapping(address => Reputation) private _merchantRep;

    constructor(address owner_, address arbiter_, address gateway_, uint64 disputeWindow_)
        EIP712("RecourseEscrow", "1")
        Ownable(owner_)
    {
        arbiter = arbiter_;
        gateway = gateway_;
        disputeWindow = disputeWindow_;
    }

    // ---------------------------------------------------------------- mandate registry

    function registerMandate(Mandate calldata m, address[] calldata merchants, bytes calldata signature)
        external
        whenNotPaused
        returns (bytes32 mandateId)
    {
        if (nonceUsed[m.owner][m.nonce]) revert NonceUsed();
        if (keccak256(abi.encodePacked(merchants)) != m.merchantsHash) revert MerchantsHashMismatch();
        // allowlist must be strictly ascending (sorted, no duplicates)
        for (uint256 i = 1; i < merchants.length; i++) {
            if (merchants[i - 1] >= merchants[i]) revert MerchantsHashMismatch();
        }

        bytes32 structHash = keccak256(
            abi.encode(
                MANDATE_TYPEHASH,
                m.owner,
                m.agent,
                m.token,
                m.maxPricePerCall,
                m.totalBudget,
                m.expiresAt,
                m.nonce,
                m.merchantsHash,
                m.termsHash
            )
        );
        mandateId = _hashTypedDataV4(structHash);
        if (!SignatureChecker.isValidSignatureNow(m.owner, mandateId, signature)) revert BadSignature();

        nonceUsed[m.owner][m.nonce] = true;
        _mandates[mandateId] = m;
        for (uint256 i = 0; i < merchants.length; i++) {
            _allowed[mandateId][merchants[i]] = true;
        }
        emit MandateRegistered(mandateId, m.owner, m.agent, m.termsHash);
    }

    // ---------------------------------------------------------------- escrow lifecycle

    function createEscrow(bytes32 mandateId, address merchant, uint256 amount, bytes32 requestId)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 escrowId)
    {
        Mandate storage m = _mandates[mandateId];
        if (m.owner == address(0)) revert MandateUnknown();
        if (msg.sender != m.agent) revert NotAgent();
        if (block.timestamp >= m.expiresAt) revert MandateExpired();
        if (amount == 0) revert ZeroAmount();
        if (!_allowed[mandateId][merchant]) revert MerchantNotAllowed();
        if (amount > m.maxPricePerCall) revert ExceedsMaxPrice();
        if (_spent[mandateId] + amount > m.totalBudget) revert ExceedsBudget();

        escrowId = keccak256(abi.encode(mandateId, requestId));
        if (_escrows[escrowId].state != State.None) revert DuplicateRequest();

        uint64 windowEnds = uint64(block.timestamp) + disputeWindow;
        _spent[mandateId] += amount;
        _escrows[escrowId] = Escrow({
            mandateId: mandateId,
            merchant: merchant,
            amount: amount,
            requestId: requestId,
            createdAt: uint64(block.timestamp),
            windowEnds: windowEnds,
            state: State.Held
        });
        emit EscrowCreated(escrowId, mandateId, merchant, amount, requestId, windowEnds);

        IERC20(m.token).safeTransferFrom(m.owner, address(this), amount);
    }

    function release(bytes32 escrowId) external nonReentrant {
        Escrow storage e = _escrows[escrowId];
        if (e.state != State.Held) revert WrongState();
        if (block.timestamp < e.windowEnds) revert WindowOpen();

        e.state = State.Released;
        emit Released(escrowId);
        IERC20(_mandates[e.mandateId].token).safeTransfer(e.merchant, e.amount);
    }

    function dispute(bytes32 escrowId, bytes32 reasonHash) external {
        Escrow storage e = _escrows[escrowId];
        if (e.state != State.Held) revert WrongState();
        if (msg.sender != _mandates[e.mandateId].owner) revert NotOwner();
        if (block.timestamp >= e.windowEnds) revert WindowClosed();

        e.state = State.Disputed;
        emit Disputed(escrowId, msg.sender, reasonHash);
    }

    /// Not paused-gated on purpose: an arbiter must be able to settle open disputes while paused.
    /// A refund returns tokens but does not restore `spent` (conservative budget accounting).
    function resolve(bytes32 escrowId, Outcome outcome, Fault fault, bytes32 verdictCommitment)
        external
        nonReentrant
    {
        if (msg.sender != arbiter) revert NotArbiter();
        Escrow storage e = _escrows[escrowId];
        if (e.state != State.Disputed) revert WrongState();

        Mandate storage m = _mandates[e.mandateId];
        _agentRep[m.agent].disputes++;
        _merchantRep[e.merchant].disputes++;
        if (fault == Fault.AGENT) _agentRep[m.agent].faults++;
        else if (fault == Fault.MERCHANT) _merchantRep[e.merchant].faults++;

        address to;
        if (outcome == Outcome.REFUND) {
            e.state = State.Refunded;
            to = m.owner;
        } else {
            e.state = State.Released;
            to = e.merchant;
        }
        emit Resolved(escrowId, outcome, fault, verdictCommitment);
        IERC20(m.token).safeTransfer(to, e.amount);
    }

    // ---------------------------------------------------------------- evidence anchoring

    function anchorRoot(bytes32 root, uint64 size, uint64 batchIndex) external {
        if (msg.sender != gateway) revert NotGateway();
        if (_anchoredAt[root] != 0) return; // idempotent per root
        _anchoredAt[root] = uint64(block.timestamp);
        emit RootAnchored(root, size, batchIndex, uint64(block.timestamp));
    }

    // ---------------------------------------------------------------- admin

    function setArbiter(address a) external onlyOwner {
        arbiter = a;
    }

    function setGateway(address g) external onlyOwner {
        gateway = g;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------- views

    function mandates(bytes32 mandateId) external view returns (Mandate memory) {
        return _mandates[mandateId];
    }

    function spent(bytes32 mandateId) external view returns (uint256) {
        return _spent[mandateId];
    }

    function isMerchantAllowed(bytes32 mandateId, address merchant) external view returns (bool) {
        return _allowed[mandateId][merchant];
    }

    function escrows(bytes32 escrowId) external view returns (Escrow memory) {
        return _escrows[escrowId];
    }

    function anchoredAt(bytes32 root) external view returns (uint64) {
        return _anchoredAt[root];
    }

    function agentReputation(address agent) external view returns (Reputation memory) {
        return _agentRep[agent];
    }

    function merchantReputation(address merchant) external view returns (Reputation memory) {
        return _merchantRep[merchant];
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
