# Treasury - Role Configuration Guide

This document shows all roles needed to configure the `Treasury` contract and its interactions with external contracts.

---

## 1. Internal Roles (Treasury Contract)

Roles and functions defined in the `Treasury` contract.

### 1.1 Role Definitions

All roles in the contract, their admin roles, and whether they are inherited or contract-specific.

| Role Name             | Admin Role        | Type              |
| --------------------- | ----------------- | ----------------- |
| `OWNER_ROLE`          | Self-administered | Inherited         |
| `GRANTOR_ROLE`        | `OWNER_ROLE`      | Inherited         |
| `RESCUER_ROLE`        | `GRANTOR_ROLE`    | Inherited         |
| `PAUSER_ROLE`         | `GRANTOR_ROLE`    | Inherited         |
| `WITHDRAWER_ROLE`     | `GRANTOR_ROLE`    | Contract-specific |
| `MINTER_ROLE`         | `GRANTOR_ROLE`    | Contract-specific |
| `BURNER_ROLE`         | `GRANTOR_ROLE`    | Contract-specific |
| `RESERVE_MINTER_ROLE` | `GRANTOR_ROLE`    | Contract-specific |
| `RESERVE_BURNER_ROLE` | `GRANTOR_ROLE`    | Contract-specific |

### 1.2 Function Access Control

Functions that change contract state, their required roles, and their type. View and pure functions are not included.

| Function                    | Required Role         | Type              |
| --------------------------- | --------------------- | ----------------- |
| `upgradeToAndCall()`        | `OWNER_ROLE`          | Inherited         |
| `pause()`                   | `PAUSER_ROLE`         | Inherited         |
| `unpause()`                 | `PAUSER_ROLE`         | Inherited         |
| `rescueERC20()`             | `RESCUER_ROLE`        | Inherited         |
| `initialize()`              | None                  | Contract-specific |
| `setRecipientLimit()`       | `OWNER_ROLE`          | Contract-specific |
| `setRecipientLimitPolicy()` | `OWNER_ROLE`          | Contract-specific |
| `withdraw()`                | `WITHDRAWER_ROLE`     | Contract-specific |
| `withdrawTo()`              | `WITHDRAWER_ROLE`     | Contract-specific |
| `mint()`                    | `MINTER_ROLE`         | Contract-specific |
| `burn()`                    | `BURNER_ROLE`         | Contract-specific |
| `mintFromReserve()`         | `RESERVE_MINTER_ROLE` | Contract-specific |
| `burnToReserve()`           | `RESERVE_BURNER_ROLE` | Contract-specific |

---

## 2. External Role Requirements

Roles that must be granted to `Treasury` on external contracts to allow function calls.

**Note:** `REQUIRES_ROLE` indicates that the actual role name must be determined from the external contract.

| External Contract                    | Function Called                     | Role to Grant   | Granted To       | Treasury Function            |
| ------------------------------------ | ----------------------------------- | --------------- | ---------------- | ---------------------------- |
| **UnderlyingToken** (IERC20Mintable) | `mint(address, uint256)`            | `REQUIRES_ROLE` | Treasury address | `mint()`                     |
| **UnderlyingToken** (IERC20Mintable) | `mintFromReserve(address, uint256)` | `REQUIRES_ROLE` | Treasury address | `mintFromReserve()`          |
| **UnderlyingToken** (IERC20Mintable) | `burn(uint256)`                     | `REQUIRES_ROLE` | Treasury address | `burn()`                     |
| **UnderlyingToken** (IERC20Mintable) | `burnToReserve(uint256)`            | `REQUIRES_ROLE` | Treasury address | `burnToReserve()`            |
| **UnderlyingToken** (IERC20)         | `safeTransfer(address, uint256)`    | None            | N/A              | `withdraw()`, `withdrawTo()` |
