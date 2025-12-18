// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { ICashierHook } from "../interfaces/ICashierHook.sol";
import { ICashierHookableTypes } from "../interfaces/ICashierHookable.sol";
import { ICashier } from "../interfaces/ICashier.sol";

/**
 * @title CashierMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev A simplified version of the Cashier contract to use in tests for other contracts.
 */
contract CashierMock is ICashierHookableTypes, ICashier {
    // ------------------ Storage --------------------------------- //

    /// @dev The mapping of a cash-out operation structure for a given off-chain transaction identifier.
    mapping(bytes32 => CashOutOperation) internal _mockCashOutOperations;

    // ------------------ Events ---------------------------------- //

    /// @dev Emitted when the `configureCashOutHooks()` function is called with the parameters of the function.
    event MockConfigureCashOutHooksCalled(
        bytes32 txId, // Tools: prevent Prettier one-liner
        address newCallableContract,
        uint256 newHookFlags
    );

    // ------------------ Transactional functions ----------------- //

    /// @dev Imitates the same-name function of the {ICashierHookable} interface. Just emits an event about the call.
    function configureCashOutHooks(bytes32 txId, address newCallableContract, uint256 newHookFlags) external {
        emit MockConfigureCashOutHooksCalled(
            txId, // Tools: prevent Prettier one-liner
            newCallableContract,
            newHookFlags
        );
    }

    /// @dev Calls the `ICashierHook.onCashierHook()` function for a provided contract with provided parameters.
    function callCashierHook(address callableContract, uint256 hookIndex, bytes32 txId) external {
        ICashierHook(callableContract).onCashierHook(hookIndex, txId);
    }

    /// @dev Sets a single cash-out operation for a provided transaction ID.
    function setCashOut(bytes32 txId, CashOutOperation calldata operation) external {
        _mockCashOutOperations[txId] = operation;
    }

    // ------------------ View functions -------------------------- //

    /// @dev Returns a cash-out operation by a transaction ID.
    function getCashOut(bytes32 txId) external view returns (CashOutOperation memory) {
        return _mockCashOutOperations[txId];
    }
}
