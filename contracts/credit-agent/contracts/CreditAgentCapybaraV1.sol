// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { CreditAgent } from "./CreditAgent.sol";

import { ICreditAgentCapybaraV1, ICreditAgentCapybaraV1Primary } from "./interfaces/ICreditAgentCapybaraV1.sol";

import { ILendingMarketCapybaraV1 } from "./interfaces/ILendingMarketCapybaraV1.sol";

/**
 * @title CreditAgentCapybaraV1 contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Wrapper contract for credit operations of the capybara finance V1 protocol.
 *
 * This contract is a specific implementation of the CreditAgent contract
 * that creates correct CreditRequest using the Capybara Finance V1 lending market interface.
 *
 * It validates input parameters and creates CreditRequest using the correct selectors and data.
 *
 * @custom:oz-upgrades-unsafe-allow missing-initializer
 */
contract CreditAgentCapybaraV1 is CreditAgent, ICreditAgentCapybaraV1 {
    using SafeCast for uint256;

    /**
     * @inheritdoc ICreditAgentCapybaraV1Primary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {MANAGER_ROLE} role.
     * - The contract must be configured.
     * - The provided `txId` must not be used for any other credit.
     * - The provided `txId`, `borrower`, `programId`, `durationInPeriods`, `loanAmount` must not be zeros.
     * - The credit with the provided `txId` must have the `Nonexistent` or `Reversed` status.
     */
    function initiateOrdinaryCredit(
        bytes32 txId, // Tools: prevent Prettier one-liner
        address borrower,
        uint256 programId,
        uint256 durationInPeriods,
        uint256 loanAmount,
        uint256 loanAddon
    ) external whenNotPaused onlyRole(MANAGER_ROLE) {
        if (programId == 0) {
            revert CreditAgentCapybaraV1_ProgramIdZero();
        }
        _validateSubLoanParams(durationInPeriods, loanAmount, loanAddon);

        _createCreditRequest(
            txId,
            borrower,
            loanAmount,
            ILendingMarketCapybaraV1.takeLoanFor.selector,
            ILendingMarketCapybaraV1.revokeLoan.selector,
            abi.encode(borrower, programId.toUint32(), loanAmount, loanAddon, durationInPeriods)
        );
    }

    /**
     * @inheritdoc ICreditAgentCapybaraV1Primary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {MANAGER_ROLE} role.
     * - The contract must be configured.
     * - The provided `txId` must not be used for any other credit.
     * - The provided `txId`, `borrower`, `programId` must not be zeros.
     * - The provided `durationsInPeriods`, `borrowAmounts`, `addonAmounts` arrays must have the same length.
     * - The provided `durationsInPeriods` and `borrowAmounts` arrays must contain only non-zero values.
     * - The credit with the provided `txId` must have the `Nonexistent` or `Reversed` status.
     */
    function initiateInstallmentCredit(
        bytes32 txId, // Tools: prevent Prettier one-liner
        address borrower,
        uint256 programId,
        uint256[] calldata durationsInPeriods,
        uint256[] calldata borrowAmounts,
        uint256[] calldata addonAmounts,
        uint256[] calldata penaltyInterestRates
    ) external whenNotPaused onlyRole(MANAGER_ROLE) {
        if (programId == 0) {
            revert CreditAgentCapybaraV1_ProgramIdZero();
        }
        if (
            durationsInPeriods.length == 0 ||
            durationsInPeriods.length != borrowAmounts.length ||
            durationsInPeriods.length != addonAmounts.length ||
            durationsInPeriods.length != penaltyInterestRates.length
        ) {
            revert CreditAgentCapybaraV1_InputArraysInvalid();
        }
        for (uint256 i = 0; i < borrowAmounts.length; i++) {
            _validateSubLoanParams(durationsInPeriods[i], borrowAmounts[i], addonAmounts[i]);
            penaltyInterestRates[i].toUint32();
        }

        _createCreditRequest(
            txId,
            borrower,
            _sumArray(borrowAmounts),
            ILendingMarketCapybaraV1.takeInstallmentLoan.selector,
            ILendingMarketCapybaraV1.revokeInstallmentLoan.selector,
            abi.encode(
                borrower,
                programId.toUint32(),
                borrowAmounts,
                addonAmounts,
                durationsInPeriods,
                penaltyInterestRates
            )
        );
    }

    /**
     * @inheritdoc ICreditAgentCapybaraV1Primary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {MANAGER_ROLE} role.
     * - The provided `txId` must not be zero.
     * - The credit with the provided `txId` must have the `Initiated` or `Expired` status.
     */
    function revokeOrdinaryCredit(bytes32 txId) external whenNotPaused onlyRole(MANAGER_ROLE) {
        _removeCreditRequest(txId);
    }

    /**
     * @inheritdoc ICreditAgentCapybaraV1Primary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {MANAGER_ROLE} role.
     * - The provided `txId` must not be zero.
     * - The credit with the provided `txId` must have the `Initiated` or `Expired` status.
     */
    function revokeInstallmentCredit(bytes32 txId) external whenNotPaused onlyRole(MANAGER_ROLE) {
        _removeCreditRequest(txId);
    }

    /**
     * @inheritdoc ICreditAgentCapybaraV1Primary
     */
    function getOrdinaryCredit(bytes32 txId) external view returns (OrdinaryCredit memory result) {
        CreditAgentStorage storage $ = _getCreditAgentStorage();
        CreditRequest storage creditRequest = $.creditRequests[txId];
        if (creditRequest.loanTakingData.length != 0) {
            (
                address borrower,
                uint256 programId,
                uint256 loanAmount,
                uint256 loanAddon,
                uint256 durationInPeriods
            ) = abi.decode(creditRequest.loanTakingData, (address, uint32, uint256, uint256, uint256));
            result = OrdinaryCredit(
                _getCreditRequestStatus(creditRequest),
                borrower,
                programId,
                durationInPeriods,
                loanAmount,
                loanAddon,
                creditRequest.loanId,
                creditRequest.deadline
            );
        }
        // else empty object
    }

    /**
     * @inheritdoc ICreditAgentCapybaraV1Primary
     */
    function getInstallmentCredit(bytes32 txId) external view returns (InstallmentCredit memory result) {
        CreditAgentStorage storage $ = _getCreditAgentStorage();
        CreditRequest storage creditRequest = $.creditRequests[txId];
        if (creditRequest.loanTakingData.length != 0) {
            (
                address borrower,
                uint256 programId,
                uint256[] memory borrowAmounts,
                uint256[] memory addonAmounts,
                uint256[] memory durationsInPeriods,
                uint256[] memory penaltyInterestRates
            ) = abi.decode(
                    creditRequest.loanTakingData,
                    (address, uint256, uint256[], uint256[], uint256[], uint256[])
                );
            result = InstallmentCredit(
                _getCreditRequestStatus(creditRequest),
                borrower,
                programId,
                durationsInPeriods,
                borrowAmounts,
                addonAmounts,
                penaltyInterestRates,
                creditRequest.loanId,
                creditRequest.deadline
            );
        }
        // else empty object
    }

    // ------------------ Pure functions -------------------------- //

    /**
     * @inheritdoc ICreditAgentCapybaraV1
     */
    function proveCreditAgentCapybaraV1() external pure {}

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     * @param newImplementation The address of the new implementation.
     */
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try ICreditAgentCapybaraV1(newImplementation).proveCreditAgentCapybaraV1() {} catch {
            revert CreditAgentCapybaraV1_ImplementationAddressInvalid();
        }
    }

    /**
     * @inheritdoc CreditAgent
     *
     * @dev Requirements:
     *
     * - The provided `lendingMarket` must be a valid Capybara Finance V1 lending market contract.
     */
    function _validateLendingMarket(address lendingMarket) internal pure override returns (bool) {
        try ILendingMarketCapybaraV1(lendingMarket).proveLendingMarket() {
            return true;
        } catch {
            return false;
        }
    }

    /// @dev Validates and downcasts subLoan parameters.
    function _validateSubLoanParams(uint256 durationInPeriods, uint256 loanAmount, uint256 loanAddon) internal pure {
        if (durationInPeriods == 0) {
            revert CreditAgentCapybaraV1_LoanDurationZero();
        }
        if (loanAmount == 0) {
            revert CreditAgentCapybaraV1_LoanAmountZero();
        }

        loanAmount.toUint64();
        loanAddon.toUint64();
        durationInPeriods.toUint32();
    }

    /// @dev Calculates the sum of all elements in a memory array.
    /// @param values Array of amounts to sum.
    /// @return The total sum of all array elements.
    function _sumArray(uint256[] memory values) internal pure returns (uint256) {
        uint256 len = values.length;
        uint256 sum = 0;
        for (uint256 i = 0; i < len; ++i) {
            sum += values[i];
        }
        return sum;
    }
}
