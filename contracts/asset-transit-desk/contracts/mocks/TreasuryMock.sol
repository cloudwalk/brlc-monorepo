// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { ITreasury } from "../interfaces/ITreasury.sol";

/**
 * @title TreasuryMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Mock implementation of the Treasury contract for testing purposes.
 */
contract TreasuryMock is ITreasury {
    using SafeERC20 for IERC20;

    // ------------------ Storage --------------------------------- //

    /// @dev The address of the underlying token.
    address private _token;

    // ------------------ Constructor ----------------------------- //

    /**
     * @dev Constructor that sets the underlying token address.
     *
     * @param token_ The address of the underlying token.
     */
    constructor(address token_) {
        _token = token_;
    }

    // ------------------ Transactional functions ----------------- //

    /// @inheritdoc ITreasury
    function withdraw(uint256 amount) external {
        IERC20(_token).safeTransfer(msg.sender, amount);
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc ITreasury
    function underlyingToken() external view returns (address) {
        return _token;
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc ITreasury
    function proveTreasury() external pure {}

    // ------------------ Test helper functions ------------------- //

    /**
     * @dev Sets the underlying token address.
     * @param token_ The new underlying token address.
     */
    function setToken(address token_) external {
        _token = token_;
    }
}
