// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { ICreditLineV1 } from "../interfaces/ICreditLineV1.sol";

/**
 * @title CreditLineV1Mock contract
 * @author CloudWalk Inc.
 * @dev Mock implementation of the `ICreditLineV1` interface used for testing.
 */
contract CreditLineV1Mock is ICreditLineV1 {
    // ------------------ Storage --------------------------------- //

    /// @dev Mapping of borrower address to their state.
    mapping(address borrower => BorrowerState) private _borrowerStates;

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Sets the state of a borrower.
     * @param borrower The address of the borrower.
     * @param state The state to set for the borrower.
     */
    function setBorrowerState(address borrower, BorrowerState calldata state) external {
        _borrowerStates[borrower] = state;
    }

    /**
     * @inheritdoc ICreditLineV1
     */
    function getBorrowerState(address borrower) external view returns (BorrowerState memory) {
        return _borrowerStates[borrower];
    }

    // ------------------ Pure functions -------------------------- //

    /**
     * @inheritdoc ICreditLineV1
     */
    function proveCreditLine() external pure {}
}
