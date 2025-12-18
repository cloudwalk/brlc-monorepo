// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { IBalanceTrackerPrimary, IBalanceTrackerErrors } from "./interfaces/IBalanceTracker.sol";
import { IBalanceTracker } from "./interfaces/IBalanceTracker.sol";
import { IERC20Hook } from "./interfaces/IERC20Hook.sol";
import { Versionable } from "./base/Versionable.sol";

/**
 * @title BalanceTracker contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The contract that tracks token balances for each account on a daily basis.
 */
contract BalanceTracker is OwnableUpgradeable, IBalanceTracker, IERC20Hook, Versionable {
    // ------------------ Constants ------------------------------- //

    /// @dev The time shift of a day in seconds.
    uint256 public constant NEGATIVE_TIME_SHIFT = 3 hours;

    /// @dev The address of the hooked token contract.
    address public constant TOKEN = address(0x1b470f79D29839dBCCa9c61c06941E27B3aFbF6d);

    // ------------------ Storage --------------------------------- //

    /// @dev The index of the initialization day.
    uint16 public INITIALIZATION_DAY;

    /// @dev The mapping of an account to daily balance records.
    mapping(address => Record[]) public _balanceRecords;

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain.
     */
    uint256[48] private __gap;

    // ------------------ Modifiers ------------------------------- //

    /**
     * @dev Throws if called by any account other than the token contract.
     */
    modifier onlyToken() {
        if (_msgSender() != TOKEN) {
            revert UnauthorizedCaller(_msgSender());
        }
        _;
    }

    // ------------------ Constructor ----------------------------- //

    /**
     * @dev Constructor that prohibits the initialization of the implementation of the upgradeable contract.
     *
     * See details:
     * https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable#initializing_the_implementation_contract
     *
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev Initializer of the upgradeable contract.
     *
     * See details: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
     */
    function initialize() external virtual initializer {
        __Ownable_init_unchained();
        (uint256 day, ) = dayAndTime();
        INITIALIZATION_DAY = _toUint16(day);
        IERC20Upgradeable(TOKEN).totalSupply();
    }

    // ------------------ Transactional hook functions ------------ //

    /**
     * @inheritdoc IERC20Hook
     *
     * @dev Requirement: Can only be called by the hooked token contract.
     *
     * Emits an {BalanceRecordCreated} event for `from` account.
     * Emits an {BalanceRecordCreated} event for `to` account.
     */
    function afterTokenTransfer(address from, address to, uint256 amount) external override onlyToken {
        if (amount == 0) return;

        (uint256 day, ) = dayAndTime();
        if (day-- <= INITIALIZATION_DAY) {
            return;
        }

        // Update `from` balances and create a new record for the past period if needed
        if (
            from != address(0) &&
            (_balanceRecords[from].length == 0 || _balanceRecords[from][_balanceRecords[from].length - 1].day < day)
        ) {
            uint240 balance = _toUint240(IERC20Upgradeable(TOKEN).balanceOf(from) + amount);
            _balanceRecords[from].push(Record({ day: _toUint16(day), value: balance }));
            emit BalanceRecordCreated(from, _toUint16(day), balance);
        }

        // Update `to` balances and create a new record for the past period if needed
        if (
            to != address(0) &&
            (_balanceRecords[to].length == 0 || _balanceRecords[to][_balanceRecords[to].length - 1].day < day)
        ) {
            uint240 balance = _toUint240(IERC20Upgradeable(TOKEN).balanceOf(to) - amount);
            _balanceRecords[to].push(Record({ day: _toUint16(day), value: balance }));
            emit BalanceRecordCreated(to, _toUint16(day), balance);
        }
    }

    /**
     * @inheritdoc IERC20Hook
     *
     * @dev Requirement: Can only be called by the hooked token contract.
     *
     * Emits an {BalanceRecordCreated} event for `from` account.
     * Emits an {BalanceRecordCreated} event for `to` account.
     */
    function beforeTokenTransfer(address from, address to, uint256 amount) external override onlyToken {}

    // ------------------ View functions -------------------------- //

    /**
     * @inheritdoc IBalanceTrackerPrimary
     */
    function readBalanceRecord(address account, uint256 index) external view returns (Record memory, uint256) {
        uint256 len = _balanceRecords[account].length;
        if (len > index) {
            return (_balanceRecords[account][index], len);
        } else {
            Record memory emptyRecord;
            return (emptyRecord, len);
        }
    }

    /**
     * @inheritdoc IBalanceTrackerPrimary
     */
    function getDailyBalances(
        address account,
        uint256 fromDay,
        uint256 toDay
    ) external view returns (uint256[] memory) {
        if (fromDay < INITIALIZATION_DAY) {
            revert FromDayPriorInitDay();
        }
        if (fromDay > toDay) {
            revert ToDayPriorFromDay();
        }

        uint16 day;
        uint256 balance;
        uint256 recordIndex = _balanceRecords[account].length;
        if (recordIndex == 0) {
            /**
             * There are no records for an account.
             * Therefore get the actual balance of the account directly from
             * the token contract and set the `day` variable outside the requested range
             */
            balance = IERC20Upgradeable(TOKEN).balanceOf(account);
            day = type(uint16).max;
        } else if (toDay >= _balanceRecords[account][--recordIndex].day) {
            /**
             * The `to` day is ahead or equal to the last record day
             * Therefore get the actual balance of the account directly from
             * the token contract and set the `day` variable to the last record day
             */
            balance = IERC20Upgradeable(TOKEN).balanceOf(account);
            day = _balanceRecords[account][recordIndex].day;
        } else {
            /**
             * The `to` day is behind the last record day
             * Therefore find the record with a day that is ahead of the `to` day
             * and set the `balance` variable to the value of that record
             */
            while (recordIndex > 0 && _balanceRecords[account][--recordIndex].day > toDay) {}
            if (recordIndex == 0 && _balanceRecords[account][recordIndex].day > toDay) {
                balance = _balanceRecords[account][recordIndex].value;
            } else {
                balance = _balanceRecords[account][recordIndex + 1].value;
            }
            day = _balanceRecords[account][recordIndex].day;
        }

        /**
         * Iterate over the records from the `to` day to the `from` day
         * and fill the `balances` array with the daily balances
         */
        uint256 i = toDay + 1 - fromDay;
        uint256 dayIndex = fromDay + i;
        uint256[] memory balances = new uint256[](i);
        do {
            i--;
            dayIndex--;
            if (dayIndex == day) {
                balance = _balanceRecords[account][recordIndex].value;
                if (recordIndex != 0) {
                    day = _balanceRecords[account][--recordIndex].day;
                }
            }
            balances[i] = balance;
        } while (i > 0);

        return balances;
    }

    /**
     * @inheritdoc IBalanceTrackerPrimary
     */
    function dayAndTime() public view override returns (uint256, uint256) {
        uint256 timestamp = _blockTimestamp();
        return (timestamp / 1 days, timestamp % 1 days);
    }

    /**
     * @inheritdoc IBalanceTrackerPrimary
     */
    function token() external pure override returns (address) {
        return TOKEN;
    }

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Returns the current block timestamp with the time shift.
     */
    function _blockTimestamp() internal view virtual returns (uint256) {
        return block.timestamp - NEGATIVE_TIME_SHIFT;
    }

    /**
     * @dev Returns the downcasted uint240 from uint256, reverting on
     * overflow (when the input is greater than largest uint240).
     */
    function _toUint240(uint256 value) internal pure returns (uint240) {
        if (value > type(uint240).max) {
            revert SafeCastOverflowUint240();
        }

        return uint240(value);
    }

    /**
     * @dev Returns the downcasted uint16 from uint256, reverting on
     * overflow (when the input is greater than largest uint16).
     */
    function _toUint16(uint256 value) internal pure returns (uint16) {
        if (value > type(uint16).max) {
            revert SafeCastOverflowUint16();
        }

        return uint16(value);
    }
}
