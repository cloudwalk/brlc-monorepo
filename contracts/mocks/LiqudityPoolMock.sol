// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title LiquidityPoolMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Mock of the `LiquidityPool` contract used for testing.
 */
contract LiquidityPoolMock {
    // ------------------ Storage --------------------------------- //

    /// @dev Flag to control whether onBeforeLiquidityIn should revert.
    bool public revertOnBeforeLiquidityIn;

    /// @dev Flag to control whether onBeforeLiquidityOut should revert.
    bool public revertOnBeforeLiquidityOut;

    /// @dev The addon treasury address.
    address public addonTreasury;

    // ------------------ Events ---------------------------------- //

    event MockLiquidityIn(uint256 amount);
    event MockLiquidityOut(uint256 amount);

    // ------------------ Errors ---------------------------------- //

    /// @dev Error thrown when onBeforeLiquidityIn is set to revert.
    error LiquidityPoolMock_OnBeforeLiquidityInReverted();

    /// @dev Error thrown when onBeforeLiquidityOut is set to revert.
    error LiquidityPoolMock_OnBeforeLiquidityOutReverted();

    // ------------------ Hook functions -------------------------- //

    /**
     * @dev Hook function called before tokens are transferred into the pool.
     * @param amount The amount of tokens to be transferred into the pool.
     */
    function onBeforeLiquidityIn(uint256 amount) external {
        if (revertOnBeforeLiquidityIn) {
            revert LiquidityPoolMock_OnBeforeLiquidityInReverted();
        }

        emit MockLiquidityIn(amount);
    }

    /**
     * @dev Hook function called before tokens are transferred out of the pool.
     * @param amount The amount of tokens to be transferred out of the pool.
     */
    function onBeforeLiquidityOut(uint256 amount) external {
        if (revertOnBeforeLiquidityOut) {
            revert LiquidityPoolMock_OnBeforeLiquidityOutReverted();
        }

        emit MockLiquidityOut(amount);
    }

    // ------------------ Mock control functions ------------------ //

    /**
     * @dev Sets whether onBeforeLiquidityIn should revert.
     * @param shouldRevert True to make the hook revert, false otherwise.
     */
    function setRevertOnBeforeLiquidityIn(bool shouldRevert) external {
        revertOnBeforeLiquidityIn = shouldRevert;
    }

    /**
     * @dev Sets whether onBeforeLiquidityOut should revert.
     * @param shouldRevert True to make the hook revert, false otherwise.
     */
    function setRevertOnBeforeLiquidityOut(bool shouldRevert) external {
        revertOnBeforeLiquidityOut = shouldRevert;
    }

    /**
     * @dev Sets the addon treasury address.
     * @param treasury The address to set as addon treasury.
     */
    function setAddonTreasury(address treasury) external {
        addonTreasury = treasury;
    }

    // ------------------ Helper functions ------------------------- //

    /**
     * @dev Approves a spender to transfer tokens from this contract.
     * @param token The address of the token to approve.
     * @param spender The address of the spender.
     * @param amount The amount of tokens to approve.
     */
    function approveToken(address token, address spender, uint256 amount) external {
        IERC20(token).approve(spender, amount);
    }

    // ------------------ Pure functions -------------------------- //

    /**
     * @dev Proves the contract is a liquidity pool. A marker function.
     */
    function proveLiquidityPool() external pure {}
}
