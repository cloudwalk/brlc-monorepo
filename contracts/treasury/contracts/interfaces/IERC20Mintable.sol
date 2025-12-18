// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IERC20Mintable interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The interface of a token that supports mint and burn operations.
 */
interface IERC20Mintable {
    /**
     * @dev Mints tokens.
     *
     * @param account The address of a tokens recipient.
     * @param amount The amount of tokens to mint.
     * @return True if the operation was successful.
     */
    function mint(address account, uint256 amount) external returns (bool);

    /**
     * @dev Mints tokens from reserve.
     *
     * Minting from reserve means that the tokens are minted in a regular way, but we also
     * increase the total reserve supply by the amount of tokens minted.
     *
     * @param account The address of a tokens recipient.
     * @param amount The amount of tokens to mint.
     */
    function mintFromReserve(address account, uint256 amount) external;

    /**
     * @dev Burns tokens.
     *
     * @param amount The amount of tokens to burn.
     */
    function burn(uint256 amount) external;

    /**
     * @dev Burns tokens to reserve.
     *
     * Burning to reserve means that the tokens are burned in a regular way, but we also
     * decrease the total reserve supply by the amount of tokens burned.
     *
     * @param amount The amount of tokens to burn.
     */
    function burnToReserve(uint256 amount) external;
}
