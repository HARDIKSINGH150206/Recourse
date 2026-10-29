// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {IRecourseEscrow} from "../src/interfaces/IRecourseEscrow.sol";

contract RecourseEscrowFuzzTest is Base {
    function testFuzz_amountAboveMaxPriceAlwaysReverts(uint256 amount, bytes32 req) public {
        amount = bound(amount, MAX_PRICE + 1, type(uint128).max);
        vm.prank(agent);
        vm.expectRevert(IRecourseEscrow.ExceedsMaxPrice.selector);
        escrow.createEscrow(mandateId, merchant, amount, req);
    }

    function testFuzz_spentNeverExceedsBudget(uint256[12] calldata amounts) public {
        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 amount = bound(amounts[i], 1, MAX_PRICE);
            vm.prank(agent);
            try escrow.createEscrow(mandateId, merchant, amount, bytes32(i + 1)) {} catch {}
            assertLe(escrow.spent(mandateId), BUDGET);
        }
    }

    function testFuzz_duplicateRequestAlwaysReverts(uint256 a, uint256 b, bytes32 req) public {
        a = bound(a, 1, MAX_PRICE);
        b = bound(b, 1, MAX_PRICE);
        vm.prank(agent);
        escrow.createEscrow(mandateId, merchant, a, req);
        vm.prank(agent);
        vm.expectRevert(IRecourseEscrow.DuplicateRequest.selector);
        escrow.createEscrow(mandateId, merchant, b, req);
    }

    function testFuzz_strangerMerchantAlwaysReverts(address stranger, uint256 amount) public {
        vm.assume(stranger != merchant && stranger != merchant2);
        amount = bound(amount, 1, MAX_PRICE);
        vm.prank(agent);
        vm.expectRevert(IRecourseEscrow.MerchantNotAllowed.selector);
        escrow.createEscrow(mandateId, stranger, amount, keccak256("r"));
    }

    function testFuzz_releaseOnlyAtOrAfterWindowEnd(uint64 dt) public {
        dt = uint64(bound(dt, 0, 10 * WINDOW));
        vm.prank(agent);
        bytes32 id = escrow.createEscrow(mandateId, merchant, 1_000, keccak256("r"));
        vm.warp(block.timestamp + dt);
        if (dt < WINDOW) {
            vm.expectRevert(IRecourseEscrow.WindowOpen.selector);
            escrow.release(id);
        } else {
            escrow.release(id);
            assertEq(usdc.balanceOf(merchant), 1_000);
        }
    }
}
