// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { ICardPaymentProcessorTypes } from "./interfaces/ICardPaymentProcessor.sol";

/**
 * @title CardPaymentProcessor storage version 1
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 */
abstract contract CardPaymentProcessorStorageV1 is ICardPaymentProcessorTypes {
    /// @dev The address of the underlying token.
    address internal _token;

    /// @dev The default cashback rate for new payments in per mille.
    uint16 internal _defaultCashbackRate;

    /// @dev The account to transfer confirmed tokens to.
    address internal _cashOutAccount;

    /// @dev The mapping of a payment for a given payment ID.
    mapping(bytes32 => Payment) internal _payments;

    /// @dev The payment statistics.
    PaymentStatistics internal _paymentStatistics;
}

/**
 * @title CardPaymentProcessor cumulative storage
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Contains storage variables of the {CardPaymentProcessor} contract.
 *
 * When we need to add new storage variables, we create a new version of CardPaymentProcessorStorage
 * e.g. CardPaymentProcessorStorage<versionNumber>, so finally it would look like
 * "contract CardPaymentProcessorStorage is CardPaymentProcessorStorageV1, CardPaymentProcessorStorageV2".
 */
abstract contract CardPaymentProcessorStorage is CardPaymentProcessorStorageV1 {
    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     */
    uint256[45] private __gap;
}
