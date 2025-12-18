// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { CreditAgent } from "../CreditAgent.sol";

import { LendingMarketMock } from "./LendingMarketMock.sol";

/**
 * @title CreditAgentMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Mock wrapper contract for credit operations.
 *
 * This is a simple implementation of the CreditAgent contract for testing purposes.
 * It does not have any specific lending market contract interactions and used to deploy abstract CreditAgent contract.
 *
 * @custom:oz-upgrades-unsafe-allow missing-initializer
 */
contract CreditAgentMock is CreditAgent {
    /// @dev close to the original implementation of verification mechanism for lending market contract.
    function _validateLendingMarket(address lendingMarket) internal view override returns (bool) {
        _validateUpgrade(address(this)); // calling that only to provide coverage to that function
        try LendingMarketMock(lendingMarket).proveLendingMarket() {
            return true;
        } catch {
            return false;
        }
    }

    function createCreditRequest(
        bytes32 txId,
        address account,
        uint256 cashOutAmount,
        bytes4 loanTakingSelector,
        bytes4 loanRevocationSelector,
        bytes memory loanTakingData
    ) external {
        _createCreditRequest(txId, account, cashOutAmount, loanTakingSelector, loanRevocationSelector, loanTakingData);
    }

    function _validateUpgrade(address newImplementation) internal view override {}
}
