# Current Version

## Main Changes.

1. Rounding approach for the sub-loan fields has changed.
   Tracked, repaid and discount fields are no longer rounded to cents individually, maintaining precise internal values.
   Rounding is now applied only when calculating the outstanding balance, repaid amount or discount amount by summing all related parts first, then rounding the result.
2. New fields of the preview structures have been introduced:
   * `SubLoanPreview.repaidAmount` -- The repaid amount of the sub-loan. It is calculated as the sum of individual repaid parts, then financial rounding applied.
   * `SubLoanPreview.discountAmount` -- The discount amount of the sub-loan. It is calculated as the sum of individual discounted components, then financial rounding applied.
   * `LoanPreview.totalRepaidAmount` -- The total repaid amount of the loan over all sub-loans.
   * `LoanPreview.totalDiscountAmount` -- The total discount amount of the loan over all sub-loans.

# 2.0.0

## Main Changes

1. The new `Capybara Finance V2` (CFv2) lending protocol has been introduced.
2. The new protocol includes the following main smart contracts: lending market (`LendingMarketV2`), credit line (`CreditLineV2`), lending engine (`LendingEngineV2`). The lending engine is not available externally, it is only used by the lending market contract through the delegatecall mechanism.
3. The new protocol reuses the liquidity pool (`LiquidityPool`) smart contract from the `Capybara Finance V1` (CFv1) protocol.
4. See protocol details in [docs/description.md](./docs/description.md).

## Migration

1. No migration path from CFv1 is currently available.
2. For new deployments of CFv2, see [docs/configuration.md](./docs/configuration.md).
