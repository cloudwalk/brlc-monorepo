# Capybara Finance V2 (CFv2) — The lending protocol

## Lending Market V2

### 1. Key Points

1. **Central Entities**: The central entities of the protocol are sub-loans (structure `SubLoan`) and operations performed on them (structure `Operation`). Several sub-loans are grouped into a loan, but the contract does not define a dedicated loan structure.

2. **Sub-Loan IDs**: Each sub-loan has a unique ID assigned when the sub-loan is taken. Sub-loan IDs are always sequential within a loan. Each sub-loan stores its index within the loan and the total number of sub-loans for that loan.

3. **Financial Tracking**: Each sub-loan separately tracks the following financial parts remaining to be repaid:
    - the principal,
    - the accrued remuneratory interest (primary rate),
    - the accrued moratory interest (penalty rate),
    - the late fee.
    For each financial part, the contract maintains the tracked, repaid, and discounted amounts.

4. **Interest and Fee Calculations**: The following calculations are performed for each financial part:
    - the remuneratory interest compounds on (principal + accrued remuneratory interest);
    - the moratory interest accrues as simple interest on principal after the due date;
    - the late fee is imposed as a one-time fee on the principal at the due date.

5. **Sub-Loan Status**: Each sub-loan can have one of the following statuses: 
    - `Nonexistent` (default value)
    - `Ongoing`: the sub-loan has at least one financial tracking part nonzero.
    - `Repaid`: the sub-loan has all financial tracking parts zeroed.
    - `Revoked`: the sub-loan is revoked and thus is closed.

    The possible transitions between statuses are:
    - `Nonexistent` => `Ongoing`.
    - `Ongoing` => `Repaid`.
    - `Ongoing` => `Revoked`.
    - `Repaid` => `Ongoing`.
    - `Repaid` => `Revoked`.

    The `Revoked` status is not reversible for now.

6. **Sub-Loan Operations**: Various operations can be performed on sub-loans. The purpose of an operation is defined by the operation kind. The following operation kinds are supported:
    - `Repayment`: repay a sub-loan partially or fully.
    - `Discount`: discount a sub-loan partially or fully.
    - `Revocation`: revoke the sub-loan.
    - `Freezing`: freeze the sub-loan.
    - `Unfreezing`: unfreeze the sub-loan.
    - `RemuneratoryRateSetting`: set the remuneratory rate of the sub-loan.
    - `MoratoryRateSetting`: set the moratory rate of the sub-loan.
    - `LateFeeRateSetting`: set the late fee rate of the sub-loan.
    - `GraceDiscountRateSetting`: set the grace discount rate of the sub-loan.
    - `DurationSetting`: set the duration of the sub-loan.

7. **Operation IDs**: Each operation has an ID within a sub-loan. Operation IDs are `uint16` values from 1 to 65535. The zero ID (`0`) means `no operation`.

8. **Operation Ordering**: Operations can be added chronologically, inserted into past history, or scheduled for future execution. They can also be discarded (future ones) or revoked (past ones), enabling complex loan modification scenarios. Operation-related actions include:
    - Adding: add an operation to the sub-loan list without processing the sub-loan.
    - Submitting: add an operation to the list and process the sub-loan immediately.
    - Canceling: remove an operation from the list without processing the sub-loan.
    - Voiding: remove an operation from the list and reprocess the sub-loan.

9. **Operation States**:
    - Nonexistent = 0: Operation does not exist (default).
    - Pending = 1: Operation is created but not yet applied.
    - Applied = 2: Operation has been successfully applied to the sub-loan.
    - Skipped = 3: Reserved for future use.
    - Dismissed = 4: Operation was voided without being applied.
    - Revoked = 5: Operation was voided after being applied.

10. **Replay Mechanism**: If operations are added sequentially, each new sub-loan state is calculated from the previous state and the newly added operation. If the new operation timestamp predates the last calculated sub-loan state, or if a previous operation is revoked, the system replays all operations for that sub-loan from the beginning.

11. **Event Groups**: The smart contract events fall into four groups:
    * a. **Loan Events**: Emitted once per loan: `LoanTaken`, `LoanRevoked`.
    * b. **Sub-Loan Taking Event**: Emitted only once per sub-loan: `SubLoanTaken`.
    * c. **Sub-Loan Updating Event**: Emitted whenever a sub-loan changes and carries the full current state: `SubLoanUpdated`. Each event includes `updateIndex` to simplify retrieving previous sub-loan states from the database. For a given sub-loan and transaction, this event is emitted only once even if multiple operations are added or voided.
    * d. **Operation Events**: Emitted once per operation: `OperationApplied`, `OperationPended`, `OperationRevoked`, `OperationDismissed`.

12. **Batch Processing**: All operations support batch processing with atomic transaction guarantees (either all succeed or all fail).

13. **Operation Logic Restrictions**:
    * a. Repayments, discounts, duration updates, rate changes, and freeze/unfreeze operations can be applied only while the sub-loan is **not** `Revoked` (i.e., `Ongoing` or `Repaid`).
    * b. A sub-loan revocation operation cannot currently be revoked.
    * c. Future-dated repayment and discount operations are currently prohibited.
    * d. The revocation operation cannot be applied externally, only via the loan revocation function.

14. **Program-Based**: Loans are created under lending programs that pair credit lines with liquidity pools, enabling flexible lending configurations inherited from Capybara Finance protocol V1.

### 2. Main Files

1. [ILendingMarketV2.sol](../contracts/interfaces/ILendingMarketV2.sol): Complete interface definition for the lending market smart contract of the CFv2 protocol. It contains core data structures and enums, events, function signatures, and error definitions, including `SubLoan` structure, the `Operation` structure, batch request structures, and view structures.

2. [LendingMarketV2StorageLayout.sol](../contracts/storage/LendingMarketV2StorageLayout.sol): Storage layout definition for the lending market smart contract of the CFv2 protocol. It follows the ERC-7201 standard and declares the storage structure containing the sub-loan counter, program counter, and mappings for sub-loans, operations, and program configurations, and exposes the storage slot accessor for upgradeable contracts.

3. [LendingMarketV2.sol](../contracts/LendingMarketV2.sol): Main contract implementation for the lending market smart contract of the CFv2 protocol. It contains all business logic for the loan life cycle, operation processing, interest calculations, revision handling, and batch operations, and implements access control, pausability, upgradeability, token transfers, and integration with credit lines and liquidity pools.

4. [LendingEngineV2.sol](../contracts/LendingEngineV2.sol): Helper contract for the lending market smart contract of the CFv2 protocol. It contains the lending engine smart contract for standalone deployments. The engine is used by the lending market contract through the delegatecall mechanism to perform the loan life cycle, operation processing, interest calculations, revision handling, and batch operations.

### 3. Main Code Entities

#### 3.1. Enums:

- `LendingProgramStatus`: The status of a lending program.
- `SubLoanStatus`: The status of a sub-loan.
- `GracePeriodStatus`: The status of the grace period of a sub-loan.
- `OperationStatus`: The status of an operation.
- `OperationKind`: The kind of an operation.

#### 3.2. Structures:

1. **Storage-only (internal, not exposed via external view functions):**

    - `LendingProgram`: Defines a lending program configuration in storage (**not exposed externally**).
    - `SubLoanInception`: Defines the inception parameters of a sub-loan in storage (**not exposed externally**).
    - `SubLoanMetadata`: Defines metadata and indexing information for a sub-loan in storage (**not exposed externally**).
    - `SubLoanState`: Defines the current financial state of a sub-loan in storage (**not exposed externally**).
    - `SubLoan`: Aggregates inception, state, metadata, and the operations mapping for a sub-loan (**not exposed externally**).
    - `Operation`: Defines a stored operation in the per–sub-loan linked list (**not exposed externally**).

2. **In-memory helper structures (used internally, not returned by external functions):**

    - `ProcessingSubLoan`: Internal processing snapshot of a sub-loan during calculations (**not exposed externally**).

3. **View / read models (returned by external view functions):**

    - `LendingProgramView`: In-memory view of a lending program returned by `getProgram()`.
    - `SubLoanPreview`: In-memory preview of a single sub-loan returned by `getSubLoanPreview()`.
    - `LoanPreview`: In-memory aggregate preview of a loan (group of sub-loans) returned by `getLoanPreview()`.
    - `OperationView`: In-memory view of a sub-loan operation returned by `getSubLoanOperation()`.

4. **Request structures (used by transactional functions):**

    - `LoanTakingRequest`: Parameters of a loan to take (borrower, program, start timestamp).
    - `SubLoanTakingRequest`: Parameters of a sub-loan within a loan (amounts, duration, rates).
    - `OperationRequest`: Parameters of an operation to submit for a sub-loan.
    - `OperationVoidingRequest`: Parameters of an operation to void for a sub-loan.

#### 3.3. Transactional Functions:

- `takeLoan()`: Takes a loan with multiple sub-loans for a provided borrower (role-restricted).
- `revokeLoan()`: Revokes an entire loan by the ID of any of its sub-loans.
- `submitOperationBatch()`: Submits a batch of operations for sub-loans and applies them atomically.
- `voidOperationBatch()`: Voids a batch of operations for sub-loans and reprocesses affected states atomically.

#### 3.4. View and pure functions:

1. **Core addresses and counters:**

    - `underlyingToken()`: Returns the underlying ERC‑20 token address.
    - `subLoanCounter()`: Returns the total number of sub-loans ever taken.
    - `subLoanAutoIdCounter()`: Returns the current auto-generated sub-loan ID counter.
    - `programCounter()`: Returns the number of lending programs ever opened.
    - `engine()`: Returns the address of the lending engine contract.

2. **Account address book:**

    - `getAccountAddressBookRecordCount()`: Returns the number of records in the account address book.
    - `getAccountInAddressBook(uint256 id)`: Returns the account address by its ID in the address book.

3. **Programs, loans, and sub-loans:**

    - `getProgram(uint32 programId)`: Returns `LendingProgramView` for the specified program.
    - `getSubLoanPreview(uint256 subLoanId, uint256 timestamp, uint256 flags)`: Returns `SubLoanPreview` for a sub-loan at a given timestamp.
    - `getLoanPreview(uint256 subLoanId, uint256 timestamp, uint256 flags)`: Returns `LoanPreview` for the loan that contains the given sub-loan.

4. **Operations:**

    - `getSubLoanOperationIds(uint256 subLoanId)`: Returns the ordered list of operation IDs for a sub-loan.
    - `getSubLoanOperation(uint256 subLoanId, uint256 operationId)`: Returns `OperationView` for a specific operation of a sub-loan.

5. **Constants and limits:**

    - `interestRateFactor()`: Returns the rate factor used for interest rate calculations.
    - `accuracyFactor()`: Returns the accuracy factor used for rounding loan amounts.
    - `subLoanCountMax()`: Returns the maximum number of sub-loans allowed per loan.
    - `operationCountMax()`: Returns the maximum number of operations allowed per sub-loan.
    - `dayBoundaryOffset()`: Returns the time offset in seconds used to calculate the day boundary.
    - `subLoanAutoIdStart()`: Returns the first auto-generated sub-loan ID constant.

6. **Pure functions:**

    - `proveLendingMarketV2()`: Pure marker function proving that the contract implements the CFv2 lending market interface.

### 4. Loan Operation Examples

#### 4.1. Example A: Sub-loan with Two Repayments, First Repayment Revoked

**Initial State:**
- Sub-loan taken: ID=10001, amount=1000, duration=30 days
- Operations: []
- New events: [LoanTaken, SubLoanTaken(ID=10001, borrowedAmount=1000, duration=30 days)]

**After First Repayment:**
- Repayment: amount=300, timestamp=t10
- Operations: [Repayment1(ID=1, amount=300, timestamp=t10, status=Applied)]
- New events: [OperationApplied(ID=1, value=300, timestamp=t10), SubLoanUpdated]
- Result: Status=Ongoing, tracked amounts updated

**After Second Repayment:**
- Repayment: amount=800, timestamp=t20
- Operations: [Repayment1(t10), Repayment2(t20)]
- New events: [OperationApplied(ID=2, value=800, timestamp=t20), SubLoanUpdated]
- Result: Status=Repaid

**After Revoking First Repayment:**
- Void operation: Repayment1 revoked
- System replays: initialize revision => skip Repayment1 => apply Repayment2(t20)
- Operations: [Repayment1(t10, status=Revoked), Repayment2(t20)]
- New events: [OperationRevoked(ID=1, value=300, timestamp=t10), SubLoanUpdated]
- Result: Status=Ongoing, only the second repayment applied, outstanding balance=200 + accrued interest

#### 4.2. Example B: Sub-loan with Two Repayments, Second Repayment Revoked

**Initial State:** Same as Example A after the second repayment.

**After Revoking Second Repayment:**
- Void operation: Repayment2 revoked
- System replays: initialize revision => apply Repayment1(t10) => skip Repayment2(t20)
- Operations: [Repayment1(t10), Repayment2(t20, status=Revoked)]
- New events: [OperationRevoked(ID=2, value=800, timestamp=t20), SubLoanUpdated]
- Result: Status=Ongoing, only the first repayment applied, outstanding balance=700 + accrued interest

#### 4.3. Example C: Adding Interest Rate Change Before Second Repayment

**Initial State:** Same as Example A after the second repayment.

**Adding Rate Change:**
- Insert operation: RemuneratoryRateSetting(ID=3, timestamp=t15, value=1.5%)
- System replays: initialize revision => apply Repayment1(t10) => apply RemuneratoryRateSetting(t15) => apply Repayment2(t20)
- Operations: [Repayment1(t10), RemuneratoryRateSetting(t15), Repayment2(t20)]
- New events: [OperationApplied(ID=3, value=1.5%, timestamp=t15), SubLoanUpdated]
- Result: Status=Ongoing, outstanding balance is greater because of the new rate at t15

#### 4.4. Example D: Adding Future Rate Change with Later Repayment

**Initial State:** Same as Example A after the first repayment.

**Adding Future Rate Change:**
- Insert operation: RemuneratoryRateSetting(ID=2, timestamp=t15, value=2.0%)
- Operations: [Repayment1(t10), RemuneratoryRateSetting(ID=2, timestamp=t15, value=2.0%, status=Pending)]
- New events: [OperationPended(ID=2, value=2.0%, timestamp=t15)]
- Result: Status=Ongoing, rate change pending

**Second Repayment After Rate Change (Initial State):** Same as Example A after the first repayment.

**Second Repayment After Rate Change:**
- Process pending operations first at t15, then apply repayment at t20
- Operations: [Repayment1(t10), RemuneratoryRateSetting(t15), Repayment2(t20)]
- New events: [OperationApplied(RemuneratoryRateSetting(t15)), OperationApplied(Repayment2(t20)), SubLoanUpdated]
- Result: Status=Ongoing, outstanding balance is greater because of the new rate at t15

### 5. Notes

1. Lending programs cannot be updated once opened because we preserve history. To reconfigure a program, open another one and switch to it. The old program can be closed to prevent new loans.
2. Operations are applied only while processing a sub-loan, which happens in the transaction where operations are added or voided, or in a later transaction when previously pending operations are processed.
3. The operation account is stored in the `Operation` structure as the account ID in the global smart-contract address book with the following special values:
    * `0` — the address is not provided or zero.
    * `type(uint64).max` — the address is the borrower of the sub-loan.
4. Operations are ordered in the sub-loan linked list by timestamp and then by ID: earlier timestamps come first, and matching timestamps are ordered by lower IDs before higher ones.
5. Loans (a group of sub-loans) can be taken starting with a timestamp in the past. If zero is provided, the current block timestamp is used. Loans cannot be taken in the future.
6. No direct token transfers to or from a pool. Tokens always move through the lending market contract. Examples:
    * Taking a loan:
      * `borrowedAmount`: LP => LM => borrower
      * `addonAmount`: LP => LM => addonTreasury
    * Repaying a loan:
      * `repaymentAmount`: borrower => LM => LP
7. Late fee rate change operations can have any timestamp, but the new rate is applied only if the operation timestamp is not later than the sub-loan due date.
8. You cannot activate a grace period for a sub-loan that was taken without one (initial grace discount rate equals zero). Any operation that changes the grace discount rate from zero to a non-zero value is rejected.
9. You cannot deactivate a grace period for a sub-loan that was taken with one (the initial grace discount rate is non-zero). Any operation that changes the grace discount rate from non-zero to zero is rejected.
10. There is currently no special amount for full sub-loan repayment. In V1 you could pass `type(uint256).max`; in V2 only explicit repayment and discount amounts are supported. If a special amount is added in the future, it must be converted to the outstanding balance when the operation is added, not when it is processed.
11. Batch view functions that return arrays of structs are no longer exposed. This keeps the ABI forward-compatible when structs gain new fields: returning a single struct remains backward compatible, whereas returning an array forces an ABI update and couples smart contracts to backend updates. To keep backend reads consistent, call the individual view functions against the same block number (not `latest`) and aggregate the results. Most blockchain libraries also let you batch JSON-RPC calls; for example, see https://docs.ethers.org/v6/api/providers/jsonrpc/#JsonRpcApiProviderOptions.
12. All rates are expressed as multiplied by `INTEREST_RATE_FACTOR = 10^9` (see the `Constants` contract).


## Credit Line V2

### 1. Key Points

1. The credit line smart contract of the CFv2 protocol is responsible for tracking the state of borrowers and their allowance to take loans. The lending market contract interacts with the credit line contract through the hook functions:
    - called before a loan is opened or reopened to check if it is allowed for the borrower;
    - called after a loan is closed due to full repayment or revocation to update the borrower's state.

2. Compared to V1, credit lines have been significantly simplified. Previously they contained many loan parameters. Now they focus solely on tracking borrower restrictions, and loan parameters are passed directly to the `LendingMarketV2` loan-taking function.

3. The following borrowing policies are supported:

    - `Prohibited`: No loans are allowed. The default value.
    - `SingleActiveLoan`: Only one active loan is allowed, additional loan requests are rejected.
    - `TotalActiveAmountLimit`: Multiple active loans are allowed, but their total borrowed amount cannot exceed the maximum borrowed amount specified for the borrower.
    - `UnlimitedActiveLoans`: Multiple active loans are allowed, with no limit on the total borrowed amount.

### 2. Main Files

1. [ICreditLineV2.sol](../contracts/interfaces/ICreditLineV2.sol): Complete interface definition for the credit line smart contract of the CFv2 protocol. It provides `BorrowerConfig` and `BorrowerState` structures, events, function signatures, and error definitions.

2. [CreditLineV2.sol](../contracts/CreditLineV2.sol): Main contract implementation for the credit line smart contract of the CFv2 protocol. It covers borrower configuration, loan-taking, and related functionality, and implements access control, pausability, and upgradeability features.

3. [CreditLineV2StorageLayout.sol](../contracts/storage/CreditLineV2StorageLayout.sol): Storage layout definition for the credit line smart contract of the CFv2 protocol. It follows the ERC-7201 standard and declares the storage structure containing borrower configuration and state and exposes the storage slot accessor for upgradeable contracts.

### 3. Main Code Entities

#### 3.1. Enums:

- `BorrowingPolicy`: The borrowing policy applied to a borrower.

#### 3.2. Structures:

1. **Storage-only (internal, not exposed via external view functions):**

    - `BorrowerConfig`: Per-borrower configuration stored in a compact form (borrowing policy and maximum total borrowed amount).
    - `BorrowerState`: Aggregated state of a borrower in this credit line (active/closed loan counters and total borrowed amounts).

2. **View / read models (returned by external view functions):**

    - `BorrowerConfigView`: In-memory view of the borrower configuration .
    - `BorrowerStateView`: In-memory view of the borrower state.

#### 3.3. Transactional Functions:

- `configureBorrower()`: Configures or updates the borrowing policy and maximum total borrowed amount for a borrower (role-restricted).
- `setLinkedCreditLine()`: Sets or updates the linked credit line whose borrower state is aggregated with this one (owner-only).
- `onBeforeLoanOpened()`: Hook called by the lending market before a loan is opened or reopened to validate borrower limits and update state.
- `onAfterLoanClosed()`: Hook called by the lending market after a loan is fully repaid or revoked to update borrower state.

#### 3.4. View and pure functions:

- `linkedCreditLine()`: Returns the address of the linked credit line used to aggregate borrower state.
- `getBorrowerConfiguration(address borrower)`: Returns `BorrowerConfigView` with the configuration of a borrower.
- `getBorrowerState(address borrower)`: Returns `BorrowerStateView` with the state of a borrower, combining this and the linked credit line if any.
- `proveCreditLineV2()`: Pure marker function proving that the contract implements the CFv2 credit line interface.

### 4. Examples

To be defined.

### 5. Notes

1. Changes in the borrowing policy of credit lines between CFv1 and CFv2 follow these mappings (CFv1 => CFv2): 0 => 1, 2 => 2, 2 => 3.
2. The credit line now emits the `LoanOpened` and `LoanClosed` events, which can be used to trace the appropriate hook function calls.
