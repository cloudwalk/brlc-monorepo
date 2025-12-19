// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title ERC20Mock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Mock of the `ERC20` token contract used for testing.
 */
contract ERC20TokenMock is ERC20 {
    // ------------------ Constructor ----------------------------- //

    constructor() ERC20("ERC20 for Tests", "TEST") {}

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Mints tokens.
     * @param account The address to mint tokens to.
     * @param amount The amount of tokens to mint.
     */
    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}
