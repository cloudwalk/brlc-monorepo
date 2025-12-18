// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { IAfterPaymentMadeHook } from "../hookable/interfaces/ICardPaymentProcessorHooks.sol";
import { IAfterPaymentUpdatedHook } from "../hookable/interfaces/ICardPaymentProcessorHooks.sol";
import { IAfterPaymentCanceledHook } from "../hookable/interfaces/ICardPaymentProcessorHooks.sol";

/**
 * @title CashbackController types interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The custom types used in the wrapper contract for the cashback operations for card payments.
 */
interface ICashbackControllerTypes {
    /**
     * @dev Statuses of a cashback operation as an enum.
     *
     * The possible values:
     *
     * - Undefined = 0 -- The operation does not exist (the default value).
     * - Success = 1 ---- The operation has been successfully executed with a full amount transfer.
     * - Partial = 2 ---- The operation has been successfully executed but with a partial amount transfer.
     * - Capped = 3 ----- The operation has been refused because the cap for the period has been reached.
     * - OutOfFunds = 4 - The operation has been refused because the treasury has not enough funds.
     *
     * Notes:
     *
     * 1. All other cases (allowance problems or some transfer issues) result in a revert.
     * 2. If there are insufficient funds in the user's account during cashback revocation,
     * this results in a revert, because that case should be impossible to happen.
     */
    enum PaymentCashbackStatus {
        Undefined,
        Success,
        Partial,
        Capped,
        OutOfFunds
    }

    /**
     * @dev The cashback-related data of a single account.
     *
     * Fields:
     *
     * - totalAmount ----------- The total amount of cashback that has been granted to the account over all payments.
     * - capPeriodStartAmount -- The amount of cashback that granted to the account during the current cap period.
     * - capPeriodStartTime ---- The timestamp of the start of the current cap period.
     */
    struct AccountCashback {
        // Slot 1
        uint64 totalAmount;
        uint64 capPeriodStartAmount;
        uint32 capPeriodStartTime;
        // uint96 __reserved; // Reserved until the end of the storage slot
    }
    /** @dev The cashback-related data of a single payment.
     *
     * Fields:
     *
     * - balance -------- The cumulative cashback balance that was successfully granted related to the payment.
     * - recipient ------ The address of the account that received the cashback.
     */
    struct PaymentCashback {
        // Slot 1
        uint64 balance;
        address recipient;
        // uint32 __reserved; // Reserved until the end of the storage slot
    }

    /**
     * @dev The view of the payment cashback data.
     *
     * This structure is used as a return type for appropriate view functions.
     *
     * Fields:
     *
     * - balance -------- The cumulative cashback balance that was successfully granted related to the payment.
     * - recipient ------ The address of the account that received the cashback.
     */
    struct PaymentCashbackView {
        uint256 balance;
        address recipient;
    }

    /**
     * @dev The view of the cashback-related data of a single account.
     *
     * This structure is used as a return type for appropriate view functions.
     *
     * Fields:
     *
     * - totalAmount ----------- The total amount of cashback that has been sent to the account.
     * - capPeriodStartAmount -- The amount of cashback that has been sent to the account during the current cap period.
     * - capPeriodStartTime ---- The timestamp of the start of the current cap period.
     */
    struct AccountCashbackView {
        uint256 totalAmount;
        uint256 capPeriodStartAmount;
        uint256 capPeriodStartTime;
    }
}

/**
 * @title ICashbackControllerPrimary interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary interface of the wrapper contract for the cashback operations for card payments.
 */
interface ICashbackControllerPrimary is ICashbackControllerTypes {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when cashback related to a payment is initially sent
     * @param paymentId The associated card transaction payment ID from the off-chain card processing backend.
     * @param recipient The address of the cashback recipient.
     * @param status The status of the cashback operation.
     * @param amount The actual amount of the sent cashback.
     */
    event CashbackSent(
        bytes32 indexed paymentId,
        address indexed recipient,
        PaymentCashbackStatus indexed status,
        uint256 amount
    );

    /**
     * @dev Emitted when cashback related to a payment is decreased.
     * @param paymentId The associated card transaction payment ID from the off-chain card processing backend.
     * @param recipient The address of the cashback recipient.
     * @param status The status of the cashback operation.
     * @param delta The actual amount by which the cashback was decreased.
     * @param balance The cashback balance after the operation.
     *
     */
    event CashbackDecreased(
        bytes32 indexed paymentId,
        address indexed recipient,
        PaymentCashbackStatus indexed status,
        uint256 delta,
        uint256 balance
    );

    /**
     * @dev Emitted when cashback related to a payment is increased.
     * @param paymentId The associated card transaction payment ID from the off-chain card processing backend.
     * @param recipient The address of the cashback recipient.
     * @param status The status of the cashback operation.
     * @param delta The actual amount by which the cashback was increased.
     * @param balance The cashback balance after the operation.
     */
    event CashbackIncreased(
        bytes32 indexed paymentId,
        address indexed recipient,
        PaymentCashbackStatus indexed status,
        uint256 delta,
        uint256 balance
    );

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Corrects the cashback amount for a payment.
     *
     * The cashback record must exist for the provided payment ID.
     *
     * @param paymentId The payment ID to correct the cashback amount for.
     * @param newCashbackAmount The new desired cashback amount for the payment.
     */
    function correctCashbackAmount(bytes32 paymentId, uint64 newCashbackAmount) external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Returns a structure with cashback-related data for a single account.
     * @param account The account address to get the cashback state for.
     */
    function getAccountCashback(address account) external view returns (AccountCashbackView memory);

    /**
     * @dev Returns the cashback state for a single payment.
     * @param paymentId The payment ID to get the cashback state for.
     */
    function getPaymentCashback(bytes32 paymentId) external view returns (PaymentCashbackView memory);
}

/**
 * @title ICashbackControllerConfiguration interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The configuration interface of the wrapper contract for the cashback operations for card payments.
 */
interface ICashbackControllerConfiguration is ICashbackControllerTypes {
    // ------------------ Events ---------------------------------- //
    /**
     * @dev Emitted when the cashback treasury address is changed.
     * @param newTreasury The address of the new cashback treasury.
     * @param oldTreasury The address of the old cashback treasury.
     */
    event CashbackTreasuryUpdated(address newTreasury, address oldTreasury);

    /**
     * @dev Emitted when the cashback vault is updated.
     *
     * See {ICashbackController} for details.
     *
     * @param newCashbackVault The address of the new cashback vault. If zero the claimable mode is disabled.
     * @param oldCashbackVault The address of the old cashback vault.
     */
    event CashbackVaultUpdated(address newCashbackVault, address oldCashbackVault);

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Sets a new address of the cashback treasury.
     *
     * Emits a {CashbackTreasuryUpdated} event.
     *
     * @param newCashbackTreasury The address of the new cashback treasury.
     */
    function setCashbackTreasury(address newCashbackTreasury) external;

    /**
     * @dev Sets the address of the cashback vault.
     *
     * See {ICashbackController} for details.
     *
     * @param cashbackVault The address of the cashback vault to set. If zero the claimable mode is disabled.
     */
    function setCashbackVault(address cashbackVault) external;

    // ------------------ View functions -------------------------- //

    /// @dev Returns the current cashback treasury address.
    function getCashbackTreasury() external view returns (address);

    /// @dev Returns the current cashback vault address.
    function getCashbackVault() external view returns (address);

    /// @dev Returns the current underlying token address.
    function underlyingToken() external view returns (address);
}

/**
 * @title ICashbackControllerErrors interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The custom errors used in the wrapper contract for the cashback operations for card payments.
 */
interface ICashbackControllerErrors {
    /// @dev The payment cashback does not exist.
    error CashbackController_CashbackDoesNotExist();

    /// @dev The provided cashback vault contract is not a valid one.
    error CashbackController_CashbackVaultInvalid();

    /// @dev The token of the provided cashback vault does not match the expected one.
    error CashbackController_CashbackVaultTokenMismatch();

    /// @dev The provided cashback vault address is identical to the current one.
    error CashbackController_CashbackVaultUnchanged();

    /// @dev The provided account does not meet the requirements to have the hook trigger role.
    error CashbackController_HookTriggerRoleIncompatible();

    /// @dev Thrown if the provided new implementation address is not of a cashback controller contract.
    error CashbackController_ImplementationAddressInvalid();

    /// @dev Thrown if the provided token address is zero during initialization.
    error CashbackController_TokenAddressZero();

    /// @dev Thrown if the cashback treasury address has no allowance for the contract.
    error CashbackController_TreasuryAllowanceZero();

    /// @dev The cashback treasury address is not configured.
    error CashbackController_TreasuryNotConfigured();

    /// @dev The cashback treasury address is the same as the previously set one.
    error CashbackController_TreasuryUnchanged();

    /// @dev The zero cashback treasury address has been passed as a function argument.
    error CashbackController_TreasuryAddressZero();
}

/**
 * @title ICashbackController
 * @dev Interface for the CashbackController contract.
 *
 * There are two cashback modes depending on whether the cashback vault is set or not:
 *
 * * Direct mode -- the cashback vault is NOT set. In this case the cashback is sent directly
 *   from or to the recipient. The token flow: Contract <=> Recipient.
 * * Claimable mode -- the cashback vault is set. In this case the cashback is sent from or to the vault
 *   and later the recipient can claim the cashback from the vault. The token flow: Contract <=> Vault <=> Recipient.
 */
interface ICashbackController is
    IAfterPaymentMadeHook,
    IAfterPaymentUpdatedHook,
    IAfterPaymentCanceledHook,
    ICashbackControllerTypes,
    ICashbackControllerPrimary,
    ICashbackControllerConfiguration,
    ICashbackControllerErrors
{
    /**
     * @dev Proves the contract is the cashback controller one. A marker function.
     *
     * It is used for simple contract compliance checks, e.g. during an upgrade.
     * This avoids situations where a wrong contract address is specified by mistake.
     */
    function proveCashbackController() external pure;
}
