// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import { IBlueprintTypes } from "./interfaces/IBlueprintTypes.sol";

/**
 * @title BlueprintStorageLayout contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the storage layout for the reference smart-contract.
 *
 * See details about the contract in the comments of the {IBlueprint} interface.
 */
abstract contract BlueprintStorageLayout is IBlueprintTypes {
    // ------------------ Constants ------------------------------- //

    /// @dev The role of manager that is allowed to deposit and withdraw tokens to the contract.
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // ------------------ Storage layout -------------------------- //

    /*
     * ERC-7201: Namespaced Storage Layout
     * keccak256(abi.encode(uint256(keccak256("cloudwalk.storage.Blueprint")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 private constant BLUEPRINT_STORAGE_LOCATION =
        0xafe7a9a1707fd5088d626d487a8abd113f3fb4bc089bd4284d3e123585a48c00;

    /**
     * @dev Defines the contract storage structure.
     *
     * Fields:
     *
     * - token ---------------- The address of the underlying token.
     * - operationalTreasury -- The address of the operational treasury.
     * - operations ----------- The mapping of an operation structure for a given off-chain operation identifier.
     * - accountStates -------- The mapping of a state for a given account.
     *
     * Notes:
     * 1. The operational treasury is used to deposit and withdraw tokens through special functions.
     *
     * @custom:storage-location erc7201:cloudwalk.storage.Blueprint
     */
    struct BlueprintStorage {
        // Slot 1
        address token;
        // uint96 __reserved1; // Reserved until the end of the storage slot

        // Slot 2
        address operationalTreasury;
        // uint96 __reserved2; // Reserved until the end of the storage slot

        // Slot 3
        mapping(bytes32 opId => Operation operation) operations;
        // No reserve until the end of the storage slot

        // Slot 4
        mapping(address account => AccountState state) accountStates;
        // No reserve until the end of the storage slot
    }

    // ------------------ Internal functions ---------------------- //

    /// @dev Returns the storage slot location for the `BlueprintStorage` struct.
    function _getBlueprintStorage() internal pure returns (BlueprintStorage storage $) {
        assembly {
            $.slot := BLUEPRINT_STORAGE_LOCATION
        }
    }
}
