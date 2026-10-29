// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RecourseEscrow} from "../src/RecourseEscrow.sol";
import {IRecourseEscrow} from "../src/interfaces/IRecourseEscrow.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// Shared fixture: deploys escrow + token, funds the owner and registers one mandate.
abstract contract Base is Test {
    RecourseEscrow public escrow;
    MockUSDC public usdc;

    uint256 internal ownerPk = 0xA11CE;
    address internal owner;
    address internal agent = makeAddr("agent");
    address internal merchant = makeAddr("merchant");
    address internal merchant2 = makeAddr("merchant2");
    address internal arbiter = makeAddr("arbiter");
    address internal gateway = makeAddr("gateway");
    address internal admin = makeAddr("admin");

    uint64 internal constant WINDOW = 120;
    uint256 internal constant MAX_PRICE = 50_000; // 0.05 USDC
    uint256 internal constant BUDGET = 2_000_000; // 2 USDC
    bytes32 internal constant TERMS = keccak256("terms");

    bytes32 public mandateId;

    function setUp() public virtual {
        owner = vm.addr(ownerPk);
        escrow = new RecourseEscrow(admin, arbiter, gateway, WINDOW);
        usdc = new MockUSDC();
        usdc.mint(owner, 100_000_000);
        vm.prank(owner);
        usdc.approve(address(escrow), type(uint256).max);

        address[] memory ms = _sorted(merchant, merchant2);
        mandateId = _register(_mandate(1, uint64(block.timestamp + 1 days), ms), ms, ownerPk);
    }

    function _sorted(address a, address b) internal pure returns (address[] memory ms) {
        ms = new address[](2);
        (ms[0], ms[1]) = a < b ? (a, b) : (b, a);
    }

    function _mandate(uint256 nonce, uint64 expiresAt, address[] memory ms)
        internal
        view
        returns (IRecourseEscrow.Mandate memory)
    {
        return IRecourseEscrow.Mandate({
            owner: owner,
            agent: agent,
            token: address(usdc),
            maxPricePerCall: MAX_PRICE,
            totalBudget: BUDGET,
            expiresAt: expiresAt,
            nonce: nonce,
            merchantsHash: keccak256(abi.encodePacked(ms)),
            termsHash: TERMS
        });
    }

    function _digest(IRecourseEscrow.Mandate memory m) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                escrow.MANDATE_TYPEHASH(),
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
        return keccak256(abi.encodePacked("\x19\x01", escrow.DOMAIN_SEPARATOR(), structHash));
    }

    function _sign(IRecourseEscrow.Mandate memory m, uint256 pk) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(m));
        return abi.encodePacked(r, s, v);
    }

    function _register(IRecourseEscrow.Mandate memory m, address[] memory ms, uint256 pk)
        internal
        returns (bytes32)
    {
        return escrow.registerMandate(m, ms, _sign(m, pk));
    }

    function _pay(uint256 amount, bytes32 requestId) internal returns (bytes32) {
        vm.prank(agent);
        return escrow.createEscrow(mandateId, merchant, amount, requestId);
    }
}
