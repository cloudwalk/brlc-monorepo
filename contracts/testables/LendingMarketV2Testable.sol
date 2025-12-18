// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { LendingMarketV2 } from "../LendingMarketV2.sol";

/**
 * @title LendingMarketV2Testable contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The version of the lending market contract with additions required for testing.
 * @custom:oz-upgrades-unsafe-allow missing-initializer
 */
contract LendingMarketV2Testable is LendingMarketV2 {
    /**
     * @dev Returns the sub-loan inception data for a given sub-loan ID.
     * @param subLoanId The ID of the sub-loan to retrieve.
     * @return The SubLoanInception struct associated with the given ID.
     */
    function getSubLoanInception(uint256 subLoanId) external view returns (SubLoanInception memory) {
        return _getLendingMarketStorage().subLoans[subLoanId].inception;
    }

    /**
     * @dev Returns the sub-loan metadata for a given sub-loan ID.
     * @param subLoanId The ID of the sub-loan to retrieve.
     * @return The SubLoanMetadata struct associated with the given ID.
     */
    function getSubLoanMetadata(uint256 subLoanId) external view returns (SubLoanMetadata memory) {
        return _getLendingMarketStorage().subLoans[subLoanId].metadata;
    }

    /**
     * @dev Returns the sub-loan state for a given sub-loan ID.
     * @param subLoanId The ID of the sub-loan to retrieve.
     * @return The SubLoanState struct associated with the given ID.
     */
    function getSubLoanState(uint256 subLoanId) external view returns (SubLoanState memory) {
        return _getLendingMarketStorage().subLoans[subLoanId].state;
    }

    /**
     * @dev Sets the status of a sub-loan.
     * @param subLoanId The ID of the sub-loan to set the status of.
     * @param status The status to set.
     */
    function mockSubLoanStatus(uint256 subLoanId, SubLoanStatus status) external {
        _getLendingMarketStorage().subLoans[subLoanId].state.status = status;
    }
}
