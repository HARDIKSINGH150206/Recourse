// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {Base} from "./Base.t.sol";
import {IRecourseEscrow} from "../src/interfaces/IRecourseEscrow.sol";

/// Drives random lifecycle actions against its own escrow and mandate (inherited fixture).
contract Handler is Base {
    bytes32[] internal ids;
    uint256 internal nonce;
    // highest state ordinal seen per escrow, to check states never move backwards
    mapping(bytes32 => uint8) internal maxState;
    bool public stateWentBackwards;

    function pay(uint256 amount) external {
        amount = bound(amount, 1, MAX_PRICE);
        vm.prank(agent);
        try escrow.createEscrow(mandateId, merchant, amount, bytes32(++nonce)) returns (bytes32 id) {
            ids.push(id);
        } catch {}
        _track();
    }

    function release(uint256 i) external {
        if (ids.length == 0) return;
        try escrow.release(ids[i % ids.length]) {} catch {}
        _track();
    }

    function disputeIt(uint256 i) external {
        if (ids.length == 0) return;
        vm.prank(owner);
        try escrow.dispute(ids[i % ids.length], keccak256("r")) {} catch {}
        _track();
    }

    function resolveIt(uint256 i, bool refund, uint8 fault) external {
        if (ids.length == 0) return;
        vm.prank(arbiter);
        try escrow.resolve(
            ids[i % ids.length],
            refund ? IRecourseEscrow.Outcome.REFUND : IRecourseEscrow.Outcome.RELEASE,
            IRecourseEscrow.Fault(fault % 3),
            bytes32(0)
        ) {} catch {}
        _track();
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 2 * WINDOW));
    }

    /// Sum of amounts in Held and Disputed escrows.
    function openTotal() external view returns (uint256 total) {
        for (uint256 i = 0; i < ids.length; i++) {
            IRecourseEscrow.Escrow memory e = escrow.escrows(ids[i]);
            if (e.state == IRecourseEscrow.State.Held || e.state == IRecourseEscrow.State.Disputed) {
                total += e.amount;
            }
        }
    }

    function _track() internal {
        for (uint256 i = 0; i < ids.length; i++) {
            uint8 s = uint8(escrow.escrows(ids[i]).state);
            // None(0) -> Held(1) -> Disputed(2) -> Released(3) | Refunded(4); Held -> Released is legal.
            if (s < maxState[ids[i]]) stateWentBackwards = true;
            if (s > maxState[ids[i]]) maxState[ids[i]] = s;
        }
    }
}

contract RecourseEscrowInvariantTest is StdInvariant, Test {
    Handler internal handler;

    function setUp() public {
        handler = new Handler();
        handler.setUp();
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = Handler.pay.selector;
        selectors[1] = Handler.release.selector;
        selectors[2] = Handler.disputeIt.selector;
        selectors[3] = Handler.resolveIt.selector;
        selectors[4] = Handler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// No value created or lost: token balance equals the sum of Held and Disputed amounts.
    function invariant_balanceEqualsOpenEscrows() public view {
        assertEq(handler.usdc().balanceOf(address(handler.escrow())), handler.openTotal());
    }

    /// Total spent never exceeds the mandate budget.
    function invariant_spentWithinBudget() public view {
        assertLe(handler.escrow().spent(handler.mandateId()), 2_000_000);
    }

    /// Escrow states only move forward.
    function invariant_statesNeverMoveBackwards() public view {
        assertFalse(handler.stateWentBackwards());
    }
}
