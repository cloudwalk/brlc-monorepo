// SPDX-License-Identifier: MIT

pragma solidity ^0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20Mintable } from "../../interfaces/IERC20Mintable.sol";

/**
 * @title ERC20TokenMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev An implementation of the {ERC20} contract for testing purposes.
 */
contract ERC20TokenMock is ERC20, IERC20Mintable {
    // ------------------ Constructor ----------------------------- //

    /**
     * @dev The constructor of the contract.
     * @param name_ The name of the token to set for this ERC20-compatible contract.
     * @param symbol_ The symbol of the token to set for this ERC20-compatible contract.
     */
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    // ------------------ Events ---------------------------------- //

    /// @dev Emitted when tokens are minted.
    event Minted(address indexed account, uint256 amount);

    /// @dev Emitted when tokens are minted from reserve.
    event MintedFromReserve(address indexed account, uint256 amount);

    /// @dev Emitted when tokens are burned.
    event Burned(uint256 amount);

    /// @dev Emitted when tokens are burned to reserve.
    event BurnedToReserve(uint256 amount);

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Calls the appropriate internal function to mint needed amount of tokens for an account.
     * @param account The address of an account to mint for.
     * @param amount The amount of tokens to mint.
     * @return True if the operation was successful.
     */
    function mint(address account, uint256 amount) external returns (bool) {
        _mint(account, amount);
        emit Minted(account, amount);
        return true;
    }

    /**
     * @dev Mints tokens from reserve (mock implementation).
     * @param account The address of an account to mint for.
     * @param amount The amount of tokens to mint.
     */
    function mintFromReserve(address account, uint256 amount) external {
        _mint(account, amount);
        emit MintedFromReserve(account, amount);
    }

    /**
     * @dev Burns tokens from the caller's balance (mock implementation).
     * @param amount The amount of tokens to burn.
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
        emit Burned(amount);
    }

    /**
     * @dev Burns tokens to reserve from the caller's balance (mock implementation).
     * @param amount The amount of tokens to burn.
     */
    function burnToReserve(uint256 amount) external {
        _burn(msg.sender, amount);
        emit BurnedToReserve(amount);
    }
}
