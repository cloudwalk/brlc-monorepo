// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

/**
 * @title CreditLineMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Mock of the `CreditLine` contract used for testing.
 */
contract CreditLineV2Mock {
    // ------------------ Storage --------------------------------- //

    /// @dev Flag to control whether onBeforeLoanOpened should revert.
    bool public revertOnBeforeLoanOpened;

    /// @dev Flag to control whether onAfterLoanClosed should revert.
    bool public revertOnAfterLoanClosed;

    // ------------------ Events ---------------------------------- //

    event MockLoanOpened(uint256 indexed firstSubLoanId, address indexed borrower, uint256 borrowedAmount);
    event MockLoanClosed(uint256 indexed firstSubLoanId, address indexed borrower, uint256 borrowedAmount);

    // ------------------ Errors ---------------------------------- //

    /// @dev Thrown when the onBeforeLoanOpened hook is set to revert.
    error CreditLineV2Mock_OnBeforeLoanOpenedReverted();

    /// @dev Thrown when the onAfterLoanClosed hook is set to revert.
    error CreditLineV2Mock_onAfterLoanClosedReverted();

    // ------------------ Hook functions -------------------------- //

    /**
     * @dev Hook that is triggered before a loan is opened or reopened.
     * @param firstSubLoanId The ID of the first sub-loan of the loan.
     * @param borrower The address of the borrower.
     * @param borrowedAmount The borrowed amount of the loan.
     */
    function onBeforeLoanOpened(uint256 firstSubLoanId, address borrower, uint256 borrowedAmount) external {
        if (revertOnBeforeLoanOpened) {
            revert CreditLineV2Mock_OnBeforeLoanOpenedReverted();
        }

        emit MockLoanOpened(firstSubLoanId, borrower, borrowedAmount);
    }

    /**
     * @dev Hook that is triggered after a loan is closed.
     * @param firstSubLoanId The ID of the first sub-loan of the loan.
     * @param borrower The address of the borrower.
     * @param borrowedAmount The borrowed amount of the loan.
     */
    function onAfterLoanClosed(uint256 firstSubLoanId, address borrower, uint256 borrowedAmount) external {
        if (revertOnAfterLoanClosed) {
            revert CreditLineV2Mock_onAfterLoanClosedReverted();
        }

        emit MockLoanClosed(firstSubLoanId, borrower, borrowedAmount);
    }

    // ------------------ Mock control functions ------------------ //

    /**
     * @dev Sets whether onBeforeLoanOpened should revert.
     * @param shouldRevert True to make the hook revert, false otherwise.
     */
    function setRevertOnBeforeLoanOpened(bool shouldRevert) external {
        revertOnBeforeLoanOpened = shouldRevert;
    }

    /**
     * @dev Sets whether onAfterLoanClosed should revert.
     * @param shouldRevert True to make the hook revert, false otherwise.
     */
    function setRevertOnAfterLoanClosed(bool shouldRevert) external {
        revertOnAfterLoanClosed = shouldRevert;
    }

    // ------------------ Pure functions -------------------------- //

    /**
     * @dev Proves the contract is a credit line. A marker function.
     */
    function proveCreditLineV2() external pure {}
}
