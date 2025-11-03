// SPDX-License-Identifier: MIT

pragma solidity ^0.8.30;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title TreasuryStorageLayout contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the storage layout for the Treasury smart contract.
 */
abstract contract TreasuryStorageLayout {
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
     * - token -------------- The address of the underlying ERC20 token.
     * - approvedSpenders --- The EnumerableSet of approved spender addresses.
     *
     * @custom:storage-location erc7201:cloudwalk.storage.Treasury
     */
    struct TreasuryStorage {
        // Slot 1
        address token;
        // uint96 __reserved1; // Reserved until the end of the storage slot

        // Slot 2, 3
        EnumerableSet.AddressSet approvedSpenders;
    }

    // ------------------ Internal functions ---------------------- //

    /// @dev Returns the storage slot location for the `TreasuryStorage` struct.
    function _getTreasuryStorage() internal pure returns (TreasuryStorage storage $) {
        assembly {
            $.slot := TREASURY_STORAGE_LOCATION
        }
    }
}
