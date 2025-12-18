// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";
import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { RescuableUpgradeable } from "./base/RescuableUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";

import { CardPaymentProcessorStorage } from "./CardPaymentProcessorStorage.sol";
import { CardPaymentProcessorHookable } from "./hookable/CardPaymentProcessorHookable.sol";

import { IAfterPaymentMadeHook } from "./hookable/interfaces/ICardPaymentProcessorHooks.sol";
import { IAfterPaymentUpdatedHook } from "./hookable/interfaces/ICardPaymentProcessorHooks.sol";
import { IAfterPaymentCanceledHook } from "./hookable/interfaces/ICardPaymentProcessorHooks.sol";
import { ICardPaymentProcessor } from "./interfaces/ICardPaymentProcessor.sol";
import { ICardPaymentProcessorConfiguration } from "./interfaces/ICardPaymentProcessor.sol";
import { ICardPaymentProcessorPrimary } from "./interfaces/ICardPaymentProcessor.sol";

/**
 * @title CardPaymentProcessor contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The wrapper contract for the card payment operations.
 */
contract CardPaymentProcessor is
    CardPaymentProcessorStorage,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    RescuableUpgradeable,
    UUPSExtUpgradeable,
    ICardPaymentProcessor,
    CardPaymentProcessorHookable,
    Versionable
{
    // ------------------ Types ----------------------------------- //

    using SafeERC20 for IERC20;

    /**
     * @dev Kind of a payment updating operation for internal use.
     *
     * The possible values:
     *
     * - Full = 0 -- The operation is executed fully regardless of the new values of the base amount and extra amount.
     * - Lazy = 1 -- The operation is executed only if the new amounts differ from the current ones of the payment.
     */
    enum UpdatingOperationKind {
        Full,
        Lazy
    }

    /**
     * @dev The kind of a payment recalculation operation for internal use.
     *
     * The possible values:
     *
     * - None = 0 -- The payment recalculation is not needed.
     * - Full = 1 -- The payment recalculation is needed.
     */
    enum PaymentRecalculationKind {
        None,
        Full
    }

    /// @dev Contains parameters of a payment making operation for internal use.
    struct MakingOperation {
        bytes32 paymentId;
        address payer;
        address sponsor;
        uint256 cashbackRate;
        uint256 baseAmount;
        uint256 extraAmount;
        uint256 subsidyLimit;
        uint256 payerSumAmount;
        uint256 sponsorSumAmount;
    }

    /// @dev Contains details of a payment for internal use.
    struct PaymentDetails {
        uint256 confirmedAmount;
        uint256 payerSumAmount;
        uint256 sponsorSumAmount;
        uint256 payerRemainder;
        uint256 sponsorRemainder;
    }

    // ------------------ Constants ------------------------------- //

    /// @dev The role of an executor that is allowed to execute the card payment operations.
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    /// @dev The maximum allowable cashback rate in per mille;
    uint256 public constant MAX_CASHBACK_RATE = 500;

    /// @dev Event addendum flag mask defining whether the payment is sponsored.
    uint256 internal constant EVENT_ADDENDUM_FLAG_MASK_SPONSORED = 1;

    /// @dev Default version of the event addendum.
    uint8 internal constant EVENT_ADDENDUM_DEFAULT_VERSION = 1;

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
     * Requirements:
     *
     * - The passed token address must not be zero.
     * - The passed cash-out account address must not be zero.
     *
     * @param token_ The address of a token to set as the underlying one.
     * @param cashOutAccount_ The cash-out account that will receive tokens of confirmed payments.
     */
    function initialize(address token_, address cashOutAccount_) external initializer {
        if (token_ == address(0)) {
            revert TokenZeroAddress();
        }

        if (cashOutAccount_ == address(0)) {
            revert CashOutAccountZeroAddress();
        }

        __AccessControlExt_init_unchained();
        __PausableExt_init_unchained();
        __Rescuable_init_unchained();
        __UUPSExt_init_unchained(); // This is needed only to avoid errors during coverage assessment

        _token = token_;
        _cashOutAccount = cashOutAccount_;

        _setRoleAdmin(EXECUTOR_ROLE, GRANTOR_ROLE);
        _grantRole(OWNER_ROLE, _msgSender());
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @inheritdoc ICardPaymentProcessorConfiguration
     *
     * @dev Requirements:
     *
     * - The caller must have the {OWNER_ROLE} role.
     * - The new cash-out account must not be the same as the previously set one.
     */
    function setCashOutAccount(address newCashOutAccount) external onlyRole(OWNER_ROLE) {
        address oldCashOutAccount = _cashOutAccount;

        if (newCashOutAccount == oldCashOutAccount) {
            revert CashOutAccountUnchanged();
        }

        if (newCashOutAccount == address(0)) {
            revert CashOutAccountZeroAddress();
        }

        _cashOutAccount = newCashOutAccount;

        emit CashOutAccountChanged(oldCashOutAccount, newCashOutAccount);
    }

    /**
     * @inheritdoc ICardPaymentProcessorPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {EXECUTOR_ROLE} role.
     * - The payment account address must not be zero.
     * - The payment ID must not be zero.
     * - The payment linked with the provided ID must be revoked or not exist.
     * - The requested cashback rate must not exceed the maximum allowable cashback rate defined in the contract.
     * - The sum of the provided base and extra amounts must not exceed the max 64-bit unsigned integer.
     * - The provided subsidy limit must not exceed the max 64-bit unsigned integer.
     * - The provided confirmation amount must not exceed the sum amount of the payment.
     */
    function makePaymentFor(
        bytes32 paymentId,
        address payer,
        uint256 baseAmount,
        uint256 extraAmount,
        address sponsor,
        uint256 subsidyLimit,
        int256 cashbackRate_,
        uint256 confirmationAmount
    ) external whenNotPaused onlyRole(EXECUTOR_ROLE) {
        if (payer == address(0)) {
            revert PayerZeroAddress();
        }
        uint256 cashbackRateActual;
        if (cashbackRate_ < 0) {
            cashbackRateActual = _defaultCashbackRate;
        } else {
            cashbackRateActual = uint256(cashbackRate_);
            if (cashbackRateActual > MAX_CASHBACK_RATE) {
                revert CashbackRateExcess();
            }
        }
        MakingOperation memory operation = MakingOperation({
            paymentId: paymentId,
            payer: payer,
            sponsor: sponsor,
            cashbackRate: cashbackRateActual,
            baseAmount: baseAmount,
            extraAmount: extraAmount,
            subsidyLimit: subsidyLimit,
            payerSumAmount: 0,
            sponsorSumAmount: 0
        });

        _makePayment_hookable(operation);
        if (confirmationAmount > 0) {
            _confirmPaymentWithTransfer(paymentId, confirmationAmount);
        }
    }

    /**
     * @inheritdoc ICardPaymentProcessorPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {EXECUTOR_ROLE} role.
     * - The payment account address must not be zero.
     * - The payment ID must not be zero.
     * - The payment linked with the provided ID must be revoked or not exist.
     */
    function makeCommonPaymentFor(
        bytes32 paymentId,
        address payer,
        uint256 baseAmount,
        uint256 extraAmount
    ) external whenNotPaused onlyRole(EXECUTOR_ROLE) {
        if (payer == address(0)) {
            revert PayerZeroAddress();
        }

        MakingOperation memory operation = MakingOperation({
            paymentId: paymentId,
            payer: payer,
            sponsor: address(0),
            cashbackRate: _defaultCashbackRate,
            baseAmount: baseAmount,
            extraAmount: extraAmount,
            subsidyLimit: 0,
            payerSumAmount: 0,
            sponsorSumAmount: 0
        });

        _makePayment_hookable(operation);
    }

    /**
     * @inheritdoc ICardPaymentProcessorPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {EXECUTOR_ROLE} role.
     * - The input payment ID must not be zero.
     * - The new base amount plus the new extra amount must not be less than the existing refund amount.
     */
    function updatePayment(
        bytes32 paymentId,
        uint256 newBaseAmount,
        uint256 newExtraAmount
    ) external whenNotPaused onlyRole(EXECUTOR_ROLE) {
        _updatePayment_hookable(
            paymentId, // Tools: prevent Prettier one-liner
            newBaseAmount,
            newExtraAmount,
            UpdatingOperationKind.Full
        );
    }

    /**
     * @inheritdoc ICardPaymentProcessorPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {EXECUTOR_ROLE} role.
     * - The input payment ID must not be zero.
     */
    function reversePayment(bytes32 paymentId) external whenNotPaused onlyRole(EXECUTOR_ROLE) {
        _cancelPayment_hookable(paymentId, PaymentStatus.Reversed);
    }

    /**
     * @inheritdoc ICardPaymentProcessorPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {EXECUTOR_ROLE} role.
     * - The input payment ID must not be zero.
     */
    function revokePayment(bytes32 paymentId) external whenNotPaused onlyRole(EXECUTOR_ROLE) {
        _cancelPayment_hookable(paymentId, PaymentStatus.Revoked);
    }

    /**
     * @inheritdoc ICardPaymentProcessorPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {EXECUTOR_ROLE} role.
     * - The input payment ID must not be zero.
     */
    function confirmPayment(
        bytes32 paymentId,
        uint256 confirmationAmount
    ) public whenNotPaused onlyRole(EXECUTOR_ROLE) {
        _confirmPaymentWithTransfer(paymentId, confirmationAmount);
    }

    /**
     * @inheritdoc ICardPaymentProcessorPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {EXECUTOR_ROLE} role.
     * - The input array must not be empty.
     * - All payment IDs in the input array must not be zero.
     */
    function confirmPayments(
        PaymentConfirmation[] calldata paymentConfirmations
    ) public whenNotPaused onlyRole(EXECUTOR_ROLE) {
        if (paymentConfirmations.length == 0) {
            revert PaymentConfirmationArrayEmpty();
        }

        uint256 totalConfirmedAmount = 0;
        for (uint256 i = 0; i < paymentConfirmations.length; i++) {
            totalConfirmedAmount += _confirmPayment(
                paymentConfirmations[i].paymentId, // Tools: prevent Prettier one-liner
                paymentConfirmations[i].amount
            );
        }

        _paymentStatistics.totalUnconfirmedRemainder = uint128(
            uint256(_paymentStatistics.totalUnconfirmedRemainder) - totalConfirmedAmount
        );
        IERC20(_token).safeTransfer(_cashOutAccount, totalConfirmedAmount);
    }

    /**
     * @inheritdoc ICardPaymentProcessorPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {EXECUTOR_ROLE} role.
     * - The input payment ID must not be zero.
     * - The new base amount plus the new extra amount must not be less than the existing refund amount.
     */
    function updateLazyAndConfirmPayment(
        bytes32 paymentId,
        uint256 newBaseAmount,
        uint256 newExtraAmount,
        uint256 confirmationAmount
    ) external whenNotPaused onlyRole(EXECUTOR_ROLE) {
        _updatePayment_hookable(
            paymentId, // Tools: prevent Prettier one-liner
            newBaseAmount,
            newExtraAmount,
            UpdatingOperationKind.Lazy
        );
        _confirmPaymentWithTransfer(paymentId, confirmationAmount);
    }

    /**
     * @inheritdoc ICardPaymentProcessorPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {EXECUTOR_ROLE} role.
     * - The input payment ID must not be zero.
     * - The result refund amount of the payment must not be higher than the new extra amount plus the base amount.
     */
    function refundPayment(
        bytes32 paymentId, // Tools: prevent Prettier one-liner
        uint256 refundingAmount
    ) external whenNotPaused onlyRole(EXECUTOR_ROLE) {
        _refundPayment_hookable(paymentId, refundingAmount);
    }

    /**
     * @inheritdoc ICardPaymentProcessorPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {EXECUTOR_ROLE} role.
     * - The account address must not be zero.
     */
    function refundAccount(
        address account, // Tools: prevent Prettier one-liner
        uint256 refundingAmount
    ) external whenNotPaused onlyRole(EXECUTOR_ROLE) {
        if (account == address(0)) {
            revert AccountZeroAddress();
        }

        emit AccountRefunded(
            account, // Tools: prevent Prettier one-liner
            refundingAmount,
            bytes("")
        );

        IERC20(_token).safeTransferFrom(_cashOutAccount, account, refundingAmount);
    }

    /**
     * @inheritdoc ICardPaymentProcessorConfiguration
     *
     * @dev Requirements:
     *
     * - The caller must have the {OWNER_ROLE} role.
     * - The new rate must differ from the previously set one.
     * - The new rate must not exceed the allowable maximum specified in the {MAX_CASHBACK_RATE} constant.
     */
    function setDefaultCashbackRate(uint256 newCashbackRate) external onlyRole(OWNER_ROLE) {
        uint256 oldCashbackRate = _defaultCashbackRate;
        if (newCashbackRate == oldCashbackRate) {
            revert DefaultCashbackRateUnchanged();
        }
        if (newCashbackRate > MAX_CASHBACK_RATE) {
            revert CashbackRateExcess();
        }

        _defaultCashbackRate = uint16(newCashbackRate);

        emit DefaultCashbackRateChanged(oldCashbackRate, newCashbackRate);
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc ICardPaymentProcessorPrimary
    function cashOutAccount() external view returns (address) {
        return _cashOutAccount;
    }

    /// @inheritdoc ICardPaymentProcessorConfiguration
    function defaultCashbackRate() external view returns (uint256) {
        return _defaultCashbackRate;
    }

    /// @inheritdoc ICardPaymentProcessorPrimary
    function token() external view returns (address) {
        return _token;
    }

    /// @inheritdoc ICardPaymentProcessorPrimary
    function getPayment(bytes32 paymentId) external view returns (Payment memory) {
        return _payments[paymentId];
    }

    /// @inheritdoc ICardPaymentProcessorPrimary
    function getPaymentStatistics() external view returns (PaymentStatistics memory) {
        return _paymentStatistics;
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc ICardPaymentProcessor
    function proveCardPaymentProcessor() external pure {}

    // ------------------ Internal functions ---------------------- //

    function _makePayment_hookable(MakingOperation memory operation) internal {
        // before hooks goes here if needed
        _makePayment(operation);
        PaymentHookData memory emptyPayment;

        _callHooks(
            IAfterPaymentMadeHook.afterPaymentMade.selector,
            operation.paymentId,
            emptyPayment,
            _convertPaymentToHookData(_payments[operation.paymentId])
        );
    }

    function _updatePayment_hookable(
        bytes32 paymentId,
        uint256 newBaseAmount,
        uint256 newExtraAmount,
        UpdatingOperationKind kind
    ) internal {
        PaymentHookData memory oldPayment = _convertPaymentToHookData(_payments[paymentId]);
        // before hooks goes here if needed
        _updatePayment(paymentId, newBaseAmount, newExtraAmount, kind);

        _callHooks(
            IAfterPaymentUpdatedHook.afterPaymentUpdated.selector,
            paymentId,
            oldPayment,
            _convertPaymentToHookData(_payments[paymentId])
        );
    }

    function _cancelPayment_hookable(
        bytes32 paymentId, // Tools: prevent Prettier one-liner
        PaymentStatus targetStatus
    ) internal {
        PaymentHookData memory oldPayment = _convertPaymentToHookData(_payments[paymentId]);
        // before hooks goes here if needed
        _cancelPayment(paymentId, targetStatus);

        _callHooks(
            IAfterPaymentCanceledHook.afterPaymentCanceled.selector,
            paymentId,
            oldPayment,
            _convertPaymentToHookData(_payments[paymentId])
        );
    }

    function _refundPayment_hookable(
        bytes32 paymentId, // Tools: prevent Prettier one-liner
        uint256 refundingAmount
    ) internal {
        PaymentHookData memory oldPayment = _convertPaymentToHookData(_payments[paymentId]);
        _refundPayment(paymentId, refundingAmount);

        _callHooks(
            IAfterPaymentUpdatedHook.afterPaymentUpdated.selector,
            paymentId,
            oldPayment,
            _convertPaymentToHookData(_payments[paymentId])
        );
    }

    /// @dev Making a payment internally.
    function _makePayment(MakingOperation memory operation) internal {
        if (operation.paymentId == 0) {
            revert PaymentZeroId();
        }

        Payment storage storedPayment = _payments[operation.paymentId];

        PaymentStatus status = storedPayment.status;
        if (status != PaymentStatus.Nonexistent && status != PaymentStatus.Revoked) {
            revert PaymentAlreadyExistent();
        }

        _processPaymentMaking(operation);
        _storeNewPayment(storedPayment, operation);

        address sponsor = operation.sponsor;
        uint256 eventFlags = _defineEventFlags(sponsor);
        bytes memory addendum = abi.encodePacked(
            EVENT_ADDENDUM_DEFAULT_VERSION,
            uint8(eventFlags),
            uint64(operation.baseAmount),
            uint64(operation.extraAmount),
            uint64(operation.payerSumAmount)
        );
        if (eventFlags & EVENT_ADDENDUM_FLAG_MASK_SPONSORED != 0) {
            addendum = abi.encodePacked(
                addendum, // Tools: prevent Prettier one-liner
                sponsor,
                uint64(operation.sponsorSumAmount)
            );
        }
        emit PaymentMade(
            operation.paymentId, // Tools: prevent Prettier one-liner
            operation.payer,
            addendum
        );
    }

    /// @dev Updates the base amount and extra amount of a payment internally.
    function _updatePayment(
        bytes32 paymentId,
        uint256 newBaseAmount,
        uint256 newExtraAmount,
        UpdatingOperationKind kind
    ) internal {
        if (paymentId == 0) {
            revert PaymentZeroId();
        }

        Payment storage storedPayment = _payments[paymentId];
        Payment memory payment = storedPayment;

        if (
            kind == UpdatingOperationKind.Lazy &&
            payment.baseAmount == newBaseAmount &&
            payment.extraAmount == newExtraAmount
        ) {
            return;
        }

        _checkActivePaymentStatus(paymentId, payment.status);
        _checkPaymentSumAmount(newBaseAmount + newExtraAmount, payment.refundAmount);

        PaymentDetails memory oldPaymentDetails = _definePaymentDetails(payment, PaymentRecalculationKind.None);
        uint256 oldBaseAmount = payment.baseAmount;
        uint256 oldExtraAmount = payment.extraAmount;
        payment.baseAmount = uint64(newBaseAmount);
        payment.extraAmount = uint64(newExtraAmount);
        PaymentDetails memory newPaymentDetails = _definePaymentDetails(payment, PaymentRecalculationKind.Full);

        _processPaymentChange(paymentId, payment, oldPaymentDetails, newPaymentDetails);
        _storeChangedPayment(storedPayment, payment, newPaymentDetails);
        _updatePaymentStatistics(oldPaymentDetails, newPaymentDetails);

        address sponsor = payment.sponsor;
        uint256 eventFlags = _defineEventFlags(sponsor);
        bytes memory addendum = abi.encodePacked(
            EVENT_ADDENDUM_DEFAULT_VERSION,
            uint8(eventFlags),
            uint64(oldBaseAmount),
            uint64(newBaseAmount),
            uint64(oldExtraAmount),
            uint64(newExtraAmount),
            uint64(oldPaymentDetails.payerSumAmount),
            uint64(newPaymentDetails.payerSumAmount)
        );
        if (eventFlags & EVENT_ADDENDUM_FLAG_MASK_SPONSORED != 0) {
            addendum = abi.encodePacked(
                addendum,
                sponsor,
                uint64(oldPaymentDetails.sponsorSumAmount),
                uint64(newPaymentDetails.sponsorSumAmount)
            );
        }
        emit PaymentUpdated(
            paymentId, // Tools: prevent Prettier one-liner
            payment.payer,
            addendum
        );
    }

    /// @dev Cancels a payment internally.
    function _cancelPayment(
        bytes32 paymentId, // Tools: prevent Prettier one-liner
        PaymentStatus targetStatus
    ) internal {
        if (paymentId == 0) {
            revert PaymentZeroId();
        }

        Payment storage storedPayment = _payments[paymentId];
        Payment memory payment = storedPayment;

        _checkActivePaymentStatus(paymentId, payment.status);

        PaymentDetails memory oldPaymentDetails = _definePaymentDetails(payment, PaymentRecalculationKind.None);
        PaymentDetails memory newPaymentDetails; // All fields are zero

        _processPaymentChange(paymentId, payment, oldPaymentDetails, newPaymentDetails);
        _updatePaymentStatistics(oldPaymentDetails, newPaymentDetails);

        storedPayment.status = targetStatus;

        address sponsor = payment.sponsor;
        uint256 eventFlags = _defineEventFlags(sponsor);
        bytes memory addendum = abi.encodePacked(
            EVENT_ADDENDUM_DEFAULT_VERSION,
            uint8(eventFlags),
            uint64(payment.baseAmount),
            uint64(payment.extraAmount),
            uint64(oldPaymentDetails.payerRemainder)
        );
        if (eventFlags & EVENT_ADDENDUM_FLAG_MASK_SPONSORED != 0) {
            addendum = abi.encodePacked(
                addendum, // Tools: prevent Prettier one-liner
                sponsor,
                uint64(oldPaymentDetails.sponsorRemainder)
            );
        }

        if (targetStatus == PaymentStatus.Revoked) {
            emit PaymentRevoked(
                paymentId, // Tools: prevent Prettier one-liner
                payment.payer,
                addendum
            );
        } else {
            emit PaymentReversed(
                paymentId, // Tools: prevent Prettier one-liner
                payment.payer,
                addendum
            );
        }
    }

    /// @dev Confirms a payment internally.
    function _confirmPayment(
        bytes32 paymentId, // Tools: prevent Prettier one-liner
        uint256 confirmationAmount
    ) internal returns (uint256) {
        if (paymentId == 0) {
            revert PaymentZeroId();
        }
        Payment storage payment = _payments[paymentId];
        _checkActivePaymentStatus(paymentId, payment.status);

        if (confirmationAmount == 0) {
            return confirmationAmount;
        }

        uint256 remainder = uint256(payment.baseAmount) + uint256(payment.extraAmount) - uint256(payment.refundAmount);
        uint256 oldConfirmedAmount = payment.confirmedAmount;
        uint256 newConfirmedAmount = oldConfirmedAmount + confirmationAmount;
        if (newConfirmedAmount > remainder) {
            revert InappropriateConfirmationAmount();
        }

        payment.confirmedAmount = uint64(newConfirmedAmount);
        _emitPaymentConfirmedAmountChanged(
            paymentId,
            payment.payer,
            payment.sponsor,
            oldConfirmedAmount,
            newConfirmedAmount
        );

        return confirmationAmount;
    }

    /// @dev Confirms a payment internally with the token transfer to the cash-out account.
    function _confirmPaymentWithTransfer(
        bytes32 paymentId, // Tools: prevent Prettier one-liner
        uint256 confirmationAmount
    ) internal {
        confirmationAmount = _confirmPayment(paymentId, confirmationAmount);
        _paymentStatistics.totalUnconfirmedRemainder = uint128(
            uint256(_paymentStatistics.totalUnconfirmedRemainder) - confirmationAmount
        );
        IERC20(_token).safeTransfer(_cashOutAccount, confirmationAmount);
    }

    /// @dev Makes a refund for a payment internally.
    function _refundPayment(
        bytes32 paymentId, // Tools: prevent Prettier one-liner
        uint256 refundingAmount
    ) internal {
        if (paymentId == 0) {
            revert PaymentZeroId();
        }

        Payment storage storedPayment = _payments[paymentId];
        Payment memory payment = storedPayment;
        _checkActivePaymentStatus(paymentId, payment.status);

        uint256 newRefundAmount = uint256(payment.refundAmount) + refundingAmount;
        if (newRefundAmount > uint256(payment.baseAmount) + uint256(payment.extraAmount)) {
            revert InappropriateRefundingAmount();
        }

        PaymentDetails memory oldPaymentDetails = _definePaymentDetails(payment, PaymentRecalculationKind.None);
        payment.refundAmount = uint64(newRefundAmount);
        PaymentDetails memory newPaymentDetails = _definePaymentDetails(payment, PaymentRecalculationKind.Full);

        _processPaymentChange(paymentId, payment, oldPaymentDetails, newPaymentDetails);
        _storeChangedPayment(storedPayment, payment, newPaymentDetails);
        _updatePaymentStatistics(oldPaymentDetails, newPaymentDetails);

        address sponsor = payment.sponsor;
        uint256 eventFlags = _defineEventFlags(sponsor);
        bytes memory addendum = abi.encodePacked(
            EVENT_ADDENDUM_DEFAULT_VERSION,
            uint8(eventFlags),
            uint64(oldPaymentDetails.payerSumAmount - oldPaymentDetails.payerRemainder), // oldPayerRefundAmount
            uint64(newPaymentDetails.payerSumAmount - newPaymentDetails.payerRemainder) // newPayerRefundAmount
        );
        if (eventFlags & EVENT_ADDENDUM_FLAG_MASK_SPONSORED != 0) {
            // Add sponsor, oldSponsorRefundAmount, newSponsorRefundAmount
            addendum = abi.encodePacked(
                addendum,
                sponsor,
                uint64(oldPaymentDetails.sponsorSumAmount - oldPaymentDetails.sponsorRemainder),
                uint64(newPaymentDetails.sponsorSumAmount - newPaymentDetails.sponsorRemainder)
            );
        }

        emit PaymentRefunded(
            paymentId, // Tools: prevent Prettier one-liner
            payment.payer,
            addendum
        );
    }

    /// @dev Executes token transfers related to a new payment.
    function _processPaymentMaking(MakingOperation memory operation) internal {
        uint256 sumAmount = operation.baseAmount + operation.extraAmount;
        if (sumAmount > type(uint64).max) {
            revert OverflowOfSumAmount();
        }
        if (operation.sponsor == address(0) && operation.subsidyLimit != 0) {
            revert SponsorZeroAddress();
        }
        if (operation.subsidyLimit > type(uint64).max) {
            revert OverflowOfSubsidyLimit();
        }
        (uint256 payerSumAmount, uint256 sponsorSumAmount) = _defineSumAmountParts(sumAmount, operation.subsidyLimit);
        IERC20 erc20Token = IERC20(_token);
        operation.payerSumAmount = payerSumAmount;
        operation.sponsorSumAmount = sponsorSumAmount;

        erc20Token.safeTransferFrom(operation.payer, address(this), payerSumAmount);
        if (operation.sponsor != address(0)) {
            erc20Token.safeTransferFrom(operation.sponsor, address(this), sponsorSumAmount);
        }
    }

    /// @dev Checks if the status of a payment is active. Otherwise reverts with an appropriate error.
    function _checkActivePaymentStatus(bytes32 paymentId, PaymentStatus status) internal pure {
        if (status == PaymentStatus.Nonexistent) {
            revert PaymentNonExistent(paymentId);
        }
        if (status != PaymentStatus.Active) {
            revert InappropriatePaymentStatus(paymentId, status);
        }
    }

    /// @dev Checks if the payment sum amount and the refund amount meet the requirements.
    function _checkPaymentSumAmount(uint256 sumAmount, uint256 refundAmount) internal pure {
        if (refundAmount > sumAmount) {
            revert InappropriateSumAmount();
        }
        if (sumAmount > type(uint64).max) {
            revert OverflowOfSumAmount();
        }
    }

    /// @dev Executes token transfers related to changes of a payment and emits additional events.
    function _processPaymentChange(
        bytes32 paymentId,
        Payment memory payment,
        PaymentDetails memory oldPaymentDetails,
        PaymentDetails memory newPaymentDetails
    ) internal {
        IERC20 erc20Token = IERC20(_token);

        // Cash-out account token transferring
        if (newPaymentDetails.confirmedAmount < oldPaymentDetails.confirmedAmount) {
            uint256 amount = oldPaymentDetails.confirmedAmount - newPaymentDetails.confirmedAmount;
            erc20Token.safeTransferFrom(_cashOutAccount, address(this), amount);
            _emitPaymentConfirmedAmountChanged(
                paymentId,
                payment.payer,
                payment.sponsor,
                oldPaymentDetails.confirmedAmount,
                newPaymentDetails.confirmedAmount
            );
        }

        // Payer token transferring
        {
            int256 amount = -(int256(newPaymentDetails.payerRemainder) - int256(oldPaymentDetails.payerRemainder));

            if (amount < 0) {
                erc20Token.safeTransferFrom(payment.payer, address(this), uint256(-amount));
            } else if (amount > 0) {
                erc20Token.safeTransfer(payment.payer, uint256(amount));
            }
        }

        // Sponsor token transferring
        address sponsor = payment.sponsor;
        if (payment.sponsor != address(0)) {
            if (newPaymentDetails.sponsorRemainder > oldPaymentDetails.sponsorRemainder) {
                uint256 amount = newPaymentDetails.sponsorRemainder - oldPaymentDetails.sponsorRemainder;
                erc20Token.safeTransferFrom(sponsor, address(this), amount);
            } else if (newPaymentDetails.sponsorRemainder < oldPaymentDetails.sponsorRemainder) {
                uint256 amount = oldPaymentDetails.sponsorRemainder - newPaymentDetails.sponsorRemainder;
                erc20Token.safeTransfer(sponsor, amount);
            }
        }
    }

    /// @dev Emits an appropriate event when the confirmed amount is changed for a payment.
    function _emitPaymentConfirmedAmountChanged(
        bytes32 paymentId,
        address payer,
        address sponsor,
        uint256 oldConfirmedAmount,
        uint256 newConfirmedAmount
    ) internal {
        uint256 eventFlags = _defineEventFlags(sponsor);
        bytes memory addendum = abi.encodePacked(
            EVENT_ADDENDUM_DEFAULT_VERSION,
            uint8(eventFlags),
            uint64(oldConfirmedAmount),
            uint64(newConfirmedAmount)
        );
        if (eventFlags & EVENT_ADDENDUM_FLAG_MASK_SPONSORED != 0) {
            addendum = abi.encodePacked(
                addendum, // Tools: prevent Prettier one-liner
                sponsor
            );
        }

        emit PaymentConfirmedAmountChanged(
            paymentId, // Tools: prevent Prettier one-liner
            payer,
            addendum
        );
    }

    /// @dev Stores the data of a newly created payment.
    function _storeNewPayment(
        Payment storage storedPayment, // Tools: prevent Prettier one-liner
        MakingOperation memory operation
    ) internal {
        PaymentStatus oldStatus = storedPayment.status;
        storedPayment.status = PaymentStatus.Active;
        storedPayment.payer = operation.payer;
        storedPayment.cashbackRate = uint16(operation.cashbackRate);
        storedPayment.confirmedAmount = 0;
        if (oldStatus != PaymentStatus.Nonexistent || operation.sponsor != address(0)) {
            storedPayment.sponsor = operation.sponsor;
            storedPayment.subsidyLimit = uint64(operation.subsidyLimit);
        }
        storedPayment.baseAmount = uint64(operation.baseAmount);
        storedPayment.extraAmount = uint64(operation.extraAmount);
        storedPayment.refundAmount = 0;

        _paymentStatistics.totalUnconfirmedRemainder += uint128(operation.baseAmount + operation.extraAmount);
    }

    /// @dev Stores the data of a changed payment.
    function _storeChangedPayment(
        Payment storage storedPayment,
        Payment memory changedPayment,
        PaymentDetails memory newPaymentDetails
    ) internal {
        storedPayment.baseAmount = changedPayment.baseAmount;
        storedPayment.extraAmount = changedPayment.extraAmount;
        storedPayment.refundAmount = changedPayment.refundAmount;

        if (newPaymentDetails.confirmedAmount != changedPayment.confirmedAmount) {
            storedPayment.confirmedAmount = uint64(newPaymentDetails.confirmedAmount);
        }
    }

    /// @dev Updates statistics of all payments.
    function _updatePaymentStatistics(
        PaymentDetails memory oldPaymentDetails,
        PaymentDetails memory newPaymentDetails
    ) internal {
        // prettier-ignore
        int256 paymentRemainderChange =
            (int256(newPaymentDetails.payerRemainder) + int256(newPaymentDetails.sponsorRemainder)) -
            (int256(oldPaymentDetails.payerRemainder) + int256(oldPaymentDetails.sponsorRemainder));
        // prettier-ignore
        int256 paymentConfirmedAmountChange =
            int256(newPaymentDetails.confirmedAmount) - int256(oldPaymentDetails.confirmedAmount);

        int256 unconfirmedRemainderChange = paymentRemainderChange - paymentConfirmedAmountChange;

        // This is done to protect against possible overflow/underflow of the `totalUnconfirmedRemainder` variable
        if (unconfirmedRemainderChange >= 0) {
            _paymentStatistics.totalUnconfirmedRemainder += uint128(uint256(unconfirmedRemainderChange));
        } else {
            _paymentStatistics.totalUnconfirmedRemainder = uint128(
                uint256(_paymentStatistics.totalUnconfirmedRemainder) - uint256(-unconfirmedRemainderChange)
            );
        }
    }

    /// @dev Defines details of a payment.
    function _definePaymentDetails(
        Payment memory payment,
        PaymentRecalculationKind kind
    ) internal pure returns (PaymentDetails memory) {
        uint256 sumAmount;
        unchecked {
            sumAmount = uint256(payment.baseAmount) + uint256(payment.extraAmount);
        }
        (uint256 payerSumAmount, uint256 sponsorSumAmount) = _defineSumAmountParts(sumAmount, payment.subsidyLimit);
        uint256 sponsorRefund = _defineSponsorRefund(payment.refundAmount, payment.baseAmount, payment.subsidyLimit);
        uint256 payerRefund = uint256(payment.refundAmount) - sponsorRefund;
        uint256 confirmedAmount = payment.confirmedAmount;
        if (kind != PaymentRecalculationKind.None) {
            confirmedAmount = _defineNewConfirmedAmount(confirmedAmount, sumAmount - payment.refundAmount);
        }
        PaymentDetails memory details = PaymentDetails({
            confirmedAmount: confirmedAmount,
            payerSumAmount: payerSumAmount,
            sponsorSumAmount: sponsorSumAmount,
            payerRemainder: payerSumAmount - payerRefund,
            sponsorRemainder: sponsorSumAmount - sponsorRefund
        });
        return details;
    }

    /// @dev Defines the payer and sponsor parts of a payment sum amount according to a subsidy limit.
    function _defineSumAmountParts(
        uint256 paymentSumAmount,
        uint256 subsidyLimit
    ) internal pure returns (uint256 payerSumAmount, uint256 sponsorSumAmount) {
        if (subsidyLimit >= paymentSumAmount) {
            sponsorSumAmount = paymentSumAmount;
            payerSumAmount = 0;
        } else {
            sponsorSumAmount = subsidyLimit;
            payerSumAmount = paymentSumAmount - subsidyLimit;
        }
    }

    /// @dev Defines the sponsor refund amount according to a subsidy limit.
    function _defineSponsorRefund(
        uint256 refundAmount,
        uint256 baseAmount,
        uint256 subsidyLimit
    ) internal pure returns (uint256) {
        if (baseAmount > subsidyLimit) {
            refundAmount = (refundAmount * subsidyLimit) / baseAmount;
        }
        if (refundAmount > subsidyLimit) {
            refundAmount = subsidyLimit;
        }
        return refundAmount;
    }

    /// @dev Defines the new confirmed amount of a payment according to the old confirmed amount and the remainder.
    function _defineNewConfirmedAmount(
        uint256 oldConfirmedAmount,
        uint256 commonRemainder
    ) internal pure returns (uint256) {
        if (oldConfirmedAmount > commonRemainder) {
            return commonRemainder;
        } else {
            return oldConfirmedAmount;
        }
    }

    /// @dev Defines event flags according to the input parameters.
    function _defineEventFlags(address sponsor) internal pure returns (uint256) {
        uint256 eventFlags = 0;
        if (sponsor != address(0)) {
            eventFlags |= EVENT_ADDENDUM_FLAG_MASK_SPONSORED;
        }
        return eventFlags;
    }

    /// @dev Converts a Payment struct to a PaymentHookData struct
    function _convertPaymentToHookData(Payment storage payment) internal view returns (PaymentHookData memory) {
        return
            PaymentHookData({
                status: payment.status,
                payer: payment.payer,
                cashbackRate: payment.cashbackRate,
                confirmedAmount: payment.confirmedAmount,
                sponsor: payment.sponsor,
                subsidyLimit: payment.subsidyLimit,
                baseAmount: payment.baseAmount,
                extraAmount: payment.extraAmount,
                refundAmount: payment.refundAmount
            });
    }

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     * @param newImplementation The address of the new implementation.
     */
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try ICardPaymentProcessor(newImplementation).proveCardPaymentProcessor() {} catch {
            revert ImplementationAddressInvalid();
        }
    }

    // ------------------ Service functions ----------------------- //

    /**
     * @dev The version of the standard upgrade function without the second parameter for backward compatibility.
     * @custom:oz-upgrades-unsafe-allow-reachable delegatecall
     */
    function upgradeTo(address newImplementation) external {
        upgradeToAndCall(newImplementation, "");
    }
}
