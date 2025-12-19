// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

/**
 * @title ILiquidityPool interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the needed functions to interact with the liquidity pool contract.
 */
interface ILiquidityPool {
    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Hook function that must be called before tokens are transferred into the pool.
     *
     * Checks whether the transfer will not break the pool balance.
     * Updates the internal borrowable balance to reflect the incoming liquidity.
     *
     * @param amount The amount of tokens to be transferred into the pool.
     */
    function onBeforeLiquidityIn(uint256 amount) external;

    /**
     * @dev Hook function that must be called before tokens are transferred out of the pool.
     *
     * Checks whether the transfer will not break the pool balance.
     * Updates the internal borrowable balance to reflect the outgoing liquidity.
     *
     * @param amount The amount of tokens to be transferred out of the pool.
     */
    function onBeforeLiquidityOut(uint256 amount) external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Returns the addon treasury address.
     *
     * Previously, this address affected the pool logic.
     * But since version 1.8.0, the ability to save the addon amount in the pool has become deprecated.
     * Now the addon amount must always be output to an external wallet. The addon balance of the pool is always zero.
     *
     * @return The current address of the addon treasury.
     */
    function addonTreasury() external view returns (address);

    // ------------------ Pure functions -------------------------- //

    /// @dev Proves the contract is the liquidity pool one. A marker function.
    function proveLiquidityPool() external pure;
}
