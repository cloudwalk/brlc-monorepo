// SPDX-License-Identifier: MIT

pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { UUPSExtUpgradeable } from "./base/UUPSExtUpgradeable.sol";
import { Versionable } from "./base/Versionable.sol";

import { ICreditLineV2 } from "./interfaces/ICreditLineV2.sol";
import { ILendingMarketV2 } from "./interfaces/ILendingMarketV2.sol";
import { ILendingEngineV2 } from "./interfaces/ILendingEngineV2.sol";
import { ILendingMarketV2Configuration } from "./interfaces/ILendingMarketV2.sol";
import { ILendingMarketV2Primary } from "./interfaces/ILendingMarketV2.sol";
import { ILiquidityPool } from "./interfaces/ILiquidityPool.sol";

import { AddressBook } from "./libraries/AddressBook.sol";
import { LendingMarketV2Core } from "./core/LendingMarketV2Core.sol";

/**
 * @title LendingMarketV2 contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The lending market contract.
 *
 * See details about the smart contract logic in the `docs/description.md` file.
 */
contract LendingMarketV2 is
    LendingMarketV2Core,
    Initializable,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    ILendingMarketV2,
    Versionable,
    UUPSExtUpgradeable
{
    // ------------------ Constants ------------------------------- //

    /// @dev The role of an admin that is allowed to execute loan-related functions.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ------------------ Modifiers ------------------------------- //

    /**
     * @dev Modifier that checks that the caller is the contract itself.
     */
    modifier onlySelf() {
        if (_msgSender() != address(this)) {
            revert LendingMarketV2_UnauthorizedCallContext();
        }
        _;
    }

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
    function initialize(address underlyingToken_, address engine_) external initializer {
        __AccessControlExt_init_unchained();
        __PausableExt_init_unchained();
        __UUPSExt_init_unchained();

        _setRoleAdmin(ADMIN_ROLE, GRANTOR_ROLE);
        _grantRole(OWNER_ROLE, _msgSender());

        _setUnderlyingToken(underlyingToken_);
        _setEngine(engine_);

        LendingMarketStorage storage $ = _getLendingMarketStorage();
        $.storageKind = uint8(STORAGE_KIND_MARKET);
    }

    // ----------- Configuration transactional functions ---------- //

    /// @inheritdoc ILendingMarketV2Configuration
    function openProgram(
        address creditLine, // Tools: prevent Prettier one-liner
        address liquidityPool
    ) external whenNotPaused onlyRole(OWNER_ROLE) {
        _openProgram(creditLine, liquidityPool);
    }

    /// @inheritdoc ILendingMarketV2Configuration
    function closeProgram(uint256 programId) external whenNotPaused onlyRole(OWNER_ROLE) {
        _closeProgram(programId);
    }

    // -------------- Primary transactional functions ------------- //

    // All functions are redirected to the engine contract functions with the same name and parameters.

    /// @inheritdoc ILendingMarketV2Primary
    function takeLoan(
        LoanTakingRequest calldata,
        SubLoanTakingRequest[] calldata
    ) external whenNotPaused onlyRole(ADMIN_ROLE) returns (uint256 firstSubLoanId) {
        bytes memory ret = _delegateToEngine(msg.data);
        return abi.decode(ret, (uint256));
    }

    /// @inheritdoc ILendingMarketV2Primary
    function revokeLoan(uint256) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _delegateToEngine(msg.data);
    }

    /// @inheritdoc ILendingMarketV2Primary
    function submitOperationBatch(
        OperationRequest[] calldata operationRequests
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _submitOperations(operationRequests);
    }

    /// @inheritdoc ILendingMarketV2Primary
    function voidOperationBatch(
        OperationVoidingRequest[] calldata operationVoidingRequests
    ) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _voidOperations(operationVoidingRequests);
    }

    /**
     * @dev Delegates a call to the lending engine smart contract internally.
     *
     * This function is for self calls only, external calls are prohibited.
     *
     * @param callData The call data to delegate.
     * @return The return data of the delegated call.
     */
    function delegateToEngine(bytes memory callData) public onlySelf returns (bytes memory) {
        return _delegateToEngine(callData);
    }

    // ------------------ View functions -------------------------- //

    /// @inheritdoc ILendingMarketV2Primary
    function underlyingToken() external view returns (address) {
        return _getLendingMarketStorage().underlyingToken;
    }

    /// @inheritdoc ILendingMarketV2Primary
    function subLoanCounter() external view returns (uint256) {
        return _getLendingMarketStorage().subLoanCounter;
    }

    /// @inheritdoc ILendingMarketV2Primary
    function subLoanAutoIdCounter() external view returns (uint256) {
        return _getLendingMarketStorage().subLoanAutoIdCounter;
    }

    /// @inheritdoc ILendingMarketV2Primary
    function programCounter() external view returns (uint256) {
        return _getLendingMarketStorage().programCounter;
    }

    /// @inheritdoc ILendingMarketV2Primary
    function engine() external view returns (address) {
        return _getLendingMarketStorage().engine;
    }

    /// @inheritdoc ILendingMarketV2Primary
    function getAccountAddressBookRecordCount() external view returns (uint256) {
        return _getLendingMarketStorage().accountAddressBook.recordCount;
    }

    /// @inheritdoc ILendingMarketV2Primary
    function getAccountInAddressBook(uint256 id) external view returns (address) {
        return AddressBook.getAccount(_getLendingMarketStorage().accountAddressBook, id);
    }

    /// @inheritdoc ILendingMarketV2Primary
    function getProgram(uint32 programId) external view returns (LendingProgramView memory) {
        LendingProgram storage program = _getLendingMarketStorage().programs[programId];
        return
            LendingProgramView({
                status: uint256(program.status),
                creditLine: program.creditLine,
                liquidityPool: program.liquidityPool
            });
    }

    /// @inheritdoc ILendingMarketV2Primary
    function getSubLoanPreview(
        uint256 subLoanId,
        uint256 timestamp,
        uint256 flags
    ) external view returns (SubLoanPreview memory) {
        return _getSubLoanPreview(subLoanId, timestamp, flags);
    }

    /// @inheritdoc ILendingMarketV2Primary
    function getLoanPreview(
        uint256 subLoanId,
        uint256 timestamp,
        uint256 flags
    ) external view returns (LoanPreview memory previews) {
        return _getLoanPreview(subLoanId, timestamp, flags);
    }

    /// @inheritdoc ILendingMarketV2Primary
    function getSubLoanOperationIds(uint256 subLoanId) external view returns (uint256[] memory) {
        SubLoan storage subLoan = _getLendingMarketStorage().subLoans[subLoanId];
        uint256[] memory operationIds = new uint256[](subLoan.metadata.operationCount);
        uint256 operationId = subLoan.metadata.earliestOperationId;
        for (uint256 i = 0; operationId != 0; ++i) {
            operationIds[i] = operationId;
            operationId = subLoan.operations[operationId].nextOperationId;
        }
        return operationIds;
    }

    /// @inheritdoc ILendingMarketV2Primary
    function getSubLoanOperation(uint256 subLoanId, uint256 operationId) external view returns (OperationView memory) {
        return _getOperationView(subLoanId, operationId);
    }

    // ------------------ Constant view functions ----------------- //

    /// @inheritdoc ILendingMarketV2Primary
    function interestRateFactor() external pure returns (uint256) {
        return INTEREST_RATE_FACTOR;
    }

    /// @inheritdoc ILendingMarketV2Primary
    function accuracyFactor() external pure returns (uint256) {
        return ACCURACY_FACTOR;
    }

    /// @inheritdoc ILendingMarketV2Primary
    function subLoanCountMax() external pure returns (uint256) {
        return SUB_LOAN_COUNT_MAX;
    }

    /// @inheritdoc ILendingMarketV2Primary
    function operationCountMax() external pure returns (uint256) {
        return OPERATION_COUNT_MAX;
    }

    /// @inheritdoc ILendingMarketV2Primary
    function dayBoundaryOffset() external pure returns (int256) {
        return -int256(NEGATIVE_DAY_BOUNDARY_OFFSET);
    }

    /// @inheritdoc ILendingMarketV2Primary
    function subLoanAutoIdStart() external pure returns (uint256) {
        return SUB_LOAN_AUTO_ID_START;
    }

    // ------------------ Pure functions -------------------------- //

    /// @inheritdoc ILendingMarketV2
    function proveLendingMarketV2() external pure {}

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Sets the underlying token of the lending market with validation.
     * @param underlyingToken_ The address of the underlying token.
     */
    function _setUnderlyingToken(address underlyingToken_) internal {
        if (underlyingToken_ == address(0)) {
            revert LendingMarketV2_UnderlyingTokenAddressZero();
        }
        if (underlyingToken_.code.length == 0) {
            revert LendingMarketV2_UnderlyingTokenAddressInvalid();
        }
        try IERC20(underlyingToken_).balanceOf(address(0)) {} catch {
            revert LendingMarketV2_UnderlyingTokenAddressInvalid();
        }

        _getLendingMarketStorage().underlyingToken = underlyingToken_;
    }

    /**
     * @dev Sets the lending engine of the lending market with validation.
     * @param engine_ The address of the lending engine.
     */
    function _setEngine(address engine_) internal {
        if (engine_ == address(0)) {
            revert LendingMarketV2_EngineAddressZero();
        }
        if (engine_.code.length == 0) {
            revert LendingMarketV2_EngineAddressInvalid();
        }
        try ILendingEngineV2(engine_).proveLendingEngineV2() {} catch {
            revert LendingMarketV2_EngineAddressInvalid();
        }

        _getLendingMarketStorage().engine = engine_;
    }

    /**
     * @dev Checks if a credit line is valid.
     * @param creditLine The address of the credit line.
     */
    function _checkCreditLine(address creditLine) internal view {
        if (creditLine == address(0)) {
            revert LendingMarketV2_CreditLineAddressZero();
        }
        if (creditLine.code.length == 0) {
            revert LendingMarketV2_CreditLineAddressInvalid();
        }
        try ICreditLineV2(creditLine).proveCreditLineV2() {} catch {
            revert LendingMarketV2_CreditLineAddressInvalid();
        }
    }

    /**
     * @dev Checks if a liquidity pool is valid.
     * @param liquidityPool The address of the liquidity pool.
     */
    function _checkLiquidityPool(address liquidityPool) internal view {
        if (liquidityPool == address(0)) {
            revert LendingMarketV2_LiquidityPoolAddressZero();
        }
        if (liquidityPool.code.length == 0) {
            revert LendingMarketV2_LiquidityPoolAddressInvalid();
        }
        try ILiquidityPool(liquidityPool).proveLiquidityPool() {} catch {
            revert LendingMarketV2_LiquidityPoolAddressInvalid();
        }
    }

    /**
     * @dev Checks if a credit line and liquidity pool are valid.
     * @param creditLine The address of the credit line.
     * @param liquidityPool The address of the liquidity pool.
     */
    function _checkCreditLineAndLiquidityPool(address creditLine, address liquidityPool) internal view {
        _checkCreditLine(creditLine);
        _checkLiquidityPool(liquidityPool);
    }

    /**
     * @dev Opens a new lending program.
     */
    function _openProgram(
        address creditLine, // Tools: prevent Prettier one-liner
        address liquidityPool
    ) internal {
        _checkCreditLineAndLiquidityPool(creditLine, liquidityPool);

        uint256 programId = _increaseProgramId();
        LendingProgram storage program = _getLendingMarketStorage().programs[programId];

        emit ProgramOpened(programId, creditLine, liquidityPool);

        program.status = LendingProgramStatus.Active;
        program.creditLine = creditLine;
        program.liquidityPool = liquidityPool;
    }

    /**
     * @dev Closes a lending program.
     */
    function _closeProgram(uint256 programId) internal {
        LendingProgram storage program = _getLendingMarketStorage().programs[programId];
        if (program.status != LendingProgramStatus.Active) {
            revert LendingMarketV2_ProgramStatusIncompatible(uint256(program.status));
        }

        emit ProgramClosed(programId);

        program.status = LendingProgramStatus.Closed;
    }

    /**
     * @dev Increments and returns the next program ID, reverting if it exceeds the maximum allowed value.
     */
    function _increaseProgramId() internal returns (uint256) {
        LendingMarketStorage storage $ = _getLendingMarketStorage();
        uint256 programId = uint256($.programCounter);
        unchecked {
            programId += 1;
        }
        if (programId > type(uint24).max) {
            revert LendingMarketV2_ProgramIdExcess();
        }
        $.programCounter = uint24(programId);
        return programId;
    }

    /**
     * @dev Performs a static call to this contract and bubbles up any revert.
     */
    function _selfStaticCall(bytes memory callData) internal view returns (bytes memory) {
        (bool ok, bytes memory ret) = address(this).staticcall(callData);
        if (!ok) {
            _bubbleRevert(ret);
        }
        return ret;
    }

    /**
     * @dev Delegates a call to the lending engine contract and bubbles up any revert.
     */
    function _delegateToEngine(bytes memory callData) internal returns (bytes memory) {
        address engine_ = _getLendingMarketStorage().engine;
        if (engine_ == address(0)) {
            revert LendingMarketV2_EngineUnconfigured();
        }
        address engineImplementation = ILendingEngineV2(engine_).getImplementation();
        (bool ok, bytes memory ret) = engineImplementation.delegatecall(callData);
        if (!ok) {
            _bubbleRevert(ret);
        }
        return ret;
    }

    /**
     * @dev Re-throws the revert data from a failed call using inline assembly.
     */
    function _bubbleRevert(bytes memory revertData) private pure {
        assembly {
            revert(add(revertData, 0x20), mload(revertData))
        }
    }

    /**
     * @dev Submits multiple operations to sub-loans and processes all affected sub-loans.
     */
    function _submitOperations(
        OperationRequest[] memory operationRequests
    ) internal returns (uint256[] memory affectedSubLoanIds) {
        uint256 count = operationRequests.length;
        if (count == 0) {
            revert LendingMarketV2_OperationRequestCountZero();
        }
        affectedSubLoanIds = new uint256[](count);
        for (uint256 i = 0; i < count; ++i) {
            OperationRequest memory operationRequest = operationRequests[i];
            _delegateToEngine(
                abi.encodeCall(
                    ILendingEngineV2.addOperation,
                    (
                        operationRequest.subLoanId,
                        uint256(operationRequest.kind),
                        operationRequest.timestamp,
                        operationRequest.value,
                        operationRequest.account
                    )
                )
            );
            _includeAffectedSubLoanId(affectedSubLoanIds, operationRequest.subLoanId);
        }
        _processAffectedSubLoans(affectedSubLoanIds);
    }

    /**
     * @dev Cancels multiple operations and processes all affected sub-loans.
     */
    function _voidOperations(OperationVoidingRequest[] memory operationVoidingRequests) internal {
        uint256 count = operationVoidingRequests.length;
        if (count == 0) {
            revert LendingMarketV2_OperationRequestCountZero();
        }
        uint256[] memory affectedSubLoanIds = new uint256[](count);
        for (uint256 i = 0; i < count; ++i) {
            OperationVoidingRequest memory voidingRequest = operationVoidingRequests[i];
            _delegateToEngine(
                abi.encodeCall(
                    ILendingEngineV2.cancelOperation,
                    (voidingRequest.subLoanId, voidingRequest.operationId, voidingRequest.counterparty)
                )
            );
            _includeAffectedSubLoanId(affectedSubLoanIds, voidingRequest.subLoanId);
        }
        _processAffectedSubLoans(affectedSubLoanIds);
    }

    /**
     * @dev Adds a sub-loan ID to the array of affected sub-loans if not already present.
     */
    function _includeAffectedSubLoanId(uint256[] memory affectedSubLoanIds, uint256 subLoanId) internal pure {
        uint256 count = affectedSubLoanIds.length;
        uint256 i = 0;
        for (; i < count; ++i) {
            uint256 affectedSubLoanId = affectedSubLoanIds[i];
            if (affectedSubLoanId == subLoanId) {
                return;
            }
            if (affectedSubLoanId == 0) {
                break;
            }
        }

        // No existing affected sub-loan found, add a new one
        affectedSubLoanIds[i] = subLoanId;
    }

    /**
     * @dev Processes all affected sub-loans and validates their state by computing previews.
     */
    function _processAffectedSubLoans(uint256[] memory affectedSubLoanIds) internal {
        uint256 count = affectedSubLoanIds.length;
        for (uint256 i = 0; i < count; ++i) {
            uint256 subLoanId = affectedSubLoanIds[i];
            if (subLoanId == 0) {
                break;
            }
            _delegateToEngine(abi.encodeCall(ILendingEngineV2.processSubLoan, (subLoanId)));
            // to be sure pending operations will not be reverted in the future
            _getSubLoanPreview(subLoanId, _getLatestOperationTimestamp(subLoanId), 0);
        }
    }

    /**
     * @dev Converts a processing sub-loan structure to a sub-loan preview structure.
     */
    function _convertToSubLoanPreview(ProcessingSubLoan memory subLoan) internal view returns (SubLoanPreview memory) {
        SubLoanPreview memory preview;
        SubLoan storage storedSubLoan = _getLendingMarketStorage().subLoans[subLoan.id];

        preview.day = _dayIndex(subLoan.trackedTimestamp);
        preview.id = subLoan.id;
        preview.firstSubLoanId = subLoan.id - storedSubLoan.metadata.subLoanIndex;
        preview.subLoanCount = storedSubLoan.metadata.subLoanCount;
        preview.operationCount = storedSubLoan.metadata.operationCount;
        preview.earliestOperationId = subLoan.earliestOperationId;
        preview.recentOperationId = subLoan.recentOperationId;
        preview.latestOperationId = storedSubLoan.metadata.latestOperationId;
        preview.status = subLoan.status;
        preview.gracePeriodStatus = subLoan.gracePeriodStatus;
        preview.programId = storedSubLoan.inception.programId;
        preview.borrower = storedSubLoan.inception.borrower;
        preview.borrowedAmount = storedSubLoan.inception.borrowedAmount;
        preview.addonAmount = storedSubLoan.inception.addonAmount;
        preview.startTimestamp = subLoan.startTimestamp;
        preview.freezeTimestamp = subLoan.freezeTimestamp;
        preview.trackedTimestamp = subLoan.trackedTimestamp;
        preview.pendingTimestamp = subLoan.pendingTimestamp;
        preview.duration = subLoan.duration;
        preview.remuneratoryRate = subLoan.remuneratoryRate;
        preview.moratoryRate = subLoan.moratoryRate;
        preview.lateFeeRate = subLoan.lateFeeRate;
        preview.graceDiscountRate = subLoan.graceDiscountRate;
        preview.trackedPrincipal = subLoan.trackedPrincipal;
        preview.trackedRemuneratoryInterest = subLoan.trackedRemuneratoryInterest;
        preview.trackedMoratoryInterest = subLoan.trackedMoratoryInterest;
        preview.trackedLateFee = subLoan.trackedLateFee;
        preview.outstandingBalance = _calculateOutstandingBalance(subLoan);
        preview.repaidPrincipal = subLoan.repaidPrincipal;
        preview.repaidRemuneratoryInterest = subLoan.repaidRemuneratoryInterest;
        preview.repaidMoratoryInterest = subLoan.repaidMoratoryInterest;
        preview.repaidLateFee = subLoan.repaidLateFee;
        preview.discountPrincipal = subLoan.discountPrincipal;
        preview.discountRemuneratoryInterest = subLoan.discountRemuneratoryInterest;
        preview.discountMoratoryInterest = subLoan.discountMoratoryInterest;
        preview.discountLateFee = subLoan.discountLateFee;
        return preview;
    }

    /**
     * @dev Retrieves the preview of a sub-loan at a given timestamp via a delegated engine call.
     */
    function _getSubLoanPreview(
        uint256 subLoanId,
        uint256 timestamp,
        uint256 flags
    ) internal view returns (SubLoanPreview memory) {
        bytes memory ret = _selfStaticCall(
            abi.encodeCall(
                this.delegateToEngine,
                (abi.encodeCall(ILendingEngineV2.previewSubLoan, (subLoanId, timestamp, flags)))
            )
        );

        // The `delegateToEngine` function returns `bytes` which wrap the engine return data.
        // First, decode the outer `bytes`, then decode the inner payload.
        bytes memory engineRet = abi.decode(ret, (bytes));
        ProcessingSubLoan memory subLoan = abi.decode(engineRet, (ProcessingSubLoan));

        return _convertToSubLoanPreview(subLoan);
    }

    /**
     * @dev Calculates the preview of a loan.
     * @param subLoanId The ID of any sub-loan of the loan.
     * @param timestamp The timestamp to calculate the preview at.
     * @return The loan preview.
     */
    function _getLoanPreview(
        uint256 subLoanId,
        uint256 timestamp,
        uint256 flags
    ) internal view returns (LoanPreview memory) {
        LoanPreview memory preview;

        SubLoan storage subLoan = _getLendingMarketStorage().subLoans[subLoanId];
        uint256 subLoanCount = subLoan.metadata.subLoanCount;
        subLoanId = subLoanId - subLoan.metadata.subLoanIndex;

        preview.firstSubLoanId = subLoanId;
        preview.subLoanCount = subLoanCount;

        SubLoanPreview memory singleLoanPreview;
        for (uint256 i = 0; i < subLoanCount; ++i) {
            singleLoanPreview = _getSubLoanPreview(subLoanId, timestamp, flags);
            if (singleLoanPreview.status == uint256(SubLoanStatus.Ongoing)) {
                preview.ongoingSubLoanCount += 1;
            }
            if (singleLoanPreview.status == uint256(SubLoanStatus.Repaid)) {
                preview.repaidSubLoanCount += 1;
            }
            if (singleLoanPreview.status == uint256(SubLoanStatus.Revoked)) {
                preview.revokedSubLoanCount += 1;
            }
            preview.totalBorrowedAmount += singleLoanPreview.borrowedAmount;
            preview.totalAddonAmount += singleLoanPreview.addonAmount;
            preview.totalTrackedPrincipal += singleLoanPreview.trackedPrincipal;
            preview.totalTrackedRemuneratoryInterest += singleLoanPreview.trackedRemuneratoryInterest;
            preview.totalTrackedMoratoryInterest += singleLoanPreview.trackedMoratoryInterest;
            preview.totalTrackedLateFee += singleLoanPreview.trackedLateFee;
            preview.totalOutstandingBalance += singleLoanPreview.outstandingBalance;
            preview.totalRepaidPrincipal += singleLoanPreview.repaidPrincipal;
            preview.totalRepaidRemuneratoryInterest += singleLoanPreview.repaidRemuneratoryInterest;
            preview.totalRepaidMoratoryInterest += singleLoanPreview.repaidMoratoryInterest;
            preview.totalRepaidLateFee += singleLoanPreview.repaidLateFee;
            preview.totalDiscountPrincipal += singleLoanPreview.discountPrincipal;
            preview.totalDiscountRemuneratoryInterest += singleLoanPreview.discountRemuneratoryInterest;
            preview.totalDiscountMoratoryInterest += singleLoanPreview.discountMoratoryInterest;
            preview.totalDiscountLateFee += singleLoanPreview.discountLateFee;
            unchecked {
                ++subLoanId;
            }
        }
        preview.day = singleLoanPreview.day;
        preview.programId = singleLoanPreview.programId;
        preview.borrower = singleLoanPreview.borrower;

        return preview;
    }

    /**
     * @dev Retrieves the view structure of a specific operation for a sub-loan.
     */
    function _getOperationView(
        uint256 subLoanId, // Tools: prevent Prettier one-liner
        uint256 operationId
    ) internal view returns (OperationView memory) {
        SubLoan storage subLoan = _getLendingMarketStorage().subLoans[subLoanId];
        Operation storage operation = subLoan.operations[operationId];
        return
            OperationView({
                id: operationId,
                status: uint256(operation.status),
                kind: uint256(operation.kind),
                nextOperationId: operation.nextOperationId,
                prevOperationId: operation.prevOperationId,
                timestamp: operation.timestamp,
                value: operation.value,
                account: _getOperationAccount(subLoan, operation)
            });
    }

    /**
     * @dev Returns the timestamp of the latest operation for a sub-loan.
     */
    function _getLatestOperationTimestamp(uint256 subLoanId) internal view returns (uint256) {
        SubLoan storage subLoan = _getLendingMarketStorage().subLoans[subLoanId];
        return subLoan.operations[subLoan.metadata.latestOperationId].timestamp;
    }

    /**
     * @dev Calculates the total outstanding balance of a sub-loan by summing all tracked components.
     */
    function _calculateOutstandingBalance(ProcessingSubLoan memory subLoan) internal pure returns (uint256) {
        return
            _roundMath(subLoan.trackedPrincipal) +
            _roundMath(subLoan.trackedRemuneratoryInterest) +
            _roundMath(subLoan.trackedMoratoryInterest) +
            _roundMath(subLoan.trackedLateFee);
    }

    /**
     * @dev The upgrade validation function for the UUPSExtUpgradeable contract.
     */
    function _validateUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        try ILendingMarketV2(newImplementation).proveLendingMarketV2() {} catch {
            revert LendingMarketV2_ImplementationAddressInvalid();
        }
    }
}
