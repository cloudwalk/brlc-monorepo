// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AddressBook library
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Manages a mapping of account addresses to unique IDs and vice versa.
 *
 * IDs start at 1 (0 means "no account", the zero address).
 */
library AddressBook {
    // ------------------ Types ----------------------------------- //

    /**
     * @dev Defines the table structure for the address book.
     *
     * Fields:
     *
     * - idToAccount -- The mapping of ID to account address.
     * - accountToId -- The mapping of account address to ID.
     * - recordCount -- The number of accounts in the table.
     */
    struct Table {
        mapping(uint256 id => address) idToAccount;
        mapping(address account => uint256) accountToId;
        uint256 recordCount;
    }

    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when a new account is added to the address book.
     *
     * @param account The address of the account added.
     * @param id The ID assigned to the account.
     */
    event AddressBookAccountAdded(address indexed account, uint256 indexed id);

    // ------------------ Transactional functions  ---------------- //

    /**
     * @dev Adds an account to the address book.
     *
     * @param table The table to add the account to.
     * @param account The address of the account to add.
     * @return id The ID of the account.
     */
    function addAccount(Table storage table, address account) internal returns (uint256 id) {
        if (account == address(0)) {
            return 0;
        }
        id = table.accountToId[account];
        if (id != 0) {
            return id;
        }
        id = table.recordCount + 1;
        table.recordCount = id;
        table.idToAccount[id] = account;
        table.accountToId[account] = id;

        emit AddressBookAccountAdded(account, id);
    }

    // ------------------ View functions  ------------------------- //

    /**
     * @dev Gets the account related to an ID.
     *
     * @param table The table to get the account from.
     * @param id The ID of the account to get.
     * @return account The address of the account.
     */
    function getAccount(Table storage table, uint256 id) internal view returns (address) {
        if (id == 0) {
            return address(0);
        }
        return table.idToAccount[id];
    }
}
