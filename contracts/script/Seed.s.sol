// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Local chain only: mints MockUSDC to the owner and approves the escrow.
/// Env: OWNER_PRIVATE_KEY, TOKEN_ADDRESS, ESCROW_ADDRESS.
contract Seed is Script {
    function run() external {
        require(block.chainid == 31337, "local chain only");
        uint256 ownerPk = vm.envUint("OWNER_PRIVATE_KEY");
        address token = vm.envAddress("TOKEN_ADDRESS");
        address escrow = vm.envAddress("ESCROW_ADDRESS");
        vm.startBroadcast(ownerPk);
        MockUSDC(token).mint(vm.addr(ownerPk), 1_000 * 1e6);
        IERC20(token).approve(escrow, type(uint256).max);
        vm.stopBroadcast();
    }
}
