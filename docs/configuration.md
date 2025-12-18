# Protocol Deployment & Configuration Checklist

1. Select the underlying token address for the protocol as `UNDERLYING_TOKEN_ADDRESS`.
2. Deploy `LendingEngineV2` as UUPS. No parameters are required. Use the future owner account.
3. Deploy `LendingMarketV2` as UUPS with parameters:
   - `underlyingToken_=UNDERLYING_TOKEN_ADDRESS`,
   - `engine_=<deployed LendingEngineV2 address>`.
   Use the future owner account.
4. Deploy one or more `CreditLineV2` as UUPS. No parameters are required. Use the future owner account.
5. On `LendingMarketV2`, grant `GRANTOR_ROLE` to needed grantor addresses. Use the owner account.
6. On `LendingMarketV2`, grant `ADMIN_ROLE` to protocol admins. Use a grantor account.
7. On each `CreditLineV2`, grant `GRANTOR_ROLE` to needed grantor addresses. Use the owner account.
8. On each `CreditLineV2`, grant `LOAN_OPERATOR_ROLE` to the `LendingMarketV2` contract. Use a grantor account.
9. On each `CreditLineV2`, grant `ADMIN_ROLE` to protocol admins. Use a grantor account.
10. On each `CreditLineV2`, set the appropriate linked credit line of CFv1 if needed. Use the owner account.
11. On each liquidity pool (already deployed), set addon treasury if not set yet. Use the owner account.
12. On each liquidity pool (already deployed), grant `LIQUIDITY_OPERATOR_ROLE` (or equivalent) to `LendingMarketV2`. Use a grantor account.
13. On `LendingMarketV2`, open lending programs. Use the owner account.
14. On the underlying token, ensure token approvals from liquidity pools, borrowers, repayers, addon treasuries to `LendingMarketV2` or make `LendingMarketV2` trustable.
15. Optional. On each `CreditLineV2`, configure borrowers if needed. Use the owner account.
