## Main Changes

- Added `deleteWallet(address wallet)` function and `WalletDeleted` event to delete an existing wallet with zero balance.
- Added additional validations for the shared wallet address in `createWallet`:
  - The wallet address cannot be a contract (new error `SharedWalletController_WalletAddressIsContract`).
  - The wallet address must have zero token balance (new error `SharedWalletController_WalletAddressHasBalance`).
- The contract now emits `Withdrawal` and `Deposit` events on zero-amount transfers,
  while still not emitting per-participant `TransferIn` and `TransferOut` events when the participant share is zero.

### Technical changes

- Updated Solidity compiler to 0.8.28 and EVM version to `cancun`.

### Migration

No actions needed.

# 1.0.0
