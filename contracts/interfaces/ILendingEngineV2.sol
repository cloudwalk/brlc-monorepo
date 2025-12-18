// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { ILendingMarketV2Types } from "./ILendingMarketV2.sol";

/**
 * @title ILendingEngineV2 interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The lending engine contract interface.
 *
 * All engine functions must be called through `delegatecall` from the `LendingMarket` contract.
 */
interface ILendingEngineV2 is ILendingMarketV2Types {
    // ------------------ Errors ---------------------------------- //
    /**
     * @dev Thrown when the lending market implementation address is invalid
     *      (does not implement the needed proof function).
     */
    error LendingEngineV2_ImplementationAddressInvalid();

    /**
     * @dev Thrown when a function is called from an unauthorized call context.
     *
     * E.g., not through a delegate call from the lending market contract.
     */
    error LendingEngineV2_UnauthorizedCallContext();

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Takes a loan with multiple sub-loans for a provided borrower.
     *
     * Can be called only by an account with a special role.
     *
     * @param loanTakingRequest The request structure with the loan parameters.
     * @param subLoanTakingRequests The request structures with the individual sub-loan parameters.
     * @return firstSubLoanId The unique identifier of the first sub-loan of the loan.
     */
    function takeLoan(
        LoanTakingRequest calldata loanTakingRequest,
        SubLoanTakingRequest[] calldata subLoanTakingRequests
    ) external returns (uint256 firstSubLoanId);

    /**-
     * @dev Revokes a loan by the ID of any of its sub-loans.
     * @param subLoanId The unique identifier of the sub-loan to revoke.
     */
    function revokeLoan(uint256 subLoanId) external;

    /**
     * @dev Adds an operation to a sub-loan operation list without processing it.
     *
     * Not all operation kinds are allowed to be explicitly added. See the `OperationKind` enum for the details.
     *
     * The operation timestamp can be in the past, or (for some operation kinds) in the future related to
     * the current block timestamp and/or the sub-loan tracked timestamp.
     * See details about the operation application in the `docs/description.md` file.
     *
     * If an operation does not require a value or an account, the appropriate parameters must be set to zero.
     * See the `OperationKind` enum for the details about the operation parameters.
     *
     * @param subLoanId The unique identifier of the sub-loan to add the operation to.
     * @param kind The kind of the operation to add.
     * @param timestamp The timestamp of the operation to add. Can be in the past, not in the future. If zero, the current block timestamp will be used.
     * @param value The value of the operation to add. The meaning of the value depends on the operation kind.
     * @param account The address of the account that will perform the operation.
     *
     * Notes:
     *
     * - Operation IDs are auto-generated sequentially within each sub-loan.
     */
    function addOperation(
        uint256 subLoanId, // Tools: prevent Prettier one-liner
        uint256 kind,
        uint256 timestamp,
        uint256 value,
        address account
    ) external;

    /**
     * @dev Cancels an operation of a sub-loan without replaying the sub-loan.
     *
     * If the operation is already applied it will be marked as revoked with additional changes
     * in sub-loan fields needed to reprocessed the loan in the near future.
     * If the operation is not yet applied it will be simply marked as dismissed.
     *
     * The canceled operation will be kept in the operation list of the sub-loan.
     *
     * See details about the operation cancellation (voiding) in the `docs/description.md` file.
     *
     * If the counterparty is not needed for the canceled operation, the appropriate parameter must be set to zero.
     *
     * @param subLoanId The unique identifier of the sub-loan to cancel the operation of.
     * @param operationId The unique identifier of the operation to cancel.
     * @param counterparty The address of the account that will provide or receive tokens during the operation cancellation.
     */
    function cancelOperation(
        uint256 subLoanId, // Tools: prevent Prettier one-liner
        uint256 operationId,
        address counterparty
    ) external;

    /**
     * @dev Processes a sub-loan taking into account recent changes in operations.
     *
     * See details about the sub-loan processing in the `docs/description.md` file.
     *
     * @param subLoanId The unique off-chain identifier of the sub-loan to process.
     */
    function processSubLoan(uint256 subLoanId) external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Returns the preview of a sub-loan for a specific timestamp.
     *
     * The timestamp can be in the past, but not earlier than the sub-loan start timestamp.
     *
     * @param subLoanId The unique off-chain identifier of the sub-loan to preview.
     * @param timestamp The timestamp to preview the sub-loan at.
     * @param flags The flags to preview the sub-loan with. See the `SubLoanPreviewRequest` structure for the details.
     */
    function previewSubLoan(
        uint256 subLoanId,
        uint256 timestamp,
        uint256 flags
    ) external view returns (ProcessingSubLoan memory subLoan);

    /**
     * @dev Returns the implementation address of the lending engine contract.
     *
     * The implementation address is needed to execute the proper delegation call to the lending engine contract
     * from the lending market contract. We cannot `delegatecall` the engine proxy directly because the call is executed
     * in the lending market storage context, so the proxy's implementation slot would point to the market's own
     * implementation rather than the engine one.
     */
    function getImplementation() external view returns (address);

    // ------------------ Pure functions ------------------ //

    /// @dev Proves the contract is the lending market engine one. A marker function.
    function proveLendingEngineV2() external pure;
}
