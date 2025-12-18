# 1.1.0

## Main Changes

- Added token mint and burn operations with role-based access control.
  - `mint(uint256 amount)` — Mint tokens to the treasury (requires `MINTER_ROLE`).
  - `mintFromReserve(uint256 amount)` — Mint tokens from reserve to the treasury (requires `RESERVE_MINTER_ROLE`).
  - `burn(uint256 amount)` — Burn tokens from the treasury (requires `BURNER_ROLE`).
  - `burnToReserve(uint256 amount)` — Burn tokens to reserve from the treasury (requires `RESERVE_BURNER_ROLE`).
  - All mint/burn operations respect the pause state and revert when the contract is paused.

- Introduced new roles for mint and burn operations:
  - `MINTER_ROLE` — Allows minting tokens to the treasury.
  - `BURNER_ROLE` — Allows burning tokens from the treasury.
  - `RESERVE_MINTER_ROLE` — Allows minting tokens from reserve to the treasury.
  - `RESERVE_BURNER_ROLE` — Allows burning tokens to reserve from the treasury.
  - All new roles have `GRANTOR_ROLE` as their admin role.

- Added `IERC20Mintable` interface for tokens supporting mint and burn operations.
  - Defines `mint(address account, uint256 amount)` with boolean return.
  - Defines `mintFromReserve(address account, uint256 amount)` for reserve minting.
  - Defines `burn(uint256 amount)` for burning tokens.
  - Defines `burnToReserve(uint256 amount)` for burning tokens to reserve.

- Enhanced access control with role enumeration support.
  - Migrated from `AccessControlUpgradeable` to `AccessControlEnumerableUpgradeable`.
  - Added `setRoleAdmin(bytes32 role, bytes32 adminRole)` function (owner-only, temporary for migration).
  - Added `migrateExistingRoles(bytes32 role, address[] memory existingMembers)` function (owner-only).
  - Migration functions enable upgrading from non-enumerable to enumerable role storage without losing existing role assignments.

- Replaced ERC20 approval-based spending model with recipient limits and allowlist system.
  - Breaking change: Removed `approve()` and `clearAllApprovals()` functions.
  - Breaking change: Removed `approvedSpenders()` view function.
  - Breaking change: Removed `MANAGER_ROLE` — both `withdraw()` and `withdrawTo()` now require `WITHDRAWER_ROLE`.

- Added recipient limits enforcement with configurable policy:
  - `setRecipientLimit(address recipient, uint256 limit)` — Configure withdrawal limits per recipient (owner-only).
  - `setRecipientLimitPolicy(RecipientLimitPolicy policy)` — Set the enforcement policy (owner-only).
  - Introduced `RecipientLimitPolicy` enum with two values:
    - `Disabled` (0) — No limit checks performed. Any address can receive funds.
    - `EnforceAll` (1) — Full enforcement. Only allowlisted recipients can receive funds with limit checks.

- Updated events to track recipient limit changes:
  - `UnderlyingTokenSet(address indexed token)` — Emitted when the underlying token is set during initialization.
  - `RecipientLimitUpdated(address indexed recipient, uint256 oldLimit, uint256 newLimit)` — Emitted when a recipient's limit is updated.
  - `RecipientLimitPolicyUpdated(RecipientLimitPolicy indexed policy)` — Emitted when the enforcement policy is changed.

- Added view functions to inspect recipient limits:
  - `getRecipientLimits() → RecipientLimitView[]` — Returns all configured recipients and their limits as an array of structs.
  - `recipientLimitPolicy() → RecipientLimitPolicy` — Returns the current enforcement policy.

- Updated custom errors:
  - Added `Treasury_InsufficientRecipientLimit(address recipient, uint256 requested, uint256 available)` — Prevents withdrawals exceeding recipient limits.
  - Replaced `Treasury_SpenderAddressZero` with `Treasury_RecipientAddressZero`.

- Storage changes:
  - Renamed storage field `token` to `underlyingToken`.
  - Replaced `EnumerableSet.AddressSet approvedSpenders` with `EnumerableMap.AddressToUintMap recipientLimits`.
  - Added `recipientLimitPolicy` field to storage for enforcement policy tracking.

## Mint and Burn Operations Behavior

The treasury now supports minting and burning tokens through the underlying ERC20 token contract that implements the `IERC20Mintable` interface.

### Mint Operations

- `mint()` — Mints tokens directly to the treasury's balance. The underlying token's `mint()` function is called.
- `mintFromReserve()` — Mints tokens to the treasury while also increasing the token's total reserve supply. This is useful for tokens with reserve accounting.

### Burn Operations

- `burn()` — Burns tokens from the treasury's balance. The underlying token's `burn()` function is called.
- `burnToReserve()` — Burns tokens from the treasury while also decreasing the token's total reserve supply. This is useful for tokens with reserve accounting.

### Security and Access Control

- Each operation requires a specific role (`MINTER_ROLE`, `RESERVE_MINTER_ROLE`, `BURNER_ROLE`, `RESERVE_BURNER_ROLE`).
- All operations respect the contract's pause state and will revert if the contract is paused.
- Burn operations will revert if the treasury's balance is insufficient.

## Recipient Limits Behavior

### When Policy is EnforceAll (default)

- Only recipients with configured limits can receive funds (allowlist enforcement).
- Recipients not in the map are treated as having a 0 limit and cannot receive funds.
- Each withdrawal decrements the recipient's limit.
- Recipients remain in the map even when their limit reaches 0 after withdrawals.
- Setting limit to 0 explicitly removes the recipient from the allowed list.
- Recipients with `type(uint256).max` have unlimited withdrawals (limit is not decremented).

### When Policy is Disabled

- Withdrawals can be made to any address without checks.
- Recipient limits are NOT decremented.
- Configured limits are preserved and can be re-enforced by switching policy back to `EnforceAll`.

# 1.0.0

## Overview

The Treasury contract is a secure, upgradeable vault for a single ERC20 token with controlled spending rules and role-based access control. It allows designated withdrawers to withdraw tokens directly and approved spenders to transfer tokens via ERC20 allowances. The contract is designed to manage only one token type per deployment, ensuring focused and predictable token operations.

## Functions

### Transactional Functions

#### `withdraw(uint256 amount)`

- **Purpose**: Withdraws tokens to the caller's address
- **Access**: WITHDRAWER_ROLE required
- **Intended Usage**: Designed for smart contracts that need programmatic access to treasury funds. Grant WITHDRAWER_ROLE to smart contracts that require automated token withdrawals to their own addresses
- **Parameters**:
  - `amount`: Amount of tokens to withdraw
- **Events**: Emits `Withdrawal` event

#### `withdrawTo(address to, uint256 amount)`

- **Purpose**: Withdraws tokens to a specified address
- **Access**: WITHDRAWER_ROLE required (changed from MANAGER_ROLE in latest version)
- **Intended Usage**: Allows withdrawers to transfer tokens to any destination address for treasury management and distribution purposes
- **Parameters**:
  - `to`: Destination address for tokens
  - `amount`: Amount of tokens to withdraw
- **Events**: Emits `Withdrawal` event

#### `mint(uint256 amount)`

- **Purpose**: Mints tokens to the treasury
- **Access**: MINTER_ROLE required
- **Parameters**:
  - `amount`: Amount of tokens to mint
- **Effects**: Calls mint function on underlying ERC20 token

#### `mintFromReserve(uint256 amount)`

- **Purpose**: Mints tokens from reserve to the treasury
- **Access**: RESERVE_MINTER_ROLE required
- **Parameters**:
  - `amount`: Amount of tokens to mint from reserve
- **Effects**: Calls mintFromReserve function on underlying ERC20 token

#### `burn(uint256 amount)`

- **Purpose**: Burns tokens from the treasury
- **Access**: BURNER_ROLE required
- **Parameters**:
  - `amount`: Amount of tokens to burn
- **Effects**: Calls burn function on underlying ERC20 token

#### `burnToReserve(uint256 amount)`

- **Purpose**: Burns tokens to reserve from the treasury
- **Access**: RESERVE_BURNER_ROLE required
- **Parameters**:
  - `amount`: Amount of tokens to burn to reserve
- **Effects**: Calls burnToReserve function on underlying ERC20 token

### View Functions

#### `underlyingToken()`

- **Purpose**: Returns the address of the managed ERC20 token
- **Access**: Public view
- **Returns**: `address` - Token contract address

## Events

### `Withdrawal(address indexed to, address indexed withdrawer, uint256 amount)`

- **Emitted by**: `withdraw()` and `withdrawTo()` functions
- **Purpose**: Logs token withdrawal operations
- **Parameters**:
  - `to`: Address that received the tokens (indexed)
  - `withdrawer`: Address that initiated the withdrawal (indexed)
  - `amount`: Amount of tokens withdrawn

## Roles

### Treasury-Specific Roles

#### `WITHDRAWER_ROLE`

- **Purpose**: Allows withdrawing tokens from the treasury
- **Functions**: `withdraw()`, `withdrawTo()`
- **Admin Role**: GRANTOR_ROLE
- **Intended Recipients**: Smart contracts and accounts that need to withdraw treasury funds

#### `MINTER_ROLE`

- **Purpose**: Allows minting tokens to the treasury
- **Functions**: `mint()`
- **Admin Role**: GRANTOR_ROLE
- **Intended Recipients**: Accounts authorized to mint tokens directly to the treasury

#### `BURNER_ROLE`

- **Purpose**: Allows burning tokens from the treasury
- **Functions**: `burn()`
- **Admin Role**: GRANTOR_ROLE
- **Intended Recipients**: Accounts authorized to burn tokens from the treasury balance

#### `RESERVE_MINTER_ROLE`

- **Purpose**: Allows minting tokens from reserve to the treasury
- **Functions**: `mintFromReserve()`
- **Admin Role**: GRANTOR_ROLE
- **Intended Recipients**: Accounts authorized to mint tokens with reserve accounting

#### `RESERVE_BURNER_ROLE`

- **Purpose**: Allows burning tokens to reserve from the treasury
- **Functions**: `burnToReserve()`
- **Admin Role**: GRANTOR_ROLE
- **Intended Recipients**: Accounts authorized to burn tokens with reserve accounting
