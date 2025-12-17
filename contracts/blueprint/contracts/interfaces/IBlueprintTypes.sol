// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IBlueprintTypes interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the types used in the blueprint smart contract.
 *
 * See details about the contract in the comments of the {IBlueprint} interface.
 */
interface IBlueprintTypes {
    /**
     * @dev Possible statuses of an operation used in the blueprint smart contract.
     *
     * The values:
     *
     * - Nonexistent = 0 -- The operation does not exist (the default value).
     * - Deposit = 1 ------ The deposit operation has been executed.
     * - Withdrawal = 2 --- The withdrawal operation has been executed.
     */
    enum OperationStatus {
        Nonexistent,
        Deposit,
        Withdrawal
    }

    /**
     * @dev The data of a single operation of the blueprint smart-contract.
     *
     * Fields:
     *
     * - status --- The status of the operation according to the {OperationStatus} enum.
     * - account -- The address of the account involved in the operation.
     * - amount --- The amount parameter of the related operation.
     */
    struct Operation {
        OperationStatus status;
        address account;
        uint64 amount;
        // uint24 __reserved; // Reserved until the end of the storage slot
    }

    /**
     * @dev The state of a single account within the blueprint smart-contract.
     *
     * Fields:
     *
     * - lastOpId -------- The identifier of the last operation related to the account.
     * - balance --------- The balance of the account.
     * - operationCount -- The number of operations related to the account.
     */
    struct AccountState {
        // Slot 1
        bytes32 lastOpId;
        // No reserve until the end of the storage slot

        // Slot 2
        uint64 balance;
        uint32 operationCount;
        // uint160 __reserved; // Reserved until the end of the storage slot
    }
}
