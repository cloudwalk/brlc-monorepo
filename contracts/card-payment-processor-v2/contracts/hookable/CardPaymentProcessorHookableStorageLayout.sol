// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title CardPaymentProcessorHookableStorageLayout contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the storage layout for the card payment processor hookable smart contract.
 */
abstract contract CardPaymentProcessorHookableStorageLayout {
    // ------------------ Storage layout -------------------------- //

    /*
     * ERC-7201: Namespaced Storage Layout
     * keccak256(abi.encode(uint256(keccak256("cloudwalk.storage.CardPaymentProcessorHookable")) - 1)) &
     * ~bytes32(uint256(0xff))
     */
    bytes32 private constant CARD_PAYMENT_PROCESSOR_HOOKABLE_STORAGE_LOCATION =
        0x9618f3235c734729f9967657c30b823bf6898e756d4c8b6db78d6edcce4a7d00;

    /**
     * @dev Defines the contract storage structure.
     *
     * Fields:
     *
     * - hooks ------- The mapping of method selector to set of hook contract addresses.
     *
     * @custom:storage-location erc7201:cloudwalk.storage.CardPaymentProcessorHookable
     */
    struct CardPaymentProcessorHookableStorage {
        // Slot 1
        mapping(bytes4 hookSelector => EnumerableSet.AddressSet) hooks;
    }

    // ------------------ Internal functions ---------------------- //

    /// @dev Returns the storage slot location for the `CashbackVaultStorage` struct.
    function _getCardPaymentProcessorHookableStorage()
        internal
        pure
        returns (CardPaymentProcessorHookableStorage storage $)
    {
        assembly {
            $.slot := CARD_PAYMENT_PROCESSOR_HOOKABLE_STORAGE_LOCATION
        }
    }
}
