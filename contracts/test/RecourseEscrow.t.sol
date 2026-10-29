// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {IRecourseEscrow} from "../src/interfaces/IRecourseEscrow.sol";

contract RecourseEscrowTest is Base {
    bytes32 internal constant REQ = keccak256("req-1");

    // ------------------------------------------------------------ registerMandate

    function test_register_storesMandateAndAllowlist() public view {
        assertEq(escrow.mandates(mandateId).owner, owner);
        assertEq(escrow.mandates(mandateId).totalBudget, BUDGET);
        assertTrue(escrow.isMerchantAllowed(mandateId, merchant));
        assertTrue(escrow.isMerchantAllowed(mandateId, merchant2));
        assertFalse(escrow.isMerchantAllowed(mandateId, agent));
        assertTrue(escrow.nonceUsed(owner, 1));
    }

    function test_register_matchesOffchainDigest() public view {
        // mandateId must equal the EIP-712 digest that TypeScript computes (packages/shared eip712.ts)
        assertEq(mandateId, _digest(escrow.mandates(mandateId)));
    }

    function test_register_revertsOnReplayedNonce() public {
        address[] memory ms = _sorted(merchant, merchant2);
        IRecourseEscrow.Mandate memory m = _mandate(1, uint64(block.timestamp + 1 days), ms);
        bytes memory sig = _sign(m, ownerPk);
        vm.expectRevert(IRecourseEscrow.NonceUsed.selector);
        escrow.registerMandate(m, ms, sig);
    }

    function test_register_revertsOnBadSignature() public {
        address[] memory ms = _sorted(merchant, merchant2);
        IRecourseEscrow.Mandate memory m = _mandate(2, uint64(block.timestamp + 1 days), ms);
        bytes memory sig = _sign(m, 0xBAD);
        vm.expectRevert(IRecourseEscrow.BadSignature.selector);
        escrow.registerMandate(m, ms, sig);
    }

    function test_register_revertsWhenFieldChangedAfterSigning() public {
        address[] memory ms = _sorted(merchant, merchant2);
        IRecourseEscrow.Mandate memory m = _mandate(2, uint64(block.timestamp + 1 days), ms);
        bytes memory sig = _sign(m, ownerPk);
        m.totalBudget += 1;
        vm.expectRevert(IRecourseEscrow.BadSignature.selector);
        escrow.registerMandate(m, ms, sig);
    }

    function test_register_revertsOnMerchantsHashMismatch() public {
        address[] memory ms = _sorted(merchant, merchant2);
        IRecourseEscrow.Mandate memory m = _mandate(2, uint64(block.timestamp + 1 days), ms);
        bytes memory sig = _sign(m, ownerPk);
        address[] memory other = new address[](1);
        other[0] = agent;
        vm.expectRevert(IRecourseEscrow.MerchantsHashMismatch.selector);
        escrow.registerMandate(m, other, sig);
    }

    function test_register_revertsOnUnsortedMerchants() public {
        address[] memory sorted = _sorted(merchant, merchant2);
        address[] memory unsorted = new address[](2);
        (unsorted[0], unsorted[1]) = (sorted[1], sorted[0]);
        IRecourseEscrow.Mandate memory m = _mandate(2, uint64(block.timestamp + 1 days), unsorted);
        bytes memory sig = _sign(m, ownerPk);
        vm.expectRevert(IRecourseEscrow.MerchantsHashMismatch.selector);
        escrow.registerMandate(m, unsorted, sig);
    }

    // ------------------------------------------------------------ createEscrow

    function test_create_holdsFundsAndRecordsState() public {
        uint256 before_ = usdc.balanceOf(owner);
        bytes32 id = _pay(10_000, REQ);
        assertEq(id, keccak256(abi.encode(mandateId, REQ)));
        IRecourseEscrow.Escrow memory e = escrow.escrows(id);
        assertEq(uint8(e.state), uint8(IRecourseEscrow.State.Held));
        assertEq(e.amount, 10_000);
        assertEq(e.windowEnds, uint64(block.timestamp) + WINDOW);
        assertEq(escrow.spent(mandateId), 10_000);
        assertEq(usdc.balanceOf(address(escrow)), 10_000);
        assertEq(usdc.balanceOf(owner), before_ - 10_000);
    }

    function test_create_revertsForUnknownMandate() public {
        vm.prank(agent);
        vm.expectRevert(IRecourseEscrow.MandateUnknown.selector);
        escrow.createEscrow(bytes32(uint256(1)), merchant, 1, REQ);
    }

    function test_create_revertsForNonAgent() public {
        vm.prank(owner);
        vm.expectRevert(IRecourseEscrow.NotAgent.selector);
        escrow.createEscrow(mandateId, merchant, 1, REQ);
    }

    function test_create_revertsAfterExpiry() public {
        vm.warp(block.timestamp + 1 days);
        vm.prank(agent);
        vm.expectRevert(IRecourseEscrow.MandateExpired.selector);
        escrow.createEscrow(mandateId, merchant, 1, REQ);
    }

    function test_create_revertsOnZeroAmount() public {
        vm.prank(agent);
        vm.expectRevert(IRecourseEscrow.ZeroAmount.selector);
        escrow.createEscrow(mandateId, merchant, 0, REQ);
    }

    function test_create_revertsForMerchantNotAllowed() public {
        vm.prank(agent);
        vm.expectRevert(IRecourseEscrow.MerchantNotAllowed.selector);
        escrow.createEscrow(mandateId, makeAddr("stranger"), 1, REQ);
    }

    function test_create_revertsAboveMaxPrice() public {
        vm.prank(agent);
        vm.expectRevert(IRecourseEscrow.ExceedsMaxPrice.selector);
        escrow.createEscrow(mandateId, merchant, MAX_PRICE + 1, REQ);
    }

    function test_create_revertsAboveBudget() public {
        for (uint256 i = 0; i < BUDGET / MAX_PRICE; i++) _pay(MAX_PRICE, bytes32(i + 100));
        assertEq(escrow.spent(mandateId), BUDGET);
        vm.prank(agent);
        vm.expectRevert(IRecourseEscrow.ExceedsBudget.selector);
        escrow.createEscrow(mandateId, merchant, 1, REQ);
    }

    function test_create_revertsOnDuplicateRequest() public {
        _pay(1_000, REQ);
        vm.prank(agent);
        vm.expectRevert(IRecourseEscrow.DuplicateRequest.selector);
        escrow.createEscrow(mandateId, merchant, 1_000, REQ);
    }

    function test_create_revertsWhenPaused() public {
        vm.prank(admin);
        escrow.pause();
        vm.prank(agent);
        vm.expectRevert();
        escrow.createEscrow(mandateId, merchant, 1, REQ);
    }

    // ------------------------------------------------------------ release

    function test_release_paysMerchantAfterWindow() public {
        bytes32 id = _pay(10_000, REQ);
        vm.warp(block.timestamp + WINDOW);
        escrow.release(id);
        assertEq(usdc.balanceOf(merchant), 10_000);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.escrows(id).state), uint8(IRecourseEscrow.State.Released));
    }

    function test_release_revertsWhileWindowOpen() public {
        bytes32 id = _pay(10_000, REQ);
        vm.expectRevert(IRecourseEscrow.WindowOpen.selector);
        escrow.release(id);
    }

    function test_release_revertsTwiceAndForUnknown() public {
        bytes32 id = _pay(10_000, REQ);
        vm.warp(block.timestamp + WINDOW);
        escrow.release(id);
        vm.expectRevert(IRecourseEscrow.WrongState.selector);
        escrow.release(id);
        vm.expectRevert(IRecourseEscrow.WrongState.selector);
        escrow.release(bytes32(uint256(9)));
    }

    // ------------------------------------------------------------ dispute

    function test_dispute_onlyOwnerWithinWindow() public {
        bytes32 id = _pay(10_000, REQ);
        vm.prank(agent);
        vm.expectRevert(IRecourseEscrow.NotOwner.selector);
        escrow.dispute(id, keccak256("why"));

        vm.warp(block.timestamp + WINDOW);
        vm.prank(owner);
        vm.expectRevert(IRecourseEscrow.WindowClosed.selector);
        escrow.dispute(id, keccak256("why"));
    }

    function test_dispute_blocksReleaseAndSecondDispute() public {
        bytes32 id = _pay(10_000, REQ);
        vm.prank(owner);
        escrow.dispute(id, keccak256("why"));
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(IRecourseEscrow.WrongState.selector);
        escrow.release(id);
        vm.prank(owner);
        vm.expectRevert(IRecourseEscrow.WrongState.selector);
        escrow.dispute(id, keccak256("again"));
    }

    // ------------------------------------------------------------ resolve

    function test_resolve_refundReturnsFundsAndBlamesMerchant() public {
        bytes32 id = _pay(10_000, REQ);
        uint256 ownerBefore = usdc.balanceOf(owner);
        vm.prank(owner);
        escrow.dispute(id, keccak256("bad data"));
        vm.prank(arbiter);
        escrow.resolve(id, IRecourseEscrow.Outcome.REFUND, IRecourseEscrow.Fault.MERCHANT, keccak256("v"));
        assertEq(usdc.balanceOf(owner), ownerBefore + 10_000);
        assertEq(uint8(escrow.escrows(id).state), uint8(IRecourseEscrow.State.Refunded));
        assertEq(escrow.merchantReputation(merchant).disputes, 1);
        assertEq(escrow.merchantReputation(merchant).faults, 1);
        assertEq(escrow.agentReputation(agent).disputes, 1);
        assertEq(escrow.agentReputation(agent).faults, 0);
    }

    function test_resolve_releaseForBuyerRegretBlamesNoOne() public {
        bytes32 id = _pay(10_000, REQ);
        vm.prank(owner);
        escrow.dispute(id, keccak256("changed my mind"));
        vm.prank(arbiter);
        escrow.resolve(id, IRecourseEscrow.Outcome.RELEASE, IRecourseEscrow.Fault.NONE, keccak256("v"));
        assertEq(usdc.balanceOf(merchant), 10_000);
        assertEq(uint8(escrow.escrows(id).state), uint8(IRecourseEscrow.State.Released));
        assertEq(escrow.merchantReputation(merchant).faults, 0);
        assertEq(escrow.agentReputation(agent).faults, 0);
    }

    function test_resolve_agentFault() public {
        bytes32 id = _pay(10_000, REQ);
        vm.prank(owner);
        escrow.dispute(id, keccak256("x"));
        vm.prank(arbiter);
        escrow.resolve(id, IRecourseEscrow.Outcome.REFUND, IRecourseEscrow.Fault.AGENT, keccak256("v"));
        assertEq(escrow.agentReputation(agent).faults, 1);
        assertEq(escrow.merchantReputation(merchant).faults, 0);
    }

    function test_resolve_onlyArbiterAndOnlyWhenDisputed() public {
        bytes32 id = _pay(10_000, REQ);
        vm.prank(arbiter);
        vm.expectRevert(IRecourseEscrow.WrongState.selector);
        escrow.resolve(id, IRecourseEscrow.Outcome.REFUND, IRecourseEscrow.Fault.NONE, 0);

        vm.prank(owner);
        escrow.dispute(id, keccak256("x"));
        vm.prank(owner);
        vm.expectRevert(IRecourseEscrow.NotArbiter.selector);
        escrow.resolve(id, IRecourseEscrow.Outcome.REFUND, IRecourseEscrow.Fault.NONE, 0);
    }

    function test_resolve_worksWhilePaused() public {
        bytes32 id = _pay(10_000, REQ);
        vm.prank(owner);
        escrow.dispute(id, keccak256("x"));
        vm.prank(admin);
        escrow.pause();
        vm.prank(arbiter);
        escrow.resolve(id, IRecourseEscrow.Outcome.REFUND, IRecourseEscrow.Fault.MERCHANT, 0);
    }

    function test_resolve_cannotRunTwice() public {
        bytes32 id = _pay(10_000, REQ);
        vm.prank(owner);
        escrow.dispute(id, keccak256("x"));
        vm.startPrank(arbiter);
        escrow.resolve(id, IRecourseEscrow.Outcome.REFUND, IRecourseEscrow.Fault.MERCHANT, 0);
        vm.expectRevert(IRecourseEscrow.WrongState.selector);
        escrow.resolve(id, IRecourseEscrow.Outcome.RELEASE, IRecourseEscrow.Fault.NONE, 0);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ anchoring and admin

    function test_anchor_onlyGatewayAndIdempotent() public {
        bytes32 root = keccak256("root");
        vm.expectRevert(IRecourseEscrow.NotGateway.selector);
        escrow.anchorRoot(root, 5, 0);

        vm.prank(gateway);
        escrow.anchorRoot(root, 5, 0);
        uint64 first = escrow.anchoredAt(root);
        assertEq(first, uint64(block.timestamp));

        vm.warp(block.timestamp + 100);
        vm.prank(gateway);
        escrow.anchorRoot(root, 5, 0);
        assertEq(escrow.anchoredAt(root), first);
    }

    function test_admin_onlyOwner() public {
        vm.expectRevert();
        escrow.setArbiter(agent);
        vm.expectRevert();
        escrow.setGateway(agent);
        vm.expectRevert();
        escrow.pause();

        vm.startPrank(admin);
        escrow.setArbiter(agent);
        escrow.setGateway(agent);
        vm.stopPrank();
        assertEq(escrow.arbiter(), agent);
        assertEq(escrow.gateway(), agent);
    }

    function test_register_blockedWhenPaused() public {
        vm.prank(admin);
        escrow.pause();
        address[] memory ms = _sorted(merchant, merchant2);
        IRecourseEscrow.Mandate memory m = _mandate(2, uint64(block.timestamp + 1 days), ms);
        bytes memory sig = _sign(m, ownerPk);
        vm.expectRevert();
        escrow.registerMandate(m, ms, sig);
    }
}
