// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { AccessControlExtUpgradeable } from "../base/AccessControlExtUpgradeable.sol";

import { CardPaymentProcessorHookableStorageLayout } from "./CardPaymentProcessorHookableStorageLayout.sol";

import { IAfterPaymentMadeHook } from "./interfaces/ICardPaymentProcessorHooks.sol";
import { IAfterPaymentUpdatedHook } from "./interfaces/ICardPaymentProcessorHooks.sol";
import { IAfterPaymentCanceledHook } from "./interfaces/ICardPaymentProcessorHooks.sol";
import { ICardPaymentProcessorHook } from "./interfaces/ICardPaymentProcessorHooks.sol";
import { ICardPaymentProcessorHookable } from "./interfaces/ICardPaymentProcesorHookable.sol";
import { ICardPaymentProcessorTypes } from "../interfaces/ICardPaymentProcessor.sol";

/**
 * @title CardPaymentProcessorHookable base contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Provides hook registration and dispatching for payment lifecycle events.
 */
abstract contract CardPaymentProcessorHookable is
    AccessControlExtUpgradeable,
    ICardPaymentProcessorHookable,
    CardPaymentProcessorHookableStorageLayout
{
    using EnumerableSet for EnumerableSet.AddressSet;

    // ------------------ Transactional functions ----------------- //

    /**
     * @inheritdoc ICardPaymentProcessorHookable
     *
     * @dev Requirements:
     *
     * - The caller must have the {OWNER_ROLE} role.
     */
    function registerHook(address hookAddress) external onlyRole(OWNER_ROLE) {
        bytes4[] memory hookMethods = _getHookMethods();

        for (uint256 i = 0; i < hookMethods.length; i++) {
            if (ICardPaymentProcessorHook(hookAddress).supportsHookMethod(hookMethods[i])) {
                _attachHook(hookMethods[i], hookAddress);
            } else {
                _detachHook(hookMethods[i], hookAddress);
            }
        }
    }

    /**
     * @inheritdoc ICardPaymentProcessorHookable
     *
     * @dev Requirements:
     *
     * - The caller must have the {OWNER_ROLE} role.
     */
    function unregisterHook(address hookAddress, bytes32 proof) external onlyRole(OWNER_ROLE) {
        // ⚠️ IMPORTANT: This proof verifies the caller is fully conscious and aware of what they are doing.
        // 📖 See interface docs before using.
        require(
            proof ==
                keccak256("unregisterHook") ^
                    bytes32(uint256(uint160(hookAddress))) ^
                    bytes32(uint256(uint160(address(this))))
        );
        bytes4[] memory hookMethods = _getHookMethods();

        for (uint256 i = 0; i < hookMethods.length; i++) {
            _detachHook(hookMethods[i], hookAddress);
        }
    }

    // ------------------ Internal functions -------------------- //

    function _attachHook(bytes4 methodSelector, address hookAddress) internal {
        CardPaymentProcessorHookableStorage storage $ = _getCardPaymentProcessorHookableStorage();
        if ($.hooks[methodSelector].add(hookAddress)) {
            emit HookRegistered(hookAddress, methodSelector);
        }
    }

    function _detachHook(bytes4 methodSelector, address hookAddress) internal {
        CardPaymentProcessorHookableStorage storage $ = _getCardPaymentProcessorHookableStorage();
        if ($.hooks[methodSelector].remove(hookAddress)) {
            emit HookUnregistered(hookAddress, methodSelector);
        }
    }

    /// @dev Used as replacement for constant array of hook methods
    function _getHookMethods() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = IAfterPaymentMadeHook.afterPaymentMade.selector;
        selectors[1] = IAfterPaymentUpdatedHook.afterPaymentUpdated.selector;
        selectors[2] = IAfterPaymentCanceledHook.afterPaymentCanceled.selector;

        return selectors;
    }

    /**
     * @dev Calls all registered hooks for a given hook method selector with provided old and new payment data.
     *
     * The supported method selectors are defined by interfaces in {ICardPaymentProcessorHooks}.
     *
     * @param methodSelector The hook method selector (e.g. afterPaymentMade selector).
     * @param paymentId The ID of the payment.
     * @param oldPayment The previous payment snapshot.
     * @param newPayment The new payment snapshot.
     */
    function _callHooks(
        bytes4 methodSelector,
        bytes32 paymentId,
        PaymentHookData memory oldPayment,
        PaymentHookData memory newPayment
    ) internal {
        CardPaymentProcessorHookableStorage storage $ = _getCardPaymentProcessorHookableStorage();
        uint256 length = $.hooks[methodSelector].length();

        for (uint256 i = 0; i < length; i++) {
            address hook = $.hooks[methodSelector].at(i);
            (bool success, bytes memory returnData) = hook.call(
                abi.encodeWithSelector(methodSelector, paymentId, oldPayment, newPayment)
            );

            if (!success) {
                _revertWithReturnData(returnData);
            }
        }
    }

    /**
     * @dev Reverts with the same error data that was returned from a failed call.
     * If no return data is provided, reverts with a default error.
     * @param returnData The return data from the failed call.
     */
    function _revertWithReturnData(bytes memory returnData) private pure {
        // Bubble up the custom error
        assembly {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }
}
