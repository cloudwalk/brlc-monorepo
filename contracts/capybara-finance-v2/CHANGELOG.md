# Current Version

## Main Changes.

1. Rounding approach for the sub-loan fields has changed.
   Tracked, repaid and discount fields are no longer rounded to cents individually, maintaining precise internal values.
   Rounding is now applied only when calculating the outstanding balance by summing all related parts first, then rounding the result.
2. The number of bits per rate in the packed rates fields of events has been changed from 64 bits per rate to 32 bits per rate.
3. The remuneratory interest fields have been split into two fields:
   - `primaryInterest` -- the remuneratory interest (tracked, repaid, discount) up to the due date.
   - `secondaryInterest` -- the remuneratory interest (tracked, repaid, discount) post the due date.
4. The remuneratory rate fields have been split into two fields:
   - `primaryRate` -- the primary rate of the sub-loan.
   - `secondaryRate` -- the secondary rate of the sub-loan.
5. The sub-loan parts have been regrouped in storage slots, view structures and event packed fields as follows:
   - principal: `trackedPrincipal`, `repaidPrincipal`, `discountPrincipal`;
   - primary interest: `trackedPrimaryInterest`, `repaidPrimaryInterest`, `discountPrimaryInterest`;
   - secondary interest: `trackedSecondaryInterest`, `repaidSecondaryInterest`, `discountSecondaryInterest`;
   - moratory interest: `trackedMoratoryInterest`, `repaidMoratoryInterest`, `discountMoratoryInterest`;
   - late fee: `trackedLateFee`, `repaidLateFee`, `discountLateFee`.
6. The `SubLoanTaken` and  `SubLoanUpdated` events have been changed according to the points above.

# 2.0.0

## Main Changes

1. The new `Capybara Finance V2` (CFv2) lending protocol has been introduced.
2. The new protocol includes the following main smart contracts: lending market (`LendingMarketV2`), credit line (`CreditLineV2`), lending engine (`LendingEngineV2`). The lending engine is not available externally, it is only used by the lending market contract through the delegatecall mechanism.
3. The new protocol reuses the liquidity pool (`LiquidityPool`) smart contract from the `Capybara Finance V1` (CFv1) protocol.
4. See protocol details in [docs/description.md](./docs/description.md).

## Migration

1. No migration path from CFv1 is currently available.
2. For new deployments of CFv2, see [docs/configuration.md](./docs/configuration.md).
