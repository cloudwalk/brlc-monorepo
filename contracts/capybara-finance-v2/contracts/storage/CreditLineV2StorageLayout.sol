// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { ICreditLineV2Types } from "../interfaces/ICreditLineV2.sol";

/**
 * @title CreditLineStorageLayout contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the storage layout for the credit line contract.
 */
abstract contract CreditLineV2StorageLayout is ICreditLineV2Types {
    // ------------------ Storage layout -------------------------- //

    /**
     * @dev The storage location for the credit line.
     *
     * See: ERC-7201 "Namespaced Storage Layout" for more details.
     *
     * The value is the same as:
     *
     * ```solidity
     * string memory id = "cloudwalk.storage.CreditLine";
     * bytes32 location = keccak256(abi.encode(uint256(keccak256(id) - 1)) & ~bytes32(uint256(0xff));
     * ```
     */
    // TODO: use storage location id "cloudwalk.storage.CreditLineV2", redeploy the contract
    bytes32 private constant CREDIT_LINE_STORAGE_LOCATION =
        0xa3fd4b9b32140f4fbbe9f284e8809f89ab5f4a029de5415ce11a80e48f112f00;

    /**
     * @dev Defines the contract storage structure.
     *
     * Fields:
     *
     * - borrowerConfigs --- The mapping of borrower to borrower configuration.
     * - borrowerStates ---- The mapping of borrower to borrower state.
     * - linkedCreditLine -- The address of the linked credit line.
     *
     * @custom:storage-location erc7201:cloudwalk.storage.CreditLine
     */
    struct CreditLineStorage {
        // Slots 1, 2
        mapping(address borrower => BorrowerConfig) borrowerConfigs;
        mapping(address borrower => BorrowerState) borrowerStates;
        // No reserve until the end of the storage slot

        // Slot 3
        address linkedCreditLine;
        // uint96 __reserved; // Reserved until the end of the storage slot
    }

    // ------------------ Internal functions ---------------------- //

    /// @dev Returns the storage slot location for the `LendingMarketStorage` struct.
    function _getCreditLineStorage() internal pure returns (CreditLineStorage storage $) {
        assembly {
            $.slot := CREDIT_LINE_STORAGE_LOCATION
        }
    }
}
