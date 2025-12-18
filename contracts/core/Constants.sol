// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

/**
 * @title Constants library
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the constants used across the contracts.
 */
abstract contract Constants {
    /**
     * @dev The rate factor used for the interest rate calculations.
     *
     * Exposed via the `interestRateFactor()` function.
     */
    uint256 internal constant INTEREST_RATE_FACTOR = 10 ** 9;

    /**
     * @dev The accuracy factor used for loan amounts rounding.
     *
     * E.g. a value of `10000` means rounding to the nearest `0.01` in case of BRLC.
     * Exposed via the `accuracyFactor()` function.
     */
    uint256 internal constant ACCURACY_FACTOR = 10000;

    /**
     * @dev The maximum number of sub-loan for a loan.
     *
     * Must fit in `uint16`.
     * Exposed via the `subLoanCountMax()` function.
     */
    uint256 internal constant SUB_LOAN_COUNT_MAX = uint16(180);

    /**
     * @dev The maximum number of operations for a sub-loan.
     *
     * Must fit in `uint16`.
     * Exposed via the `operationCountMax()` function.
     */
    uint256 internal constant OPERATION_COUNT_MAX = uint16(10000);

    /**
     * @dev The negative time offset in seconds that is used to calculate the day boundary for the lending market.
     *
     * Must fit in `uint128`.
     * Exposed via `dayBoundaryOffset()`.
     */
    uint256 internal constant NEGATIVE_DAY_BOUNDARY_OFFSET = uint128(3 hours);

    /// @dev The start value for the auto-generated sub-loan ID.
    uint256 internal constant SUB_LOAN_AUTO_ID_START = 10_000_000;

    /// @dev The flag to ignore the grace period.
    uint256 internal constant SUB_LOAN_FLAG_IGNORE_GRACE_PERIOD = (1 << 0);

    /// @dev The special account ID of an operation corresponding to the borrower of the sub-loan.
    uint256 internal constant ACCOUNT_ID_BORROWER = type(uint64).max;
}
