// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { IAssetTransitDeskTypes } from "./interfaces/IAssetTransitDesk.sol";

/**
 * @title AssetTransitDeskStorageLayout contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the storage layout for the AssetTransitDesk smart contract.
 *
 * See details about the contract in the comments of the {IAssetTransitDesk} interface.
 */
abstract contract AssetTransitDeskStorageLayout is IAssetTransitDeskTypes {
    // ------------------ Storage layout -------------------------- //

    /*
     * ERC-7201: Namespaced Storage Layout
     * keccak256(abi.encode(uint256(keccak256("cloudwalk.storage.AssetTransitDesk")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 private constant ASSET_TRANSIT_DESK_STORAGE_LOCATION =
        0x27f7e363d656435411c0d572d62984de181fb65d332e8e701d94a91bd5969800;

    /**
     * @dev Defines the contract storage structure.
     *
     * Fields:
     *
     * - token ---------------- The address of the underlying token.
     * - treasury ------------- The address of the treasury.
     * - _reserve ------------- Reserved field for future reuse, see description below.
     * - issuanceOperations --- Mapping of asset issuance IDs to issuance operations.
     * - redemptionOperations - Mapping of asset redemption IDs to redemption operations.
     *
     * Notes:
     * 1. The treasury is used to withdraw and deposit both the principal and yield.
     * 2. Operation mappings store the history and state of all asset issuance and redemption operations.
     *
     * @custom:storage-location erc7201:cloudwalk.storage.AssetTransitDesk
     */
    struct AssetTransitDeskStorage {
        // Slot 1
        address token;
        // uint96 __reserved1; // Reserved until the end of the storage slot

        // Slot 2
        address treasury;
        // uint96 __reserved2; // Reserved until the end of the storage slot

        // Slot 3 (available for future reuse)
        // IMPORTANT: This field is zeroed each time when the `treasury` one is set.
        //            Change that behaviour if you are going to reuse this slot.
        address _reserve;
        // uint96 __reserved3; // Reserved until the end of the storage slot

        // Slot 4
        mapping(bytes32 opId => IssuanceOperation operation) issuanceOperations;
        // No reserve until the end of the storage slot

        // Slot 5
        mapping(bytes32 opId => RedemptionOperation operation) redemptionOperations;
        // No reserve until the end of the storage slot
    }

    // ------------------ Internal functions ---------------------- //

    /// @dev Returns the storage slot location for the `AssetTransitDeskStorage` struct.
    function _getAssetTransitDeskStorage() internal pure returns (AssetTransitDeskStorage storage $) {
        assembly {
            $.slot := ASSET_TRANSIT_DESK_STORAGE_LOCATION
        }
    }
}
