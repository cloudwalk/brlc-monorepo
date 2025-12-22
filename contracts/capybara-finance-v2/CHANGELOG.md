# Current Version

## Main Changes.

1. Rounding approach for the sub-loan fields has changed.
   Tracked, repaid and discount fields are no longer rounded to cents individually, maintaining precise internal values.
   Rounding is now applied only when calculating the outstanding balance by summing all related parts first, then rounding the result.
2. The number of bits per rate in the packed rates fields of events has been changed from 64 bits per rate to 32 bits per rate.
3. The `SubLoanTaken` event has been changed.
4. The legal principal approach has been introduced to the financial logic of sub-loans. After the due date, the remuneratory interest is capitalized into the principal, converting it to a "legal principal". Then the remuneratory interest parts are reset to zero to start tracking only new interest accrued, repaid and discounted amounts only after the due date. Formally it looks like the following:
   - `trackedPrincipal += trackedRemuneratoryInterest`;
   - `repaidPrincipal += repaidRemuneratoryInterest`;
   - `discountPrincipal += discountRemuneratoryInterest`;
   - `trackedRemuneratoryInterest = 0`
   - `repaidRemuneratoryInterest = 0`
   - `discountRemuneratoryInterest = 0`.
5. The `isOverdie` field has been added to the `SubLoanPreview` structure to track the overdue status of the sub-loan.
6. The `LoanPreview` structure has been updated to track the legal principal amounts for overdue sub-loans.
   The structure now includes `totalTrackedLegalPrincipal`, `totalRepaidLegalPrincipal`, and `totalDiscountLegalPrincipal` fields.
   For overdue sub-loans (when `overdueStatus != 0`), principal amounts are tracked in the legal principal fields instead of the regular principal fields.
   Legal principal represents the principal after the due date, which includes the initial principal plus the remuneratory interest that was capitalized into principal at the due date.

# 2.0.0

## Main Changes

1. The new `Capybara Finance V2` (CFv2) lending protocol has been introduced.
2. The new protocol includes the following main smart contracts: lending market (`LendingMarketV2`), credit line (`CreditLineV2`), lending engine (`LendingEngineV2`). The lending engine is not available externally, it is only used by the lending market contract through the delegatecall mechanism.
3. The new protocol reuses the liquidity pool (`LiquidityPool`) smart contract from the `Capybara Finance V1` (CFv1) protocol.
4. See protocol details in [docs/description.md](./docs/description.md).

## Migration

1. No migration path from CFv1 is currently available.
2. For new deployments of CFv2, see [docs/configuration.md](./docs/configuration.md).
