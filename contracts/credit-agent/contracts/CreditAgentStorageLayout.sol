// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { ICreditAgentTypes } from "./interfaces/ICreditAgent.sol";

/**
 * @title CreditAgentStorageLayout contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the storage layout for the credit agent contract.
 *
 * See details about the contract in the comments of the {ICreditAgent} interface.
 */
abstract contract CreditAgentStorageLayout is ICreditAgentTypes {
    // --- Storage layout ----- //

    /*
     * ERC-7201: Namespaced Storage Layout
     * keccak256(abi.encode(uint256(keccak256("cloudwalk.storage.CreditAgent")) - 1)) & ~bytes32(uint256(0xff))
     */
    bytes32 private constant CREDIT_AGENT_STORAGE_LOCATION =
        0xc9a7c133291156951712043a2f51acd97439f45bd84bf994c7488a1baaece700;

    /**
     * @dev Defines the contract storage structure.
     *
     * Fields:
     *
     * - cashier ------------ The address of the cashier contract.
     * - lendingMarket ------ The address of the lending market contract.
     * - creditRequests ----- The mapping of a credit request structure for a given transaction identifier.
     * - agentState --------- The state of this agent contract.
     *
     * @custom:storage-location erc7201:cloudwalk.storage.CreditAgent
     */
    struct CreditAgentStorage {
        // Slot 1
        address cashier;
        // uint96 __reserved1; // Reserved until the end of the storage slot

        // Slot 2
        address lendingMarket;
        // uint96 __reserved2; // Reserved until the end of the storage slot

        // Slot 3
        mapping(bytes32 txId => CreditRequest creditRequest) creditRequests;
        // No reserve until the end of the storage slot

        // Slot 4
        AgentState agentState;
        // uint184 __reserved; // Reserved until the end of the storage slot
    }

    // --- Internal functions ---- //

    /// @dev Returns the storage slot location for the `CreditAgentStorage` struct.
    function _getCreditAgentStorage() internal pure returns (CreditAgentStorage storage $) {
        assembly {
            $.slot := CREDIT_AGENT_STORAGE_LOCATION
        }
    }
}
