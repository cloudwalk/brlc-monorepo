// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { ICashbackControllerTypes } from "./interfaces/ICashbackController.sol";

/**
 * @title CashbackControllerStorageLayout contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the storage layout for the cashback controller smart contract.
 */
abstract contract CashbackControllerStorageLayout is ICashbackControllerTypes {
    // ------------------ Storage layout -------------------------- //

    /*
     * ERC-7201: Namespaced Storage Layout
     * keccak256(abi.encode(uint256(keccak256("cloudwalk.storage.CashbackController")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 private constant CASHBACK_CONTROLLER_STORAGE_LOCATION =
        0xf710ccda5fd74584580744a7376db3d40057789dbb6544aa55d03ee3e7212900;
    /**
     * @dev Defines the contract storage structure.
     *
     * Fields:
     *
     * - token ------------------ The address of the underlying token.
     * - cashbackTreasury ------- The address of the cashback treasury.
     * - cashbackVault ---------- The address of the cashback vault.
     * - accountCashbacks ------- The mapping of cashback state for each account.
     * - paymentCashbacks ------- The mapping of payment cashback for a given payment ID.
     *
     * @custom:storage-location erc7201:cloudwalk.storage.CashbackController
     */
    struct CashbackControllerStorage {
        // Slot 1
        address token;
        // Slot 2
        address cashbackTreasury;
        // Slot 3
        address cashbackVault;
        // Slot 4
        mapping(address account => AccountCashback) accountCashbacks;
        // Slot 5
        mapping(bytes32 paimentId => PaymentCashback) paymentCashbacks;
    }

    // ------------------ Internal functions ---------------------- //

    /// @dev Returns the storage slot location for the `CashbackControllerStorage` struct.
    function _getCashbackControllerStorage() internal pure returns (CashbackControllerStorage storage $) {
        assembly {
            $.slot := CASHBACK_CONTROLLER_STORAGE_LOCATION
        }
    }
}
