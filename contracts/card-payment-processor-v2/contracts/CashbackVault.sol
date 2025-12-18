// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { RescuableUpgradeable } from "./base/RescuableUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";
import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";

import { CashbackVaultStorageLayout } from "./CashbackVaultStorageLayout.sol";

import { ICashbackVault } from "./interfaces/ICashbackVault.sol";
import { ICashbackVaultPrimary } from "./interfaces/ICashbackVault.sol";
import { ICashbackVaultConfiguration } from "./interfaces/ICashbackVault.sol";

/**
 * @title CashbackVault contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 */
contract CashbackVault is
    CashbackVaultStorageLayout,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    RescuableUpgradeable,
    UUPSExtUpgradeable,
    ICashbackVault,
    Versionable
{
    // ------------------ Types ----------------------------------- //

    using SafeERC20 for IERC20;

    // ------------------ Constants ------------------------------- //

    /// @dev The role for cashback operators who are allowed to increase and decrease cashback balances.
    bytes32 public constant CASHBACK_OPERATOR_ROLE = keccak256("CASHBACK_OPERATOR_ROLE");

    /// @dev The role for managers who are allowed to claim cashback on behalf of accounts.
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

    // --------------------- Modifiers ---------------------------- //

    modifier onlyValidAccount(address account) {
        if (account == address(0)) {
            revert CashbackVault_AccountAddressZero();
        }
        _;
    }

    modifier onlyValidAmount(uint64 amount) {
        if (amount == 0) {
            revert CashbackVault_AmountZero();
        }
        _;
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
        __AccessControlExt_init_unchained();
        __PausableExt_init_unchained();
        __Rescuable_init_unchained();
        __UUPSExt_init_unchained(); // This is needed only to avoid errors during coverage assessment

        if (token_ == address(0)) {
            revert CashbackVault_TokenAddressZero();
        }

        CashbackVaultStorage storage $ = _getCashbackVaultStorage();
        $.token = token_;

        _setRoleAdmin(CASHBACK_OPERATOR_ROLE, GRANTOR_ROLE);
        _setRoleAdmin(MANAGER_ROLE, GRANTOR_ROLE);
        _grantRole(OWNER_ROLE, _msgSender());
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @inheritdoc ICashbackVaultPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHBACK_OPERATOR_ROLE} role.
     * - The provided account address must not be zero.
     * - The provided amount must not be zero.
     */
    function grantCashback(
        address account,
        uint64 amount
    ) external whenNotPaused onlyRole(CASHBACK_OPERATOR_ROLE) onlyValidAccount(account) onlyValidAmount(amount) {
        CashbackVaultStorage storage $ = _getCashbackVaultStorage();
        AccountCashbackState storage accountState = $.accountCashbackStates[account];

        accountState.balance += amount;
        accountState.lastGrantTimestamp = uint64(block.timestamp);
        $.totalCashback += amount;

        IERC20($.token).safeTransferFrom(_msgSender(), address(this), amount);

        emit CashbackGranted(account, _msgSender(), amount, accountState.balance);
    }

    /**
     * @inheritdoc ICashbackVaultPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHBACK_OPERATOR_ROLE} role.
     * - The provided account address must not be zero.
     * - The provided amount must not be zero.
     * - The account must have sufficient cashback balance.
     */
    function revokeCashback(
        address account,
        uint64 amount
    ) external whenNotPaused onlyRole(CASHBACK_OPERATOR_ROLE) onlyValidAmount(amount) onlyValidAccount(account) {
        CashbackVaultStorage storage $ = _getCashbackVaultStorage();
        AccountCashbackState storage accountState = $.accountCashbackStates[account];

        if (accountState.balance < amount) {
            revert CashbackVault_CashbackBalanceInsufficient();
        }

        accountState.balance -= amount;
        $.totalCashback -= amount;

        IERC20($.token).safeTransfer(_msgSender(), amount);
        emit CashbackRevoked(account, _msgSender(), amount, accountState.balance);
    }

    /**
     * @inheritdoc ICashbackVaultPrimary
     *
     * @dev Requirements:
     * - The contract must not be paused.
     * - The caller must have the {MANAGER_ROLE} role.
     * - The provided account address must not be zero.
     * - The account must have sufficient cashback balance.
     * - The provided amount must not be zero.
     */
    function claim(
        address account,
        uint64 amount
    ) external whenNotPaused onlyRole(MANAGER_ROLE) onlyValidAccount(account) {
        _claim(account, amount);
    }

    /**
     * @inheritdoc ICashbackVaultPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {MANAGER_ROLE} role.
     * - The provided account address must not be zero.
     * - The account must have a cashback balance greater than zero.
     */
    function claimAll(address account) external whenNotPaused onlyRole(MANAGER_ROLE) onlyValidAccount(account) {
        CashbackVaultStorage storage $ = _getCashbackVaultStorage();
        AccountCashbackState storage accountState = $.accountCashbackStates[account];

        _claim(account, accountState.balance);
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc ICashbackVaultPrimary
    function getAccountCashbackBalance(address account) external view returns (uint256) {
        return _getCashbackVaultStorage().accountCashbackStates[account].balance;
    }

    /// @inheritdoc ICashbackVaultPrimary
    function getAccountCashbackState(address account) external view returns (AccountCashbackStateView memory) {
        AccountCashbackState storage accountState = _getCashbackVaultStorage().accountCashbackStates[account];
        return
            AccountCashbackStateView({
                balance: accountState.balance,
                totalClaimed: accountState.totalClaimed,
                lastClaimTimestamp: accountState.lastClaimTimestamp,
                lastGrantTimestamp: accountState.lastGrantTimestamp
            });
    }

    /// @inheritdoc ICashbackVaultPrimary
    function underlyingToken() external view returns (address) {
        return _getCashbackVaultStorage().token;
    }

    /// @inheritdoc ICashbackVaultPrimary
    function getTotalCashbackBalance() external view returns (uint256) {
        return _getCashbackVaultStorage().totalCashback;
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc ICashbackVault
    function proveCashbackVault() external pure {}

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Claims cashback for an account.
     *
     * @param account The account to claim cashback for.
     * @param amount The amount of cashback to claim.
     */
    function _claim(address account, uint64 amount) internal {
        CashbackVaultStorage storage $ = _getCashbackVaultStorage();
        AccountCashbackState storage accountState = $.accountCashbackStates[account];
        if (amount == 0) {
            revert CashbackVault_AmountZero();
        }

        if (accountState.balance < amount) {
            revert CashbackVault_CashbackBalanceInsufficient();
        }

        accountState.balance -= amount;
        accountState.totalClaimed += amount;
        accountState.lastClaimTimestamp = uint64(block.timestamp);
        $.totalCashback -= amount;

        IERC20($.token).safeTransfer(account, amount);
        emit CashbackClaimed(account, _msgSender(), amount, accountState.balance);
    }

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     * @param newImplementation The address of the new implementation.
     */
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try ICashbackVault(newImplementation).proveCashbackVault() {} catch {
            revert CashbackVault_ImplementationAddressInvalid();
        }
    }
}
