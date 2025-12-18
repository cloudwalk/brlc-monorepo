// SPDX-License-Identifier: MIT

pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { EnumerableMap } from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { RescuableUpgradeable } from "./base/RescuableUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";

import { IERC20Mintable } from "./interfaces/IERC20Mintable.sol";
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
    using EnumerableMap for EnumerableMap.AddressToUintMap;

    // ------------------ Constants ------------------------------- //

    /// @dev The role of a withdrawer that is allowed to withdraw tokens from the treasury.
    bytes32 public constant WITHDRAWER_ROLE = keccak256("WITHDRAWER_ROLE");

    /// @dev The role of an ordinary minter that is allowed to mint tokens.
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @dev The role of an ordinary burner that is allowed to burn tokens.
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    /// @dev The role of a reserve minter that is allowed to mint tokens from reserve.
    bytes32 public constant RESERVE_MINTER_ROLE = keccak256("RESERVE_MINTER_ROLE");

    /// @dev The role of a reserve burner that is allowed to burn tokens to reserve.
    bytes32 public constant RESERVE_BURNER_ROLE = keccak256("RESERVE_BURNER_ROLE");

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

        $.underlyingToken = tokenAddress;
        emit UnderlyingTokenSet(tokenAddress);

        $.recipientLimitPolicy = RecipientLimitPolicy.EnforceAll;
        emit RecipientLimitPolicyUpdated(RecipientLimitPolicy.EnforceAll);

        _setRoleAdmin(WITHDRAWER_ROLE, GRANTOR_ROLE);
        _setRoleAdmin(MINTER_ROLE, GRANTOR_ROLE);
        _setRoleAdmin(BURNER_ROLE, GRANTOR_ROLE);
        _setRoleAdmin(RESERVE_MINTER_ROLE, GRANTOR_ROLE);
        _setRoleAdmin(RESERVE_BURNER_ROLE, GRANTOR_ROLE);
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
     * - The caller must have the {WITHDRAWER_ROLE} role.
     */
    function withdrawTo(address to, uint256 amount) external whenNotPaused onlyRole(WITHDRAWER_ROLE) {
        _withdraw(to, _msgSender(), amount);
    }

    /**
     * @inheritdoc ITreasuryPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {MINTER_ROLE} role.
     */
    function mint(uint256 amount) external whenNotPaused onlyRole(MINTER_ROLE) {
        TreasuryStorage storage $ = _getTreasuryStorage();
        IERC20Mintable($.underlyingToken).mint(address(this), amount);
    }

    /**
     * @inheritdoc ITreasuryPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {RESERVE_MINTER_ROLE} role.
     */
    function mintFromReserve(uint256 amount) external whenNotPaused onlyRole(RESERVE_MINTER_ROLE) {
        TreasuryStorage storage $ = _getTreasuryStorage();
        IERC20Mintable($.underlyingToken).mintFromReserve(address(this), amount);
    }

    /**
     * @inheritdoc ITreasuryPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {BURNER_ROLE} role.
     */
    function burn(uint256 amount) external whenNotPaused onlyRole(BURNER_ROLE) {
        TreasuryStorage storage $ = _getTreasuryStorage();
        IERC20Mintable($.underlyingToken).burn(amount);
    }

    /**
     * @inheritdoc ITreasuryPrimary
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {RESERVE_BURNER_ROLE} role.
     */
    function burnToReserve(uint256 amount) external whenNotPaused onlyRole(RESERVE_BURNER_ROLE) {
        TreasuryStorage storage $ = _getTreasuryStorage();
        IERC20Mintable($.underlyingToken).burnToReserve(amount);
    }

    /**
     * @inheritdoc ITreasuryPrimary
     *
     * @dev Requirements:
     *
     * - The caller must have the {OWNER_ROLE} role.
     * - The recipient address must not be zero.
     */
    function setRecipientLimit(address recipient, uint256 limit) external onlyRole(OWNER_ROLE) {
        if (recipient == address(0)) {
            revert Treasury_RecipientAddressZero();
        }

        TreasuryStorage storage $ = _getTreasuryStorage();
        (, uint256 oldLimit) = $.recipientLimits.tryGet(recipient);

        // Setting limit to 0 removes the recipient from the allowed list
        if (limit == 0) {
            $.recipientLimits.remove(recipient);
        } else {
            $.recipientLimits.set(recipient, limit);
        }

        emit RecipientLimitUpdated(recipient, oldLimit, limit);
    }

    /**
     * @inheritdoc ITreasuryPrimary
     *
     * @dev Requirements:
     *
     * - The caller must have the {OWNER_ROLE} role.
     * - The provided policy must differ from the current one.
     */
    function setRecipientLimitPolicy(RecipientLimitPolicy policy) external onlyRole(OWNER_ROLE) {
        TreasuryStorage storage $ = _getTreasuryStorage();

        if ($.recipientLimitPolicy == policy) {
            revert Treasury_RecipientLimitPolicyAlreadySet();
        }

        $.recipientLimitPolicy = policy;
        emit RecipientLimitPolicyUpdated(policy);
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc ITreasuryPrimary
    function getRecipientLimits() external view returns (RecipientLimitView[] memory recipientLimits) {
        TreasuryStorage storage $ = _getTreasuryStorage();
        uint256 length = $.recipientLimits.length();
        recipientLimits = new RecipientLimitView[](length);

        for (uint256 i = 0; i < length; i++) {
            (address recipient, uint256 limit) = $.recipientLimits.at(i);
            recipientLimits[i] = RecipientLimitView({ recipient: recipient, limit: limit });
        }
    }

    /// @inheritdoc ITreasuryPrimary
    function recipientLimitPolicy() external view returns (RecipientLimitPolicy policy) {
        policy = _getTreasuryStorage().recipientLimitPolicy;
    }

    /// @inheritdoc ITreasuryPrimary
    function underlyingToken() external view returns (address token) {
        token = _getTreasuryStorage().underlyingToken;
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc ITreasury
    function proveTreasury() external pure {}

    // ------------------ Internal functions ---------------------- //

    function _withdraw(address to, address withdrawer, uint256 amount) internal {
        if (to == address(0)) {
            revert Treasury_RecipientAddressZero();
        }

        TreasuryStorage storage $ = _getTreasuryStorage();

        if ($.recipientLimitPolicy == RecipientLimitPolicy.EnforceAll) {
            _processRecipientLimit($, to, amount);
        }
        // Disabled: no checks performed at all

        IERC20($.underlyingToken).safeTransfer(to, amount);
        emit Withdrawal(to, withdrawer, amount);
    }

    /**
     * @dev Processes and enforces recipient limit for withdrawal operations.
     *
     * @param $ The treasury storage pointer.
     * @param recipient The address of the withdrawal recipient.
     * @param amount The withdrawal amount to check against the recipient's limit.
     */
    function _processRecipientLimit(TreasuryStorage storage $, address recipient, uint256 amount) internal {
        // Get current limit for recipient (returns 0 if recipient not in map)
        // Allowlist enforcement: only explicitly configured recipients can receive funds
        (, uint256 currentLimit) = $.recipientLimits.tryGet(recipient);

        // Recipients with type(uint256).max have unlimited withdrawals
        if (currentLimit != type(uint256).max) {
            if (currentLimit < amount) {
                revert Treasury_InsufficientRecipientLimit(recipient, amount, currentLimit);
            }

            // Decrement the limit
            // Recipients remain in the map even when limit reaches 0 (not auto-removed)
            uint256 newLimit;
            unchecked {
                newLimit = currentLimit - amount;
            }
            $.recipientLimits.set(recipient, newLimit);
        }
    }
}
