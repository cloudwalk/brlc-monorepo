// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

/**
 * @title ILendingMarketV2Types interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines types that are used in the lending market contract and the engine one.
 *
 * See details about the smart contract logic in the `docs/description.md` file.
 */
interface ILendingMarketV2Types {
    /**
     * @dev The status of a lending program.
     *
     * Values:
     *
     * - Nonexistent = 0 -- Lending program does not exist. The default value.
     * - Active = 1 ------- Lending program is active and can be used to take loans.
     * - Closed = 2 ------- Lending program is closed and cannot be used to take loans.
     *
     * Notes:
     *
     * - A closed program cannot be reopened.
     */
    enum LendingProgramStatus {
        Nonexistent,
        Active,
        Closed
    }

    /**
     * @dev The status of a sub-loan.
     *
     * Values:
     *
     * - Nonexistent = 0 -- The sub-loan does not exist. The default value.
     * - Ongoing = 1 ------ The sub-loan is ongoing and should be repaid.
     * - Repaid = 2 ------- The sub-loan is fully repaid and thus is closed.
     * - Revoked = 3 ------ The sub-loan is revoked and thus is closed.
     *
     * Notes:
     *
     * - A revoked sub-loan cannot be reopened.
     * - A revoked sub-loan rejects submission of new operations or voiding of existing ones.
     * - A fully repaid sub-loan can be reopened by voiding an existing operation or submitting new ones.
     */
    enum SubLoanStatus {
        Nonexistent,
        Ongoing,
        Repaid,
        Revoked
    }

    /**
     * @dev The status of the grace period of a sub-loan.
     *
     * Values:
     *
     * - None = 0 ---- The grace period is not active. The default value.
     * - Active = 1 -- The grace period is active.
     *
     * Notes:
     *
     * - A grace period is active if the following conditions are met:
     *   - the grace discount rate is not zero for the sub-loan;
     *   - the sub-loan is ongoing;
     *   - the sub-loan tracked timestamp is not greater than the end of the due date of the sub-loan.
     */
    enum GracePeriodStatus {
        None,
        Active
    }

    /**
     * @dev The status of a sub-loan operation.
     *
     * Values:
     *
     * - Nonexistent = 0 -- Operation does not exist.
     * - Pending = 1 ------ Operation is created but not yet applied.
     * - Applied = 2 ------ Operation has been successfully applied to the sub-loan.
     * - Skipped = 3 ------ Reserved for future use, because statuses >3 are voided.
     * - Dismissed = 4 ---- Operation was voided without being applied.
     * - Revoked = 5 ------ Operation was voided after being applied.
     */
    enum OperationStatus {
        Nonexistent,
        Pending,
        Applied,
        Skipped,
        Dismissed,
        Revoked
    }

    /**
     * @dev The type of a sub-loan operation.
     *
     * Values:
     *
     * - Nonexistent = 0 --------------- The operation does not exist. The default value.
     * - Repayment = 1 ----------------- The repayment of the sub-loan.
     * - Discount = 2 ------------------ The discount of the sub-loan.
     * - Revocation = 3 ---------------- The revocation of the sub-loan.
     * - Freezing = 4 ------------------ The freezing of the sub-loan.
     * - Unfreezing = 5 ---------------- The unfreezing of the sub-loan.
     * - RemuneratoryRateSetting = 6 --- The setting of the remuneratory rate of the sub-loan.
     * - MoratoryRateSetting = 7 ------- The setting of the moratory rate of the sub-loan.
     * - LateFeeRateSetting = 8 -------- The setting of the late fee rate of the sub-loan.
     * - GraceDiscountRateSetting = 9 -- The setting of the grace discount rate of the sub-loan.
     * - DurationSetting = 10 ---------- The setting of the duration of the sub-loan.
     *
     * Notes:
     *
     * 1. The only operation that have the account parameter is the repayment.
     *    All other operations do not have this parameter and it must be set to zero address in the submission request.
     * 2. The following operations does not have the value parameter, it must be set to zero in the submission request:
     *    - Revocation;
     *    - Freezing.
     * 3. The meaning of the value parameter of an operation depends on the operation kind:
     *    - Repayment: The amount of the repayment.
     *    - Discount: The amount of the discount.
     *    - Unfreezing: The flag indicating whether the sub-loan duration extension should be skipped during unfreezing:
     *      - 0: The sub-loan duration is extended by the number of days since the freezing timestamp.
     *      - 1: The sub-loan duration is kept without changes.
     *    - RemuneratoryRateSetting: The remuneratory rate of the sub-loan to set.
     *    - MoratoryRateSetting: The moratory rate of the sub-loan to set.
     *    - LateFeeRateSetting: The late fee rate of the sub-loan to set.
     *    - GraceDiscountRateSetting: The grace discount rate of the sub-loan to set.
     *    - DurationSetting: The duration of the sub-loan to set.
     * 4. The repayment and discount amounts of an operation must be rounded according to the ACCURACY_FACTOR,
     *    see the `Constants` contract.
     * 5. All rates are expressed as multiplied by the `INTEREST_RATE_FACTOR` constant in the `Constants` contract.
     */
    enum OperationKind {
        Nonexistent,
        Repayment,
        Discount,
        Revocation,
        Freezing,
        Unfreezing,
        RemuneratoryRateSetting,
        MoratoryRateSetting,
        LateFeeRateSetting,
        GraceDiscountRateSetting,
        DurationSetting
    }

    /**
     * @dev Defines the lending program.
     *
     * This structure is intended for storage use only.
     *
     * Fields:
     *
     * - status --------- The status of the lending program.
     * - creditLine ----- The address of the credit line.
     * - liquidityPool -- The address of the liquidity pool.
     */
    struct LendingProgram {
        // Slot1
        LendingProgramStatus status;
        address creditLine;
        // uint88 __reserved; // Reserved until the end of the storage slot

        // Slot 2
        address liquidityPool;
        // uint96 __reserved; // Reserved until the end of the storage slot
    }

    /**
     * @dev Defines the view of a lending program.
     *
     * This structure is intended for in-memory use only.
     *
     * Fields:
     *
     * - status --------- The status of the lending program.
     * - creditLine ----- The address of the credit line.
     * - liquidityPool -- The address of the liquidity pool.
     */
    struct LendingProgramView {
        uint256 status;
        address creditLine;
        address liquidityPool;
    }

    /**
     * @dev Defines the inception of a sub-loan, including the initial values and unalterable data.
     *
     * This structure is intended for storage use only.
     *
     * Fields:
     *
     * - borrowedAmount ------------ The borrowed amount of the sub-loan.
     * - addonAmount --------------- The addon amount of the sub-loan.
     * - initialRemuneratoryRate --- The initial remuneratory rate of the sub-loan.
     * - initialMoratoryRate ------- The initial moratory rate of the sub-loan.
     * - initialLateFeeRate -------- The initial late fee rate of the sub-loan.
     * - initialGraceDiscountRate -- The initial grace discount rate of the sub-loan.
     * - initialDuration ----------- The initial duration of the sub-loan in days.
     * - startTimestamp ------------ The timestamp (at UTC timezone) when the sub-loan is started.
     * - programId ----------------- The ID of the lending program used to take the sub-loan.
     * - borrower ------------------ The address of the borrower.
     *
     * Notes:
     *
     * 1. The borrowed amount and the addon amount together form the principal of the sub-loan.
     * 2. If the grace discount rate is not zero, then the grace period is active from the start timestamp.
     *    Otherwise, it is inactive.
     * 3. All rates are expressed as multiplied by the `INTEREST_RATE_FACTOR` constant in the `Constants` contract.
     */
    struct SubLoanInception {
        // Slot1 -- This data will never change and is rarely read
        uint64 borrowedAmount;
        uint64 addonAmount;
        uint32 initialRemuneratoryRate;
        uint32 initialMoratoryRate;
        uint32 initialLateFeeRate;
        uint32 initialGraceDiscountRate;
        // No reserve until the end of the storage slot

        // Slot 2 -- This data will never change
        uint16 initialDuration;
        uint32 startTimestamp;
        uint24 programId;
        address borrower;
        // uint24 __reserved; // Reserved until the end of the storage slot
    }

    /**
     * @dev Defines the metadata of a sub-loan, used during the sub-loan processing.
     *
     * This structure is intended for storage use only.
     *
     * Fields:
     *
     * - subLoanIndex --------- The index of the sub-loan within a loan.
     * - subLoanCount --------- The number of sub-loans within a loan.
     * - updateIndex ---------- The index of the next update event to be emitted for the sub-loan.
     * - pendingTimestamp ----- The timestamp of the earliest pending operation of the sub-loan or zero if none.
     * - operationCount ------- The number of operations with all states for the sub-loan.
     * - earliestOperationId -- The ID of the earliest submitted operation of the sub-loan.
     * - recentOperationId ---- The ID of the recent applied operation of the sub-loan.
     * - latestOperationId ---- The ID of the latest submitted operation of the sub-loan.
     *
     * Notes:
     *
     * 1. The `pendingTimestamp` field is also used in intermediate processing of the sub-loan to
     *    store the timestamp of the earliest altered operation (added or canceled).
     *    But between blockchain transactions it stores the timestamp of the earliest pending operation.
     */
    struct SubLoanMetadata {
        // Slot 1
        uint16 subLoanIndex;
        uint16 subLoanCount;
        uint24 updateIndex;
        uint32 pendingTimestamp;
        uint16 operationCount;
        uint16 earliestOperationId;
        uint16 recentOperationId;
        uint16 latestOperationId;
        // uint88 __reserved; // Reserved until the end of the storage slot
    }

    /**
     * @dev Defines the current state of a sub-loan, calculated based on the inception and the active operations.
     *
     * This structure is intended for storage use only.
     *
     * Fields:
     *
     * - status ------------------------ The status of the sub-loan.
     * - gracePeriodStatus ------------- The status of the grace period of the sub-loan.
     * - duration ---------------------- The duration of the sub-loan in days.
     * - freezeTimestamp --------------- The timestamp (at UTC timezone) when the sub-loan is frozen.
     * - trackedTimestamp -------------- The timestamp (at UTC timezone) at which this state is determined.
     * - remuneratoryRate -------------- The remuneratory rate of the sub-loan.
     * - moratoryRate ------------------ The moratory rate of the sub-loan.
     * - lateFeeRate ------------------- The late fee rate of the sub-loan.
     * - graceDiscountRate ------------- The grace discount rate of the sub-loan.
     * - trackedPrincipal -------------- The tracked principal of the sub-loan, remaining to be repaid.
     * - trackedRemuneratoryInterest --- The tracked remuneratory interest of the sub-loan, remaining to be repaid.
     * - trackedMoratoryInterest ------- The tracked moratory interest of the sub-loan, remaining to be repaid.
     * - trackedLateFee ---------------- The tracked late fee of the sub-loan, remaining to be repaid.
     * - repaidPrincipal --------------- The repaid principal of the sub-loan.
     * - repaidRemuneratoryInterest ---- The repaid remuneratory interest of the sub-loan.
     * - repaidMoratoryInterest -------- The repaid moratory interest of the sub-loan.
     * - repaidLateFee ----------------- The repaid late fee of the sub-loan.
     * - discountPrincipal ------------- The discount principal of the sub-loan.
     * - discountRemuneratoryInterest -- The discount remuneratory interest of the sub-loan.
     * - discountMoratoryInterest ------ The discount moratory interest of the sub-loan.
     * - discountLateFee --------------- The discount late fee of the sub-loan.
     *
     * Notes:
     *
     * 1. The `gracePeriodStatus` field is needed to be sure in which state the sub-loan is during the grace period,
     *    Consider the case when there is only one operation after the due date and it is voided.
     *    Then next operation most likely will be after the due date and it is redundant
     *    to change the grace period status again. So to be sure what is the current status we store it explicitly.
     * 2. The `graceDiscountRate` field is used to calculate effective remuneratory rate during the grace period
     *    according to the formula:
     *   `effectiveRate = (remuneratoryRate * (INTEREST_RATE_FACTOR - graceDiscountRate)) /INTEREST_RATE_FACTOR`.
     * 3. The principal parts obey the following formula:
     *    `principal = borrowedAmount + addonAmount = trackedPrincipal + repaidPrincipal + discountPrincipal`.
     * 4. The initial late fee imposed just after the due date can be calculated as:
     *   `initialLateFee = trackedLateFee + repaidLateFee + discountLateFee`.
     * 5. All rates are expressed as multiplied by the `INTEREST_RATE_FACTOR` constant in the `Constants` contract.
     */
    struct SubLoanState {
        // Slot 1 -- Frequently used data for reading and writing
        SubLoanStatus status;
        GracePeriodStatus gracePeriodStatus;
        uint16 duration;
        uint32 freezeTimestamp;
        uint32 trackedTimestamp;
        uint32 remuneratoryRate;
        uint32 moratoryRate;
        uint32 lateFeeRate;
        uint32 graceDiscountRate;
        // uint32 __reserved; // Reserved until the end of the storage slot

        // Slot 2 -- Forms the tracked balance
        uint64 trackedPrincipal;
        uint64 trackedRemuneratoryInterest;
        uint64 trackedMoratoryInterest;
        uint64 trackedLateFee;
        // No reserve until the end of the storage slot

        // Slot 3 -- Forms the repaid amount
        uint64 repaidPrincipal;
        uint64 repaidRemuneratoryInterest;
        uint64 repaidMoratoryInterest;
        uint64 repaidLateFee;
        // No reserve until the end of the storage slot

        // Slot 4 -- Forms the discount amount
        uint64 discountPrincipal;
        uint64 discountRemuneratoryInterest;
        uint64 discountMoratoryInterest;
        uint64 discountLateFee;
        // No reserve until the end of the storage slot
    }

    /**
     * @dev Defines the sub-loan, including the inception, the metadata, the state, and more.
     *
     * This structure is intended for storage use only.
     *
     * Fields:
     *
     * - inception --- The inception of the sub-loan.
     * - state ------- The state of the sub-loan.
     * - metadata ---- The metadata of the sub-loan.
     * - operations -- The operations of the sub-loan.
     * - __gapX ------ Reserved for future use and the possible structure extensions.
     */
    struct SubLoan {
        // Slots 1, 2
        SubLoanInception inception;
        // Slots 3 ... 50
        uint256[48] __gap0;
        // No reserve until the end of the storage slot

        // Slot 51 ... 54
        SubLoanState state;
        // Slots 55 ... 100
        uint256[46] __gap1;
        // No reserve until the end of the storage slot

        // Slot 101
        SubLoanMetadata metadata;
        // Slots 102 ... 150
        uint256[49] __gap2;
        // No reserve until the end of the storage slot

        // Slot 151
        mapping(uint256 operationId => Operation) operations;
    }

    /**
    /**
     * @dev Defines the data of a sub-loan, used during the sub-loan processing and previewing.
     * 
     * This structure is intended for in-memory use only.
     * 
     * Values:
     *
     * - id ---------------------------- The ID of the sub-loan.
     * - earliestOperationId ----------- The ID of the earliest submitted operation of the sub-loan.
     * - recentOperationId ------------- The ID of the recent applied operation of the sub-loan.
     * - flags ------------------------- The flags of the sub-loan.
     * - status ------------------------ The status of the sub-loan.
     * - gracePeriodStatus ------------- The status of the grace period of the sub-loan.
     * - startTimestamp ---------------- The timestamp (at UTC timezone) when the sub-loan is started.
     * - freezeTimestamp --------------- The timestamp (at UTC timezone) when the sub-loan is frozen.
     * - trackedTimestamp -------------- The timestamp (at UTC timezone) at which this state is determined.
     * - pendingTimestamp -------------- The timestamp of the earliest pending operation or zero if none.
     * - duration ---------------------- The duration of the sub-loan in days.
     * - remuneratoryRate -------------- The remuneratory rate of the sub-loan.
     * - moratoryRate ------------------ The moratory rate of the sub-loan.
     * - lateFeeRate ------------------- The late fee rate of the sub-loan.
     * - graceDiscountRate ------------- The grace discount rate of the sub-loan.
     * - trackedPrincipal -------------- The tracked principal of the sub-loan, remaining to be repaid.
     * - trackedRemuneratoryInterest --- The tracked remuneratory interest of the sub-loan, remaining to be repaid.
     * - trackedMoratoryInterest ------- The tracked moratory interest of the sub-loan, remaining to be repaid.
     * - trackedLateFee ---------------- The tracked late fee of the sub-loan, remaining to be repaid.
     * - repaidPrincipal --------------- The repaid principal of the sub-loan.
     * - repaidRemuneratoryInterest ---- The repaid remuneratory interest of the sub-loan.
     * - repaidMoratoryInterest -------- The repaid moratory interest of the sub-loan.
     * - repaidLateFee ----------------- The repaid late fee of the sub-loan.
     * - discountPrincipal ------------- The discount principal of the sub-loan.
     * - discountRemuneratoryInterest -- The discount remuneratory interest of the sub-loan.
     * - discountMoratoryInterest ------ The discount moratory interest of the sub-loan.
     * - discountLateFee --------------- The discount late fee of the sub-loan.
     * 
     * See notes for the appropriate fields in comments for the storage sub-loan structures above.
     */
    struct ProcessingSubLoan {
        uint256 id;
        uint256 earliestOperationId;
        uint256 recentOperationId;
        uint256 flags;
        uint256 status;
        uint256 gracePeriodStatus;
        uint256 startTimestamp;
        uint256 freezeTimestamp;
        uint256 trackedTimestamp;
        uint256 pendingTimestamp;
        uint256 duration;
        uint256 remuneratoryRate;
        uint256 moratoryRate;
        uint256 lateFeeRate;
        uint256 graceDiscountRate;
        uint256 trackedPrincipal;
        uint256 trackedRemuneratoryInterest;
        uint256 trackedMoratoryInterest;
        uint256 trackedLateFee;
        uint256 repaidPrincipal;
        uint256 repaidRemuneratoryInterest;
        uint256 repaidMoratoryInterest;
        uint256 repaidLateFee;
        uint256 discountPrincipal;
        uint256 discountRemuneratoryInterest;
        uint256 discountMoratoryInterest;
        uint256 discountLateFee;
    }

    /**
     * @dev Defines the preview of a sub-loan.
     *
     * This structure is intended for in-memory use only.
     *
     * Fields:
     *
     * - day --------------------------- The day index at which the preview is calculated.
     * - id ---------------------------- The ID of the sub-loan.
     * - firstSubLoanId ---------------- The ID of the first sub-loan in the loan.
     * - subLoanCount ------------------ The number of sub-loans in the loan.
     * - operationCount ---------------- The number of operations (with all states) for the sub-loan.
     * - earliestOperationId ----------- The ID of the earliest submitted operation of the sub-loan.
     * - recentOperationId ------------- The ID of the recent applied operation of the sub-loan.
     * - latestOperationId ------------- The ID of the latest submitted operation of the sub-loan.
     * - status ------------------------ The status of the sub-loan.
     * - gracePeriodStatus ------------- The status of the grace period of the sub-loan.
     * - programId --------------------- The ID of the lending program used to take the sub-loan.
     * - borrower ---------------------- The address of the borrower.
     * - borrowedAmount ---------------- The borrowed amount of the sub-loan.
     * - addonAmount ------------------- The addon amount of the sub-loan.
     * - startTimestamp ---------------- The timestamp (at UTC timezone) when the sub-loan is started.
     * - freezeTimestamp --------------- The timestamp (at UTC timezone) when the sub-loan is frozen.
     * - trackedTimestamp -------------- The timestamp (at UTC timezone) at which this view is determined.
     * - pendingTimestamp -------------- The timestamp of the earliest pending operation for the sub-loan or zero if none.
     * - duration ---------------------- The duration of the sub-loan in days.
     * - remuneratoryRate -------------- The remuneratory rate of the sub-loan.
     * - moratoryRate ------------------ The moratory rate of the sub-loan.
     * - lateFeeRate ------------------- The late fee rate of the sub-loan.
     * - graceDiscountRate ------------- The grace discount rate of the sub-loan.
     * - trackedPrincipal -------------- The tracked principal of the sub-loan, remaining to be repaid.
     * - trackedRemuneratoryInterest --- The tracked remuneratory interest of the sub-loan, remaining to be repaid.
     * - trackedMoratoryInterest ------- The tracked moratory interest of the sub-loan, remaining to be repaid.
     * - trackedLateFee ---------------- The tracked late fee of the sub-loan, remaining to be repaid.
     * - outstandingBalance ------------ The outstanding balance of the sub-loan, see notes below.
     * - repaidPrincipal --------------- The repaid principal of the sub-loan.
     * - repaidRemuneratoryInterest ---- The repaid remuneratory interest of the sub-loan.
     * - repaidMoratoryInterest -------- The repaid moratory interest of the sub-loan.
     * - repaidLateFee ----------------- The repaid late fee of the sub-loan.
     * - discountPrincipal ------------- The discount principal of the sub-loan.
     * - discountRemuneratoryInterest -- The discount remuneratory interest of the sub-loan.
     * - discountMoratoryInterest ------ The discount moratory interest of the sub-loan.
     * - discountLateFee --------------- The discount late fee of the sub-loan.
     *
     * Notes:
     *
     * 1. The day index is calculated taking into account the day boundary offset,
     *    see the `dayBoundaryOffset()` function and the `NEGATIVE_DAY_BOUNDARY_OFFSET` constant in the `Constants` contract.
     * 2. The outstanding balance is calculated as:
     *    `outstandingBalance = round(trackedPrincipal) + round(trackedRemuneratoryInterest) + round(trackedMoratoryInterest) + round(trackedLateFee, ACCURACY_FACTOR)`.
     *    where the `round()` function returns an integer rounded according to the ACCURACY_FACTOR (see the `Constants` contract) using the standard mathematical rules.
     * 3. See notes for the appropriate fields in comments for the storage sub-loan structures above.
     *
     */
    struct SubLoanPreview {
        uint256 day;
        uint256 id;
        uint256 firstSubLoanId;
        uint256 subLoanCount;
        uint256 operationCount;
        uint256 earliestOperationId;
        uint256 recentOperationId;
        uint256 latestOperationId;
        uint256 status;
        uint256 gracePeriodStatus;
        uint256 programId;
        address borrower;
        uint256 borrowedAmount;
        uint256 addonAmount;
        uint256 startTimestamp;
        uint256 freezeTimestamp;
        uint256 trackedTimestamp;
        uint256 pendingTimestamp;
        uint256 duration;
        uint256 remuneratoryRate;
        uint256 moratoryRate;
        uint256 lateFeeRate;
        uint256 graceDiscountRate;
        uint256 trackedPrincipal;
        uint256 trackedRemuneratoryInterest;
        uint256 trackedMoratoryInterest;
        uint256 trackedLateFee;
        uint256 outstandingBalance;
        uint256 repaidPrincipal;
        uint256 repaidRemuneratoryInterest;
        uint256 repaidMoratoryInterest;
        uint256 repaidLateFee;
        uint256 discountPrincipal;
        uint256 discountRemuneratoryInterest;
        uint256 discountMoratoryInterest;
        uint256 discountLateFee;
    }

    /**
     * @dev Defines the preview of a loan.
     *
     * This structure is intended for in-memory use only.
     *
     * Fields:
     *
     * - day -------------------------------- The day index at which the preview is calculated.
     * - firstSubLoanId --------------------- The ID of the first sub-loan in the loan.
     * - subLoanCount ----------------------- The number of sub-loans in the loan.
     * - ongoingSubLoanCount ---------------- The number of ongoing sub-loans in the loan.
     * - repaidSubLoanCount ----------------- The number of fully repaid sub-loans in the loan.
     * - revokedSubLoanCount ---------------- The number of revoked sub-loans in the loan.
     * - programId -------------------------- The ID of the lending program used to take the loan.
     * - borrower --------------------------- The address of the borrower.
     * - totalBorrowedAmount ---------------- The total borrowed amount of the loan over all sub-loans.
     * - totalAddonAmount ------------------- The total addon amount of the loan over all sub-loans.
     * - totalTrackedPrincipal -------------- The total tracked principal of the loan over all sub-loans.
     * - totalTrackedRemuneratoryInterest --- The total tracked remuneratory interest of the loan over all sub-loans.
     * - totalTrackedMoratoryInterest ------- The total tracked moratory interest of the loan over all sub-loans.
     * - totalTrackedLateFee ---------------- The total tracked late fee of the loan over all sub-loans.
     * - totalOutstandingBalance ------------ The total outstanding balance of the loan over all sub-loans.
     * - totalRepaidPrincipal --------------- The total repaid principal of the loan over all sub-loans.
     * - totalRepaidRemuneratoryInterest ---- The total repaid remuneratory interest of the loan over all sub-loans.
     * - totalRepaidMoratoryInterest -------- The total repaid moratory interest of the loan over all sub-loans.
     * - totalRepaidLateFee ----------------- The total repaid late fee of the loan over all sub-loans.
     * - totalDiscountPrincipal ------------- The total discount principal of the loan over all sub-loans.
     * - totalDiscountRemuneratoryInterest -- The total discount remuneratory interest of the loan over all sub-loans.
     * - totalDiscountMoratoryInterest ------ The total discount moratory interest of the loan over all sub-loans.
     * - totalDiscountLateFee --------------- The total discount late fee of the loan over all sub-loans.
     *
     * See notes for the appropriate fields in comments for the storage sub-loan structures above.
     */
    struct LoanPreview {
        uint256 day;
        uint256 firstSubLoanId;
        uint256 subLoanCount;
        uint256 ongoingSubLoanCount;
        uint256 repaidSubLoanCount;
        uint256 revokedSubLoanCount;
        uint256 programId;
        address borrower;
        uint256 totalBorrowedAmount;
        uint256 totalAddonAmount;
        uint256 totalTrackedPrincipal;
        uint256 totalTrackedRemuneratoryInterest;
        uint256 totalTrackedMoratoryInterest;
        uint256 totalTrackedLateFee;
        uint256 totalOutstandingBalance;
        uint256 totalRepaidPrincipal;
        uint256 totalRepaidRemuneratoryInterest;
        uint256 totalRepaidMoratoryInterest;
        uint256 totalRepaidLateFee;
        uint256 totalDiscountPrincipal;
        uint256 totalDiscountRemuneratoryInterest;
        uint256 totalDiscountMoratoryInterest;
        uint256 totalDiscountLateFee;
    }

    /**
     * @dev Defines the operation of a sub-loan.
     *
     * This structure is intended for storage use only.
     *
     * Fields:
     *
     * - status ----------- The status of the operation.
     * - kind ------------- The kind of the operation.
     * - nextOperationId -- The ID of the next operation in the operation linked list.
     * - prevOperationId -- The ID of the previous operation in the operation linked list.
     * - timestamp -------- The timestamp (at UTC timezone) of the operation.
     * - value ------------ The value of the operation.
     * - accountId -------- The ID of the account related to the operation. See notes below.
     *
     * Notes:
     *
     * 1. The `accountId` field is used to store the ID of the account related to the operation (e.g. the repayer) in
     *    the global address book of the smart contract. There are special IDs:
     *    - 0 -- corresponds to no account, the zero address;
     *    - type(uint64).max -- corresponds to the borrower address of the sub-loan.
     *
     * Possible extension suggestion. If in the future we need a complex operation with multiple values,
     * we can use one the following approaches:
     *
     * - Split it into multiple operations with single values each and process them at once.
     *   E.g., we can introduce operations kinds like `DoComplexPart1`, `DoComplexPart2`, etc.
     * - Add more IDs like the `accountId` one with appropriate map storages.
     *   Those new IDs can have the sub-loan scope and type uint16.
     */
    struct Operation {
        // Slot1
        OperationStatus status;
        OperationKind kind;
        uint16 nextOperationId;
        uint16 prevOperationId;
        uint32 timestamp;
        uint64 value;
        uint64 accountId;
        // uint48 __reserved; // Reserved until the end of the storage slot
    }

    /**
     * @dev Defines the view of an operation.
     *
     * This structure is intended for in-memory use only.
     *
     * Fields:
     *
     * - id --------------- The ID of the operation.
     * - status ----------- The status of the operation.
     * - kind ------------- The kind of the operation.
     * - nextOperationId -- The ID of the next operation in the operation linked list.
     * - prevOperationId -- The ID of the previous operation in the operation linked list.
     * - timestamp -------- The timestamp (at UTC timezone) of the operation.
     * - value ------------ The value of the operation.
     * - account ---------- The address of the account related to the operation (e.g. the repayer).
     */
    struct OperationView {
        uint256 id;
        uint256 status;
        uint256 kind;
        uint256 nextOperationId;
        uint256 prevOperationId;
        uint256 timestamp;
        uint256 value;
        address account;
    }

    /**
     * @dev The request structure with the loan parameters to take.
     *
     * This structure is intended for in-memory use only.
     *
     * Fields:
     *
     * - borrower -------- The address of the loan borrower.
     * - programId ------- The ID of the lending program that will be used to take the loan.
     * - startTimestamp -- The timestamp when the loan and all its sub-loans starts.
     *
     * Field requirements:
     *
     * - All fields must not be zero, except the `startTimestamp` one.
     * - The `startTimestamp` field must be not greater than the current block timestamp.
     *
     * Notes about the fields:
     *
     * 1. If startTimestamp = 0, then the current block timestamp is used.
     * 2. The `startTimestamp` field allows to create loans that started in the past.
     */
    struct LoanTakingRequest {
        address borrower;
        uint256 programId;
        uint256 startTimestamp;
    }

    /**
    /**
     * @dev Defines the request with the parameters of a sub-loan to take within a loan.
     *
     * This structure is intended for in-memory use only.
     *
     * Fields:
     *
     * - borrowedAmount ----- The borrowed amount of the sub-loan.
     * - addonAmount -------- The addon amount of the sub-loan.
     * - duration ----------- The duration of the sub-loan in days.
     * - remuneratoryRate --- The remuneratory rate of the sub-loan.
     * - moratoryRate ------- The moratory rate of the sub-loan.
     * - lateFeeRate -------- The late fee rate of the sub-loan.
     * - graceDiscountRate -- The grace discount rate of the sub-loan.
     *
     * Notes:
     *
     * 1. All fields must be provided for each sub-loan request.
     * 2. The number of requests defines the number of sub-loans to take within the loan.
     * 3. The rates are expressed in basis points (1/100th of a percent).
     * 4. The application and calculation of each rate depends on the lending program's rules.
     */
    struct SubLoanTakingRequest {
        uint256 borrowedAmount;
        uint256 addonAmount;
        uint256 duration;
        uint256 remuneratoryRate;
        uint256 moratoryRate;
        uint256 lateFeeRate;
        uint256 graceDiscountRate;
    }

    /**
     * @dev Defines the request with the parameters of an operation to submit for a sub-loan.
     *
     * This structure is intended for in-memory use only.
     *
     * Fields:
     *
     * - subLoanId ---- The ID of the sub-loan to submit the operation for.
     * - kind --------- The kind of the operation to submit, see {OperationKind}.
     * - timestamp ---- The timestamp (at UTC timezone) of the operation to submit.
     * - value -------- The value of the operation to submit or zero if the operation does not have a value.
     * - account ------ The address of the account related to the operation to submit or the zero address if the operation does not have an account.
     *
     * See details about the fields in the comments for the `Operation` structure and `OperationKind` enum.
     *
     * Notes:
     *
     * - Operation IDs are assigned sequentially within each sub-loan by the contract.
     */
    struct OperationRequest {
        uint256 subLoanId;
        uint256 kind;
        uint256 timestamp;
        uint256 value;
        address account;
    }

    /**
     * @dev Defines the request to void an operation of a sub-loan.
     *
     * This structure is intended for in-memory use only.
     *
     * Fields:
     *
     * - subLoanId ----- The ID of the sub-loan to void the operation of.
     * - operationId --- The ID of the operation to void.
     * - counterparty -- The address of the account that will provide or receive tokens during the operation voiding.
     *
     * See details about the operation voiding in the `docs/description.md` file.
     */
    struct OperationVoidingRequest {
        uint256 subLoanId;
        uint256 operationId;
        address counterparty;
    }
}

/**
 * @title ILendingMarketV2PrimaryEvents interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary events of the lending market contract interface.
 */
interface ILendingMarketV2PrimaryEvents is ILendingMarketV2Types {
    /**
     * @dev Emitted when a loan is taken in the form of multiple sub-loans.
     * @param firstSubLoanId The ID of the first sub-loan of the loan.
     * @param borrower The address of the borrower.
     * @param programId The ID of the lending program that was used to take the loan.
     * @param totalBorrowedAmount The total amount borrowed in the loan as the sum of all sub-loans.
     * @param totalAddonAmount The total addon amount of the loan as the sum of all sub-loans.
     * @param subLoanCount The total number of sub-loans.
     * @param creditLine The address of the credit line that was used to take the loan.
     * @param liquidityPool The address of the liquidity pool that was used to take the loan.
     */
    event LoanTaken(
        uint256 indexed firstSubLoanId,
        address indexed borrower,
        uint256 indexed programId,
        uint256 totalBorrowedAmount,
        uint256 totalAddonAmount,
        uint256 subLoanCount,
        address creditLine,
        address liquidityPool
    );

    /**
     * @dev Emitted when a loan is fully revoked by revocation of all its sub-loans.
     * The sign of the `revokedBorrowedAmount` parameter indicates the direction of the token transfer:
     *
     * - positive: tokens were transferred from the borrower to the liquidity pool.
     * - negative: tokens were transferred from the liquidity pool to the borrower,
     *   it can happen when the loan was repaid more than the total borrowed amount over all sub-loans.
     *
     * @param firstSubLoanId The ID of the first sub-loan within the loan.
     * @param subLoanCount The total number of sub-loans.
     * @param revokedBorrowedAmount The amount of tokens transferred from the liquidity pool to the borrower or opposite.
     * @param revokedAddonAmount The amount of tokens transferred from the addon treasury to the liquidity pool.
     */
    event LoanRevoked(
        uint256 indexed firstSubLoanId, // Tools: prevent Prettier one-liner
        uint256 subLoanCount,
        int256 revokedBorrowedAmount,
        uint256 revokedAddonAmount
    );

    /**
     * @dev Emitted when a sub-loan is taken.
     * @param subLoanId The unique identifier of the sub-loan.
     * @param borrowedAmount The amount of tokens borrowed for the sub-loan.
     * @param addonAmount The addon amount of the sub-loan.
     * @param startTimestamp The timestamp when the sub-loan was created.
     * @param duration The duration of the sub-loan in days.
     * @param packedRates The packed rates of the sub-loan. A bitfield with the following bits:
     *
     * - 64 bits from 0 to 63: the remuneratory interest rate.
     * - 64 bits from 64 to 127: the moratory interest rate.
     * - 64 bits from 128 to 191: the late fee rate.
     * - 64 bits from 192 to 255: the grace interest rate.
     */
    event SubLoanTaken(
        uint256 indexed subLoanId, // Tools: prevent Prettier one-liner
        uint256 borrowedAmount,
        uint256 addonAmount,
        uint256 startTimestamp,
        uint256 duration,
        bytes32 packedRates
    );

    /**
     * @dev Emitted when a sub-loan is updated.
     *
     * Update may include: repayment, discounting, rate change, duration change, freezing, unfreezing, etc.
     * Update may also include voiding any of the above operations.
     *
     * Notes about the event parameters:
     *
     * 1. The `packedParameters` value is a bitfield with the following bits (see the `_emitUpdateEvent()` function):
     *
     * - 08 bits from 000 to 007: the sub-loan current status.
     * - 08 bits from 008 to 015: the reserve for future usage.
     * - 16 bits from 016 to 031: the current duration in days.
     * - 32 bits from 032 to 063: the remuneratory interest rate.
     * - 32 bits from 064 to 095: the moratory interest rate.
     * - 32 bits from 096 to 127: the late fee rate.
     * - 32 bits from 128 to 159: the grace interest rate.
     * - 32 bits from 160 to 191: the stored tracked timestamp.
     * - 32 bits from 192 to 223: the stored freeze timestamp.
     * - 32 bits from 224 to 256: the earliest unprocessed operation timestamp or zero if none.
     *
     * 2. Any `...packed...Parts` value is a bitfield with the following bits:
     *
     * - 64 bits from 0 to 63: related to the principal.
     * - 64 bits from 64 to 127: related to the remuneratory interest.
     * - 64 bits from 128 to 191: related to the moratory interest.
     * - 64 bits from 192 to 255: related to the late fee.
     *
     * 3. The cumulative unrounded value of any packed parts can be calculated using the following function:
     *     ```
     *     function _calculateSumAmountByParts(uint256 packedParts) {
     *         return
     *             ((packedParts >>   0) & type(uint64).max) +
     *             ((packedParts >>  64) & type(uint64).max) +
     *             ((packedParts >> 128) & type(uint64).max) +
     *             ((packedParts >> 192) & type(uint64).max)
     *     }
     *     ```
     *
     * 4. The cumulative rounded value of any packed parts can be calculated using the following function:
     *     ```
     *     function _calculateRoundedSumAmountByParts(uint256 packedParts) {
     *         return
     *             round((packedParts >>   0) & type(uint64).max) +
     *             round((packedParts >>  64) & type(uint64).max) +
     *             round((packedParts >> 128) & type(uint64).max) +
     *             round((packedParts >> 192) & type(uint64).max)
     *     }
     *     ```
     *
     * 5. The `storedPackedTrackedParts` and `currentPackedTrackedParts` are equal when an operation is submitted at
     *    the end of the operation list. They differ when revoking or submitting an operation in the past:
     *    - `storedPackedTrackedParts` corresponds to the timestamp of the latest applied operation.
     *    - `currentPackedTrackedParts` corresponds to the timestamp of the changing operation.
     *
     * 6. The update index is incremented by one for each update event of the sub-loan.
     *
     * @param subLoanId The unique identifier of the sub-loan.
     * @param updateIndex The sequence index of the update event for the sub-loan.
     * @param packedParameters The packed parameters of the sub-loan, see notes above.
     * @param packedRepaidParts The packed repaid parts of the sub-loan, see notes above.
     * @param packedDiscountParts The packed discount parts of the sub-loan, see notes above.
     * @param storedPackedTrackedParts The packed tracked parts of the sub-loan at the stored tracked timestamp.
     * @param currentPackedTrackedParts The packed tracked parts of the sub-loan at the current timestamp.
     */
    event SubLoanUpdated(
        uint256 indexed subLoanId, // Tools: prevent Prettier one-liner
        uint256 indexed updateIndex,
        bytes32 packedParameters,
        bytes32 packedRepaidParts,
        bytes32 packedDiscountParts,
        bytes32 storedPackedTrackedParts,
        bytes32 currentPackedTrackedParts
    );

    /**
     * @dev Emitted when an operation is applied.
     * @param subLoanId The unique identifier of the sub-loan.
     * @param operationId The unique identifier of the operation within the sub-loan.
     * @param kind The kind of the operation.
     * @param timestamp The timestamp when the operation was applied.
     * @param value The value of the operation.
     * @param account The account related to the operation, e.g. the repayer.
     */
    event OperationApplied(
        uint256 indexed subLoanId,
        uint256 indexed operationId,
        OperationKind indexed kind,
        uint256 timestamp,
        uint256 value,
        address account
    );

    /**
     * @dev Emitted when an operation is added to the list of sub-loan operations, but not yet applied.
     * @param subLoanId The unique identifier of the sub-loan.
     * @param operationId The unique identifier of the operation within the sub-loan.
     * @param kind The kind of the operation.
     * @param timestamp The timestamp when the operation will be applied.
     * @param value The value of the operation.
     * @param account The account related to the operation, e.g. the repayer.
     */
    event OperationPended(
        uint256 indexed subLoanId,
        uint256 indexed operationId,
        OperationKind indexed kind,
        uint256 timestamp,
        uint256 value,
        address account
    );

    /**
     * @dev Emitted when a previously applied operation is voided.
     * @param subLoanId The unique identifier of the sub-loan.
     * @param operationId The unique identifier of the operation.
     * @param kind The kind of the operation.
     * @param timestamp The timestamp when the operation was originally applied.
     * @param value The value of the operation.
     * @param account The account related to the operation, e.g. the repayer.
     * @param counterparty The account related to the operation voiding, e.g. the receiver.
     */
    event OperationRevoked(
        uint256 indexed subLoanId,
        uint256 indexed operationId,
        OperationKind indexed kind,
        uint256 timestamp,
        uint256 value,
        address account,
        address counterparty
    );

    /**
     * @dev Emitted when a previously pending operation is voided.
     * @param subLoanId The unique identifier of the sub-loan.
     * @param operationId The unique identifier of the operation within the sub-loan.
     * @param kind The kind of the operation.
     * @param timestamp The timestamp when the operation was originally scheduled.
     * @param value The value of the operation.
     * @param account The account related to the operation, e.g. the repayer.
     */
    event OperationDismissed(
        uint256 indexed subLoanId, // Tools: prevent Prettier one-liner
        uint256 indexed operationId,
        OperationKind indexed kind,
        uint256 timestamp,
        uint256 value,
        address account
    );
}

/**
 * @title ILendingMarketV2Primary interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary part of the lending market contract interface.
 */
interface ILendingMarketV2Primary is ILendingMarketV2Types, ILendingMarketV2PrimaryEvents {
    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Takes a loan with multiple sub-loans for a provided borrower.
     *
     * Can be called only by an account with a special role.
     *
     * @param loanTakingRequest The request to take the loan.
     * @param subLoanTakingRequests The requests to take the sub-loans.
     * @return firstSubLoanId The unique identifier of the first sub-loan of the loan calculated using the loan base ID.
     */
    function takeLoan(
        LoanTakingRequest calldata loanTakingRequest,
        SubLoanTakingRequest[] calldata subLoanTakingRequests
    ) external returns (uint256 firstSubLoanId);

    /**
     * @dev Revokes a loan by the ID of any of its sub-loans.
     * @param subLoanId The unique identifier of the sub-loan to revoke.
     */
    function revokeLoan(uint256 subLoanId) external;

    /**
     * @dev Submits a batch of operations for sub-loans.
     *
     * Can be called only by an account with a special role.
     *
     * This function performs the following steps:
     * 1. Add all operations specified in the operation requests to the corresponding sub-loan operation lists.
     * 2. Recalculates affected sub-loan states if needed and emits corresponding events
     *
     * This atomic batch operation ensures data consistency when voiding multiple operations simultaneously.
     *
     * Operation IDs are generated sequentially within each sub-loan.
     *
     *
     * @param operationRequests The request structures to submit.
     */
    function submitOperationBatch(OperationRequest[] calldata operationRequests) external;

    /**
     * @dev Voids a batch of operations for sub-loans.
     *
     * The voided operations will be kept in the operation lists of the sub-loans.
     *
     * Can be called only by an account with a special role.
     *
     * This function performs the following steps:
     * 1. Cancels all operations specified in the void requests
     * 2. Recalculates affected sub-loan states if needed and emits corresponding events
     *
     * This atomic batch operation ensures data consistency when voiding multiple operations simultaneously.
     *
     * @param operationVoidingRequests The requests to void the operations.
     */
    function voidOperationBatch(OperationVoidingRequest[] calldata operationVoidingRequests) external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Returns the address of the underlying token.
     */
    function underlyingToken() external view returns (address);

    /**
     * @dev Returns the number of sub-loans taken.
     */
    function subLoanCounter() external view returns (uint256);

    /**
     * @dev Returns the current number of auto-generated sub-loan IDs.
     */
    function subLoanAutoIdCounter() external view returns (uint256);

    /**
     * @dev Returns the number lending programs ever opened.
     */
    function programCounter() external view returns (uint256);

    /**
     * @dev Returns the address of the lending engine smart contract.
     */
    function engine() external view returns (address);

    /**
     * @dev Returns the number of records in the account address book.
     */
    function getAccountAddressBookRecordCount() external view returns (uint256);

    /**
     * @dev Gets an account address by its ID in the account address book.
     * @param id The ID of the account to get.
     * @return The address of the account, or zero address if ID is 0 or not found.
     */
    function getAccountInAddressBook(uint256 id) external view returns (address);

    /**
     * @dev Gets a lending program.
     * @param programId The unique identifier of the lending program to get.
     */
    function getProgram(uint32 programId) external view returns (LendingProgramView memory);

    /**
     * @dev Gets the sub-loan preview at a specific timestamp for a of sub-loans.
     *
     * The `timestamp` field can have the special values:
     *
     * - 0 -- means the current block timestamp.
     * - 1 -- means the current sub-loan tracked timestamp (for a loan, individual timestamp of each sub-loan).
     *
     * The `flags` field is a bitfield that can have the following bits:
     *
     * - bit 0 --- if set to 1, the preview will ignore the grace period status.
     * - others -- are reserved for future use.
     *
     * The timestamp field must not be earlier than the sub-loan start timestamp.
     *
     * @param subLoanId The unique identifier of the sub-loan to get the preview for.
     * @param timestamp The timestamp (at UTC timezone) to calculate the preview at.
     * @param flags The flags to calculate the preview with.
     * @return The preview of the sub-loan.
     */
    function getSubLoanPreview(
        uint256 subLoanId,
        uint256 timestamp,
        uint256 flags
    ) external view returns (SubLoanPreview memory);

    /**
     * @dev Gets the preview of a loan at a specific timestamp.
     *
     * See notes about the fields in comments for the `LoanPreview` structure above.
     *
     * @param subLoanId The unique identifier of the sub-loan to get the preview for.
     * @param timestamp The timestamp (at UTC timezone) to calculate the preview at.
     * @param flags The flags to calculate the preview with.
     * @return The preview of the loan.
     */
    function getLoanPreview(
        uint256 subLoanId,
        uint256 timestamp,
        uint256 flags
    ) external view returns (LoanPreview memory);

    /**
     * @dev Gets the list of operation IDs for a sub-loan in the order of their timestamp.
     *
     * @param subLoanId The unique identifier of the sub-loan to get the operations for.
     * @return The list of operation IDs for the sub-loan in the order of their timestamp.
     */
    function getSubLoanOperationIds(uint256 subLoanId) external view returns (uint256[] memory);

    /**
     * @dev Gets an operation for a sub-loan by the sub-loan ID and the operation ID.
     *
     * @param subLoanId The unique identifier of the sub-loan to get the operations for.
     * @param operationId The unique identifier of the operation within the sub-loan to get.
     * @return The operation view.
     */
    function getSubLoanOperation(uint256 subLoanId, uint256 operationId) external view returns (OperationView memory);

    // ------------------ Constant view functions ----------------- //

    /**
     * @dev Returns the rate factor for interest rate calculations.
     */
    function interestRateFactor() external pure returns (uint256);

    /**
     * @dev Returns the accuracy factor for loan rounding calculation. E.g. 10000 means 0.01 BRLC
     */
    function accuracyFactor() external pure returns (uint256);

    /**
     * @dev Returns the maximum number of sub-loans allowed per a loan.
     */
    function subLoanCountMax() external pure returns (uint256);

    /**
     * @dev Returns the maximum number of operations allowed per a sub-loan.
     */
    function operationCountMax() external pure returns (uint256);

    /**
     * @dev Returns time offset in seconds that is used to calculate the day boundary.
     *
     * E.g. if the lending market is in the `America/Sao_Paulo` timezone (by default),
     * then the day boundary offset is `-3 * 3600` seconds (3 hours before the UTC time).
     */
    function dayBoundaryOffset() external pure returns (int256);

    /**
     * @dev Returns the first auto-generated sub-loan ID constant.
     */
    function subLoanAutoIdStart() external pure returns (uint256);
}

/**
 * @title ILendingMarketV2Configuration interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The configuration part of the lending market contract interface.
 */
interface ILendingMarketV2Configuration {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when a new program is opened.
     * @param programId The unique identifier of the program.
     * @param creditLine The address of the credit line associated with the program.
     * @param liquidityPool The address of the liquidity pool associated with the program.
     */
    event ProgramOpened(
        uint256 indexed programId, // Tools: prevent Prettier one-liner
        address indexed creditLine,
        address indexed liquidityPool
    );

    /**
     * @dev Emitted when an existing program is closed.
     * @param programId The unique identifier of the program.
     */
    event ProgramClosed(uint256 indexed programId);

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Opens a new lending program.
     * @param creditLine The address of the credit line to associate with the program.
     * @param liquidityPool The address of the liquidity pool to associate with the program.
     */
    function openProgram(address creditLine, address liquidityPool) external;

    /**
     * @dev Closes an existing lending program.
     * @param programId The unique identifier of the program to close.
     */
    function closeProgram(uint256 programId) external;
}

/**
 * @title ILendingMarketV2Errors interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the custom errors used in the lending market contract.
 */
interface ILendingMarketV2Errors {
    /// @dev Thrown when the new account ID in the address book of the smart contract exceeds the maximum allowed value.
    error LendingMarketV2_AccountIdExcess();

    /// @dev Thrown when the addon amount exceeds the maximum allowed value or is not rounded to the accuracy factor.
    error LendingMarketV2_AddonAmountInvalid();

    /// @dev Thrown when the addon treasury address is zero.
    error LendingMarketV2_AddonTreasuryAddressZero();

    /// @dev Thrown when the block timestamp exceeds the maximum allowed value.
    error LendingMarketV2_BlockTimestampExcess();

    /// @dev Thrown when the borrower address is zero.
    error LendingMarketV2_BorrowerAddressZero();

    /**
     * @dev Thrown when the provided credit line address is invalid,
     *
     * E.g., the address is not a contract or does not implement the ICreditLineV2 interface.
     */
    error LendingMarketV2_CreditLineAddressInvalid();

    /// @dev Thrown when the provided credit line address is zero.
    error LendingMarketV2_CreditLineAddressZero();

    /// @dev Thrown when the provided lending engine address is zero.
    error LendingMarketV2_EngineAddressZero();

    /**
     * @dev Thrown when the provided lending engine address is invalid.
     *
     * E.g., the address is not a contract or does not implement the needed proof function.
     */
    error LendingMarketV2_EngineAddressInvalid();

    /// @dev Thrown when the lending engine is not configured (zero address).
    error LendingMarketV2_EngineUnconfigured();

    /**
     * @dev Thrown when the lending market implementation address is invalid
     *      (does not implement the needed proof function).
     */
    error LendingMarketV2_ImplementationAddressInvalid();

    /**
     * @dev Thrown when the provided liquidity pool address is invalid.
     *
     * E.g., the address is not a contract or does not implement the ILiquidityPool interface.
     */
    error LendingMarketV2_LiquidityPoolAddressInvalid();

    /// @dev Thrown when the provided liquidity pool address is zero.
    error LendingMarketV2_LiquidityPoolAddressZero();

    /**
     * @dev Thrown when the provided loan base ID is invalid.
     *
     * E.g. the ID equals zero or exceeds the maximum allowed value.
     */
    error LendingMarketV2_LoanBaseIdInvalid();

    /**
     * @dev Thrown when the provided borrowed amount is invalid.
     *
     * E.g. the amount equals zero, exceeds the maximum allowed value, is not rounded to the accuracy factor.
     */
    error LendingMarketV2_LoanBorrowedAmountInvalid();

    /**
     * @dev Thrown when the provided sub-loan durations within a loan are invalid.
     *
     * E.g., a sub-loan duration is less than the previous one.
     */
    error LendingMarketV2_LoanDurationsInvalid();

    /**
     * @dev Thrown when an operation account is not zero for operation kinds that do not require it.
     *
     * E.g., such operations are discounting, rate changes.
     */
    error LendingMarketV2_OperationAccountNonzero();

    /**
     * @dev Thrown when an attempt is made to add a revocation operation,
     *      but there is a later pending operation in the sub-loan operation list.
     */
    error LendingMarketV2_OperationAfterRevocation();

    /// @dev Thrown when the operation applying timestamp is earlier than the sub-loan start timestamp.
    error LendingMarketV2_OperationApplyingTimestampTooEarly();

    /// @dev Thrown when the number of operations for a sub-loan exceeds the maximum allowed value.
    error LendingMarketV2_OperationCountExcess();

    /// @dev Thrown when trying to void an operation that has already been dismissed.
    error LendingMarketV2_OperationDismissedAlready(uint256 subLoanId, uint256 operationId);

    /**
     * @dev Thrown when the operation kind is invalid.
     *
     * E.g., the kind is Nonexistent or exceeds the maximum allowed value.
     */
    error LendingMarketV2_OperationKindInvalid();

    /**
     * @dev Thrown when attempting to add an operation of a kind for which future scheduling is prohibited
     *      (operation.timestamp > block.timestamp).
     */
    error LendingMarketV2_OperationKindProhibitedInFuture();

    /// @dev Thrown when the operation kind is unacceptable, e.g., revocation operations cannot be added directly.

    /**
     * @dev Thrown when the operation kind is unacceptable.
     *
     * E.g., revocation operations cannot be added directly.
     */
    error LendingMarketV2_OperationKindUnacceptable();

    /// @dev Thrown when trying to access an operation that does not exist.
    error LendingMarketV2_OperationNonexistent(uint256 subLoanId, uint256 operationId);

    /// @dev Thrown when trying to call a function with the zero count of operation requests.
    error LendingMarketV2_OperationRequestCountZero();

    /// @dev Thrown when trying to void an operation that has already been revoked.
    error LendingMarketV2_OperationRevokedAlready(uint256 subLoanId, uint256 operationId);

    /// @dev Thrown when the operation timestamp is earlier than the sub-loan start timestamp.
    error LendingMarketV2_OperationTimestampTooEarly();

    /// @dev Thrown when the operation timestamp exceeds the maximum allowed value of `type(uint32).max`.
    error LendingMarketV2_OperationTimestampExcess();

    /**
     * @dev Thrown when the operation value is invalid.
     *
     *  E.g., freezing operation must have value 0, unfreezing operation must have value 0 or 1.
     */
    error LendingMarketV2_OperationValueInvalid();

    /**
     * @dev Thrown when trying to void an operation of a kind for which voiding is prohibited.
     *
     * E.g., revocation operations, that direct voiding is not allowed, only via the loan revocation function.
     */
    error LendingMarketV2_OperationVoidingProhibited();

    /// @dev Thrown when the newly generated lending program ID exceeds the maximum allowed value (uint24).
    error LendingMarketV2_ProgramIdExcess();

    /**
     * @dev Thrown when the lending program has an incompatible status for the requested operation.
     *
     * E.g. when you try to close a nonexistent program or take a loan using a closed program.
     */
    error LendingMarketV2_ProgramStatusIncompatible(uint256 actualStatus);

    /// @dev Thrown when the total number of sub-loans in the contract exceeds the maximum allowed value (uint40).
    error LendingMarketV2_SubLoanAutoIdCounterExcess();

    /**
     * @dev Thrown when the sub-loan borrowed amount is invalid.
     *
     * E.g. the amount is zero.
     */
    error LendingMarketV2_SubLoanBorrowedAmountInvalid();

    /// @dev Thrown when the requested number of sub-loans within a loan exceeds the maximum allowed value.
    error LendingMarketV2_SubLoanCountExcess();

    /// @dev Thrown when the number of sub-loans within a loan to take is zero.
    error LendingMarketV2_SubLoanCountZero();

    /// @dev Thrown when the total number of sub-loans in the contract exceeds the maximum allowed value (uint64).
    error LendingMarketV2_SubLoanCounterExcess();

    /// @dev Thrown when the discount amount exceeds the outstanding balance of the sub-loan.
    error LendingMarketV2_SubLoanDiscountExcess();

    /// @dev Thrown when the sub-loan duration exceeds the maximum allowed value (uint16).
    error LendingMarketV2_SubLoanDurationExcess();

    /**
     * @dev Thrown when the provided sub-loan duration is invalid.
     *
     * E.g., the duration is zero or exceeds the maximum allowed value.
     */
    error LendingMarketV2_SubLoanDurationInvalid();

    /// @dev Thrown when trying to create a sub-loan that already exists.
    error LendingMarketV2_SubLoanExistentAlready(uint256 subLoanId);

    /**
     * @dev Thrown when the first sub-loan ID is invalid.
     *
     * E.g., it is not less than SUB_LOAN_AUTO_ID_START for non-autogenerated IDs.
     */
    error LendingMarketV2_SubLoanFirstIdInvalid();

    /// @dev Thrown when the loan is already frozen.
    error LendingMarketV2_SubLoanFrozenAlready();

    /// @dev Thrown when the provided grace period discount rate exceeds 100 %.
    error LendingMarketV2_SubLoanGraceDiscountRateExcess();

    /// @dev Thrown when trying to initialize the grace period discount rate of a sub-loan that is initially zero.
    error LendingMarketV2_SubLoanGraceDiscountRateInitializationProhibited();

    /// @dev Thrown when trying to zero out the grace period discount rate that is initially non-zero.
    error LendingMarketV2_SubLoanGraceDiscountRateZeroingProhibited();

    /// @dev Thrown when the newly generated sub-loan ID exceeds the maximum allowed value (uint40).
    error LendingMarketV2_SubLoanIdExcess();

    /// @dev Thrown when the sub-loan does not exist.
    error LendingMarketV2_SubLoanNonexistent();

    /**
     * @dev Thrown when the principal amount of a loan is invalid.
     *
     * E.g. the amount exceeds the maximum allowed value (uint64).
     */
    error LendingMarketV2_SubLoanPrincipalInvalid();

    /// @dev Thrown when the repayer address is zero for a repayment operation.
    error LendingMarketV2_SubLoanRapayerAddressZero();

    /**
     * @dev Thrown when a rate value (remuneratory, moratory, late fee rate, grace rate) exceeds
     *      the maximum allowed value (uint32).
     */
    error LendingMarketV2_SubLoanRateValueInvalid();

    /// @dev Thrown when the repayment amount exceeds the outstanding balance of the sub-loan.
    error LendingMarketV2_SubLoanRepaymentExcess();

    /// @dev Thrown when the repayment or discount amount is not rounded to the accuracy factor.
    error LendingMarketV2_SubLoanRepaymentOrDiscountAmountUnrounded();

    /**
     * @dev Thrown when the sub-loan start timestamp is invalid.
     *
     * E.g., it is in the future (greater than block.timestamp).
     */
    error LendingMarketV2_SubLoanStartTimestampInvalid();

    /// @dev Thrown when trying to perform an operation on a revoked sub-loan.
    error LendingMarketV2_SubLoanRevoked();

    /// @dev Thrown when the newly generated sub-loan update index exceeds the maximum allowed value (uint24).
    error LendingMarketV2_SubLoanUpdateIndexExcess();

    /// @dev Thrown when trying to unfreeze a sub-loan that is not frozen.
    error LendingMarketV2_SubLoanUnfrozen();

    /**
     * @dev Thrown when a function is called from an unauthorized call context.
     *
     * E.g., not from the contract itself.
     */
    error LendingMarketV2_UnauthorizedCallContext();

    /// @dev Thrown when the provided underlying token address is zero.
    error LendingMarketV2_UnderlyingTokenAddressZero();

    /**
     * @dev Thrown when the provided underlying token address is invalid.
     *
     * E.g., the address is not a contract or does not implement a function of the IERC20 interface.
     */
    error LendingMarketV2_UnderlyingTokenAddressInvalid();
}

/**
 * @title ILendingMarketV2 interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The full interface of the lending market contract.
 *
 * See details about the smart contract logic in the `docs/description.md` file.
 */
interface ILendingMarketV2 is ILendingMarketV2Primary, ILendingMarketV2Configuration, ILendingMarketV2Errors {
    /// @dev Proves the contract is the lending market one. A marker function.
    function proveLendingMarketV2() external pure;
}
