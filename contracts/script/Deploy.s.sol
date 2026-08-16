// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MonadMeadow} from "../src/MonadMeadow.sol";

contract DeployScript is Script {
    function run() external returns (MonadMeadow meadow) {
        vm.startBroadcast();
        meadow = new MonadMeadow();
        vm.stopBroadcast();

        console.log("MonadMeadow deployed at:", address(meadow));
        console.log("Owner:", meadow.owner());
    }
}
