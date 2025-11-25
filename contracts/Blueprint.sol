// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { RescuableUpgradeable } from "./base/RescuableUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";
import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";

import { IBlueprint } from "./interfaces/IBlueprint.sol";
import { IBlueprintPrimary } from "./interfaces/IBlueprint.sol";
import { IBlueprintConfiguration } from "./interfaces/IBlueprint.sol";

import { BlueprintStorageLayout } from "./BlueprintStorageLayout.sol";

/**
 * @title Blueprint contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The smart contract is designed as a reference and template one.
 * It executes deposit and withdrawal operations using the underlying token smart contract and stores related data.
 *
 * See details about the contract in the comments of the {IBlueprint} interface.
 */
contract Blueprint is
    BlueprintStorageLayout,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    RescuableUpgradeable,
    UUPSExtUpgradeable,
    Versionable,
    IBlueprint
{
    // ------------------ Types ----------------------------------- //

    using SafeERC20 for IERC20;

    // ------------------ Constants ------------------------------- //

    /// @dev The kind of operation that is deposit.
    uint256 internal constant OPERATION_KIND_DEPOSIT = 0;

    /// @dev The kind of operation that is withdrawal.
    uint256 internal constant OPERATION_KIND_WITHDRAWAL = 1;

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
     *
     * @param token_ The address of the token to set as the underlying one.
     */
    function initialize(address token_) external initializer {
        __AccessControlExt_init_unchained();
        __PausableExt_init_unchained();
        __Rescuable_init_unchained();
        __UUPSExt_init_unchained(); // This is needed only to avoid errors during coverage assessment

        if (token_ == address(0)) {
            revert Blueprint_TokenAddressZero();
        }

        _getBlueprintStorage().token = token_;

        _setRoleAdmin(MANAGER_ROLE, GRANTOR_ROLE);
        _grantRole(OWNER_ROLE, _msgSender());
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @inheritdoc IBlueprintConfiguration
     *
     * @dev Requirements:
     *
     * - The caller must have the {OWNER_ROLE} role.
     * - The new operational treasury address must not be zero.
     * - The new operational treasury address must not be the same as already configured.
     */
    function setOperationalTreasury(address newTreasury) external onlyRole(OWNER_ROLE) {
        BlueprintStorage storage $ = _getBlueprintStorage();
        address oldTreasury = $.operationalTreasury;
        if (newTreasury == oldTreasury) {
            revert Blueprint_TreasuryAddressAlreadyConfigured();
        }
        if (newTreasury != address(0)) {
            if (IERC20($.token).allowance(newTreasury, address(this)) == 0) {
                revert Blueprint_TreasuryAllowanceZero();
            }
        }

        emit OperationalTreasuryChanged(newTreasury, oldTreasury);
        $.operationalTreasury = newTreasury;
    }

    /**
     * @inheritdoc IBlueprintPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {MANAGER_ROLE} role.
     * - The provided account address must not be zero.
     * - The provided operation identifier must not be zero.
     */
    function deposit(
        address account, // Tools: this comment prevents Prettier from formatting into a single line
        uint256 amount,
        bytes32 opId
    ) external whenNotPaused onlyRole(MANAGER_ROLE) {
        _executeOperation(account, amount, opId, OPERATION_KIND_DEPOSIT);
    }

    /**
     * @inheritdoc IBlueprintPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {MANAGER_ROLE} role.
     * - The provided account address must not be zero.
     * - The provided operation identifier must not be zero.
     */
    function withdraw(
        address account, // Tools: this comment prevents Prettier from formatting into a single line
        uint256 amount,
        bytes32 opId
    ) external whenNotPaused onlyRole(MANAGER_ROLE) {
        _executeOperation(account, amount, opId, OPERATION_KIND_WITHDRAWAL);
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc IBlueprintPrimary
    function getOperation(bytes32 opId) external view returns (Operation memory) {
        return _getBlueprintStorage().operations[opId];
    }

    /// @inheritdoc IBlueprintPrimary
    function getAccountState(address account) external view returns (AccountState memory) {
        return _getBlueprintStorage().accountStates[account];
    }

    /// @inheritdoc IBlueprintPrimary
    function balanceOf(address account) public view returns (uint256) {
        return _getBlueprintStorage().accountStates[account].balance;
    }

    /// @inheritdoc IBlueprintPrimary
    function underlyingToken() external view returns (address) {
        return _getBlueprintStorage().token;
    }

    /// @inheritdoc IBlueprintConfiguration
    function operationalTreasury() external view returns (address) {
        return _getBlueprintStorage().operationalTreasury;
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc IBlueprint
    function proveBlueprint() external pure {}

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Executes an operation on the contract.
     * @param account The account involved in the operation.
     * @param amount The amount of the operation.
     * @param opId The off-chain identifier of the operation.
     * @param operationKind The kind of operation: 0 - deposit, 1 - withdrawal.
     */
    function _executeOperation(address account, uint256 amount, bytes32 opId, uint256 operationKind) internal {
        _checkOperationParameters(account, amount, opId);
        BlueprintStorage storage $ = _getBlueprintStorage();
        address treasury = _getAndCheckOperationalTreasury($);

        Operation storage operation = _getAndCheckOperation(opId, $);
        operation.account = account;
        operation.amount = uint64(amount);

        AccountState storage state = $.accountStates[account];

        uint256 oldBalance = state.balance;
        uint256 newBalance = oldBalance;

        if (operationKind == OPERATION_KIND_DEPOSIT) {
            operation.status = OperationStatus.Deposit;
            newBalance += amount;
            if (newBalance > type(uint64).max) {
                revert Blueprint_BalanceExcess();
            }
        } else {
            newBalance -= amount;
            operation.status = OperationStatus.Withdrawal;
        }

        state.balance = uint64(newBalance);
        state.operationCount += 1;
        state.lastOpId = opId;

        emit BalanceUpdated(
            opId, // Tools: this comment prevents Prettier from formatting into a single line
            account,
            newBalance,
            oldBalance
        );

        if (operationKind == OPERATION_KIND_DEPOSIT) {
            IERC20($.token).safeTransferFrom(account, treasury, amount);
        } else {
            IERC20($.token).safeTransferFrom(treasury, account, amount);
        }
    }

    /**
     * @dev Checks the parameters of an operation.
     * @param account The account involved in the operation.
     * @param amount The amount of the operation.
     * @param opId The off-chain identifier of the operation.
     */
    function _checkOperationParameters(address account, uint256 amount, bytes32 opId) internal pure {
        if (account == address(0)) {
            revert Blueprint_AccountAddressZero();
        }
        if (opId == bytes32(0)) {
            revert Blueprint_OperationIdZero();
        }
        if (amount > type(uint64).max) {
            revert Blueprint_AmountExcess();
        }
    }

    /// @dev Returns the operational treasury address after checking it.
    function _getAndCheckOperationalTreasury(BlueprintStorage storage $) internal view returns (address) {
        address operationalTreasury_ = $.operationalTreasury;
        if (operationalTreasury_ == address(0)) {
            revert Blueprint_OperationalTreasuryAddressZero();
        }
        return operationalTreasury_;
    }

    /**
     * @dev Fetches the current data of an operation and checks it.
     * @param opId The off-chain identifier of the operation.
     * @return The current operation.
     */
    function _getAndCheckOperation(bytes32 opId, BlueprintStorage storage $) internal view returns (Operation storage) {
        Operation storage operation = $.operations[opId];
        if (operation.status != OperationStatus.Nonexistent) {
            revert Blueprint_OperationAlreadyExecuted(opId);
        }
        return operation;
    }

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     * @param newImplementation The address of the new implementation.
     */
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try IBlueprint(newImplementation).proveBlueprint() {} catch {
            revert Blueprint_ImplementationAddressInvalid();
        }
    }
}
