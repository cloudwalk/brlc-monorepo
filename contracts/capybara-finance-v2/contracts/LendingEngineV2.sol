// SPDX-License-Identifier: MIT

pragma solidity 0.8.30;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { ERC1967Utils } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { ABDKMath64x64 } from "./libraries/ABDKMath64x64.sol";
import { AddressBook } from "./libraries/AddressBook.sol";

import { ICreditLineV2 } from "./interfaces/ICreditLineV2.sol";
import { ILendingEngineV2 } from "./interfaces/ILendingEngineV2.sol";
import { ILiquidityPool } from "./interfaces/ILiquidityPool.sol";

import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";

import { LendingMarketV2Core } from "./core/LendingMarketV2Core.sol";

/**
 * @title LendingEngineV2 contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The lending engine contract.
 *
 * See details about the smart contract logic in the `docs/description.md` file.
 */
contract LendingEngineV2 is
    AccessControlUpgradeable,
    LendingMarketV2Core,
    Versionable,
    UUPSExtUpgradeable,
    ILendingEngineV2
{
    // ------------------ Types ----------------------------------- //

    using SafeERC20 for IERC20;
    using AddressBook for AddressBook.Table;

    /**
     * @dev Defines the summary of a loan over all its sub-loans.
     *
     * This structure is intended for in-memory internal use only.
     *
     * Fields:
     *
     * - programId ------------ The ID of the lending program.
     * - borrower ------------- The address of the borrower.
     * - totalBorrowedAmount -- The total borrowed amount.
     * - totalAddonAmount ----- The total addon amount.
     * - totalRepaidAmount ---- The total repaid amount.
     * - ongoingSubLoanCount -- The number of ongoing sub-loans.
     */
    struct LoanSummary {
        uint256 programId;
        address borrower;
        uint256 totalBorrowedAmount;
        uint256 totalAddonAmount;
        uint256 totalRepaidAmount;
        uint256 ongoingSubLoanCount;
    }

    // ------------------ Constants ------------------------------- //

    /// @dev The role of this contract owner.
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    // ------------------ Constructor ----------------------------- //

    /**
     * @dev Constructor that prohibits the initialization of the implementation of the upgradeable contract.
     *
     * See details
     * https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable#initializing_the_implementation_contract
     *
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev Initializer of the upgradeable contract.
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     */
    function initialize() external initializer {
        __AccessControl_init();
        __UUPSExt_init_unchained();

        _setRoleAdmin(OWNER_ROLE, OWNER_ROLE);
        _grantRole(OWNER_ROLE, msg.sender);
    }

    // ------------------ Transactional functions ------------------ //

    /// @inheritdoc ILendingEngineV2
    function takeLoan(
        LoanTakingRequest calldata loanTakingRequest,
        SubLoanTakingRequest[] calldata subLoanTakingRequests
    ) external returns (uint256 firstSubLoanId) {
        _checkCallContext();
        return _takeLoan(loanTakingRequest, subLoanTakingRequests);
    }

    /// @inheritdoc ILendingEngineV2
    function revokeLoan(uint256 subLoanId) external {
        _checkCallContext();
        _revokeLoan(subLoanId);
    }

    /// @inheritdoc ILendingEngineV2
    function addOperation(uint256 subLoanId, uint256 kind, uint256 timestamp, uint256 value, address account) external {
        _checkCallContext();
        if (timestamp == 0) {
            timestamp = _blockTimestamp();
        }
        SubLoan storage subLoan = _getNonRevokedSubLoan(subLoanId);
        _checkOperationParameters(
            subLoan, // Tools: prevent Prettier one-liner
            kind,
            timestamp,
            value,
            account
        );
        _addOperation(
            subLoanId, // Tools: prevent Prettier one-liner
            kind,
            timestamp,
            value,
            account
        );
    }

    /// @inheritdoc ILendingEngineV2
    function cancelOperation(uint256 subLoanId, uint256 operationId, address counterparty) external {
        _checkCallContext();
        _cancelOperation(subLoanId, operationId, counterparty);
    }

    /// @inheritdoc ILendingEngineV2
    function processSubLoan(uint256 subLoanId) external {
        _checkCallContext();
        _processSubLoan(subLoanId);
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc ILendingEngineV2
    function previewSubLoan(
        uint256 subLoanId,
        uint256 timestamp
    ) external view returns (ProcessingSubLoan memory subLoan) {
        _checkCallContext();
        return _previewSubLoan(subLoanId, timestamp);
    }

    /// @inheritdoc ILendingEngineV2
    function getImplementation() external view returns (address) {
        return ERC1967Utils.getImplementation();
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc ILendingEngineV2
    function proveLendingEngineV2() external pure {}

    // ------------------ Internal functions -------------------- //

    /**
     * @dev Checks the call context and ensures the block timestamp does not exceed the maximum allowed value.
     */
    function _checkCallContext() internal view {
        if (_getLendingMarketStorage().storageKind != STORAGE_KIND_MARKET) {
            revert LendingEngineV2_UnauthorizedCallContext();
        }
        if (_blockTimestamp() > type(uint32).max) {
            revert LendingMarketV2_BlockTimestampExcess();
        }
    }

    /**
     * @dev Takes a loan with multiple sub-loans, validates parameters, and transfers funds to the borrower.
     */
    function _takeLoan(
        LoanTakingRequest calldata loanTakingRequest,
        SubLoanTakingRequest[] calldata subLoanTakingRequests
    ) internal returns (uint256 firstSubLoanId) {
        uint256 subLoanCount = subLoanTakingRequests.length;

        _checkSubLoanCount(subLoanCount);
        (uint256 totalBorrowedAmount, uint256 totalAddonAmount) = _calculateTotalBorrowedAndAddonAmounts(
            subLoanTakingRequests
        );
        _checkLoanParameters(
            loanTakingRequest, // Tools: prevent Prettier one-liner
            totalBorrowedAmount,
            totalAddonAmount
        );
        firstSubLoanId = _getLendingMarketStorage().subLoanAutoIdCounter + SUB_LOAN_AUTO_ID_START;
        _increaseSubLoanRelatedCounters(subLoanCount);

        for (uint256 i = 0; i < subLoanCount; ++i) {
            uint256 subLoanId = firstSubLoanId + i;
            if (i != 0) {
                // This check prevents a possible backend error and can be removed without side effects.
                // In a PRICE system loan, each subsequent sub-loan must have a longer duration than the previous one.
                if (subLoanTakingRequests[i].duration < subLoanTakingRequests[i - 1].duration) {
                    revert LendingMarketV2_LoanDurationsInvalid();
                }
            }
            SubLoan storage subLoan = _takeSubLoan(
                subLoanId,
                loanTakingRequest.borrower,
                loanTakingRequest.programId,
                loanTakingRequest.startTimestamp,
                subLoanTakingRequests[i]
            );
            subLoan.metadata.subLoanIndex = uint16(i); // This type cast is safe due to prior checks
            subLoan.metadata.subLoanCount = uint16(subLoanCount); // This type cast is safe due to prior checks
        }

        {
            LendingProgram storage program = _getLendingMarketStorage().programs[loanTakingRequest.programId];
            ICreditLineV2(program.creditLine).onBeforeLoanOpened(
                firstSubLoanId,
                loanTakingRequest.borrower,
                totalBorrowedAmount
            );
            _transferFromPool(loanTakingRequest.programId, loanTakingRequest.borrower, totalBorrowedAmount);
            if (totalAddonAmount != 0) {
                address addonTreasury = _getAndCheckAddonTreasury(loanTakingRequest.programId);
                _transferFromPool(loanTakingRequest.programId, addonTreasury, totalAddonAmount);
            }

            emit LoanTaken(
                firstSubLoanId, // Tools: prevent Prettier one-liner
                loanTakingRequest.borrower,
                loanTakingRequest.programId,
                totalBorrowedAmount,
                totalAddonAmount,
                subLoanCount,
                program.creditLine,
                program.liquidityPool
            );
        }
    }

    /**
     * @dev Revokes all sub-loans associated with the given sub-loan ID and transfers tokens back to the pool.
     */
    function _revokeLoan(uint256 subLoanId) internal {
        SubLoan storage subLoan = _getExitingSubLoan(subLoanId);

        uint256 firstSubLoanId = subLoanId - subLoan.metadata.subLoanIndex;
        uint256 subLoanCount = subLoan.metadata.subLoanCount;

        for (uint256 i = 0; i < subLoanCount; ++i) {
            subLoanId = firstSubLoanId + i;
            subLoan = _getNonRevokedSubLoan(subLoanId);
            _addOperation(
                subLoanId, // Tools: prevent Prettier one-liner
                uint256(OperationKind.Revocation),
                _blockTimestamp(),
                0,
                address(0)
            );
            _processSubLoan(subLoanId);
        }

        (int256 revokedBorrowedAmount, uint256 revokedAddonAmount) = _transferTokensOnLoanRevocation(
            firstSubLoanId,
            subLoanCount
        );

        emit LoanRevoked(
            firstSubLoanId, // Tools: prevent Prettier one-liner
            subLoanCount,
            revokedBorrowedAmount,
            revokedAddonAmount
        );
    }

    /**
     * @dev Creates a sub-loan structs with inception, state, and metadata fields initialized.
     */
    function _takeSubLoan(
        uint256 subLoanId,
        address borrower,
        uint256 programId,
        uint256 startTimestamp,
        SubLoanTakingRequest calldata subLoanTakingRequest
    ) internal returns (SubLoan storage subLoan) {
        subLoan = _getSubLoan(subLoanId);

        if (subLoan.state.status != SubLoanStatus.Nonexistent) {
            revert LendingMarketV2_SubLoanExistentAlready(subLoanId);
        }
        if (subLoanTakingRequest.borrowedAmount == 0) {
            revert LendingMarketV2_SubLoanBorrowedAmountInvalid();
        }
        // The zero duration is allowed intentionally. Such a sub-loan should be repaid at the same day.
        if (subLoanTakingRequest.duration > type(uint16).max) {
            revert LendingMarketV2_SubLoanDurationExcess();
        }
        // All rates cannot exceed 100%
        if (
            subLoanTakingRequest.upToDueRemuneratoryRate > INTEREST_RATE_FACTOR ||
            subLoanTakingRequest.postDueRemuneratoryRate > INTEREST_RATE_FACTOR ||
            subLoanTakingRequest.moratoryRate > INTEREST_RATE_FACTOR ||
            subLoanTakingRequest.lateFeeRate > INTEREST_RATE_FACTOR ||
            subLoanTakingRequest.clawbackFeeRate > INTEREST_RATE_FACTOR
        ) {
            revert LendingMarketV2_SubLoanRateValueExcess();
        }

        // Set the sub-loan fields and call the hook function in a separate block to avoid the 'stack too deep' error
        // All type cast operations are safe due to prior checks
        {
            if (startTimestamp == 0) {
                startTimestamp = _blockTimestamp();
            }
            uint256 borrowedAmount = subLoanTakingRequest.borrowedAmount;
            uint256 principal = borrowedAmount + subLoanTakingRequest.addonAmount;
            uint256 duration = subLoanTakingRequest.duration;

            subLoan.inception.borrower = borrower;
            subLoan.inception.programId = uint24(programId);
            subLoan.inception.startTimestamp = uint32(startTimestamp);
            subLoan.inception.initialDuration = uint16(duration);
            subLoan.inception.borrowedAmount = uint64(borrowedAmount);
            subLoan.inception.addonAmount = uint64(subLoanTakingRequest.addonAmount);
            subLoan.inception.initialUpToDueRemuneratoryRate = uint32(subLoanTakingRequest.upToDueRemuneratoryRate);
            subLoan.inception.initialPostDueRemuneratoryRate = uint32(subLoanTakingRequest.postDueRemuneratoryRate);
            subLoan.inception.initialMoratoryRate = uint32(subLoanTakingRequest.moratoryRate);
            subLoan.inception.initialLateFeeRate = uint32(subLoanTakingRequest.lateFeeRate);
            subLoan.inception.initialClawbackFeeRate = uint32(subLoanTakingRequest.clawbackFeeRate);

            // State fields, slot 1, 2
            subLoan.state.status = SubLoanStatus.Ongoing;
            // subLoan.state._reservedStatus = 0;
            subLoan.state.duration = uint16(duration);
            // subLoan.state.freezeTimestamp = 0;
            subLoan.state.trackedTimestamp = uint32(startTimestamp);
            subLoan.state.upToDueRemuneratoryRate = uint32(subLoanTakingRequest.upToDueRemuneratoryRate);
            subLoan.state.postDueRemuneratoryRate = uint32(subLoanTakingRequest.postDueRemuneratoryRate);
            subLoan.state.moratoryRate = uint32(subLoanTakingRequest.moratoryRate);
            subLoan.state.lateFeeRate = uint32(subLoanTakingRequest.lateFeeRate);
            subLoan.state.clawbackFeeRate = uint32(subLoanTakingRequest.clawbackFeeRate);

            // State fields, slot 3, 4
            subLoan.state.trackedPrincipal = uint64(principal);
            // subLoan.state.repaidPrincipal = 0;
            // subLoan.state.discountPrincipal = 0;
            // subLoan.state._reserved1 = 0;

            // State fields, slot 5, 6
            // subLoan.state.trackedUpToDueRemuneratoryInterest = 0;
            // subLoan.state.repaidUpToDueRemuneratoryInterest = 0;
            // subLoan.state.discountUpToDueRemuneratoryInterest = 0;
            // subLoan.state._reserved2 = 0;

            // State fields, slot 7, 8
            // subLoan.state.trackedPostDueRemuneratoryInterest = 0;
            // subLoan.state.repaidPostDueRemuneratoryInterest = 0;
            // subLoan.state.discountPostDueRemuneratoryInterest = 0;
            // subLoan.state._reserved3 = 0;

            // State fields, slot 9, 10
            // subLoan.state.trackedMoratoryInterest = 0;
            // subLoan.state.repaidMoratoryInterest = 0;
            // subLoan.state.discountMoratoryInterest = 0;
            // subLoan.state._reserved3 = 0;

            // State fields, slot 11, 12
            // subLoan.state.trackedLateFee = 0;
            // subLoan.state.repaidLateFee = 0;
            // subLoan.state.discountLateFee = 0;
            // subLoan.state._reserved4 = 0;

            // State fields, slot 13, 14
            // subLoan.state.trackedClawbackFee = 0;
            // subLoan.state.repaidClawbackFee = 0;
            // subLoan.state.discountClawbackFee = 0;
            // subLoan.state._reserved6 = 0;

            // Metadata fields
            // subLoan.metadata.subLoanIndex = 0;
            // subLoan.metadata.subLoanCount = 0;
            // subLoan.metadata.updateIndex = 0;
            // subLoan.metadata.pendingTimestamp = 0;
            // subLoan.metadata.operationCount = 0;
            // subLoan.metadata.earliestOperationId = 0;
            // subLoan.metadata.recentOperationId = 0;
        }

        {
            uint256 packedRates = _packRates(
                subLoanTakingRequest.upToDueRemuneratoryRate,
                subLoanTakingRequest.postDueRemuneratoryRate,
                subLoanTakingRequest.moratoryRate,
                subLoanTakingRequest.lateFeeRate,
                subLoanTakingRequest.clawbackFeeRate
            );
            emit SubLoanTaken(
                subLoanId,
                subLoanTakingRequest.borrowedAmount,
                subLoanTakingRequest.addonAmount,
                startTimestamp,
                subLoanTakingRequest.duration,
                bytes32(packedRates)
            );
        }
    }

    /**
     * @dev Adds a new operation to the sub-loan's operation list and emits an event for future operations.
     */
    function _addOperation(
        uint256 subLoanId,
        uint256 kind,
        uint256 timestamp,
        uint256 value,
        address account
    ) internal {
        SubLoan storage subLoan = _getSubLoan(subLoanId);
        uint256 operationId = _generateOperationId(subLoan);
        (uint256 prevOperationId, uint256 nextOperationId) = _insertOperationInList(subLoan, timestamp, operationId);

        // Any active operations are prohibited after the revocation one
        // Alternatively we could cancel any active operations after the revocation one, but it seems more error-prone
        if (
            kind == uint256(OperationKind.Revocation) && // Tools: prevent Prettier one-liner
            0 != _findNextActiveOperationId(subLoan, nextOperationId)
        ) {
            revert LendingMarketV2_OperationAfterRevocation();
        }

        _updatePendingTimestamp(subLoan, timestamp);

        Operation storage operation = subLoan.operations[operationId];
        operation.status = OperationStatus.Pending;
        operation.kind = OperationKind(kind);
        operation.prevOperationId = uint16(prevOperationId); // Safe cast due to prior checks
        operation.nextOperationId = uint16(nextOperationId); // Safe cast due to prior checks
        operation.timestamp = uint32(timestamp); // Safe cast due to prior checks
        operation.value = uint64(value); // Safe cast due to prior checks
        if (account != address(0)) {
            operation.accountId = uint64(_addOperationAccount(subLoan, account));
        }

        // Only emit event for future operations, the event about application is emitted during sub-loan processing
        if (timestamp > _blockTimestamp()) {
            emit OperationPended(
                subLoanId, // Tools: prevent Prettier one-liner
                operationId,
                OperationKind(kind),
                timestamp,
                value,
                account
            );
        }
    }

    /**
     * @dev Inserts an operation into the doubly-linked list maintaining chronological order by timestamp and ID.
     */
    function _insertOperationInList(
        SubLoan storage subLoan,
        uint256 timestamp,
        uint256 operationId
    ) internal returns (uint256 prevOperationId, uint256 nextOperationId) {
        prevOperationId = _findEarlierOperation(subLoan, timestamp, operationId);

        if (prevOperationId == 0) {
            // Add at the beginning of the operation list
            nextOperationId = subLoan.metadata.earliestOperationId;
            subLoan.metadata.earliestOperationId = uint16(operationId);
        } else {
            // Insert in the middle or at the end of the operation list
            Operation storage prevOperation = subLoan.operations[prevOperationId];
            nextOperationId = prevOperation.nextOperationId;
            prevOperation.nextOperationId = uint16(operationId);
        }

        if (nextOperationId != 0) {
            subLoan.operations[nextOperationId].prevOperationId = uint16(operationId);
        } else {
            subLoan.metadata.latestOperationId = uint16(operationId);
        }
    }

    /**
     * @dev Adds an account to the address book or returns the special ID if the account is the borrower.
     */
    function _addOperationAccount(SubLoan storage subLoan, address account) internal returns (uint256 accountId) {
        uint256 accountIdBorrower = _accountIdBorrower();
        if (account == subLoan.inception.borrower) {
            return accountIdBorrower;
        }
        accountId = _getLendingMarketStorage().accountAddressBook.addAccount(account);
        if (accountId >= accountIdBorrower) {
            revert LendingMarketV2_AccountIdExcess();
        }
    }

    /**
     * @dev Cancels an operation by dismissing it if pending or revoking it if already applied.
     */
    function _cancelOperation(
        uint256 subLoanId,
        uint256 operationId,
        address counterparty
    ) internal returns (Operation storage operation) {
        SubLoan storage subLoan = _getNonRevokedSubLoan(subLoanId);
        operation = subLoan.operations[operationId];
        _checkCancellationOperationParameters(operation);

        uint256 previousStatus = uint256(operation.status);
        if (previousStatus == uint256(OperationStatus.Pending)) {
            operation.status = OperationStatus.Dismissed;
            uint256 operationTimestamp = operation.timestamp;

            emit OperationDismissed(
                subLoanId, // Tools: prevent Prettier one-liner
                operationId,
                operation.kind,
                operationTimestamp,
                operation.value,
                _getOperationAccount(subLoan, operation)
            );
            if (operationTimestamp == subLoan.metadata.pendingTimestamp) {
                subLoan.metadata.pendingTimestamp = uint32(
                    _findNextActiveOperationTimestamp(subLoan, operation.nextOperationId)
                );
            }
        } else if (previousStatus == uint256(OperationStatus.Applied)) {
            operation.status = OperationStatus.Revoked;

            // An operation can be canceled without a counterparty. In that case tokens are kept in the pool.
            if (operation.kind == OperationKind.Repayment && counterparty != address(0)) {
                _transferFromPool(subLoan.inception.programId, counterparty, operation.value);
            }

            emit OperationRevoked(
                subLoanId, // Tools: prevent Prettier one-liner
                operationId,
                operation.kind,
                operation.timestamp,
                operation.value,
                _getOperationAccount(subLoan, operation),
                counterparty
            );

            _updatePendingTimestamp(subLoan, operation.timestamp);
        } else if (previousStatus == uint256(OperationStatus.Dismissed)) {
            revert LendingMarketV2_OperationDismissedAlready(subLoanId, operationId);
        } else if (previousStatus == uint256(OperationStatus.Revoked)) {
            revert LendingMarketV2_OperationRevokedAlready(subLoanId, operationId);
        } else {
            revert LendingMarketV2_OperationNonexistent(subLoanId, operationId);
        }
    }

    /**
     * @dev Transfers tokens from the borrower and addon treasury back to the liquidity pool on loan revocation.
     */
    function _transferTokensOnLoanRevocation(
        uint256 firstSubLoanId, // Tools: prevent Prettier one-liner
        uint256 subLoanCount
    ) internal returns (int256 revokedBorrowedAmount, uint256 revokedAddonAmount) {
        LoanSummary memory summary = _getLoanSummary(firstSubLoanId, subLoanCount);
        unchecked {
            revokedBorrowedAmount = int256(summary.totalBorrowedAmount) - int256(summary.totalRepaidAmount);
        }
        if (revokedBorrowedAmount > 0) {
            _transferToPool(summary.programId, summary.borrower, uint256(revokedBorrowedAmount));
        } else if (revokedBorrowedAmount != 0) {
            _transferFromPool(summary.programId, summary.borrower, uint256(-revokedBorrowedAmount));
        }
        revokedAddonAmount = summary.totalAddonAmount;
        if (revokedAddonAmount != 0) {
            address addonTreasury = _getAndCheckAddonTreasury(summary.programId);
            _transferToPool(summary.programId, addonTreasury, revokedAddonAmount);
        }
    }

    /**
     * @dev Transfers tokens from a liquidity pool to a receiver through this contract.
     */
    function _transferFromPool(uint256 programId, address receiver, uint256 amount) internal {
        LendingMarketStorage storage $ = _getLendingMarketStorage();
        address token = $.underlyingToken;
        address liquidityPool = $.programs[programId].liquidityPool;
        ILiquidityPool(liquidityPool).onBeforeLiquidityOut(amount);
        IERC20(token).safeTransferFrom(liquidityPool, address(this), amount);
        IERC20(token).safeTransfer(receiver, amount);
    }

    /**
     * @dev Transfers tokens from a sender to a liquidity pool through this contract.
     */
    function _transferToPool(uint256 programId, address sender, uint256 amount) internal {
        LendingMarketStorage storage $ = _getLendingMarketStorage();
        address token = $.underlyingToken;
        address liquidityPool = $.programs[programId].liquidityPool;
        ILiquidityPool(liquidityPool).onBeforeLiquidityIn(amount);
        IERC20(token).safeTransferFrom(sender, address(this), amount);
        IERC20(token).safeTransfer(liquidityPool, amount);
    }

    /**
     * @dev Finds the operation that should precede an inserted operation, traversing from latest to earliest.
     *
     *
     * Operations are ordered by timestamp and then by ID: earlier timestamps come first, and matching
     * timestamps are ordered by lower IDs before higher ones.
     *
     * It is expected that most likely new operations will be inserted at the end of the operation list.
     * Because the operation list is doubly linked, we can traverse it from the latest entry towards the earliest one,
     * we find the first operation that should stay before the inserted operation.
     */
    function _findEarlierOperation(
        SubLoan storage subLoan,
        uint256 insertedOperationTimestamp,
        uint256 insertedOperationId
    ) internal view returns (uint256) {
        uint256 operationId = subLoan.metadata.latestOperationId;

        while (operationId != 0) {
            Operation storage operation = subLoan.operations[operationId];

            // Found the latest operation that is still earlier (or equal timestamp but lower ID)
            if (
                operation.timestamp < insertedOperationTimestamp ||
                (operation.timestamp == insertedOperationTimestamp && operationId < insertedOperationId)
            ) {
                break;
            }

            operationId = operation.prevOperationId;
        }

        return operationId;
    }

    /**
     * @dev Finds the next active (pending or applied) operation ID starting from the given operation.
     * @return The ID of the next active operation, or zero if none found.
     */
    function _findNextActiveOperationId(SubLoan storage subLoan, uint256 operationId) internal view returns (uint256) {
        while (operationId != 0) {
            Operation storage operation = subLoan.operations[operationId];
            if (
                operation.status == OperationStatus.Pending || // Tools: prevent Prettier one-liner
                operation.status == OperationStatus.Applied
            ) {
                break;
            }
            operationId = operation.nextOperationId;
        }
        return operationId;
    }

    /**
     * @dev Finds the next active (pending or applied) operation timestamp starting from the given operation.
     * @return The timestamp of the next active operation, or zero if none found.
     */
    function _findNextActiveOperationTimestamp(
        SubLoan storage subLoan,
        uint256 operationId
    ) internal view returns (uint256) {
        uint256 activeOperationId = _findNextActiveOperationId(subLoan, operationId);
        if (activeOperationId == 0) {
            return 0;
        } else {
            return subLoan.operations[activeOperationId].timestamp;
        }
    }

    /**
     * @dev Processes a sub-loan by applying pending operations up to the current timestamp and updating storage.
     */
    function _processSubLoan(uint256 subLoanId) internal {
        ProcessingSubLoan memory subLoan = _convertToProcessingSubLoan(subLoanId, _getExitingSubLoan(subLoanId));
        uint256 timestamp = _blockTimestamp();

        // If there are no pending operations prior the current timestamp, no processing is needed.
        if (subLoan.pendingTimestamp == 0 || timestamp < subLoan.pendingTimestamp) {
            return;
        }

        // After applying, the tracked balance and tracked timestamp match the time of the last applied operation.
        (uint256 earliestNewlyAppliedOpId, uint256 newlyAppliedOpCount) = _applyOperations(subLoan, timestamp);
        _processNewlyAppliedOperations(subLoan, earliestNewlyAppliedOpId, newlyAppliedOpCount);
        _updateSubLoan(subLoan);
    }

    /**
     * @dev Returns a preview of the sub-loan state at the specified timestamp without modifying storage.
     */
    function _previewSubLoan(
        uint256 subLoanId,
        uint256 timestamp
    ) internal view returns (ProcessingSubLoan memory subLoan) {
        subLoan = _convertToProcessingSubLoan(subLoanId, _getSubLoan(subLoanId));

        if (timestamp == 0) {
            timestamp = _blockTimestamp();
        }
        if (timestamp == 1) {
            timestamp = subLoan.trackedTimestamp;
        }

        // After applying, the tracked balance and tracked timestamp match the time of the last applied operation.
        _applyOperations(subLoan, timestamp);

        // Extends the tracked timestamp and tracked balance up to the requested timestamp.
        _accrueInterest(subLoan, timestamp);
    }

    /**
     * @dev Applies or re-applies all operations up to the specified timestamp.
     */
    function _applyOperations(
        ProcessingSubLoan memory subLoan,
        uint256 timestamp
    ) internal view returns (uint256 earliestNewlyAppliedOperationId, uint256 newlyAppliedOperationCount) {
        if (timestamp < subLoan.startTimestamp) {
            revert LendingMarketV2_OperationApplyingTimestampTooEarly();
        }

        SubLoan storage storedSubLoan = _getSubLoan(subLoan.id);
        uint256 operationId;

        if (
            timestamp < subLoan.trackedTimestamp ||
            (subLoan.pendingTimestamp != 0 && subLoan.pendingTimestamp <= subLoan.trackedTimestamp)
        ) {
            _initiateSubLoan(subLoan);
        }

        uint256 recentOperationId = subLoan.recentOperationId;
        if (recentOperationId == 0) {
            operationId = subLoan.earliestOperationId;
        } else {
            operationId = storedSubLoan.operations[recentOperationId].nextOperationId;
        }

        while (operationId != 0) {
            Operation storage operation = storedSubLoan.operations[operationId];
            if (operation.timestamp > timestamp) {
                break;
            }
            uint256 operationStatus = uint256(operation.status);
            if (
                operationStatus == uint256(OperationStatus.Applied) || // Tools: prevent Prettier one-liner
                operationStatus == uint256(OperationStatus.Pending)
            ) {
                _applySingleOperation(subLoan, operation);
                if (operationStatus == uint256(OperationStatus.Pending)) {
                    ++newlyAppliedOperationCount;
                    if (earliestNewlyAppliedOperationId == 0) {
                        earliestNewlyAppliedOperationId = operationId;
                    }
                }
            }
            recentOperationId = operationId;
            operationId = storedSubLoan.operations[operationId].nextOperationId;
        }
        subLoan.recentOperationId = recentOperationId;

        if (0 == _calculateTrackedBalance(subLoan) && subLoan.status == uint256(SubLoanStatus.Ongoing)) {
            subLoan.status = uint256(SubLoanStatus.Repaid);
        }

        subLoan.pendingTimestamp = _findNextActiveOperationTimestamp(storedSubLoan, operationId);
    }

    /**
     * @dev Applies a single operation to the sub-loan, accruing interest and executing the operation logic.
     */
    function _applySingleOperation(ProcessingSubLoan memory subLoan, Operation storage operation) internal view {
        uint256 operationKind = uint256(operation.kind);

        // Any operation leads to the interest accrual up to its timestamp and changes the tracked timestamp.
        _accrueInterest(subLoan, operation.timestamp);

        if (operationKind == uint256(OperationKind.Repayment)) {
            _applyRepayment(subLoan, operation);
        } else if (operationKind == uint256(OperationKind.Discount)) {
            _applyDiscount(subLoan, operation);
        } else if (operationKind == uint256(OperationKind.Revocation)) {
            _applyRevocation(subLoan);
        } else if (operationKind == uint256(OperationKind.Freezing)) {
            _applyFreezing(subLoan, operation);
        } else if (operationKind == uint256(OperationKind.Unfreezing)) {
            _applyUnfreezing(subLoan, operation);
        } else if (operationKind == uint256(OperationKind.UpToDueRemuneratoryRateSetting)) {
            subLoan.upToDueRemuneratoryRate = operation.value;
        } else if (operationKind == uint256(OperationKind.PostDueRemuneratoryRateSetting)) {
            subLoan.postDueRemuneratoryRate = operation.value;
        } else if (operationKind == uint256(OperationKind.MoratoryRateSetting)) {
            subLoan.moratoryRate = operation.value;
        } else if (operationKind == uint256(OperationKind.LateFeeRateSetting)) {
            subLoan.lateFeeRate = operation.value;
        } else if (operationKind == uint256(OperationKind.ClawbackFeeRateSetting)) {
            subLoan.clawbackFeeRate = operation.value;
        } else if (operationKind == uint256(OperationKind.DurationSetting)) {
            subLoan.duration = operation.value;
        }
    }

    /**
     * @dev Processes newly applied operations by transferring tokens and updating their status to applied.
     */
    function _processNewlyAppliedOperations(
        ProcessingSubLoan memory subLoan, // Tools: prevent Prettier one-liner
        uint256 operationId,
        uint256 newlyAppliedOperationCount
    ) internal {
        SubLoan storage storedSubLoan = _getLendingMarketStorage().subLoans[subLoan.id];
        while (newlyAppliedOperationCount > 0 && operationId != 0) {
            Operation storage operation = storedSubLoan.operations[operationId];
            if (operation.status == OperationStatus.Pending) {
                address account = _getOperationAccount(storedSubLoan, operation);
                if (operation.kind == OperationKind.Repayment) {
                    _transferToPool(storedSubLoan.inception.programId, account, operation.value);
                }
                operation.status = OperationStatus.Applied;

                emit OperationApplied(
                    subLoan.id,
                    operationId,
                    operation.kind,
                    operation.timestamp,
                    operation.value,
                    account
                );

                unchecked {
                    --newlyAppliedOperationCount;
                }
            }
            operationId = operation.nextOperationId;
        }
    }

    /**
     * @dev Resets the sub-loan to its initial state for reprocessing from the start timestamp.
     */
    function _initiateSubLoan(ProcessingSubLoan memory subLoan) internal view {
        SubLoan storage storedSubLoan = _getSubLoan(subLoan.id);
        subLoan.recentOperationId = 0;
        subLoan.status = uint256(SubLoanStatus.Ongoing);
        subLoan.duration = storedSubLoan.inception.initialDuration;
        subLoan.upToDueRemuneratoryRate = storedSubLoan.inception.initialUpToDueRemuneratoryRate;
        subLoan.postDueRemuneratoryRate = storedSubLoan.inception.initialPostDueRemuneratoryRate;
        subLoan.moratoryRate = storedSubLoan.inception.initialMoratoryRate;
        subLoan.lateFeeRate = storedSubLoan.inception.initialLateFeeRate;
        subLoan.clawbackFeeRate = storedSubLoan.inception.initialClawbackFeeRate;

        subLoan.trackedPrincipal = storedSubLoan.inception.borrowedAmount + storedSubLoan.inception.addonAmount;
        subLoan.repaidPrincipal = 0;
        subLoan.discountPrincipal = 0;

        subLoan.trackedUpToDueRemuneratoryInterest = 0;
        subLoan.repaidUpToDueRemuneratoryInterest = 0;
        subLoan.discountUpToDueRemuneratoryInterest = 0;

        subLoan.trackedPostDueRemuneratoryInterest = 0;
        subLoan.repaidPostDueRemuneratoryInterest = 0;
        subLoan.discountPostDueRemuneratoryInterest = 0;

        subLoan.trackedMoratoryInterest = 0;
        subLoan.repaidMoratoryInterest = 0;
        subLoan.discountMoratoryInterest = 0;

        subLoan.trackedLateFee = 0;
        subLoan.repaidLateFee = 0;
        subLoan.discountLateFee = 0;

        subLoan.trackedClawbackFee = 0;
        subLoan.repaidClawbackFee = 0;
        subLoan.discountClawbackFee = 0;

        subLoan.trackedTimestamp = subLoan.startTimestamp;
        subLoan.freezeTimestamp = 0;
    }

    /**
     * @dev Accrues remuneratory and moratory interest, and imposes late fees based on elapsed days.
     */
    function _accrueInterest(
        ProcessingSubLoan memory subLoan, // Tools: prevent Prettier one-liner
        uint256 finishTimestamp
    ) internal pure {
        uint256 begDay = _dayIndex(subLoan.trackedTimestamp);
        subLoan.trackedTimestamp = finishTimestamp;

        {
            uint256 freezeTimestamp = subLoan.freezeTimestamp;
            if (freezeTimestamp != 0 && freezeTimestamp < finishTimestamp) {
                finishTimestamp = freezeTimestamp;
            }
        }

        uint256 finishDay = _dayIndex(finishTimestamp);

        if (finishDay > begDay) {
            uint256 startDay = _dayIndex(subLoan.startTimestamp);
            uint256 dueDay = startDay + subLoan.duration;
            if (begDay <= dueDay) {
                if (finishDay <= dueDay) {
                    _accrueUpToDueRemuneratoryInterest(subLoan, finishDay - begDay);
                } else {
                    _accrueUpToDueRemuneratoryInterest(subLoan, dueDay - begDay);
                    _imposeClawbackFee(subLoan, dueDay - startDay);
                    _imposeLateFee(subLoan);
                    _accruePostDueRemuneratoryInterest(subLoan, finishDay - dueDay);
                    _accrueMoratoryInterest(subLoan, finishDay - dueDay);
                }
            } else {
                _accruePostDueRemuneratoryInterest(subLoan, finishDay - begDay);
                _accrueMoratoryInterest(subLoan, finishDay - begDay);
            }
        }
    }

    /**
     * @dev Accrues up to the due date remuneratory interest using compound interest.
     */
    function _accrueUpToDueRemuneratoryInterest(ProcessingSubLoan memory subLoan, uint256 dayCount) internal pure {
        uint256 oldTrackedBalance = subLoan.trackedPrincipal + subLoan.trackedUpToDueRemuneratoryInterest;
        uint256 newTrackedBalance = _calculateCompoundInterest(
            oldTrackedBalance,
            dayCount,
            subLoan.upToDueRemuneratoryRate
        );
        subLoan.trackedUpToDueRemuneratoryInterest += newTrackedBalance - oldTrackedBalance;
    }

    /**
     * @dev Accrues post the due date remuneratory interest using compound interest.
     */
    function _accruePostDueRemuneratoryInterest(ProcessingSubLoan memory subLoan, uint256 dayCount) internal pure {
        uint256 oldTrackedBalance = subLoan.trackedPrincipal +
            subLoan.trackedUpToDueRemuneratoryInterest +
            subLoan.trackedPostDueRemuneratoryInterest;
        uint256 newTrackedBalance = _calculateCompoundInterest(
            oldTrackedBalance,
            dayCount,
            subLoan.postDueRemuneratoryRate
        );
        subLoan.trackedPostDueRemuneratoryInterest += newTrackedBalance - oldTrackedBalance;
    }

    /**
     * @dev Accrues moratory interest using simple interest calculation on the principal.
     */
    function _accrueMoratoryInterest(ProcessingSubLoan memory subLoan, uint256 dayCount) internal pure {
        uint256 accrualBase = (subLoan.trackedPrincipal + subLoan.trackedUpToDueRemuneratoryInterest) * dayCount;
        subLoan.trackedMoratoryInterest += _calculateSimpleInterest(accrualBase, subLoan.moratoryRate);
    }

    /**
     * @dev Imposes a one-time late fee calculated as a percentage of the tracked principal.
     */
    function _imposeLateFee(ProcessingSubLoan memory subLoan) internal pure {
        uint256 trackedLegalPrincipal = subLoan.trackedPrincipal + subLoan.trackedUpToDueRemuneratoryInterest;
        subLoan.trackedLateFee = _calculateSimpleInterest(trackedLegalPrincipal, subLoan.lateFeeRate);
    }

    /**
     * @dev Imposes a one-time clawback fee calculate.
     */
    function _imposeClawbackFee(ProcessingSubLoan memory subLoan, uint256 dayCount) internal pure {
        uint256 oldTrackedLegalPrincipal = subLoan.trackedPrincipal + subLoan.trackedUpToDueRemuneratoryInterest;
        uint256 newTrackedLegalPrincipal = _calculateCompoundInterest(
            oldTrackedLegalPrincipal,
            dayCount,
            subLoan.clawbackFeeRate
        );
        subLoan.trackedClawbackFee = newTrackedLegalPrincipal - oldTrackedLegalPrincipal;
    }

    /**
     * @dev Updates the pending timestamp to the earliest unprocessed operation timestamp.
     */
    function _updatePendingTimestamp(SubLoan storage subLoan, uint256 timestamp) internal {
        uint256 pendingTimestamp = subLoan.metadata.pendingTimestamp;
        if (pendingTimestamp == 0 || timestamp < pendingTimestamp) {
            subLoan.metadata.pendingTimestamp = uint32(timestamp); // Safe cast due to prior checks
        }
    }

    /**
     * @dev Persists the processed sub-loan state to storage and emits an update event.
     */
    function _updateSubLoan(ProcessingSubLoan memory subLoan) internal {
        SubLoan storage storedSubLoan = _getSubLoan(subLoan.id);

        _acceptSubLoanStatusChange(subLoan, storedSubLoan);

        // Update storage with the unchecked type conversion is used for all stored values due to prior checks
        // All type cast operations are safe due to prior checks

        // TODO: Check overflows for some fields, e.g. repayments, discounts, trackedInterests.

        // State fields, slot 1, 2
        storedSubLoan.state.status = SubLoanStatus(subLoan.status);
        // storedSubLoan.state._reservedStatus = 0;
        storedSubLoan.state.duration = uint16(subLoan.duration);
        storedSubLoan.state.freezeTimestamp = uint32(subLoan.freezeTimestamp);
        storedSubLoan.state.trackedTimestamp = uint32(subLoan.trackedTimestamp);
        storedSubLoan.state.upToDueRemuneratoryRate = uint32(subLoan.upToDueRemuneratoryRate);
        storedSubLoan.state.postDueRemuneratoryRate = uint32(subLoan.postDueRemuneratoryRate);
        storedSubLoan.state.moratoryRate = uint32(subLoan.moratoryRate);
        storedSubLoan.state.lateFeeRate = uint32(subLoan.lateFeeRate);
        storedSubLoan.state.clawbackFeeRate = uint32(subLoan.clawbackFeeRate);

        // State fields, slot 3, 4
        storedSubLoan.state.trackedPrincipal = uint64(subLoan.trackedPrincipal);
        storedSubLoan.state.repaidPrincipal = uint64(subLoan.repaidPrincipal);
        storedSubLoan.state.discountPrincipal = uint64(subLoan.discountPrincipal);

        // State fields, slot 5, 6
        storedSubLoan.state.trackedUpToDueRemuneratoryInterest = uint64(subLoan.trackedUpToDueRemuneratoryInterest);
        storedSubLoan.state.repaidUpToDueRemuneratoryInterest = uint64(subLoan.repaidUpToDueRemuneratoryInterest);
        storedSubLoan.state.discountUpToDueRemuneratoryInterest = uint64(subLoan.discountUpToDueRemuneratoryInterest);

        // State fields, slot 7, 8
        storedSubLoan.state.trackedPostDueRemuneratoryInterest = uint64(subLoan.trackedPostDueRemuneratoryInterest);
        storedSubLoan.state.repaidPostDueRemuneratoryInterest = uint64(subLoan.repaidPostDueRemuneratoryInterest);
        storedSubLoan.state.discountPostDueRemuneratoryInterest = uint64(subLoan.discountPostDueRemuneratoryInterest);

        // State fields, slot 9, 10
        storedSubLoan.state.trackedMoratoryInterest = uint64(subLoan.trackedMoratoryInterest);
        storedSubLoan.state.repaidMoratoryInterest = uint64(subLoan.repaidMoratoryInterest);
        storedSubLoan.state.discountMoratoryInterest = uint64(subLoan.discountMoratoryInterest);

        // State fields, slot 11, 12
        storedSubLoan.state.trackedLateFee = uint64(subLoan.trackedLateFee);
        storedSubLoan.state.repaidLateFee = uint64(subLoan.repaidLateFee);
        storedSubLoan.state.discountLateFee = uint64(subLoan.discountLateFee);

        // Metadata fields
        storedSubLoan.metadata.recentOperationId = uint16(subLoan.recentOperationId);
        storedSubLoan.metadata.pendingTimestamp = uint32(subLoan.pendingTimestamp);

        _emitUpdateEvent(subLoan, storedSubLoan);
    }

    /**
     * @dev Emits a sub-loan update event with packed parameters and increments the update index.
     */
    function _emitUpdateEvent(ProcessingSubLoan memory subLoan, SubLoan storage storedSubLoan) internal {
        uint256 packedParameters = ((uint256(subLoan.status) & type(uint8).max) << 0) +
            ((uint256(0) & type(uint8).max) << 8) + // reserve for future usage
            ((uint256(subLoan.duration) & type(uint16).max) << 16) +
            ((uint256(subLoan.startTimestamp) & type(uint32).max) << 32) +
            ((uint256(subLoan.trackedTimestamp) & type(uint32).max) << 64) +
            ((uint256(subLoan.freezeTimestamp) & type(uint32).max) << 96) +
            ((uint256(subLoan.pendingTimestamp) & type(uint32).max) << 128) +
            ((uint256(storedSubLoan.metadata.operationCount) & type(uint16).max) << 160) +
            ((uint256(storedSubLoan.metadata.earliestOperationId) & type(uint16).max) << 176) +
            ((uint256(storedSubLoan.metadata.recentOperationId) & type(uint16).max) << 192) +
            ((uint256(storedSubLoan.metadata.latestOperationId) & type(uint16).max) << 208);

        uint256 packedRates = _packRates(
            subLoan.upToDueRemuneratoryRate,
            subLoan.postDueRemuneratoryRate,
            subLoan.moratoryRate,
            subLoan.lateFeeRate,
            subLoan.clawbackFeeRate
        );

        emit SubLoanUpdated(
            subLoan.id,
            storedSubLoan.metadata.updateIndex,
            bytes32(packedParameters),
            bytes32(packedRates),
            bytes32(_packPrincipalParts(subLoan)),
            bytes32(_packUpToDueRemuneratoryInterestParts(subLoan)),
            bytes32(_packPostDueRemuneratoryInterestParts(subLoan)),
            bytes32(_packMoratoryInterestParts(subLoan)),
            bytes32(_packLateFeeParts(subLoan)),
            bytes32(_packClawbackParts(subLoan))
        );

        // No custom error is introduced because index overflow is not possible due to the overall contract logic
        storedSubLoan.metadata.updateIndex += uint24(1);
    }

    /**
     * @dev Applies a repayment operation, reducing tracked amounts.
     */
    function _applyRepayment(ProcessingSubLoan memory subLoan, Operation storage operation) internal view {
        uint256 amount = operation.value;
        uint256 trackedBalance = _calculateTrackedBalance(subLoan);
        uint256 roundedTrackedBalance = _roundFinancially(trackedBalance);
        if (amount > roundedTrackedBalance) {
            revert LendingMarketV2_SubLoanRepaymentExcess();
        }
        // Since rounding may occur downwards (e.g. 1.004 => 1.00), adjust the amount in case of a full repayment.
        if (amount == roundedTrackedBalance) {
            amount = trackedBalance;
        }

        amount = _repayPostDueRemuneratoryInterest(subLoan, amount);
        amount = _repayMoratoryInterest(subLoan, amount);
        amount = _repayLateFee(subLoan, amount);
        amount = _repayClawbackFee(subLoan, amount);
        amount = _repayUpToDueRemuneratoryInterest(subLoan, amount);
        amount = _repayPrincipal(subLoan, amount);
    }

    /**
     * @dev Applies a discount operation, reducing tracked amounts.
     */
    function _applyDiscount(ProcessingSubLoan memory subLoan, Operation storage operation) internal view {
        uint256 amount = operation.value;
        uint256 trackedBalance = _calculateTrackedBalance(subLoan);
        uint256 roundedTrackedBalance = _roundFinancially(trackedBalance);
        if (amount > roundedTrackedBalance) {
            revert LendingMarketV2_SubLoanDiscountExcess();
        }
        // Since rounding may occur downwards (e.g. 1.004 => 1.00), adjust the amount in case of a full discount.
        if (amount == roundedTrackedBalance) {
            amount = trackedBalance;
        }

        amount = _discountPostDueRemuneratoryInterest(subLoan, amount);
        amount = _discountMoratoryInterest(subLoan, amount);
        amount = _discountLateFee(subLoan, amount);
        amount = _discountClawbackFee(subLoan, amount);
        amount = _discountUpToDueRemuneratoryInterest(subLoan, amount);
        amount = _discountPrincipal(subLoan, amount);
    }

    /**
     * @dev Applies a revocation operation, setting status to revoked and clearing all tracked amounts.
     */
    function _applyRevocation(ProcessingSubLoan memory subLoan) internal pure {
        subLoan.status = uint256(SubLoanStatus.Revoked);
        subLoan.trackedPrincipal = 0;
        subLoan.trackedUpToDueRemuneratoryInterest = 0;
        subLoan.trackedPostDueRemuneratoryInterest = 0;
        subLoan.trackedMoratoryInterest = 0;
        subLoan.trackedLateFee = 0;
    }

    /**
     * @dev Applies a freezing operation, setting the freeze timestamp to pause interest accrual.
     */
    function _applyFreezing(
        ProcessingSubLoan memory subLoan, // Tools: prevent Prettier one-liner
        Operation storage operation
    ) internal view {
        if (subLoan.freezeTimestamp != 0) {
            revert LendingMarketV2_SubLoanFrozenAlready();
        }
        subLoan.freezeTimestamp = operation.timestamp;
    }

    /**
     * @dev Applies an unfreezing operation, resuming interest accrual and optionally extending duration.
     */
    function _applyUnfreezing(
        ProcessingSubLoan memory subLoan, // Tools: prevent Prettier one-liner
        Operation storage operation
    ) internal view {
        if (subLoan.freezeTimestamp == 0) {
            revert LendingMarketV2_SubLoanUnfrozen();
        }

        // Increase the sub-loan duration by the freeze period if value is zero, otherwise just unfreeze.
        if (operation.value == 0) {
            subLoan.duration += _dayIndex(operation.timestamp) - _dayIndex(subLoan.freezeTimestamp);
        }

        subLoan.freezeTimestamp = 0;
    }

    /**
     * @dev Repays principal, returning the remaining amount.
     */
    function _repayPrincipal(ProcessingSubLoan memory subLoan, uint256 amount) internal pure returns (uint256) {
        uint256 changeAmount = subLoan.trackedPrincipal;
        if (changeAmount > amount) {
            changeAmount = amount;
        }
        if (changeAmount == 0) {
            return amount;
        }
        unchecked {
            amount -= changeAmount;
            subLoan.trackedPrincipal -= changeAmount;
        }
        subLoan.repaidPrincipal += changeAmount;
        return amount;
    }

    /**
     * @dev Repays up to the due date remuneratory interest, returning the remaining amount.
     */
    function _repayUpToDueRemuneratoryInterest(
        ProcessingSubLoan memory subLoan,
        uint256 amount
    ) internal pure returns (uint256) {
        uint256 changeAmount = subLoan.trackedUpToDueRemuneratoryInterest;
        if (changeAmount > amount) {
            changeAmount = amount;
        }
        if (changeAmount == 0) {
            return amount;
        }
        unchecked {
            amount -= changeAmount;
            subLoan.trackedUpToDueRemuneratoryInterest -= changeAmount;
        }
        subLoan.repaidUpToDueRemuneratoryInterest += changeAmount;
        return amount;
    }

    /**
     * @dev Repays post the due date remuneratory interest, returning the remaining amount.
     */
    function _repayPostDueRemuneratoryInterest(
        ProcessingSubLoan memory subLoan,
        uint256 amount
    ) internal pure returns (uint256) {
        uint256 changeAmount = subLoan.trackedPostDueRemuneratoryInterest;
        if (changeAmount > amount) {
            changeAmount = amount;
        }
        if (changeAmount == 0) {
            return amount;
        }
        unchecked {
            amount -= changeAmount;
            subLoan.trackedPostDueRemuneratoryInterest -= changeAmount;
        }
        subLoan.repaidPostDueRemuneratoryInterest += changeAmount;
        return amount;
    }

    /**
     * @dev Repays moratory interest, returning the remaining amount.
     */
    function _repayMoratoryInterest(ProcessingSubLoan memory subLoan, uint256 amount) internal pure returns (uint256) {
        uint256 changeAmount = subLoan.trackedMoratoryInterest;
        if (changeAmount > amount) {
            changeAmount = amount;
        }
        if (changeAmount == 0) {
            return amount;
        }
        unchecked {
            amount -= changeAmount;
            subLoan.trackedMoratoryInterest -= changeAmount;
        }
        subLoan.repaidMoratoryInterest += changeAmount;
        return amount;
    }

    /**
     * @dev Repays late fee, returning the remaining amount.
     */
    function _repayLateFee(ProcessingSubLoan memory subLoan, uint256 amount) internal pure returns (uint256) {
        uint256 changeAmount = subLoan.trackedLateFee;
        if (changeAmount > amount) {
            changeAmount = amount;
        }
        if (changeAmount == 0) {
            return amount;
        }
        unchecked {
            amount -= changeAmount;
            subLoan.trackedLateFee -= changeAmount;
        }
        subLoan.repaidLateFee += changeAmount;
        return amount;
    }

    /**
     * @dev Repays clawback fee, returning the remaining amount.
     */
    function _repayClawbackFee(ProcessingSubLoan memory subLoan, uint256 amount) internal pure returns (uint256) {
        uint256 changeAmount = subLoan.trackedClawbackFee;
        if (changeAmount > amount) {
            changeAmount = amount;
        }
        if (changeAmount == 0) {
            return amount;
        }
        unchecked {
            amount -= changeAmount;
            subLoan.trackedClawbackFee -= changeAmount;
        }
        subLoan.repaidClawbackFee += changeAmount;
        return amount;
    }

    /**
     * @dev Discounts principal, returning the remaining amount.
     */
    function _discountPrincipal(ProcessingSubLoan memory subLoan, uint256 amount) internal pure returns (uint256) {
        uint256 changeAmount = subLoan.trackedPrincipal;
        if (changeAmount > amount) {
            changeAmount = amount;
        }
        if (changeAmount == 0) {
            return amount;
        }
        unchecked {
            amount -= changeAmount;
            subLoan.trackedPrincipal -= changeAmount;
        }
        subLoan.discountPrincipal += changeAmount;
        return amount;
    }

    /**
     * @dev Discounts up to the due date remuneratory interest, returning the remaining amount.
     */
    function _discountUpToDueRemuneratoryInterest(
        ProcessingSubLoan memory subLoan,
        uint256 amount
    ) internal pure returns (uint256) {
        uint256 changeAmount = subLoan.trackedUpToDueRemuneratoryInterest;
        if (changeAmount > amount) {
            changeAmount = amount;
        }
        if (changeAmount == 0) {
            return amount;
        }
        unchecked {
            amount -= changeAmount;
            subLoan.trackedUpToDueRemuneratoryInterest -= changeAmount;
        }
        subLoan.discountUpToDueRemuneratoryInterest += changeAmount;
        return amount;
    }

    /**
     * @dev Discounts post the due date remuneratory interest, returning the remaining amount.
     */
    function _discountPostDueRemuneratoryInterest(
        ProcessingSubLoan memory subLoan,
        uint256 amount
    ) internal pure returns (uint256) {
        uint256 changeAmount = subLoan.trackedPostDueRemuneratoryInterest;
        if (changeAmount > amount) {
            changeAmount = amount;
        }
        if (changeAmount == 0) {
            return amount;
        }
        unchecked {
            amount -= changeAmount;
            subLoan.trackedPostDueRemuneratoryInterest -= changeAmount;
        }
        subLoan.discountPostDueRemuneratoryInterest += changeAmount;
        return amount;
    }

    /**
     * @dev Discounts moratory interest, returning the remaining amount.
     */
    function _discountMoratoryInterest(
        ProcessingSubLoan memory subLoan,
        uint256 amount
    ) internal pure returns (uint256) {
        uint256 changeAmount = subLoan.trackedMoratoryInterest;
        if (changeAmount > amount) {
            changeAmount = amount;
        }
        if (changeAmount == 0) {
            return amount;
        }
        unchecked {
            amount -= changeAmount;
            subLoan.trackedMoratoryInterest -= changeAmount;
        }
        subLoan.discountMoratoryInterest += changeAmount;
        return amount;
    }

    /**
     * @dev Discounts late fee, returning the remaining amount.
     */
    function _discountLateFee(ProcessingSubLoan memory subLoan, uint256 amount) internal pure returns (uint256) {
        uint256 changeAmount = subLoan.trackedLateFee;
        if (changeAmount > amount) {
            changeAmount = amount;
        }
        if (changeAmount == 0) {
            return amount;
        }
        unchecked {
            amount -= changeAmount;
            subLoan.trackedLateFee -= changeAmount;
        }
        subLoan.discountLateFee += changeAmount;
        return amount;
    }

    /**
     * @dev Discounts clawback fee, returning the remaining amount.
     */
    function _discountClawbackFee(ProcessingSubLoan memory subLoan, uint256 amount) internal pure returns (uint256) {
        uint256 changeAmount = subLoan.trackedClawbackFee;
        if (changeAmount > amount) {
            changeAmount = amount;
        }
        if (changeAmount == 0) {
            return amount;
        }
        unchecked {
            amount -= changeAmount;
            subLoan.trackedClawbackFee -= changeAmount;
        }
        subLoan.discountClawbackFee += changeAmount;
        return amount;
    }

    /**
     * @dev Handles sub-loan status transitions by notifying the credit line of loan opening or closing.
     */
    function _acceptSubLoanStatusChange(
        ProcessingSubLoan memory newSubLoan, // Tools: prevent Prettier one-liner
        SubLoan storage oldSubLoan
    ) internal {
        uint256 newStatus = newSubLoan.status;
        uint256 oldStatus = uint256(oldSubLoan.state.status);
        if (newStatus == oldStatus) {
            return;
        }
        LendingProgram storage program = _getLendingMarketStorage().programs[oldSubLoan.inception.programId];
        if (
            newStatus == uint256(SubLoanStatus.Repaid) ||
            (newStatus == uint256(SubLoanStatus.Revoked) && oldStatus != uint256(SubLoanStatus.Repaid))
        ) {
            uint256 firstSubLoanId = newSubLoan.id - oldSubLoan.metadata.subLoanIndex;
            LoanSummary memory summary = _getLoanSummary(firstSubLoanId, oldSubLoan.metadata.subLoanCount);
            if (summary.ongoingSubLoanCount == 1) {
                ICreditLineV2(program.creditLine).onAfterLoanClosed(
                    firstSubLoanId,
                    summary.borrower,
                    summary.totalBorrowedAmount
                );
            }
        }
        if (newStatus == uint256(SubLoanStatus.Ongoing)) {
            uint256 firstSubLoanId = newSubLoan.id - oldSubLoan.metadata.subLoanIndex;
            LoanSummary memory summary = _getLoanSummary(firstSubLoanId, oldSubLoan.metadata.subLoanCount);
            if (summary.ongoingSubLoanCount == 0) {
                ICreditLineV2(program.creditLine).onBeforeLoanOpened(
                    firstSubLoanId,
                    summary.borrower,
                    summary.totalBorrowedAmount
                );
            }
        }
    }

    /**
     * @dev Calculates the total borrowed and addon amounts from all sub-loan taking requests.
     */
    function _calculateTotalBorrowedAndAddonAmounts(
        SubLoanTakingRequest[] calldata subLoanTakingRequests
    ) internal pure returns (uint256 totalBorrowedAmount, uint256 totalAddonAmount) {
        uint256 len = subLoanTakingRequests.length;
        for (uint256 i = 0; i < len; ++i) {
            SubLoanTakingRequest calldata subLoanTakingRequest = subLoanTakingRequests[i];
            totalBorrowedAmount += subLoanTakingRequest.borrowedAmount;
            totalAddonAmount += subLoanTakingRequest.addonAmount;
        }
    }

    /**
     * @dev Calculates the tracked balance using the compound interest formula with mathematical rounding.
     */
    function _calculateCompoundInterest(
        uint256 originalBalance, // Tools: prevent Prettier one-liner
        uint256 numberOfDays,
        uint256 interestRate
    ) internal pure returns (uint256 trackedBalance) {
        // The equivalent formula: round(originalBalance * (1 + interestRate / interestRateFactor)^numberOfPeriods)
        // Where division operator `/` and power operator `^` take into account the fractional part and
        // the `round()` function returns an integer rounded according to standard mathematical rules.
        int128 onePlusRateValue = ABDKMath64x64.div(
            ABDKMath64x64.fromUInt(INTEREST_RATE_FACTOR + interestRate),
            ABDKMath64x64.fromUInt(INTEREST_RATE_FACTOR)
        );
        int128 powValue = ABDKMath64x64.pow(onePlusRateValue, numberOfDays);
        int128 originalBalanceValue = ABDKMath64x64.fromUInt(originalBalance);
        uint256 unroundedResult = uint256(uint128(ABDKMath64x64.mul(powValue, originalBalanceValue)));
        trackedBalance = unroundedResult >> 64;
        if ((unroundedResult - (trackedBalance << 64)) >= (1 << 63)) {
            trackedBalance += 1;
        }
    }

    /**
     * @dev Calculates simple interest with mathematical rounding based on principal, and rate.
     */
    function _calculateSimpleInterest(uint256 accrualBase, uint256 interestRate) internal pure returns (uint256) {
        // The risk that the `accrualBase * interestRate` can overflow `uint256` and revert is accepted.
        uint256 product = accrualBase * interestRate;
        uint256 remainder = product % INTEREST_RATE_FACTOR;
        uint256 result = product / INTEREST_RATE_FACTOR;
        if (remainder >= (INTEREST_RATE_FACTOR / 2)) {
            ++result;
        }
        return result;
    }

    /**
     * @dev Validates loan parameters including borrower, amounts, and program status.
     */
    function _checkLoanParameters(
        LoanTakingRequest calldata loanTakingRequest,
        uint256 borrowedAmount,
        uint256 addonAmount
    ) internal view {
        if (loanTakingRequest.borrower == address(0)) {
            revert LendingMarketV2_BorrowerAddressZero();
        }
        if (loanTakingRequest.startTimestamp > _blockTimestamp() || loanTakingRequest.startTimestamp == 1) {
            revert LendingMarketV2_SubLoanStartTimestampInvalid();
        }

        if (
            borrowedAmount == 0 || // Tools: prevent Prettier one-liner
            borrowedAmount > type(uint64).max ||
            borrowedAmount != _roundFinancially(borrowedAmount)
        ) {
            revert LendingMarketV2_LoanBorrowedAmountInvalid();
        }
        if (
            addonAmount > type(uint64).max || // Tools: prevent Prettier one-liner
            addonAmount != _roundFinancially(addonAmount)
        ) {
            revert LendingMarketV2_AddonAmountInvalid();
        }
        unchecked {
            if (addonAmount + borrowedAmount > type(uint64).max) {
                revert LendingMarketV2_SubLoanPrincipalInvalid();
            }
        }

        LendingProgram storage program = _getLendingMarketStorage().programs[loanTakingRequest.programId];
        if (program.status != LendingProgramStatus.Active) {
            revert LendingMarketV2_ProgramStatusIncompatible(uint256(program.status));
        }
    }

    /**
     * @dev Validates operation parameters including ID, kind, timestamp, value, and account constraints.
     */
    function _checkOperationParameters(
        SubLoan storage subLoan,
        uint256 kind,
        uint256 timestamp,
        uint256 value,
        address account
    ) internal view {
        if (
            kind == uint256(OperationKind.Nonexistent) || // Tools: prevent Prettier one-liner
            kind > uint256(type(OperationKind).max)
        ) {
            revert LendingMarketV2_OperationKindInvalid();
        }

        if (kind == uint256(OperationKind.Revocation)) {
            revert LendingMarketV2_OperationKindUnacceptable();
        }

        if (timestamp < subLoan.inception.startTimestamp) {
            revert LendingMarketV2_OperationTimestampTooEarly();
        }
        if (timestamp > type(uint32).max) {
            revert LendingMarketV2_OperationTimestampExcess();
        }

        if (kind == uint256(OperationKind.Freezing)) {
            if (value != 0) {
                revert LendingMarketV2_OperationValueInvalid();
            }
        }

        if (kind == uint256(OperationKind.Unfreezing)) {
            if (value > 1) {
                revert LendingMarketV2_OperationValueInvalid();
            }
        }

        if (
            kind == uint256(OperationKind.UpToDueRemuneratoryRateSetting) ||
            kind == uint256(OperationKind.PostDueRemuneratoryRateSetting) ||
            kind == uint256(OperationKind.MoratoryRateSetting) ||
            kind == uint256(OperationKind.LateFeeRateSetting) ||
            kind == uint256(OperationKind.ClawbackFeeRateSetting)
        ) {
            if (value > INTEREST_RATE_FACTOR) {
                revert LendingMarketV2_SubLoanRateValueExcess();
            }
        }

        if (kind == uint256(OperationKind.DurationSetting)) {
            if (value == 0 || value > type(uint16).max) {
                revert LendingMarketV2_SubLoanDurationInvalid();
            }
        }

        if (kind == uint256(OperationKind.Repayment)) {
            if (account == address(0)) {
                revert LendingMarketV2_SubLoanRapayerAddressZero();
            }
        } else if (account != address(0)) {
            revert LendingMarketV2_OperationAccountNonzero();
        }

        if (
            kind == uint256(OperationKind.Repayment) || // Tools: prevent Prettier one-liner
            kind == uint256(OperationKind.Discount)
        ) {
            // The zero value is prohibited.
            // The unrounded value is prohibited.
            // No special value for a full repayment or discount.
            if (value == 0) {
                revert LendingMarketV2_OperationValueInvalid();
            }
            if (value != _roundFinancially(value)) {
                revert LendingMarketV2_SubLoanRepaymentOrDiscountAmountUnrounded();
            }
            if (timestamp > _blockTimestamp()) {
                revert LendingMarketV2_OperationKindProhibitedInFuture();
            }
        }
    }

    /**
     * @dev Ensures the sub-loan count is within the valid range (non-zero and not exceeding the maximum).
     */
    function _checkSubLoanCount(uint256 subLoanCount) internal view {
        if (subLoanCount == 0) {
            revert LendingMarketV2_SubLoanCountZero();
        }
        if (subLoanCount > _subLoanCountMax()) {
            revert LendingMarketV2_SubLoanCountExcess();
        }
    }

    /**
     * @dev Validates that the operation is not a revocation, which cannot be cancelled.
     */
    function _checkCancellationOperationParameters(Operation storage operation) internal view {
        if (operation.kind == OperationKind.Revocation) {
            revert LendingMarketV2_OperationVoidingProhibited();
        }
    }

    /**
     * @dev Converts a stored sub-loan to a processing sub-loan structure for in-memory operations.
     */
    function _convertToProcessingSubLoan(
        uint256 subLoanId,
        SubLoan storage storedSubLoan
    ) internal view returns (ProcessingSubLoan memory) {
        ProcessingSubLoan memory subLoan;
        subLoan.id = subLoanId;
        subLoan.earliestOperationId = storedSubLoan.metadata.earliestOperationId;
        subLoan.recentOperationId = storedSubLoan.metadata.recentOperationId;
        // subLoan.flags = 0;
        subLoan.status = uint256(storedSubLoan.state.status);

        subLoan.startTimestamp = storedSubLoan.inception.startTimestamp;
        subLoan.freezeTimestamp = storedSubLoan.state.freezeTimestamp;
        subLoan.trackedTimestamp = storedSubLoan.state.trackedTimestamp;
        subLoan.pendingTimestamp = storedSubLoan.metadata.pendingTimestamp;
        subLoan.duration = storedSubLoan.state.duration;

        subLoan.upToDueRemuneratoryRate = storedSubLoan.state.upToDueRemuneratoryRate;
        subLoan.postDueRemuneratoryRate = storedSubLoan.state.postDueRemuneratoryRate;
        subLoan.moratoryRate = storedSubLoan.state.moratoryRate;
        subLoan.lateFeeRate = storedSubLoan.state.lateFeeRate;
        subLoan.clawbackFeeRate = storedSubLoan.state.clawbackFeeRate;

        subLoan.trackedPrincipal = storedSubLoan.state.trackedPrincipal;
        subLoan.repaidPrincipal = storedSubLoan.state.repaidPrincipal;
        subLoan.discountPrincipal = storedSubLoan.state.discountPrincipal;

        subLoan.trackedUpToDueRemuneratoryInterest = storedSubLoan.state.trackedUpToDueRemuneratoryInterest;
        subLoan.repaidUpToDueRemuneratoryInterest = storedSubLoan.state.repaidUpToDueRemuneratoryInterest;
        subLoan.discountUpToDueRemuneratoryInterest = storedSubLoan.state.discountUpToDueRemuneratoryInterest;

        subLoan.trackedPostDueRemuneratoryInterest = storedSubLoan.state.trackedPostDueRemuneratoryInterest;
        subLoan.repaidPostDueRemuneratoryInterest = storedSubLoan.state.repaidPostDueRemuneratoryInterest;
        subLoan.discountPostDueRemuneratoryInterest = storedSubLoan.state.discountPostDueRemuneratoryInterest;

        subLoan.trackedMoratoryInterest = storedSubLoan.state.trackedMoratoryInterest;
        subLoan.repaidMoratoryInterest = storedSubLoan.state.repaidMoratoryInterest;
        subLoan.discountMoratoryInterest = storedSubLoan.state.discountMoratoryInterest;

        subLoan.trackedLateFee = storedSubLoan.state.trackedLateFee;
        subLoan.repaidLateFee = storedSubLoan.state.repaidLateFee;
        subLoan.discountLateFee = storedSubLoan.state.discountLateFee;

        subLoan.trackedClawbackFee = storedSubLoan.state.trackedClawbackFee;
        subLoan.repaidClawbackFee = storedSubLoan.state.repaidClawbackFee;
        subLoan.discountClawbackFee = storedSubLoan.state.discountClawbackFee;

        return subLoan;
    }

    /**
     * @dev Generates the next sequential operation ID for a sub-loan, reverting if the maximum is exceeded.
     */
    function _generateOperationId(SubLoan storage subLoan) internal returns (uint256 operationId) {
        unchecked {
            operationId = uint256(subLoan.metadata.operationCount) + 1;
        }
        if (operationId > OPERATION_COUNT_MAX) {
            revert LendingMarketV2_OperationCountExcess();
        }
        subLoan.metadata.operationCount = uint16(operationId);
    }

    /**
     * @dev Increments the global sub-loan counter, reverting if the maximum is exceeded.
     */
    function _increaseSubLoanCounter(uint256 subLoanCount) internal {
        LendingMarketStorage storage $ = _getLendingMarketStorage();
        uint256 counter = uint256($.subLoanCounter);
        unchecked {
            counter += subLoanCount;
        }
        if (counter > type(uint64).max) {
            revert LendingMarketV2_SubLoanCounterExcess();
        }
        $.subLoanCounter = uint64(counter);
    }

    /**
     * @dev Increments the sub-loan related counters, reverting if the maximum is exceeded.
     */
    function _increaseSubLoanRelatedCounters(uint256 subLoanCount) internal {
        _increaseSubLoanCounter(subLoanCount);
        LendingMarketStorage storage $ = _getLendingMarketStorage();
        uint256 counter = uint256($.subLoanAutoIdCounter);
        unchecked {
            counter += subLoanCount;
        }
        $.subLoanAutoIdCounter = uint64(counter);
    }

    /**
     * @dev Returns a reference to the sub-loan storage by ID.
     */
    function _getSubLoan(uint256 subLoanId) internal view returns (SubLoan storage) {
        return _getLendingMarketStorage().subLoans[subLoanId];
    }

    /**
     * @dev Returns a reference to an existing sub-loan, reverting if nonexistent.
     */
    function _getExitingSubLoan(uint256 subLoanId) internal view returns (SubLoan storage) {
        SubLoan storage subLoan = _getSubLoan(subLoanId);
        if (subLoan.state.status == SubLoanStatus.Nonexistent) {
            revert LendingMarketV2_SubLoanNonexistent();
        }
        return subLoan;
    }

    /**
     * @dev Returns a reference to a non-revoked sub-loan, reverting if nonexistent or revoked.
     */
    function _getNonRevokedSubLoan(uint256 subLoanId) internal view returns (SubLoan storage) {
        SubLoan storage subLoan = _getExitingSubLoan(subLoanId);
        if (subLoan.state.status == SubLoanStatus.Revoked) {
            revert LendingMarketV2_SubLoanRevoked();
        }
        return subLoan;
    }

    /**
     * @dev Returns the addon treasury address for a program, reverting if it is zero.
     */
    function _getAndCheckAddonTreasury(uint256 programId) internal view returns (address) {
        address liquidityPool = _getLendingMarketStorage().programs[programId].liquidityPool;
        address addonTreasury = ILiquidityPool(liquidityPool).addonTreasury();
        if (addonTreasury == address(0)) {
            revert LendingMarketV2_AddonTreasuryAddressZero();
        }
        return addonTreasury;
    }

    /**
     * @dev Aggregates summary data across all sub-loans of a loan.
     */
    function _getLoanSummary(
        uint256 firstSubLoanId, // Tools: prevent Prettier one-liner
        uint256 subLoanCount
    ) internal view returns (LoanSummary memory summary) {
        SubLoan storage subLoan = _getSubLoan(firstSubLoanId);
        summary.programId = subLoan.inception.programId;
        summary.borrower = subLoan.inception.borrower;
        _appendSubLoanToLoanSummary(subLoan, summary);
        for (uint256 i = 1; i < subLoanCount; ++i) {
            subLoan = _getSubLoan(firstSubLoanId + i);
            _appendSubLoanToLoanSummary(subLoan, summary);
        }
    }

    /**
     * @dev Appends a sub-loan's amounts and status to the loan summary.
     */
    function _appendSubLoanToLoanSummary(SubLoan storage subLoan, LoanSummary memory summary) internal view {
        summary.totalBorrowedAmount += subLoan.inception.borrowedAmount;
        summary.totalAddonAmount += subLoan.inception.addonAmount;
        summary.totalRepaidAmount +=
            subLoan.state.repaidPrincipal +
            subLoan.state.repaidUpToDueRemuneratoryInterest +
            subLoan.state.repaidPostDueRemuneratoryInterest +
            subLoan.state.repaidMoratoryInterest +
            subLoan.state.repaidLateFee;
        if (subLoan.state.status == SubLoanStatus.Ongoing) {
            summary.ongoingSubLoanCount += 1;
        }
    }

    /**
     * @dev Packs three 64-bit amount parts into a single 256-bit value.
     *
     * The packed amount parts of a sub-loan is a bitfield with the following bits:
     *
     * - 64 bits from   0 to  63: the tracked amount of the part
     * - 64 bits from  64 to 127: the repaid amount of the part
     * - 64 bits from 128 to 191: the discount amount of the part
     * - 64 bits from 192 to 255: reserved for future usage
     */
    function _packAmountParts(
        uint256 partTracked,
        uint256 partRepaid,
        uint256 partDiscount
    ) internal pure returns (uint256) {
        return
            (partTracked & type(uint64).max) |
            ((partRepaid & type(uint64).max) << 64) |
            ((partDiscount & type(uint64).max) << 128);
    }

    /**
     * @dev Packs the principal parts (tracked, repaid, discount) into a single value.
     */
    function _packPrincipalParts(ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            _packAmountParts(
                subLoan.trackedPrincipal, // Tools: prevent Prettier one-liner
                subLoan.repaidPrincipal,
                subLoan.discountPrincipal
            );
    }

    /**
     * @dev Packs the up to the due date remuneratory interest parts (tracked, repaid, discount) into a single value.
     */
    function _packUpToDueRemuneratoryInterestParts(ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            _packAmountParts(
                subLoan.trackedUpToDueRemuneratoryInterest,
                subLoan.repaidUpToDueRemuneratoryInterest,
                subLoan.discountUpToDueRemuneratoryInterest
            );
    }

    /**
     * @dev Packs the post the due date remuneratory interest parts (tracked, repaid, discount) into a single value.
     */
    function _packPostDueRemuneratoryInterestParts(ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            _packAmountParts(
                subLoan.trackedPostDueRemuneratoryInterest,
                subLoan.repaidPostDueRemuneratoryInterest,
                subLoan.discountPostDueRemuneratoryInterest
            );
    }

    /**
     * @dev Packs the moratory interest parts (tracked, repaid, discount) into a single value.
     */
    function _packMoratoryInterestParts(ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            _packAmountParts(
                subLoan.trackedMoratoryInterest,
                subLoan.repaidMoratoryInterest,
                subLoan.discountMoratoryInterest
            );
    }

    /**
     * @dev Packs the late fee parts (tracked, repaid, discount) into a single value.
     */
    function _packLateFeeParts(ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            _packAmountParts(
                subLoan.trackedLateFee, // Tools: prevent Prettier one-liner
                subLoan.repaidLateFee,
                subLoan.discountLateFee
            );
    }

    /**
     * @dev Packs the clawback fee parts (tracked, repaid, discount) into a single value.
     */
    function _packClawbackParts(ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            _packAmountParts(
                subLoan.trackedClawbackFee, // Tools: prevent Prettier one-liner
                subLoan.repaidClawbackFee,
                subLoan.discountClawbackFee
            );
    }

    /**
     * @dev Packs rate values into a single 256-bit value.
     *
     * The packed rates is a bitfield with the following bits:
     *
     * - 32 bits from   0 to  31: the up to the due date remuneratory interest rate.
     * - 32 bits from  32 to  63: the post the due date remuneratory interest rate.
     * - 32 bits from  64 to  95: the moratory interest rate.
     * - 32 bits from  96 to 127: the late fee rate.
     * - 32 bits from 128 to 159: the clawback fee rate.
     * - 96 bits from 160 to 255: reserved for future usage.
     */
    function _packRates(
        uint256 upToDueRemuneratoryRate,
        uint256 postDueRemuneratoryRate,
        uint256 moratoryRate,
        uint256 lateFeeRate,
        uint256 clawbackFeeRate
    ) internal pure returns (uint256) {
        return
            ((upToDueRemuneratoryRate & type(uint32).max) << 0) |
            ((postDueRemuneratoryRate & type(uint32).max) << 32) |
            ((moratoryRate & type(uint32).max) << 64) |
            ((lateFeeRate & type(uint32).max) << 96) |
            ((clawbackFeeRate & type(uint32).max) << 128);
    }

    /**
     * @dev Returns the current block timestamp. Can be overridden for testing.
     */
    function _blockTimestamp() internal view virtual returns (uint256) {
        return block.timestamp;
    }

    /**
     * @dev Returns the reserved account ID used to represent the borrower. Can be overridden for testing.
     */
    function _accountIdBorrower() internal pure virtual returns (uint256) {
        return ACCOUNT_ID_BORROWER;
    }

    /**
     * @dev Returns the maximum allowed number of sub-loans per loan. Can be overridden for testing.
     */
    function _subLoanCountMax() internal view virtual returns (uint256) {
        return SUB_LOAN_COUNT_MAX;
    }

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     */
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try ILendingEngineV2(newImplementation).proveLendingEngineV2() {} catch {
            revert LendingEngineV2_ImplementationAddressInvalid();
        }
    }
}
