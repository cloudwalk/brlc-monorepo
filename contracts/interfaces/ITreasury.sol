// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title ITreasuryPrimary interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary part of the Treasury smart contract interface.
 */
interface ITreasuryPrimary {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when tokens are withdrawn from the treasury.
     *
     * @param to The address that received the tokens.
     * @param withdrawer The address that initiated the withdrawal.
     * @param amount The amount of tokens withdrawn.
     */
    event Withdrawal(address indexed to, address indexed withdrawer, uint256 amount);

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
     * @dev Approves a spender to spend tokens from the treasury using `ERC20.transferFrom`.
     *
     * @param spender The address to approve as a spender.
     * @param amount The amount of tokens the spender is allowed to spend.
     */
    function approve(address spender, uint256 amount) external;

    /**
     * @dev Clears all ERC20 allowances for all spenders.
     */
    function clearAllApprovals() external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Returns all approved accounts.
     * @return An array of approved spender addresses.
     */
    function approvedSpenders() external view returns (address[] memory);

    /// @dev Returns the address of the underlying token contract.
    function underlyingToken() external view returns (address);
}

/**
 * @title ITreasuryErrors interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the custom errors used in the Treasury contract.
 */
interface ITreasuryErrors {
    /// @dev Thrown if the provided token address is zero.
    error Treasury_TokenAddressZero();

    /// @dev Thrown if the provided spender address is zero.
    error Treasury_SpenderAddressZero();

    /// @dev Thrown if the provided new implementation address is not of a treasury contract.
    error Treasury_ImplementationAddressInvalid();
}

/**
 * @title ITreasury interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The full interface of the Treasury smart contract.
 *
 * The Treasury contract is a vault for ERC20 tokens with controlled spending rules.
 * It allows designated withdrawers to withdraw tokens and approved spenders to transfer tokens via ERC20 allowances.
 * The contract supports role-based access control and can be paused for security.
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
