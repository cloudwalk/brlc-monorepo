// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { ICardPaymentProcessorHookTypes } from "./ICardPaymentProcesorHookable.sol";

/**
 * @title ICardPaymentProcessorHook
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The interface for the card payment processor hook.
 */
interface ICardPaymentProcessorHook is ICardPaymentProcessorHookTypes {
    /**
     * @dev Returns true if the hook supports the given method selector.
     *
     * May revert if hook has some validation of the caller.
     *
     * @param methodSelector The method selector to check.
     * @return True if the hook supports the given method selector, false otherwise.
     */
    function supportsHookMethod(bytes4 methodSelector) external view returns (bool);
}

/**
 * @title IAfterPaymentMadeHook
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The interface for the 'afterPaymentMade' hook.
 */
interface IAfterPaymentMadeHook is ICardPaymentProcessorHook {
    function afterPaymentMade(
        bytes32 paymentId,
        PaymentHookData calldata oldPayment,
        PaymentHookData calldata newPayment
    ) external;
}

/**
 * @title IAfterPaymentUpdatedHook
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The interface for the 'afterPaymentUpdated' hook.
 */
interface IAfterPaymentUpdatedHook is ICardPaymentProcessorHook {
    function afterPaymentUpdated(
        bytes32 paymentId,
        PaymentHookData calldata oldPayment,
        PaymentHookData calldata newPayment
    ) external;
}

/**
 * @title IAfterPaymentCanceledHook
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The interface for the 'afterPaymentCanceled' hook.
 */
interface IAfterPaymentCanceledHook is ICardPaymentProcessorHook {
    function afterPaymentCanceled(
        bytes32 paymentId,
        PaymentHookData calldata oldPayment,
        PaymentHookData calldata newPayment
    ) external;
}
