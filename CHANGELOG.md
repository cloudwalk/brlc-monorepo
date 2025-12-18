# 2.0.0

## Main Changes

1. The new `Capybara Finance V2` (CFv2) lending protocol has been introduced.
2. The new protocol includes the following main smart contracts: lending market (`LendingMarketV2`), credit line (`CreditLineV2`), lending engine (`LendingEngineV2`). The lending engine is not available externally, it is only used by the lending market contract through the delegatecall mechanism.
3. The new protocol reuses the liquidity pool (`LiquidityPool`) smart contract from the `Capybara Finance V1` (CFv1) protocol.
4. See protocol details in [docs/description.md](./docs/description.md).

## Migration

1. No migration path from CFv1 is currently available.
2. For new deployments of CFv2, see [docs/configuration.md](./docs/configuration.md).
