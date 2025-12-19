// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

/**
 * @title ICreditLineV2Types interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines types that are used in the credit line contract.
 */
interface ICreditLineV2Types {
    /**
     * @dev Defines the available borrowing policies.
     *
     * Possible values:
     *
     * - Prohibited = 0 -------------- No loans are allowed. The default value.
     * - SingleActiveLoan = 1 -------- Only one active loan is allowed, additional loan requests are rejected.
     * - TotalActiveAmountLimit = 2 -- Multiple active loans are allowed, but their total borrowed amount cannot
     *                                 exceed the maximum borrowed amount specified for the borrower.
     * - UnlimitedActiveLoans = 3 ---- Multiple active loans are allowed, with no limit on the total borrowed amount.
     *
     * Notes:
     *
     * 1. In all cases, each individual loan must comply with the maximum amount limit.
     * 2. A loan can include several sub-loans. It does not matter for the credit line contract.
     */
    enum BorrowingPolicy {
        Prohibited,
        SingleActiveLoan,
        TotalActiveAmountLimit,
        UnlimitedActiveLoans
    }

    /**
     * @dev A struct that defines borrower configuration.
     *
     * Fields:
     *
     * - borrowingPolicy ---- The borrowing policy to be applied to the borrower.
     * - maxBorrowedAmount -- The maximum amount of tokens the borrower can take as a loan or several ones.
     *
     * See notes for the {BorrowingPolicy} enum.
     */
    struct BorrowerConfig {
        // Slot 1
        BorrowingPolicy borrowingPolicy;
        uint64 maxBorrowedAmount;
        // uint184 __reserved; // Reserved until the end of the storage slot.
    }

    /**
     * @dev Defines a borrower state.
     *
     * Fields:
     *
     * - activeLoanCount -------- the number of active loans currently held by the borrower.
     * - closedLoanCount -------- the number of loans that have been closed, with or without a full repayment.
     * - totalActiveLoanAmount -- the total amount borrowed across all active loans.
     * - totalClosedLoanAmount -- the total amount that was borrowed across all closed loans.
     *
     * See notes for the {BorrowingPolicy} enum.
     */
    struct BorrowerState {
        // Slot 1
        uint16 activeLoanCount;
        uint16 closedLoanCount;
        uint64 totalActiveLoanAmount;
        uint64 totalClosedLoanAmount;
        // uint96 __reserved; // Reserved until the end of the storage slot.
    }

    /**
     * @dev Defines the view of a borrower configuration.
     *
     * This struct is used as the return type of the appropriate view functions.
     *
     * Fields:
     *
     * - borrowingPolicy ---- The borrowing policy to be applied to the borrower.
     * - maxBorrowedAmount -- The maximum amount of tokens the borrower can take as a loan or several ones.
     *
     * See notes for the {BorrowingPolicy} enum.
     */
    struct BorrowerConfigView {
        BorrowingPolicy borrowingPolicy;
        uint256 maxBorrowedAmount;
    }

    /**
     * @dev Defines the view of a borrower state.
     *
     * This struct is used as the return type of the appropriate view functions.
     *
     * Fields:
     *
     * - activeLoanCount -------- the number of active loans currently held by the borrower.
     * - closedLoanCount -------- the number of loans that have been closed, with or without a full repayment.
     * - totalActiveLoanAmount -- the total amount borrowed across all active loans.
     * - totalClosedLoanAmount -- the total amount that was borrowed across all closed loans.
     *
     * See notes for the {BorrowingPolicy} enum.
     */
    struct BorrowerStateView {
        uint256 activeLoanCount;
        uint256 closedLoanCount;
        uint256 totalActiveLoanAmount;
        uint256 totalClosedLoanAmount;
    }
}

/**
 * @title ICreditLineV2Primary interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary part of the credit line contract interface.
 */
interface ICreditLineV2Primary is ICreditLineV2Types {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when a borrower is configured.
     *
     * See notes for the {BorrowingPolicy} enum.
     *
     * @param borrower The address of the borrower being configured.
     * @param borrowingPolicy The borrowing policy assigned to the borrower.
     * @param maxBorrowedAmount The maximum amount of tokens the borrower can take as a loan or several ones.
     */
    event BorrowerConfigured(
        address indexed borrower, // Tools: prevent Prettier one-liner
        BorrowingPolicy borrowingPolicy,
        uint256 maxBorrowedAmount
    );

    /**
     * @dev Emitted when a loan is opened.
     *
     * @param firstSubLoanId The ID of the first sub-loan within the loan.
     * @param borrower The address of the borrower.
     * @param borrowedAmount The amount of tokens borrowed for the loan.
     */
    event LoanOpened(
        uint256 indexed firstSubLoanId, // Tools: prevent Prettier one-liner
        address indexed borrower,
        uint256 borrowedAmount
    );

    /**
     * @dev Emitted when a loan is closed.
     *
     * @param firstSubLoanId The ID of the first sub-loan within the loan.
     * @param borrower The address of the borrower.
     * @param borrowedAmount The amount of tokens borrowed for the loan.
     */
    event LoanClosed(
        uint256 indexed firstSubLoanId, // Tools: prevent Prettier one-liner
        address indexed borrower,
        uint256 borrowedAmount
    );

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Configures a borrower.
     *
     * Can only be called by accounts with the admin role.
     *
     * Emits a {BorrowerConfigured} event.
     *
     * See notes for the {BorrowingPolicy} enum.
     *
     * @param borrower The address of the borrower to configure.
     * @param borrowingPolicy The the borrowing police to be applied to the borrower.
     * @param maxBorrowedAmount The the maximum amount of tokens the borrower can take as loans.
     */
    function configureBorrower(
        address borrower, // Tools: prevent Prettier one-liner
        BorrowingPolicy borrowingPolicy,
        uint256 maxBorrowedAmount
    ) external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Retrieves the configuration of a borrower.
     *
     * See notes for the {BorrowingPolicy} enum.
     *
     * @param borrower The address of the borrower to check.
     * @return The structure containing the borrower configuration.
     */
    function getBorrowerConfiguration(address borrower) external view returns (BorrowerConfigView memory);

    /**
     * @dev Retrieves the state of a borrower combined from the current credit line and the linked credit line if any.
     *
     * See notes for the {BorrowingPolicy} enum.
     *
     * @param borrower The address of the borrower to check.
     * @return The structure containing the borrower state.
     */
    function getBorrowerState(address borrower) external view returns (BorrowerStateView memory);
}

/**
 * @title ICreditLineV2Configuration interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The configuration part of the credit line contract interface.
 */
interface ICreditLineV2Configuration is ICreditLineV2Types {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when the linked credit line is changed.
     *
     * See notes about the linked credit line in the {ICreditLineV2} interface.
     *
     * @param newLinkedCreditLine The address of the new linked credit line.
     * @param oldLinkedCreditLine The address of the old linked credit line.
     */
    event LinkedCreditLineChanged(
        address newLinkedCreditLine, // Tools: prevent Prettier one-liner
        address oldLinkedCreditLine
    );

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Sets the linked credit line.
     *
     * See notes about the linked credit line in the {ICreditLineV2} interface.
     *
     * Can only be called by accounts with the owner role.
     *
     * Emits a {LinkedCreditLineChanged} event.
     *
     * @param newLinkedCreditLine The address of the new linked credit line to set.
     */
    function setLinkedCreditLine(address newLinkedCreditLine) external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Retrieves the address of the linked credit line.
     *
     * See notes about the linked credit line in the {ICreditLineV2} interface.
     *
     * @return The address of the linked credit line.
     */
    function linkedCreditLine() external returns (address);
}

/**
 * @title ICreditLineV2Hooks interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The hooks part of the credit line contract interface.
 */
interface ICreditLineV2Hooks {
    /**
     * @dev A hook that is triggered by a loan operator before a loan is opened or reopened
     *
     * See notes for the {BorrowingPolicy} enum.
     *
     * @param firstSubLoanId The ID of the first sub-loan of the loan being opened or reopened.
     * @param borrower The address of the borrower.
     * @param borrowedAmount The borrowed amount of the loan.
     */
    function onBeforeLoanOpened(uint256 firstSubLoanId, address borrower, uint256 borrowedAmount) external;

    /**
     * @dev A hook that is triggered by a loan operator after a loan is closed due to full repayment or revocation.
     *
     * See notes for the {BorrowingPolicy} enum.
     *
     * @param firstSubLoanId The ID of the first sub-loan of the loan being closed.
     * @param borrower The address of the borrower.
     * @param borrowedAmount The borrowed amount of the loan.
     */
    function onAfterLoanClosed(uint256 firstSubLoanId, address borrower, uint256 borrowedAmount) external;
}

/**
 * @title ICreditLineV2Errors interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the custom errors used in the credit line contract.
 */
interface ICreditLineV2Errors {
    /// @dev Thrown when the provided linked credit line address is the same as the current one.
    error CreditLineV2_LinkedCreditLineUnchanged();

    /// @dev Thrown when the provided linked credit line address is not a contract (code.length == 0).
    error CreditLineV2_LinkedCreditLineNotContract();

    /**
     * @dev Thrown when the provided linked credit line address is invalid.
     *
     * E.g., the contract does not implement the needed proof function.
     */
    error CreditLineV2_LinkedCreditLineContractInvalid();

    /// @dev Thrown when the provided borrower address is zero.
    error CreditLineV2_BorrowerAddressZero();

    /**
     * @dev Thrown when the provided maximum borrowed amount exceeds the maximum allowed value.
     *
     * E.g., the amount is greater than or equal to uint64.max.
     */
    error CreditLineV2_MaxBorrowedAmountExcess();

    /**
     * @dev Thrown when a loan is requested but loans are prohibited for that borrower.
     *
     * E.g., the borrower's borrowing policy is set to Prohibited.
     */
    error CreditLineV2_LoansProhibited();

    /**
     * @dev Thrown when another loan is requested for a borrower but only one active loan is allowed.
     *
     * E.g., the borrower's borrowing policy is set to SingleActiveLoan and they already have an active loan.
     */
    error CreditLineV2_LimitViolationOnSingleActiveLoan();

    /**
     * @dev Thrown when the total borrowed amount of active loans exceeds the maximum borrowed amount.
     *
     * E.g., the borrower's borrowing policy is set to TotalActiveAmountLimit and the new total would exceed
     *      the maximum allowed amount.
     */
    error CreditLoneV2_LimitViolationOnTotalActiveLoanAmount(
        uint256 newTotalActiveLoanAmount,
        uint256 maxBorrowedAmount
    );

    /**
     * @dev Thrown when the borrower state counters or amounts would overflow their maximum values.
     *
     * E.g., activeLoanCount or closedLoanCount would exceed uint16.max, or totalActiveLoanAmount or
     *      totalClosedLoanAmount would exceed uint64.max.
     */
    error CreditLineV2_BorrowerStateOverflow();

    /**
     * @dev Thrown when the credit line implementation address is invalid.
     *
     * E.g., the contract does not implement the needed proof function.
     */
    error CreditLineV2_ImplementationAddressInvalid();
}

/**
 * @title ICreditLineV2 interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the full interface of the credit line contract.
 *
 * There is the mechanism of the linked credit line to consider a borrower's state on another credit line.
 * If the linked credit line is set, then the state of a borrower is the union of the state in the current contract and the linked contract.
 * For now, only the Capybara Finance V1 credit line contract is supported as the linked credit line. It is expected to use during the migration from V1 to V2.
 */
interface ICreditLineV2 is ICreditLineV2Primary, ICreditLineV2Configuration, ICreditLineV2Hooks, ICreditLineV2Errors {
    /// @dev Proves the contract is the credit line one. A marker function.
    function proveCreditLineV2() external pure;
}
