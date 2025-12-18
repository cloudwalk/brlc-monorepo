// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title ICashier interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the needed functions of the cashier contract.
 */
interface ICashier {
    // ------------------ Types ----------------------------------- //

    /**
     * @dev Possible statuses of a cash-out operation as an enum.
     *
     * The possible values:
     * - Nonexistent = 0 -- The operation does not exist (the default value).
     * - Pending = 1 ------ The status immediately after the operation requesting.
     * - Reversed = 2 ----- The operation was reversed.
     * - Confirmed = 3 ---- The operation was confirmed.
     * - Internal = 4 ----- The operation executed internally
     */
    enum CashOutStatus {
        Nonexistent,
        Pending,
        Reversed,
        Confirmed,
        Internal
    }

    /**
     * @dev The data of a single cash-out operation.
     *
     * Fields:
     *
     * - status --- The status of the cash-out operation according to the {CashOutStatus} enum.
     * - account -- The owner of tokens to cash-out.
     * - amount --- The amount of tokens to cash-out.
     * - flags ---- The bit field of flags for the operation. See {CashOutFlagIndex}.
     */
    struct CashOutOperation {
        // Slot 1
        CashOutStatus status;
        address account;
        uint64 amount;
        uint8 flags;
        // uint16 __reserved; // Reserved until the end of the storage slot
    }

    // ------------------ View functions -------------------------- //

    /**
     * @dev Returns the data of a single cash-out operation.
     * @param txId The off-chain transaction identifier of the operation.
     */
    function getCashOut(bytes32 txId) external view returns (CashOutOperation memory);
}
