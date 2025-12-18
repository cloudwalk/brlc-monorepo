// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { RescuableUpgradeable } from "./base/RescuableUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";
import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";

import { IAssetTransitDesk } from "./interfaces/IAssetTransitDesk.sol";
import { IAssetTransitDeskPrimary } from "./interfaces/IAssetTransitDesk.sol";
import { IAssetTransitDeskConfiguration } from "./interfaces/IAssetTransitDesk.sol";
import { ITreasury } from "./interfaces/ITreasury.sol";

import { AssetTransitDeskStorageLayout } from "./AssetTransitDeskStorageLayout.sol";

/**
 * @title AssetTransitDesk contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 *
 * See details about the contract in the comments of the {IAssetTransitDesk} interface.
 */
contract AssetTransitDesk is
    AssetTransitDeskStorageLayout,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    RescuableUpgradeable,
    UUPSExtUpgradeable,
    Versionable,
    IAssetTransitDesk
{
    // ------------------ Types ----------------------------------- //

    using SafeERC20 for IERC20;

    // ------------------ Constants ------------------------------- //

    /// @dev The role of a manager that is allowed to issue and redeem assets.
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // ------------------ Constructor ----------------------------- //

    /**
     * @dev Constructor that prohibits the initialization of the implementation of the upgradeable contract.
     *
     * See details:
     * https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable#initializing_the_implementation_contract
     *
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev Initializer of the upgradeable contract.
     *
     * See details: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
     *
     * @param token_ The address of the token to set as the underlying one.
     */
    function initialize(address token_) external initializer {
        if (token_ == address(0)) {
            revert AssetTransitDesk_TokenAddressZero();
        }

        __AccessControlExt_init_unchained();
        __PausableExt_init_unchained();
        __Rescuable_init_unchained();
        __UUPSExt_init_unchained(); // This is needed only to avoid errors during coverage assessment

        _getAssetTransitDeskStorage().token = token_;

        _setRoleAdmin(MANAGER_ROLE, GRANTOR_ROLE);
        _grantRole(OWNER_ROLE, _msgSender());
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @inheritdoc IAssetTransitDeskPrimary
     *
     * @dev Requirements:
     * - Caller must have the {MANAGER_ROLE} role.
     * - `assetIssuanceId` must not be zero.
     * - `buyer` must not be the zero address.
     * - `principalAmount` must be greater than zero.
     * - Contract must not be paused.
     */
    function issueAsset(
        bytes32 assetIssuanceId,
        address buyer,
        uint64 principalAmount
    ) external whenNotPaused onlyRole(MANAGER_ROLE) {
        if (assetIssuanceId == bytes32(0)) {
            revert AssetTransitDesk_OperationIdZero();
        }

        if (buyer == address(0)) {
            revert AssetTransitDesk_BuyerAddressZero();
        }

        if (principalAmount == 0) {
            revert AssetTransitDesk_PrincipalAmountZero();
        }

        AssetTransitDeskStorage storage $ = _getAssetTransitDeskStorage();

        if ($.treasury == address(0)) {
            revert AssetTransitDesk_TreasuryAddressZero();
        }

        if ($.issuanceOperations[assetIssuanceId].status != OperationStatus.Nonexistent) {
            revert AssetTransitDesk_OperationAlreadyExists();
        }

        IERC20($.token).safeTransferFrom(buyer, address(this), principalAmount);
        IERC20($.token).safeTransfer($.treasury, principalAmount);

        $.issuanceOperations[assetIssuanceId] = IssuanceOperation({
            status: OperationStatus.Successful,
            buyer: buyer,
            principalAmount: principalAmount
        });

        emit AssetIssued(assetIssuanceId, buyer, principalAmount);
    }

    /**
     * @inheritdoc IAssetTransitDeskPrimary
     *
     * @dev Requirements:
     * - Caller must have the {MANAGER_ROLE} role.
     * - `assetRedemptionId` must not be zero.
     * - `buyer` must not be the zero address.
     * - `principalAmount` must be greater than zero.
     * - Contract must not be paused.
     */
    function redeemAsset(
        bytes32 assetRedemptionId,
        address buyer,
        uint64 principalAmount,
        uint64 netYieldAmount
    ) external whenNotPaused onlyRole(MANAGER_ROLE) {
        if (assetRedemptionId == bytes32(0)) {
            revert AssetTransitDesk_OperationIdZero();
        }

        if (buyer == address(0)) {
            revert AssetTransitDesk_BuyerAddressZero();
        }

        if (principalAmount == 0) {
            revert AssetTransitDesk_PrincipalAmountZero();
        }

        AssetTransitDeskStorage storage $ = _getAssetTransitDeskStorage();

        if ($.treasury == address(0)) {
            revert AssetTransitDesk_TreasuryAddressZero();
        }

        if ($.redemptionOperations[assetRedemptionId].status != OperationStatus.Nonexistent) {
            revert AssetTransitDesk_OperationAlreadyExists();
        }

        uint256 totalAmount = principalAmount + netYieldAmount;

        ITreasury($.treasury).withdraw(totalAmount);
        IERC20($.token).safeTransfer(buyer, totalAmount);

        $.redemptionOperations[assetRedemptionId] = RedemptionOperation({
            status: OperationStatus.Successful,
            buyer: buyer,
            principalAmount: principalAmount,
            netYieldAmount: netYieldAmount
        });

        emit AssetRedeemed(assetRedemptionId, buyer, principalAmount, netYieldAmount);
    }

    /**
     * @inheritdoc IAssetTransitDeskConfiguration
     *
     * @dev Requirements:
     * - Caller must have the {OWNER_ROLE} role.
     * - `newTreasury` must not be the zero address.
     * - `newTreasury` must differ from the current value.
     */
    function setTreasury(address newTreasury) external onlyRole(OWNER_ROLE) {
        AssetTransitDeskStorage storage $ = _getAssetTransitDeskStorage();
        address oldTreasury = $.treasury;

        _validateTreasuryChange(newTreasury, oldTreasury);
        _validateTreasury(newTreasury);

        $.treasury = newTreasury;
        _resetReserveFields();

        emit TreasuryChanged(newTreasury, oldTreasury);
    }

    /**
     * @inheritdoc IAssetTransitDeskConfiguration
     *
     * @dev Requirements:
     * - Caller must have the {OWNER_ROLE} role.
     */
    function approve(address spender, uint256 amount) external onlyRole(OWNER_ROLE) {
        AssetTransitDeskStorage storage $ = _getAssetTransitDeskStorage();
        IERC20($.token).approve(spender, amount);
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc IAssetTransitDeskPrimary
    function getIssuanceOperation(bytes32 assetIssuanceId) external view returns (IssuanceOperationView memory) {
        IssuanceOperation storage operation = _getAssetTransitDeskStorage().issuanceOperations[assetIssuanceId];

        return
            IssuanceOperationView({
                status: operation.status,
                buyer: operation.buyer,
                principalAmount: operation.principalAmount
            });
    }

    /// @inheritdoc IAssetTransitDeskPrimary
    function getRedemptionOperation(bytes32 assetRedemptionId) external view returns (RedemptionOperationView memory) {
        RedemptionOperation storage operation = _getAssetTransitDeskStorage().redemptionOperations[assetRedemptionId];

        return
            RedemptionOperationView({
                status: operation.status,
                buyer: operation.buyer,
                principalAmount: operation.principalAmount,
                netYieldAmount: operation.netYieldAmount
            });
    }

    /// @inheritdoc IAssetTransitDeskConfiguration
    function getTreasury() external view returns (address) {
        return _getAssetTransitDeskStorage().treasury;
    }

    /// @inheritdoc IAssetTransitDeskConfiguration
    function underlyingToken() external view returns (address) {
        return _getAssetTransitDeskStorage().token;
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc IAssetTransitDesk
    function proveAssetTransitDesk() external pure {}

    // ------------------ Internal functions ---------------------- //

    function _validateTreasuryChange(address newTreasury, address oldTreasury) internal pure {
        if (newTreasury == oldTreasury) {
            revert AssetTransitDesk_TreasuryAlreadyConfigured();
        }
        if (newTreasury == address(0)) {
            revert AssetTransitDesk_TreasuryAddressZero();
        }
    }

    function _validateTreasury(address newTreasury) internal view {
        if (newTreasury.code.length == 0) {
            revert AssetTransitDesk_TreasuryAddressInvalid();
        }

        try ITreasury(newTreasury).proveTreasury() {} catch {
            revert AssetTransitDesk_TreasuryAddressInvalid();
        }
        if (ITreasury(newTreasury).underlyingToken() != _getAssetTransitDeskStorage().token) {
            revert AssetTransitDesk_TreasuryTokenMismatch();
        }
    }

    /**
     * @dev Resets the reserved storage field to zero address.
     *
     * This function is called every time the treasury is configured to clean up the reserved slot
     * that previously stored the liquidity pool address (now unused). This ensures the slot is
     * zeroed out and ready for future reuse. If this slot is repurposed in future contract
     * versions, this cleanup behavior may need to be adjusted or removed.
     */
    function _resetReserveFields() internal {
        _getAssetTransitDeskStorage()._reserve = address(0);
    }

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     * @param newImplementation The address of the new implementation.
     */
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try IAssetTransitDesk(newImplementation).proveAssetTransitDesk() {} catch {
            revert AssetTransitDesk_ImplementationAddressInvalid();
        }
    }
}
