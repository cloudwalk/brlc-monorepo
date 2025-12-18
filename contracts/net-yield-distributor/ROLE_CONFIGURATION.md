# NetYieldDistributor - Role Configuration Guide

This document shows all roles needed to configure the `NetYieldDistributor` contract and its interactions with external contracts.

---

## 1. Internal Roles (NetYieldDistributor Contract)

Roles and functions defined in the `NetYieldDistributor` contract.

### 1.1 Role Definitions

All roles in the contract, their admin roles, and whether they are inherited or contract-specific.

| Role Name | Admin Role | Type |
|-----------|------------|------|
| `OWNER_ROLE` | Self-administered | Inherited |
| `GRANTOR_ROLE` | `OWNER_ROLE` | Inherited |
| `RESCUER_ROLE` | `GRANTOR_ROLE` | Inherited |
| `PAUSER_ROLE` | `GRANTOR_ROLE` | Inherited |
| `MINTER_ROLE` | `GRANTOR_ROLE` | Contract-specific |
| `MANAGER_ROLE` | `GRANTOR_ROLE` | Contract-specific |

### 1.2 Function Access Control

Functions that change contract state, their required roles, and their type. View and pure functions are not included.

| Function | Required Role | Type |
|----------|---------------|------|
| `upgradeToAndCall()` | `OWNER_ROLE` | Inherited |
| `pause()` | `PAUSER_ROLE` | Inherited |
| `unpause()` | `PAUSER_ROLE` | Inherited |
| `rescueERC20()` | `RESCUER_ROLE` | Inherited |
| `initialize()` | None | Contract-specific |
| `setOperationalTreasury()` | `OWNER_ROLE` | Contract-specific |
| `mintAssetYield()` | `MINTER_ROLE` | Contract-specific |
| `burnAssetYield()` | `MINTER_ROLE` | Contract-specific |
| `advanceNetYield()` | `MANAGER_ROLE` | Contract-specific |
| `reduceAdvancedNetYield()` | `MANAGER_ROLE` | Contract-specific |

---

## 2. External Role Requirements

Roles that must be granted to `NetYieldDistributor` on external contracts to allow function calls.

**Note:** `REQUIRES_ROLE` indicates that the actual role name must be determined from the external contract.

| External Contract | Function Called | Role to Grant | Granted To | NetYieldDistributor Function |
|-------------------|----------------|---------------|------------|------------------------------|
| **UnderlyingToken** (IERC20Mintable) | `mint(address, uint256)` | `REQUIRES_ROLE` | NetYieldDistributor address | `mintAssetYield()` |
| **UnderlyingToken** (IERC20Mintable) | `burn(uint256)` | `REQUIRES_ROLE` | NetYieldDistributor address | `burnAssetYield()` |
| **UnderlyingToken** (IERC20Mintable) | `burn(uint256)` | `REQUIRES_ROLE` | NetYieldDistributor address | `reduceAdvancedNetYield()` |
| **UnderlyingToken** (IERC20) | `safeTransfer(address, uint256)` | None | N/A | `advanceNetYield()` |
| **OperationalTreasury** (ITreasury) | `withdraw(uint256)` | `REQUIRES_ROLE` | NetYieldDistributor address | `reduceAdvancedNetYield()` |
