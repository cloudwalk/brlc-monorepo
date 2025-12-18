# v1.2.0

## Main Changes

1. Migrated operational treasury from EOA (Externally Owned Account) to ITreasury contract integration.
1. Added ITreasury interface for treasury contract interactions with `withdraw()`, `underlyingToken()`, and
   `proveTreasury()` methods.
1. Enhanced `setOperationalTreasury()` function with validation to ensure:
   - Treasury address implements ITreasury interface via `proveTreasury()` call.
   - Treasury's underlying token matches the distributor's underlying token.
   - Zero address is allowed for flexibility.
1. Updated `reduceAdvancedNetYield()` to use `ITreasury.withdraw()` instead of ERC20 `transferFrom()`, eliminating
   the need for token approval.
1. Added new custom error `NetYieldDistributor_TreasuryUnderlyingTokenMismatch` for treasury validation.
1. Updated documentation across contracts and interfaces to reflect treasury contract pattern instead of EOA/wallet.

## Migration steps

For already deployed NetYieldDistributor contracts:
1. Deploy a Treasury contract that implements the ITreasury interface with the same underlying token.
1. Transfer the required tokens from the old operational treasury (EOA) to the new Treasury contract.
1. Call `setOperationalTreasury()` with the new Treasury contract address to complete the migration.

Note: The new validation in `setOperationalTreasury()` will reject EOA addresses or contracts that don't properly
implement ITreasury interface.

# v1.1.1
## Main Changes

### NetYieldDistributor updates

1. Enforced `totalAdvancedNetYield > totalAssetYieldSupply` invariant in several functions to prevent inconsistent state
   transitions and edge-case exploits.

### Dev Ex updates

1. Created npm scripts to run all necessary commands without hardhat cli knowledge.
1. Moved all github workflow to separate repository, for reusability.
1. Moved prettier and eslint configurations to separate repository. Use npm package for distribution.
1. Updated multiple dependencies, inculding OpenZeppelin contracts.
1. Added pre-commit hooks (using [husky](https://github.com/typicode/husky)) and lint-staged workflow, to ensure
   always-linted commits.
1. Added typechain generated types to tsconfig.
1. Added direct typescript dependency to declare our repository typescript version.
1. Fixed eslint warning and prettier format.
1. Added mocharc configuration file to integrate mocha test runner with IDEs.
1. Added link to common documentation.

## Migration steps
No special actions are required for already deployed smart contracts, just upgrade them.

# v1.1.0
