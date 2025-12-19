// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { LendingEngineV2 } from "../LendingEngineV2.sol";

/**
 * @title LendingEngineV2Testable contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The version of the lending engine contract with additions required for testing.
 * @custom:oz-upgrades-unsafe-allow missing-initializer
 */
contract LendingEngineV2Testable is LendingEngineV2 {
    /**
     * @dev Sets the storage kind of the lending engine.
     * @param storageKind The storage kind of the lending engine.
     */
    function setStorageKind(uint8 storageKind) external {
        _getLendingMarketStorage().storageKind = storageKind;
    }
}
