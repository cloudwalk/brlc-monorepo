// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { LendingMarketV2StorageLayout } from "../storage/LendingMarketV2StorageLayout.sol";

import { AddressBook } from "../libraries/AddressBook.sol";
import { Constants } from "./Constants.sol";

import { ILendingMarketV2Errors } from "../interfaces/ILendingMarketV2.sol";
import { ILendingMarketV2PrimaryEvents } from "../interfaces/ILendingMarketV2.sol";

/**
 * @title LendingMarketCore contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Contains storage and other code entities used both in the credit market contract and in its engine.
 */
abstract contract LendingMarketV2Core is
    LendingMarketV2StorageLayout,
    Constants,
    ILendingMarketV2PrimaryEvents,
    ILendingMarketV2Errors
{
    // ------------------ Types ----------------------------------- //

    using AddressBook for AddressBook.Table;

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Gets the account related to an operation.
     */
    function _getOperationAccount(
        SubLoan storage subLoan,
        Operation storage operation
    ) internal view returns (address) {
        uint256 accountId = operation.accountId;
        if (accountId == ACCOUNT_ID_BORROWER) {
            return subLoan.inception.borrower;
        }
        return _getLendingMarketStorage().accountAddressBook.getAccount(accountId);
    }

    /**
     * @dev Calculates the day index that corresponds the specified timestamp.
     */
    function _dayIndex(uint256 timestamp) internal pure returns (uint256) {
        if (timestamp < NEGATIVE_DAY_BOUNDARY_OFFSET) {
            return 0;
        }
        unchecked {
            return (timestamp - NEGATIVE_DAY_BOUNDARY_OFFSET) / 1 days;
        }
    }

    /**
     * @dev Rounds a value to the nearest multiple of the accuracy factor according to mathematical rules.
     */
    function _roundMath(uint256 value) internal pure returns (uint256) {
        return ((value + ACCURACY_FACTOR / 2) / ACCURACY_FACTOR) * ACCURACY_FACTOR;
    }
}
