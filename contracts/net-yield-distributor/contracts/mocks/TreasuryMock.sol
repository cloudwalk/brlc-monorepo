// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ITreasury } from "../interfaces/ITreasury.sol";

/**
 * @title TreasuryMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev A mock implementation of the {ITreasury} interface for testing purposes.
 *
 * This mock allows for configurable behavior to test various scenarios including
 * successful withdrawals and failure cases.
 */
contract TreasuryMock is ITreasury {
    // ------------------ Types ----------------------------------- //

    using SafeERC20 for IERC20;

    // ------------------ State variables ------------------------- //

    /// @dev The address of the underlying token.
    address private immutable _underlyingToken;

    /// @dev Counter for the number of withdraw calls made.
    uint256 public withdrawCallCount;

    /// @dev The total amount withdrawn across all calls.
    uint256 public totalWithdrawn;

    // ------------------ Constructor ----------------------------- //

    /**
     * @dev Constructor that sets the underlying token address.
     *
     * @param underlyingToken_ The address of the underlying ERC20 token.
     */
    constructor(address underlyingToken_) {
        _underlyingToken = underlyingToken_;
    }

    // ------------------ External functions ---------------------- //

    /**
     * @inheritdoc ITreasury
     *
     * @dev Withdraws tokens from the treasury to the caller's address.
     *
     * This mock transfers the requested amount of tokens to msg.sender and tracks
     * the withdrawal for testing purposes. If the treasury has insufficient balance,
     * the transfer will revert.
     */
    function withdraw(uint256 amount) external {
        withdrawCallCount++;
        totalWithdrawn += amount;
        IERC20(_underlyingToken).safeTransfer(msg.sender, amount);
    }

    /// @inheritdoc ITreasury
    function underlyingToken() external view returns (address) {
        return _underlyingToken;
    }

    /// @inheritdoc ITreasury
    function proveTreasury() external pure {}
}
