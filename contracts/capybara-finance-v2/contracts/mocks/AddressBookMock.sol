// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { AddressBook } from "../libraries/AddressBook.sol";

/**
 * @title AddressBookMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev A mock contract to test the AddressBook library functions.
 */
contract AddressBookMock {
    using AddressBook for AddressBook.Table;

    // ------------------ Storage --------------------------------- //

    AddressBook.Table internal _table;

    // ------------------ Transactional functions  ---------------- //

    /**
     * @dev Adds an account to the internal address book table.
     *
     * @param account The address of the account to add.
     * @return id The ID of the account.
     */
    function addAccount(address account) external returns (uint256 id) {
        return AddressBook.addAccount(_table, account);
    }

    // ------------------ View functions  ------------------------- //

    /**
     * @dev Gets the account related to an ID from the internal table.
     *
     * @param id The ID of the account to get.
     * @return account The address of the account.
     */
    function getAccount(uint256 id) external view returns (address account) {
        return AddressBook.getAccount(_table, id);
    }

    /**
     * @dev Gets the stored ID by account from the internal table.
     *
     * @param account The address of the account to get ID for.
     * @return id The ID of the account.
     */
    function getId(address account) external view returns (uint256 id) {
        return _table.accountToId[account];
    }

    /**
     * @dev Returns the current number of records in the internal table.
     *
     * @return count The number of accounts stored in the table.
     */
    function getRecordCount() external view returns (uint256 count) {
        return _table.recordCount;
    }
}
