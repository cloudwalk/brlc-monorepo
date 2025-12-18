// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

/**
 * @title IAssetTransitDeskTypes interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The types part of the AssetTransitDesk smart contract interface.
 */
interface IAssetTransitDeskTypes {
    /**
     * @dev Possible statuses of an operation.
     *
     * The values:
     *
     * - Nonexistent = 0 -- The operation does not exist (the default value).
     * - Successful = 1 --- The operation has been executed successfully.
     */
    enum OperationStatus {
        Nonexistent,
        Successful
    }

    /**
     * @dev The data of an asset issuance operation.
     *
     * Fields:
     *
     * - status -------------- The status of the operation according to the {OperationStatus} enum.
     * - buyer --------------- The address of the buyer.
     * - principalAmount ----- The amount of the principal.
     */
    struct IssuanceOperation {
        // Slot 1
        OperationStatus status;
        address buyer;
        uint64 principalAmount;
        // uint24 __reserved; // Reserved until the end of the storage slot
    }

    /**
     * @dev The data of a redemption operation.
     *
     * Fields:
     *
     * - status -------------- The status of the operation according to the {OperationStatus} enum.
     * - buyer --------------- The address of the buyer.
     * - principalAmount ----- The amount of the principal.
     * - netYieldAmount ------ The amount of the net yield.
     */
    struct RedemptionOperation {
        // Slot 1
        OperationStatus status;
        address buyer;
        uint64 principalAmount;
        // uint24 __reserved; // Reserved until the end of the storage slot

        // Slot 2
        uint64 netYieldAmount;
        // uint96 __reserved; // Reserved until the end of the storage slot
    }

    /**
     * @dev The view of an issuance operation.
     *
     * Fields:
     *
     * - status -------------- The status of the operation according to the {OperationStatus} enum.
     * - buyer --------------- The address of the buyer.
     * - principalAmount ----- The amount of the principal.
     */
    struct IssuanceOperationView {
        OperationStatus status;
        address buyer;
        uint256 principalAmount;
    }

    /**
     * @dev The view of a redemption operation.
     *
     * Fields:
     *
     * - status -------------- The status of the operation according to the {OperationStatus} enum.
     * - buyer --------------- The address of the buyer.
     * - principalAmount ----- The amount of the principal.
     * - netYieldAmount ------ The amount of the net yield.
     */
    struct RedemptionOperationView {
        OperationStatus status;
        address buyer;
        uint256 principalAmount;
        uint256 netYieldAmount;
    }
}

/**
 * @title IAssetTransitDeskPrimary interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary part of the AssetTransitDesk smart contract interface.
 */
interface IAssetTransitDeskPrimary is IAssetTransitDeskTypes {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when an asset is issued.
     *
     * @param assetIssuanceId The ID of the asset issuance operation.
     * @param buyer The address of the buyer.
     * @param principalAmount The amount of the principal.
     */
    event AssetIssued(bytes32 indexed assetIssuanceId, address indexed buyer, uint64 principalAmount);

    /**
     * @dev Emitted when an asset is redeemed.
     *
     * @param assetRedemptionId The ID of the asset redemption operation.
     * @param buyer The address of the buyer.
     * @param principalAmount The amount of the principal.
     * @param netYieldAmount The amount of the net yield.
     */
    event AssetRedeemed(
        bytes32 indexed assetRedemptionId,
        address indexed buyer,
        uint64 principalAmount,
        uint64 netYieldAmount
    );

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Issues an asset.
     *
     * Emits an {AssetIssued} event.
     *
     * @param assetIssuanceId The ID of the asset issuance operation.
     * @param buyer The address of the buyer.
     * @param principalAmount The amount of the principal.
     */
    function issueAsset(bytes32 assetIssuanceId, address buyer, uint64 principalAmount) external;

    /**
     * @dev Redeems an asset.
     *
     * Emits an {AssetRedeemed} event.
     *
     * @param assetRedemptionId The ID of the asset redemption operation.
     * @param buyer The address of the buyer.
     * @param principalAmount The amount of the principal.
     * @param netYieldAmount The amount of the net yield.
     */
    function redeemAsset(
        bytes32 assetRedemptionId,
        address buyer,
        uint64 principalAmount,
        uint64 netYieldAmount
    ) external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Returns the data of an issuance operation.
     *
     * @param assetIssuanceId The ID of the asset issuance operation.
     * @return The data of the issuance operation.
     */
    function getIssuanceOperation(bytes32 assetIssuanceId) external view returns (IssuanceOperationView memory);

    /**
     * @dev Returns the data of a redemption operation.
     *
     * @param assetRedemptionId The ID of the asset redemption operation.
     * @return The data of the redemption operation.
     */
    function getRedemptionOperation(bytes32 assetRedemptionId) external view returns (RedemptionOperationView memory);
}

/**
 * @title IAssetTransitDeskConfiguration interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The configuration part of the AssetTransitDesk smart contract interface.
 */
interface IAssetTransitDeskConfiguration {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when the treasury address is changed.
     *
     * @param newTreasury The new address of the treasury.
     * @param oldTreasury The old address of the treasury.
     */
    event TreasuryChanged(address newTreasury, address oldTreasury);

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Sets the treasury address.
     *
     * Emits a {TreasuryChanged} event.
     *
     * @param newTreasury The new address of the treasury to set.
     */
    function setTreasury(address newTreasury) external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Returns the address of the treasury.
     *
     * @return The address of the treasury.
     */
    function getTreasury() external view returns (address);

    /**
     * @dev Returns the address of the underlying token.
     *
     * @return The address of the underlying token.
     */
    function underlyingToken() external view returns (address);

    /**
     * @dev Approves the provided spender to spend the provided amount of the underlying token.
     *
     * See {IERC20-approve}.
     *
     * @param spender The address of the spender.
     * @param amount The amount of the underlying token to approve.
     */
    function approve(address spender, uint256 amount) external;
}

/**
 * @title IAssetTransitDeskErrors interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the custom errors used in the asset desk contract.
 *
 * The errors are ordered alphabetically.
 */
interface IAssetTransitDeskErrors {
    /// @dev Thrown if the provided buyer address is zero.
    error AssetTransitDesk_BuyerAddressZero();

    /// @dev Thrown if the provided new implementation address is not an AssetTransitDesk contract.
    error AssetTransitDesk_ImplementationAddressInvalid();

    /// @dev Thrown if the provided operation identifier is already used.
    error AssetTransitDesk_OperationAlreadyExists();

    /// @dev Thrown if the provided operation identifier is zero.
    error AssetTransitDesk_OperationIdZero();

    /// @dev Thrown if the provided principal amount is zero.
    error AssetTransitDesk_PrincipalAmountZero();

    /// @dev Thrown if the provided token address is zero.
    error AssetTransitDesk_TokenAddressZero();

    /// @dev Thrown if the provided treasury address is zero.
    error AssetTransitDesk_TreasuryAddressZero();

    /// @dev Thrown if the provided treasury address is not a Treasury contract.
    error AssetTransitDesk_TreasuryAddressInvalid();

    /// @dev Thrown if the provided treasury address is already configured.
    error AssetTransitDesk_TreasuryAlreadyConfigured();

    /// @dev Thrown if the provided treasury token does not match the underlying token.
    error AssetTransitDesk_TreasuryTokenMismatch();
}

/**
 * @title IAssetTransitDesk interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The full interface of the AssetTransitDesk smart contract.
 *
 * The smart contract manages and logs token transfers related to CDB buying and selling operations.
 */
interface IAssetTransitDesk is IAssetTransitDeskPrimary, IAssetTransitDeskConfiguration, IAssetTransitDeskErrors {
    /**
     * @dev Proves the contract is the AssetTransitDesk one. A marker function.
     *
     * It is used for simple contract compliance checks, e.g., during an upgrade.
     * This avoids situations where a wrong contract address is specified by mistake.
     */
    function proveAssetTransitDesk() external pure;
}
