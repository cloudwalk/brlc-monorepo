// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { ILendingMarketV2Types } from "../interfaces/ILendingMarketV2.sol";
import { AddressBook } from "../libraries/AddressBook.sol";

/**
 * @title LendingMarketStorageLayout contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the storage layout for the lending market contract.
 */
abstract contract LendingMarketV2StorageLayout is ILendingMarketV2Types {
    // ------------------ Constants ------------------------------- //

    /**
     * @dev Identifier to ensure that the lending market storage layout is used in delegate calls.
     *
     * Must be aligned in type with the `LendingMarketStorage.storageKind` field.
     */
    uint256 internal constant STORAGE_KIND_MARKET = uint8(0xA5);

    // ------------------ Storage layout -------------------------- //

    /**
     * @dev The storage location for the lending market.
     *
     * See: ERC-7201 "Namespaced Storage Layout" for more details.
     *
     * The value is the same as:
     *
     * ```solidity
     * string memory id = "cloudwalk.storage.LendingMarket";
     * bytes32 location = keccak256(abi.encode(uint256(keccak256(id) - 1)) & ~bytes32(uint256(0xff));
     * ```
     */
    // TODO: use storage location id "cloudwalk.storage.LendingMarketV2", redeploy the contract
    bytes32 private constant LENDING_MARKET_STORAGE_LOCATION =
        0x27e9a497aa8e1867f33bd8bb7ff668e694c5f7d641b7a1234b1516e32cb50000;

    /**
     * @dev Defines the contract storage structure.
     *
     * Fields:
     *
     * - storageKind ----------- The storage kind of the contract.
     * - underlyingToken ------- The address of the underlying token.
     * - subLoanCounter -------- The counter of the sub-loans.
     * - programCounter -------- The counter of the programs.
     * - engine ---------------- The address of the lending engine smart contract.
     * - subLoanAutoIdCounter -- The counter of the auto-generated sub-loan IDs.
     * - subLoans -------------- The mapping of the sub-loans.
     * - programs -------------- The mapping of the lending programs.
     * - accountAddressBook ---- The address book of the account for this contract.
     *
     * Notes:
     *
     * 1. The `storageKind` field is used to ensure that the lending market storage layout is used in delegate calls.
     *
     * @custom:storage-location erc7201:cloudwalk.storage.LendingMarket
     */
    struct LendingMarketStorage {
        // Slot 1
        uint8 storageKind;
        address underlyingToken;
        uint64 subLoanCounter;
        uint24 programCounter;
        // No reserve until the end of the storage slot

        // Slot 2
        address engine;
        uint64 subLoanAutoIdCounter;
        // uint32 __reserved; // Reserved until the end of the storage slot

        // Slots 3, 4
        mapping(uint256 subLoanId => SubLoan) subLoans;
        mapping(uint256 programId => LendingProgram) programs;
        // Slots 5, 6, 7
        AddressBook.Table accountAddressBook;
    }

    // ------------------ Internal functions ---------------------- //

    /// @dev Returns the storage slot location for the `LendingMarketStorage` struct.
    function _getLendingMarketStorage() internal pure returns (LendingMarketStorage storage $) {
        assembly {
            $.slot := LENDING_MARKET_STORAGE_LOCATION
        }
    }
}
