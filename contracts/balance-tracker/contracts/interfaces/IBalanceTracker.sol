// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title IBalanceTrackerPrimary interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary interface of the contract that tracks token balances for each account on a daily basis.
 */
interface IBalanceTrackerPrimary {
    // ------------------ Types ----------------------------------- //

    /**
     * @dev The day-value pair.
     * @param day The index of the day.
     * @param value The value associated with the day.
     */
    struct Record {
        uint16 day;
        uint240 value;
    }

    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when a new balance record is created.
     * @param account The address of the account.
     * @param day The index of the day.
     * @param balance The balance associated with the day.
     */
    event BalanceRecordCreated(address indexed account, uint16 day, uint240 balance);

    // ------------------ View functions -------------------------- //

    /**
     * @dev Reads the balance record array.
     * @param index The index of the record to read.
     * @return The record at the specified index and the length of array.
     */
    function readBalanceRecord(address account, uint256 index) external view returns (Record memory, uint256);

    /**
     * @dev Returns the daily balances for the specified account and period.
     * @param account The address of the account to get the balances for.
     * @param fromDay The index of the first day of the period.
     * @param toDay The index of the last day of the period.
     */
    function getDailyBalances(address account, uint256 fromDay, uint256 toDay) external view returns (uint256[] memory);

    /**
     * @dev Returns the balance tracker current day index and time.
     */
    function dayAndTime() external view returns (uint256, uint256);

    /**
     * @dev Returns the address of the hooked token contract.
     */
    function token() external view returns (address);
}

/**
 * @title IBalanceTrackerErrors interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The custom errors used in the contract that tracks token balances for each account on a daily basis.
 */
interface IBalanceTrackerErrors {
    // ------------------ Errors ---------------------------------- //

    /**
     * @dev Thrown when the specified "from" day is prior to the contract initialization day.
     */
    error FromDayPriorInitDay();

    /**
     * @dev Thrown when the specified "to" day is prior to the specified "from" day.
     */
    error ToDayPriorFromDay();

    /**
     * @dev Thrown when the value does not fit in the type uint16.
     */
    error SafeCastOverflowUint16();

    /**
     * @dev Thrown when the value does not fit in the type uint240.
     */
    error SafeCastOverflowUint240();

    /**
     * @dev Thrown when the caller is not the token contract.
     * @param account The address of the caller.
     */
    error UnauthorizedCaller(address account);
}

/**
 * @title IBalanceTracker interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The full interface of the contract that tracks token balances for each account on a daily basis.
 */
interface IBalanceTracker is IBalanceTrackerPrimary, IBalanceTrackerErrors {}
