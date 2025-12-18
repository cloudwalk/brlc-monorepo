// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { BalanceTracker } from "../BalanceTracker.sol";
import { HarnessAdministrable } from "./HarnessAdministrable.sol";

/**
 * @title BalanceTrackerHarness contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The same as {BalanceTracker} but with additional functions for setting internal variables for testing.
 * @custom:oz-upgrades-unsafe-allow missing-initializer
 */
contract BalanceTrackerHarness is BalanceTracker, HarnessAdministrable {
    // ------------------ Storage layout -------------------------- //

    /// @dev The structure with the contract state.
    struct BalanceTrackerHarnessState {
        uint256 currentBlockTimestamp;
        bool usingRealBlockTimestamps;
        bool initialized;
    }

    /**
     * @dev The memory slot used to store the contract state.
     *
     * It is the same as keccak256("balance tracker harness storage slot").
     */
    bytes32 private constant _STORAGE_SLOT = 0xceb91ca8f20e7d3bc24614515796ccaa88bb45ed0206676ef6d6620478090c43;

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Sets the initialization day of the balance tracker.
     * @param day The new initialization day to set.
     */
    function setInitializationDay(uint16 day) external onlyOwner {
        INITIALIZATION_DAY = day;
    }

    /**
     * @dev Adds a new balance record to the chronological array for an account.
     * @param account The address of the account to add the balance record for.
     * @param day The creation day of the new record.
     * @param value The value of the new record.
     */
    function addBalanceRecord(address account, uint16 day, uint240 value) external onlyHarnessAdmin {
        _balanceRecords[account].push(Record({ day: day, value: value }));
    }

    /**
     * @dev Sets the balance record chronological array for an account according to the provided array.
     * @param account The address of the account to set the balance record array for.
     * @param balanceRecords The array of new records to set.
     */
    function setBalanceRecords(address account, Record[] calldata balanceRecords) external onlyHarnessAdmin {
        delete _balanceRecords[account];
        uint256 len = balanceRecords.length;
        for (uint256 i = 0; i < len; ++i) {
            _balanceRecords[account].push(balanceRecords[i]);
        }
    }

    /**
     * @dev Deletes all records from the balance record chronological array for an account.
     * @param account The address of the account to clear the balance record array for.
     */
    function deleteBalanceRecords(address account) external onlyHarnessAdmin {
        delete _balanceRecords[account];
    }

    /**
     * @dev Sets the current block timestamp that should be used by the contract under certain conditions.
     * @param day The new day index starting from the Unix epoch to set.
     * @param time The new time in seconds starting from the beginning of the day to set.
     */
    function setBlockTimestamp(uint256 day, uint256 time) external onlyHarnessAdmin {
        BalanceTrackerHarnessState storage state = _getBalanceTrackerHarnessState();
        state.currentBlockTimestamp = day * (24 * 60 * 60) + time;
        state.initialized = true;
    }

    /**
     * @dev Sets the boolean variable that defines whether real block timestamps are used in the contract.
     * @param newValue The new value. If true, real block timestamps are used. Otherwise, previously set ones are used.
     */
    function setUsingRealBlockTimestamps(bool newValue) external onlyOwner {
        BalanceTrackerHarnessState storage state = _getBalanceTrackerHarnessState();
        state.usingRealBlockTimestamps = newValue;
        state.initialized = true;
    }

    // ------------------ View functions -------------------------- //

    /**
     * @dev Returns the boolean value that defines whether real block timestamps are used in the contract.
     */
    function getUsingRealBlockTimestamps() external view returns (bool) {
        BalanceTrackerHarnessState storage state = _getBalanceTrackerHarnessState();
        return state.usingRealBlockTimestamps;
    }

    /**
     * @dev Returns the internal state variable that defines the block timestamp when real timestamps are not used.
     */
    function getCurrentBlockTimestamp() external view returns (uint256) {
        BalanceTrackerHarnessState storage state = _getBalanceTrackerHarnessState();
        return state.currentBlockTimestamp;
    }

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Returns the block timestamp according to the contract settings: real timestamp or a previously set one.
     */
    function _blockTimestamp() internal view virtual override returns (uint256) {
        BalanceTrackerHarnessState storage state = _getBalanceTrackerHarnessState();
        if (state.usingRealBlockTimestamps || !state.initialized) {
            return super._blockTimestamp();
        } else {
            uint256 blockTimestamp = state.currentBlockTimestamp;
            if (blockTimestamp < NEGATIVE_TIME_SHIFT) {
                return 0;
            } else {
                return blockTimestamp - NEGATIVE_TIME_SHIFT;
            }
        }
    }

    /**
     * @dev Returns the contract stored state structure.
     */
    function _getBalanceTrackerHarnessState() internal pure returns (BalanceTrackerHarnessState storage) {
        BalanceTrackerHarnessState storage state;
        /// @solidity memory-safe-assembly
        assembly {
            state.slot := _STORAGE_SLOT
        }
        return state;
    }
}
