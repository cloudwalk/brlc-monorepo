## Main Changes

- **Breaking**: Replaced LiquidityPool integration with Treasury contract.
  - The contract now uses a single Treasury for both principal and yield management.
  - Removed dependency on LiquidityPool contract entirely.

- **Storage Layout Changes** (backwards compatible for upgrades):
  - Renamed `surplusTreasury` storage field to `treasury`.
  - Marked `liquidityPool` storage field as obsolete (`_obsolete`).
  - Storage slot positions preserved for safe contract upgrades.

- **Behavior Changes**:
  - **Issue**: `issueAsset(assetIssuanceId, buyer, principal)`
    - Pulls `principal` from `buyer` to this contract.
    - Transfers `principal` directly to `treasury`.
    - Emits `AssetIssued(assetIssuanceId, buyer, principal)`.
  - **Redeem**: `redeemAsset(assetRedemptionId, buyer, principal, netYield)`
    - Withdraws `principal + netYield` from `treasury` in a single call.
    - Pays `buyer` the total amount (`principal + netYield`).
    - Emits `AssetRedeemed(assetRedemptionId, buyer, principal, netYield)`.

- **API Changes**:
  - Renamed `setSurplusTreasury(address)` → `setTreasury(address)`.
  - Renamed `getSurplusTreasury()` → `getTreasury()`.
  - Removed `setLiquidityPool(address)`.
  - Removed `getLiquidityPool()`.

- **Event Changes**:
  - Renamed `SurplusTreasuryChanged` → `TreasuryChanged`.
  - Removed `LiquidityPoolChanged`.

- **Error Changes**:
  - Removed liquidity pool related errors:
    - `AssetTransitDesk_ContractNotRegisteredAsWorkingTreasury()`
    - `AssetTransitDesk_LiquidityPoolAddressInvalid()`
    - `AssetTransitDesk_LiquidityPoolNotAdmin()`
    - `AssetTransitDesk_LiquidityPoolTokenMismatch()`
    - `AssetTransitDesk_TreasuryAllowanceZero()`
  - Added treasury-specific errors:
    - `AssetTransitDesk_TreasuryAddressInvalid()`
    - `AssetTransitDesk_TreasuryTokenMismatch()`

- **Enhanced Safety**:
  - Added treasury zero-address checks in both `issueAsset()` and `redeemAsset()`.
  - Treasury validation checks interface compliance via `proveTreasury()`.
  - Treasury validation ensures token match with underlying token.

## Migration

### For Existing Contract Upgrades
1. Deploy new implementation contract.
2. Call `upgradeToAndCall()` to upgrade the proxy.
3. **IMPORTANT**: Call `setTreasury(treasuryAddress)` immediately after upgrade.
   - The old `surplusTreasury` value becomes the new `treasury` value.
   - If `surplusTreasury` was not configured, treasury will be zero and operations will revert until configured.
4. Ensure AssetTransitDesk has `WITHDRAWER_ROLE` in the Treasury contract.
5. All historical operation data is preserved.

### Storage Slot Reuse (Future Development)
- **Slot 3 (`_obsolete` field)** is now available for future reuse.
- This slot contains the old `liquidityPool` address from previous versions.
- **IMPORTANT**: Before reusing this field or slot in future upgrades, it MUST be explicitly cleaned up (set to zero) during the upgrade process.
- Failure to clean up may result in unexpected behavior if the old address value is misinterpreted.

# 1.2.0

## Main Changes

- Removed `netYieldAmount` checking for zero in `redeemAsset` function.
- Updated build target to Cancun and increased Solidity compiler version to 0.8.28.

## Migration

No migration required.

# 1.1.0

## Main Changes

- Added operation identifiers to prevent duplicate execution and improve traceability.
  - Breaking change: function signatures now require IDs as the first argument.
    - `issueAsset(bytes32 assetIssuanceId, address buyer, uint64 principalAmount)`
    - `redeemAsset(bytes32 assetRedemptionId, address buyer, uint64 principalAmount, uint64 netYieldAmount)`

- Updated events to include and index operation IDs and buyer for efficient querying:
  - `AssetIssued(bytes32 indexed assetIssuanceId, address indexed buyer, uint64 principalAmount)`
  - `AssetRedeemed(bytes32 indexed assetRedemptionId, address indexed buyer, uint64 principalAmount, uint64 netYieldAmount)`

- Added view functions to inspect recorded operations:
  - `getIssuanceOperation(bytes32 assetIssuanceId) → (status, buyer, principalAmount)`
  - `getRedemptionOperation(bytes32 assetRedemptionId) → (status, buyer, principalAmount, netYieldAmount)`

- Added custom error to enforce idempotency:
  - `AssetTransitDesk_OperationAlreadyExists()`

# 1.0.0

## Introduced AssetTransitDesk contract

- Orchestrate issuance and redemptions of CDBs.

### Behavior
- **Issue**: `issueAsset(buyer, principal)`
  - Pulls `principal` from `buyer` to this contract (requires allowance).
  - Deposits `principal` to `liquidityPool` from this contract as a working treasury.
  - Emits `AssetIssued(buyer, principal)`.
- **Redeem**: `redeemAsset(buyer, principal, netYield)`
  - Withdraws `principal` from `liquidityPool` back to this contract.
  - Pulls `netYield` from `surplusTreasury` to this contract (requires allowance).
  - Pays `buyer` `principal + netYield`.
  - Emits `AssetRedeemed(buyer, principal, netYield)`.

### Public/External API
- `issueAsset(address buyer, uint64 principalAmount)` — manager-only, when not paused.
- `redeemAsset(address buyer, uint64 principalAmount, uint64 netYieldAmount)` — manager-only, when not paused.
- `setSurplusTreasury(address newSurplusTreasury)` — owner-only.
- `setLiquidityPool(address newLiquidityPool)` — owner-only.
- `approve(address spender, uint256 amount)` — owner-only.
- `getSurplusTreasury() → address` — view.
- `getLiquidityPool() → address` — view.
- `underlyingToken() → address` — view.

### Events
- `AssetIssued(address buyer, uint64 principalAmount)`
- `AssetRedeemed(address buyer, uint64 principalAmount, uint64 netYieldAmount)`
- `SurplusTreasuryChanged(address newSurplusTreasury, address oldSurplusTreasury)`
- `LiquidityPoolChanged(address newLiquidityPool, address oldLiquidityPool)`

### Roles & Access Control
- `OWNER_ROLE` (admin: `OWNER_ROLE`):
  - Can set `surplusTreasury`, set `liquidityPool`, authorize upgrades.
- `GRANTOR_ROLE` (admin: `OWNER_ROLE`):
  - Admin for `MANAGER_ROLE`, `PAUSER_ROLE`, `RESCUER_ROLE`.
- `MANAGER_ROLE` (admin: `GRANTOR_ROLE`):
  - Can `issueAsset`, `redeemAsset` when not paused.
- `PAUSER_ROLE` (admin: `GRANTOR_ROLE`):
  - Can `pause`/`unpause`.
- `RESCUER_ROLE` (admin: `GRANTOR_ROLE`):
  - Can `rescueERC20`.

### Custom Errors
- `AssetTransitDesk_BuyerAddressZero()`
- `AssetTransitDesk_ContractNotRegisteredAsWorkingTreasury()`
- `AssetTransitDesk_ImplementationAddressInvalid()`
- `AssetTransitDesk_LiquidityPoolAddressInvalid()`
- `AssetTransitDesk_LiquidityPoolNotAdmin()`
- `AssetTransitDesk_LiquidityPoolTokenMismatch()`
- `AssetTransitDesk_NetYieldAmountZero()`
- `AssetTransitDesk_PrincipalAmountZero()`
- `AssetTransitDesk_TokenAddressZero()`
- `AssetTransitDesk_TreasuryAddressZero()`
- `AssetTransitDesk_TreasuryAllowanceZero()`
- `AssetTransitDesk_TreasuryAlreadyConfigured()`

### Operational Setup
- Ensure `surplusTreasury` approves this contract for the underlying token (non-zero allowance required).
- Ensure the chosen `liquidityPool` uses the same underlying token, this contract holds pool `ADMIN_ROLE`, and it’s registered as a working treasury in the pool.
- Grant `MANAGER_ROLE`, `PAUSER_ROLE`, and `RESCUER_ROLE` to operational accounts via owner/grantor as appropriate.
- Buyer must approve this contract to spend their tokens.

### Security Notes
- All state changes are role-gated; issuance/redemption guarded by `whenNotPaused`.
- Pool address is strictly validated to prevent misconfiguration or token mismatch.
- No automatic allowance is granted on pool change; approvals are explicit and owner-controlled via `approve`.
