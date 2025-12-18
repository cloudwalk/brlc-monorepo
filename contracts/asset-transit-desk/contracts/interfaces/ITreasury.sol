// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title ITreasury interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The interface of the Treasury smart contract for AssetTransitDesk integration.
 *
 * The Treasury contract is a vault for ERC20 tokens with controlled spending rules.
 */
interface ITreasury {
    /**
     * @dev Withdraws tokens from the treasury to the caller's address.
     *
     * @param amount The amount of tokens to withdraw.
     */
    function withdraw(uint256 amount) external;

    /**
     * @dev Returns the address of the underlying token contract.
     *
     * @return The address of the underlying token.
     */
    function underlyingToken() external view returns (address);

    /**
     * @dev Proves the contract is the Treasury one. A marker function.
     *
     * It is used for simple contract compliance checks, e.g. during an upgrade.
     * This avoids situations where a wrong contract address is specified by mistake.
     */
    function proveTreasury() external pure;
}
