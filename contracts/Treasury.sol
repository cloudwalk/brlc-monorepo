// SPDX-License-Identifier: MIT

pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { RescuableUpgradeable } from "./base/RescuableUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";

import { ITreasury, ITreasuryPrimary } from "./interfaces/ITreasury.sol";
import { TreasuryStorageLayout } from "./TreasuryStorageLayout.sol";

/**
 * @title Treasury contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev A vault contract for ERC20 tokens with controlled spending rules.
 *
 * See details about the contract in the comments of the {ITreasury} interface.
 */
contract Treasury is
    TreasuryStorageLayout,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    RescuableUpgradeable,
    Versionable,
    ITreasury
{
    // ------------------ Types ----------------------------------- //

    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    // ------------------ Constants ------------------------------- //

    /// @dev The role of a withdrawer that is allowed to withdraw tokens from the treasury.
    bytes32 public constant WITHDRAWER_ROLE = keccak256("WITHDRAWER_ROLE");

    /// @dev The role of a manager that is allowed to withdraw tokens to any address.
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

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
     * @param tokenAddress The address of the ERC20 token to be managed by this treasury.
     */
    function initialize(address tokenAddress) external initializer {
        __AccessControlExt_init_unchained();
        __PausableExt_init_unchained();
        __Rescuable_init_unchained();

        if (tokenAddress == address(0)) {
            revert Treasury_TokenAddressZero();
        }

        TreasuryStorage storage $ = _getTreasuryStorage();
        $.token = tokenAddress;

        _setRoleAdmin(MANAGER_ROLE, GRANTOR_ROLE);
        _setRoleAdmin(WITHDRAWER_ROLE, GRANTOR_ROLE);
        _grantRole(OWNER_ROLE, _msgSender());
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @inheritdoc ITreasuryPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {WITHDRAWER_ROLE} role.
     */
    function withdraw(uint256 amount) external whenNotPaused onlyRole(WITHDRAWER_ROLE) {
        _withdraw(_msgSender(), _msgSender(), amount);
    }

    /**
     * @inheritdoc ITreasuryPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {MANAGER_ROLE} role.
     */
    function withdrawTo(address to, uint256 amount) external whenNotPaused onlyRole(MANAGER_ROLE) {
        _withdraw(to, _msgSender(), amount);
    }

    /**
     * @inheritdoc ITreasuryPrimary
     *
     * @dev Requirements:
     *
     * - The caller must have the {OWNER_ROLE} role.
     * - The spender address must not be zero.
     */
    function approve(address spender, uint256 amount) external onlyRole(OWNER_ROLE) {
        if (spender == address(0)) {
            revert Treasury_SpenderAddressZero();
        }

        TreasuryStorage storage $ = _getTreasuryStorage();
        IERC20($.token).approve(spender, amount);
        $.approvedSpenders.add(spender);
    }

    /**
     * @inheritdoc ITreasuryPrimary
     *
     * @dev Requirements:
     *
     * - The caller must have the {OWNER_ROLE} role.
     */
    function clearAllApprovals() external onlyRole(OWNER_ROLE) {
        TreasuryStorage storage $ = _getTreasuryStorage();
        uint256 length = $.approvedSpenders.length();

        // Iterate backwards to avoid index issues when removing elements
        for (uint256 i = length; i > 0; i--) {
            address spender = $.approvedSpenders.at(i - 1);
            IERC20($.token).approve(spender, 0);
            $.approvedSpenders.remove(spender);
        }
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc ITreasuryPrimary
    function approvedSpenders() external view returns (address[] memory) {
        TreasuryStorage storage $ = _getTreasuryStorage();
        return $.approvedSpenders.values();
    }

    /// @inheritdoc ITreasuryPrimary
    function underlyingToken() external view returns (address) {
        return _getTreasuryStorage().token;
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc ITreasury
    function proveTreasury() external pure {}

    // ------------------ Internal functions ---------------------- //

    function _withdraw(address to, address withdrawer, uint256 amount) internal {
        TreasuryStorage storage $ = _getTreasuryStorage();

        IERC20($.token).safeTransfer(to, amount);
        emit Withdrawal(to, withdrawer, amount);
    }
}
