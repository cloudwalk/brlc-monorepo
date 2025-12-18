// SPDX-License-Identifier: MIT

pragma solidity ^0.8.30;

import { EnumerableMap } from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import { ITreasuryTypes } from "./interfaces/ITreasury.sol";

/**
 * @title TreasuryStorageLayout contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the storage layout for the Treasury smart contract.
 */
abstract contract TreasuryStorageLayout is ITreasuryTypes {
    // ------------------ Storage layout -------------------------- //

    /*
     * ERC-7201: Namespaced Storage Layout
     * keccak256(abi.encode(uint256(keccak256("cloudwalk.storage.Treasury")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 private constant TREASURY_STORAGE_LOCATION =
        0x1399184d0f862099161435a2e23aca33f4fa13df64b883b2c9d84ef45534f700;

    /**
     * @dev Defines the contract storage structure.
     *
     * Fields:
     *
     * - underlyingToken ------- The address of the underlying ERC20 token.
     * - recipientLimitPolicy -- The active policy for recipient limit enforcement.
     * - recipientLimits ------- The EnumerableMap of recipient addresses to their withdrawal limits.
     *
     * @custom:storage-location erc7201:cloudwalk.storage.Treasury
     */
    struct TreasuryStorage {
        // Slot 1
        address underlyingToken;
        RecipientLimitPolicy recipientLimitPolicy;
        // uint88 __reserved1; // Reserved until the end of the storage slot

        // Slot 2, 3
        EnumerableMap.AddressToUintMap recipientLimits;
    }

    // ------------------ Internal functions ---------------------- //

    /// @dev Returns the storage slot location for the `TreasuryStorage` struct.
    function _getTreasuryStorage() internal pure returns (TreasuryStorage storage $) {
        assembly {
            $.slot := TREASURY_STORAGE_LOCATION
        }
    }
}
