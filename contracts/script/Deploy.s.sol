// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {RecourseEscrow} from "../src/RecourseEscrow.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// Env: DEPLOYER_PRIVATE_KEY, ARBITER_ADDRESS, GATEWAY_ADDRESS, DISPUTE_WINDOW_SECONDS,
/// optional TOKEN_ADDRESS (when set, MockUSDC is not deployed; use testnet USDC).
/// Prints a JSON line consumed by scripts/sync-deployment.ts.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address arbiter = vm.envAddress("ARBITER_ADDRESS");
        address gateway = vm.envAddress("GATEWAY_ADDRESS");
        uint64 window = uint64(vm.envOr("DISPUTE_WINDOW_SECONDS", uint256(120)));
        address token = vm.envOr("TOKEN_ADDRESS", address(0));

        vm.startBroadcast(pk);
        if (token == address(0)) {
            require(block.chainid == 31337, "MockUSDC is local only");
            token = address(new MockUSDC());
        }
        RecourseEscrow escrow = new RecourseEscrow(deployer, arbiter, gateway, window);
        vm.stopBroadcast();

        console.log(
            string.concat(
                '{"chainId":',
                vm.toString(block.chainid),
                ',"escrow":"',
                vm.toString(address(escrow)),
                '","token":"',
                vm.toString(token),
                '","gateway":"',
                vm.toString(gateway),
                '","arbiter":"',
                vm.toString(arbiter),
                '"}'
            )
        );
    }
}
