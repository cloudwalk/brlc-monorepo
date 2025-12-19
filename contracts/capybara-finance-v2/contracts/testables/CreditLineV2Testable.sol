// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { CreditLineV2 } from "../CreditLineV2.sol";

/**
 * @title CreditLineV2Testable contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The version of the credit line contract with additions required for testing.
 * @custom:oz-upgrades-unsafe-allow missing-initializer
 */
contract CreditLineV2Testable is CreditLineV2 {
    /**
     * @dev Sets the state of a borrower.
     * @param borrower The address of the borrower.
     * @param state The state of the borrower.
     */
    function setBorrowerState(address borrower, BorrowerState calldata state) external {
        _getCreditLineStorage().borrowerStates[borrower] = state;
    }
}
