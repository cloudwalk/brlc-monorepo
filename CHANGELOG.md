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
- **Access**: MANAGER_ROLE required
- **Intended Usage**: Designed for human managers and administrative operations. Managers with MANAGER_ROLE can withdraw tokens to any destination address for treasury management and distribution purposes
- **Parameters**:
  - `to`: Destination address for tokens
  - `amount`: Amount of tokens to withdraw
- **Events**: Emits `Withdrawal` event

#### `approve(address spender, uint256 amount)`
- **Purpose**: Approves a spender to use ERC20 transferFrom on treasury tokens
- **Access**: OWNER_ROLE required
- **Parameters**:
  - `spender`: Address to approve as spender
  - `amount`: Amount of tokens to approve
- **Effects**: Adds spender to approved spenders set, calls ERC20 approve

#### `clearAllApprovals()`
- **Purpose**: Revokes all ERC20 allowances for all approved spenders
- **Access**: OWNER_ROLE required
- **Effects**: Sets all allowances to zero, clears approved spenders set

### View Functions

#### `approvedSpenders()`
- **Purpose**: Returns array of all approved spender addresses
- **Access**: Public view
- **Returns**: `address[]` - Array of approved spender addresses

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
- **Purpose**: Allows withdrawing tokens to caller's own address
- **Functions**: `withdraw()`
- **Admin Role**: GRANTOR_ROLE
- **Intended Recipients**: Smart contracts that need programmatic access to treasury funds

#### `MANAGER_ROLE`  
- **Purpose**: Allows withdrawing tokens to any specified address
- **Functions**: `withdrawTo()`
- **Admin Role**: GRANTOR_ROLE
- **Intended Recipients**: Human managers and administrative accounts for treasury operations
