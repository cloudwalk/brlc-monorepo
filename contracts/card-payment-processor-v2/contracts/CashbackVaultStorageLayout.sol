// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { ICashbackVaultTypes } from "./interfaces/ICashbackVault.sol";

/**
 * @title CashbackVaultStorageLayout contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the storage layout for the cashback vault smart contract.
 */
abstract contract CashbackVaultStorageLayout is ICashbackVaultTypes {
    // ------------------ Storage layout -------------------------- //

    /*
     * ERC-7201: Namespaced Storage Layout
     * keccak256(abi.encode(uint256(keccak256("cloudwalk.storage.CashbackVault")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 private constant CASHBACK_VAULT_STORAGE_LOCATION =
        0x77ff17a333e155d0867a10019a155145cb22ba8073d73c4e9efdacc9be865c00;

    /**
     * @dev Defines the contract storage structure.
     *
     * Fields:
     *
     * - token ------------------ The address of the underlying token.
     * - totalCashback ---------- The total amount of cashback across all accounts.
     * - accountCashbackStates -- The mapping of cashback state for each account.
     *
     * @custom:storage-location erc7201:cloudwalk.storage.CashbackVault
     */
    struct CashbackVaultStorage {
        // Slot 1
        address token;
        uint64 totalCashback;
        // uint32 __reserved1; // Reserved until the end of the storage slot

        // Slot 2
        mapping(address account => AccountCashbackState state) accountCashbackStates;
    }

    // ------------------ Internal functions ---------------------- //

    /// @dev Returns the storage slot location for the `CashbackVaultStorage` struct.
    function _getCashbackVaultStorage() internal pure returns (CashbackVaultStorage storage $) {
        assembly {
            $.slot := CASHBACK_VAULT_STORAGE_LOCATION
        }
    }
}
