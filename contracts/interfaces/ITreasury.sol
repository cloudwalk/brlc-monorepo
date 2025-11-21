// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title ITreasuryTypes interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the types used in the Treasury smart contract.
 */
interface ITreasuryTypes {
    // ------------------ Types ----------------------------------- //

    /**
     * @dev Policy for enforcing recipient limits in the treasury.
     *
     * The values:
     *
     * - Disabled = 0 ------- No limit checks are performed. Any address can receive funds.
     * - EnforceAll = 1 ----- Full enforcement. Only allowlisted recipients can receive funds,
     *                        and their limits are decremented with each withdrawal. Recipients with
     *                        type(uint256).max limit have unlimited withdrawals (limit not decremented).
     */
    enum RecipientLimitPolicy {
        Disabled,
        EnforceAll
    }

    /**
     * @dev A view structure representing a recipient's withdrawal limit.
     *
     * Fields:
     *
     * - recipient -- The address of the recipient.
     * - limit ------ The withdrawal limit for the recipient.
     */
    struct RecipientLimitView {
        address recipient;
        uint256 limit;
    }
}

/**
 * @title ITreasuryPrimary interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary part of the Treasury smart contract interface.
 */
interface ITreasuryPrimary is ITreasuryTypes {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when the underlying token is set.
     *
     * @param token The address of the underlying token.
     */
    event UnderlyingTokenSet(address indexed token);

    /**
     * @dev Emitted when tokens are withdrawn from the treasury.
     *
     * @param to The address that received the tokens.
     * @param withdrawer The address that initiated the withdrawal.
     * @param amount The amount of tokens withdrawn.
     */
    event Withdrawal(address indexed to, address indexed withdrawer, uint256 amount);

    /**
     * @dev Emitted when a recipient's withdrawal limit is updated.
     *
     * @param recipient The address of the recipient.
     * @param oldLimit The previous limit amount.
     * @param newLimit The new limit amount.
     */
    event RecipientLimitUpdated(address indexed recipient, uint256 oldLimit, uint256 newLimit);

    /**
     * @dev Emitted when the recipient limit policy is changed.
     *
     * @param policy The new recipient limit policy.
     */
    event RecipientLimitPolicyUpdated(RecipientLimitPolicy indexed policy);

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Withdraws tokens from the treasury to the caller's address.
     *
     * Emits a {Withdrawal} event.
     *
     * @param amount The amount of tokens to withdraw.
     */
    function withdraw(uint256 amount) external;

    /**
     * @dev Withdraws tokens from the treasury to a specified address.
     *
     * Emits a {Withdrawal} event.
     *
     * @param to The address to send tokens to.
     * @param amount The amount of tokens to withdraw.
     */
    function withdrawTo(address to, uint256 amount) external;

    /**
     * @dev Mints tokens to this treasury.
     *
     * @param amount The amount of tokens to mint.
     */
    function mint(uint256 amount) external;

    /**
     * @dev Mints tokens from reserve to this treasury.
     *
     * Minting from reserve means that the tokens are minted in a regular way, but the
     * total reserve supply is also increased by the amount of tokens minted.
     *
     * @param amount The amount of tokens to mint from reserve.
     */
    function mintFromReserve(uint256 amount) external;

    /**
     * @dev Burns tokens from this treasury.
     *
     * @param amount The amount of tokens to burn.
     */
    function burn(uint256 amount) external;

    /**
     * @dev Burns tokens to reserve from this treasury.
     *
     * Burning to reserve means that the tokens are burned in a regular way, but the
     * total reserve supply is also decreased by the amount of tokens burned.
     *
     * @param amount The amount of tokens to burn to reserve.
     */
    function burnToReserve(uint256 amount) external;

    /**
     * @dev Sets the withdrawal limit for a recipient address.
     *
     * Recipient limits only take effect when the contract-wide policy is set to enforce them.
     * See {setRecipientLimitPolicy} and {RecipientLimitPolicy} for policy configuration.
     *
     * Limit values:
     * - Setting limit to 0 removes the recipient from the allowed recipients list.
     * - Setting limit to `type(uint256).max` grants unlimited withdrawals.
     * - Any other value sets a specific withdrawal limit that decrements with each withdrawal.
     *
     * Behavior when limits are enforced:
     * - Only recipients with configured limits can receive funds (allowlist enforcement).
     * - Recipients not in the map are blocked from receiving funds (treated as 0 limit).
     * - Recipients whose limit reaches 0 after withdrawals remain in the map but are blocked.
     * - Recipients with `type(uint256).max` limit have their limit unchanged by withdrawals.
     *
     * Emits a {RecipientLimitUpdated} event.
     *
     * @param recipient The address to set the limit for.
     * @param limit The maximum amount of tokens the recipient can receive through withdrawals.
     */
    function setRecipientLimit(address recipient, uint256 limit) external;

    /**
     * @dev Sets the recipient limit policy.
     *
     * Emits a {RecipientLimitPolicyUpdated} event.
     *
     * @param policy The new recipient limit policy.
     */
    function setRecipientLimitPolicy(RecipientLimitPolicy policy) external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Returns all configured recipient addresses and their withdrawal limits.
     *
     * For details about recipient limits see comments of the {setRecipientLimit} function.
     *
     * @return recipientLimits An array of recipient limit view structures.
     */
    function getRecipientLimits() external view returns (RecipientLimitView[] memory recipientLimits);

    /**
     * @dev Returns the current recipient limit policy.
     * @return policy The current recipient limit policy.
     */
    function recipientLimitPolicy() external view returns (RecipientLimitPolicy policy);

    /**
     * @dev Returns the address of the underlying token contract.
     * @return token The address of the underlying token contract.
     */
    function underlyingToken() external view returns (address token);
}

/**
 * @title ITreasuryErrors interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the custom errors used in the Treasury contract.
 */
interface ITreasuryErrors {
    /// @dev Thrown if the provided token address is zero.
    error Treasury_TokenAddressZero();

    /// @dev Thrown if the provided recipient address is zero.
    error Treasury_RecipientAddressZero();

    /// @dev Thrown if the recipient does not have sufficient limit for the requested withdrawal.
    error Treasury_InsufficientRecipientLimit(address recipient, uint256 requested, uint256 available);

    /// @dev Thrown if the provided new implementation address is not of a treasury contract.
    error Treasury_ImplementationAddressInvalid();

    /// @dev Thrown if the provided recipient limit policy is already set.
    error Treasury_RecipientLimitPolicyAlreadySet();
}

/**
 * @title ITreasury interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The full interface of the Treasury smart contract.
 *
 * The Treasury contract is a vault for ERC20 tokens with controlled spending rules.
 * It allows designated withdrawers to withdraw tokens to allowed recipients with configurable limits.
 * The contract supports role-based access control and can be paused for security.
 *
 * Recipient Limit Mechanism:
 *
 * The contract implements a mechanism for limiting fund withdrawals based on the recipient's address.
 * This provides control over who can receive funds and how much they can receive. The mechanism operates
 * at two levels: a contract-wide policy that enables or disables enforcement, and individual per-recipient
 * limits. For configuration details, see {setRecipientLimitPolicy} and {setRecipientLimit}.
 */
interface ITreasury is ITreasuryPrimary, ITreasuryErrors {
    /**
     * @dev Proves the contract is the Treasury one. A marker function.
     *
     * It is used for simple contract compliance checks, e.g. during an upgrade.
     * This avoids situations where a wrong contract address is specified by mistake.
     */
    function proveTreasury() external pure;
}
