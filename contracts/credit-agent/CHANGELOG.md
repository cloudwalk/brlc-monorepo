# New Features

- Added a derived `Expired` status for credit and installment credit requests.
  After 5 minutes in the `Initiated` state, read methods treat the request as `Expired`.
  This status is not stored on-chain, and the request can only be revoked manually.
- Added the `penaltyInterestRates` parameter to the `initiateInstallmentCredit` function.
  Now we call the `takeInstallmentLoan` function instead of `takeInstallmentLoanFor` on CapybaraFinance V1 lending market.
- Used the `AccessControlEnumerableUpgradeable` contract instead of the `AccessControlUpgradeable` contract that allows to get role members list.

# Main Changes

- Functions:
  - `initiateCredit` -> `initiateOrdinaryCredit`
  - `getCredit` -> `getOrdinaryCredit`
  - `revokeCredit` -> `revokeOrdinaryCredit`
- Renamed errors:
  - `CreditAgent_BorrowerAddressZero` -> `CreditAgent_AccountAddressZero`
  - following errors renamed to their `CreditAgentCapybaraV1_*` counterparts:
    - `CreditAgent_LoanAmountZero`
    - `CreditAgent_LoanDurationZero`
    - `CreditAgent_InputArraysInvalid`
    - `CreditAgent_ProgramIdZero`
- Removed errors:
  - `CreditAgent_TxIdAlreadyUsed`: error that was previously used to cross-check ID uniqueness across the two credit request types.
  - `CreditAgent_FailedToProcessCashOutConfirmationAfter`
- Replaced the `CreditAgent_FailedToProcessCashOutRequestBefore` error with `CreditAgent_LoanTakingFailed`.
- Replaced the `CreditAgent_FailedToProcessCashOutReversalAfter` error with `CreditAgent_LoanRevocationFailed`.
- Merged the `CreditStatusChanged` and `InstallmentCreditStatusChanged` events into a single simplified `CreditRequestStatusChanged` event.
- Added the `CreditAgent_LendingMarketNotContract` error to validate the lending market contract address.
- Fixed initialization from the `Reversed` state so that it emits the correct `CreditRequestStatusChanged.oldStatus = Reversed` value.

## Technical changes

- `CreditAgent` contract separated into a core abstract contract that handles Cashier hooks and executes calls to the lending market
  and a CapybaraFinance V1-specific "frontend" that provides user-facing functions and correctly packs CapybaraFinance V1 calls.
  `CreditAgent` contract works with an abstract `CreditRequest` structure that stores the calls needed to be executed for the loan lifecycle.
- Solc updated to 0.8.28 and evmVersion to cancun. IR compilation enabled.
- Storage location moved to ERC-7201: Namespaced Storage Layout slot calculation.
- Added `.mocharc.json` file.

## Migration Steps

- The contract requires redeploy because the storage layout changed.

# 1.3.0

old changelog
