// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title LendingMarketMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev A simplified version of a lending market contract to use in tests for other contracts.
 */
contract LendingMarketMock {
    bool private _compatible = true;
    // ------------------ Constants ------------------------------- //

    /// @dev A constant value to return as a fake loan identifier.
    uint256 public constant LOAN_ID_STAB = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFDE;

    /// @dev A constant value to return as a fake installment loan count.
    uint256 public constant INSTALLMENT_COUNT_STAB = 12;

    // ------------------ Events ---------------------------------- //

    /// @dev Emitted when the `takeLoanFor()` function is called with the parameters of the function.
    event MockTakeLoanForCalled(
        address borrower,
        uint256 programId,
        uint256 borrowAmount,
        uint256 addonAmount,
        uint256 durationInPeriods
    );

    /// @dev Emitted when the `takeInstallmentLoan()` function is called with the parameters of the function.
    event MockTakeInstallmentLoanCalled(
        address borrower,
        uint256 programId,
        uint256[] borrowAmounts,
        uint256[] addonAmounts,
        uint256[] durationsInPeriods,
        uint256[] penaltyInterestRates
    );

    /// @dev Emitted when the `revokeLoan()` function is called with the parameters of the function.
    event MockRevokeLoanCalled(uint256 loanId);

    /// @dev Emitted when the `revokeInstallmentLoan()` function is called with the parameters of the function.
    event MockRevokeInstallmentLoanCalled(uint256 loanId);

    // ------------------ Errors ---------------------------------- //

    /// @dev Emitted when the `failExecution()` function is called.
    error LendingMarketMock_Fail(uint256 someId);

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Imitates the same-name function of a lending market contract.
     *      Just emits an event about the call and returns a constant.
     */
    function takeLoanFor(
        address borrower, // Tools: prevent Prettier one-liner
        uint32 programId,
        uint256 borrowAmount,
        uint256 addonAmount,
        uint256 durationInPeriods
    ) external returns (uint256) {
        emit MockTakeLoanForCalled(
            borrower, // Tools: prevent Prettier one-liner
            programId,
            borrowAmount,
            addonAmount,
            durationInPeriods
        );
        return LOAN_ID_STAB;
    }

    /**
     * @dev Imitates the same-name function of a lending market contract.
     *      Just emits an event about the call and returns a constant.
     */
    function takeInstallmentLoan(
        address borrower, // Tools: prevent Prettier one-liner
        uint32 programId,
        uint256[] memory borrowedAmounts,
        uint256[] memory addonAmounts,
        uint256[] memory durationsInPeriods,
        uint256[] memory penaltyInterestRates
    ) external returns (uint256, uint256) {
        emit MockTakeInstallmentLoanCalled(
            borrower, // Tools: prevent Prettier one-liner
            programId,
            borrowedAmounts,
            addonAmounts,
            durationsInPeriods,
            penaltyInterestRates
        );
        return (LOAN_ID_STAB, INSTALLMENT_COUNT_STAB);
    }

    /// @dev Imitates the same-name function of a lending market contract. Just emits an event about the call.
    function revokeLoan(uint256 loanId) external {
        emit MockRevokeLoanCalled(loanId);
    }

    /// @dev Imitates the same-name function of a lending market contract. Just emits an event about the call.
    function revokeInstallmentLoan(uint256 loanId) external {
        emit MockRevokeInstallmentLoanCalled(loanId);
    }

    /// @dev Proves that the contract is a lending market contract if it is compatible state.
    function proveLendingMarket() external view {
        require(_compatible);
    }

    /// @dev Sets the compatible state of the contract.
    function setCompatible(bool compatible) external {
        _compatible = compatible;
    }

    function failExecution(uint256 someId) external pure {
        revert LendingMarketMock_Fail(someId);
    }
}
