// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { ICardPaymentProcessorTypes } from "../../interfaces/ICardPaymentProcessor.sol";

/**
 * @title ICardPaymentProcessorHookTypes
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Common types shared across payment processor hooks.
 */
interface ICardPaymentProcessorHookTypes {
    /**
     * @dev The data of a single payment for use in the hook functions.
     *
     * Fields:
     *
     * - status ----------- The current status of the payment.
     * - payer ------------ The account that made the payment.
     * - cashbackRate ----- The cashback rate in per mille.
     * - confirmedAmount -- The confirmed amount that was transferred to the cash-out account.
     * - sponsor ---------- The sponsor of the payment if it is subsidized. Otherwise the zero address.
     * - subsidyLimit ----- The subsidy limit of the payment if it is subsidized. Otherwise zero.
     * - baseAmount ------- The base amount of tokens in the payment.
     * - extraAmount ------ The extra amount of tokens in the payment, without a cashback.
     * - refundAmount ----- The total amount of all refunds related to the payment.
     */
    struct PaymentHookData {
        ICardPaymentProcessorTypes.PaymentStatus status;
        address payer;
        uint256 cashbackRate;
        uint256 confirmedAmount;
        address sponsor;
        uint256 subsidyLimit;
        uint256 baseAmount;
        uint256 extraAmount;
        uint256 refundAmount;
    }
}

/**
 * @title ICardPaymentProcessorHookable
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Interface for registering/unregistering hook contracts and describing hook dispatching.
 *
 * Hooks are method-specific callbacks. Each hook method is defined by a separate
 * interface in {ICardPaymentProcessorHooks} (e.g. {IAfterPaymentMadeHook},
 * {IAfterPaymentUpdatedHook}, {IAfterPaymentCanceledHook}). The set of allowed
 * values for `methodSelector` are the function selectors of these hook methods
 * (e.g. `IAfterPaymentMadeHook.afterPaymentMade.selector`).
 *
 * When a hook contract is registered for a given method selector, it will be
 * invoked by the processor whenever the corresponding lifecycle event occurs,
 * receiving the payment data snapshot(s). See the concrete hook interfaces in
 * {ICardPaymentProcessorHooks} for the exact payloads and invocation order.
 */
interface ICardPaymentProcessorHookable is ICardPaymentProcessorHookTypes {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when a hook contract is registered for a hook method.
     * @param hook The address of the hook contract.
     * @param methodSelector The hook method selector as defined in {ICardPaymentProcessorHooks}.
     */
    event HookRegistered(address indexed hook, bytes4 methodSelector);

    /**
     * @dev Emitted when a hook contract is unregistered from a hook method.
     * @param hook The address of the hook contract.
     * @param methodSelector The hook method selector as defined in {ICardPaymentProcessorHooks}.
     */
    event HookUnregistered(address indexed hook, bytes4 methodSelector);

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Registers and unregisters a hook by checking its supported hook methods.
     *
     * Supported methods are defined by interfaces in {ICardPaymentProcessorHooks}.
     * The hook contract should implement the relevant interface(s) so it can be
     * invoked for those method selectors.
     *
     * @param hookAddress The address of the hook contract to register.
     */
    function registerHook(address hookAddress) external;

    /**
     * @dev Unregisters a hook from all capabilities.
     *
     * Unregistering a hook may lead to problems with payments and any functionality around them.
     * Please be careful and verify that this is what you really want to do.
     * Any ongoing operations may become inconsistent and fail to complete in any way.
     * If you are sure, calculate the proof manually using the addresses of the contracts.
     *  keccak256("unregisterHook") ^ bytes32(uint256(uint160(hookAddress))) ^ bytes32(uint256(uint160(address(this))))
     *
     * @param hookAddress the address of the hook contract to unregister.
     * @param proof The proof of the unregistration.
     */
    function unregisterHook(address hookAddress, bytes32 proof) external;
}
