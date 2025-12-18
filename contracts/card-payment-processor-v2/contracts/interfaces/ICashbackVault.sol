// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

/**
 * @title ICashbackVaultTypes interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the types used in the cashback vault smart contract.
 */
interface ICashbackVaultTypes {
    /**
     * @dev The cashback state of a single account within the cashback vault contract.
     *
     * Fields:
     *
     * - balance ------------- The cashback balance of the account.
     * - totalClaimed -------- The total amount of cashback claimed by the account.
     * - lastClaimTimestamp -- The timestamp of the last claim operation.
     * - lastGrantTimestamp -- The timestamp of the last grant operation.
     */
    struct AccountCashbackState {
        // Slot 1
        uint64 balance;
        uint64 totalClaimed;
        uint64 lastClaimTimestamp;
        uint64 lastGrantTimestamp;
    }

    /**
     * @dev The view of the cashback state for a single account.
     *
     * This structure is used as a return type for appropriate view functions.
     *
     * Fields:
     *
     * - balance ------------- The cashback balance of the account.
     * - totalClaimed -------- The total amount of cashback claimed by the account.
     * - lastClaimTimestamp -- The timestamp of the last claim operation.
     * - lastGrantTimestamp -- The timestamp of the last grant operation.
     */
    struct AccountCashbackStateView {
        uint256 balance;
        uint256 totalClaimed;
        uint256 lastClaimTimestamp;
        uint256 lastGrantTimestamp;
    }
}

/**
 * @title ICashbackVaultPrimary interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary part of the cashback vault smart contract interface.
 */
interface ICashbackVaultPrimary is ICashbackVaultTypes {
    // ------------------ Events ------------------------------ //

    /**
     * @dev Emitted when the cashback has been granted for an account.
     *
     * @param account The account whose cashback balance was granted.
     * @param executor The executor who performed the grant.
     * @param amount The amount of cashback granted.
     * @param newBalance The new cashback balance of the account within the vault and available for claiming.
     */
    event CashbackGranted(address indexed account, address indexed executor, uint256 amount, uint256 newBalance);

    /**
     * @dev Emitted when the cashback has been revoked for an account.
     *
     * @param account The account whose cashback balance was decreased.
     * @param executor The executor who performed the revocation.
     * @param amount The amount of cashback revoked.
     * @param newBalance The new cashback balance of the account within the vault and available for claiming.
     */
    event CashbackRevoked(address indexed account, address indexed executor, uint256 amount, uint256 newBalance);

    /**
     * @dev Emitted when cashback has been claimed for an account.
     *
     * @param account The account for whom cashback was claimed.
     * @param executor The executor who performed the claim.
     * @param amount The amount of cashback claimed.
     * @param newBalance The new cashback balance of the account within the vault and available for claiming.
     */
    event CashbackClaimed(address indexed account, address indexed executor, uint256 amount, uint256 newBalance);

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Increases the cashback balance for an account.
     *
     * Transfers tokens from the caller to the vault and increases the account's cashback balance.
     * This function can be called only by an account with the CASHBACK_OPERATOR_ROLE.
     *
     * Emits a {CashbackGranted} event.
     *
     * @param account The account to increase cashback balance for.
     * @param amount The amount to increase the cashback balance by.
     */
    function grantCashback(address account, uint64 amount) external;

    /**
     * @dev Decreases the cashback balance for an account.
     *
     * Transfers tokens from the vault to the caller and decreases the account's cashback balance.
     * This function can be called only by an account with the CASHBACK_OPERATOR_ROLE.
     *
     * Emits a {CashbackRevoked} event.
     *
     * @param account The account to decrease cashback balance for.
     * @param amount The amount to decrease the cashback balance by.
     */
    function revokeCashback(address account, uint64 amount) external;

    /**
     * @dev Claims a specific amount of cashback for an account.
     *
     * Transfers the specified amount of tokens from the vault to the account
     * and decreases the account's cashback balance.
     * This function can be called only by an account with the MANAGER_ROLE.
     *
     * Emits a {CashbackClaimed} event.
     *
     * @param account The account to claim cashback for.
     * @param amount The amount of cashback to claim.
     */
    function claim(address account, uint64 amount) external;

    /**
     * @dev Claims all available cashback for an account.
     *
     * Transfers all available cashback tokens from the vault to the account
     * and sets the account's cashback balance to zero.
     * This function can be called only by an account with the MANAGER_ROLE.
     *
     * Emits a {CashbackClaimed} event.
     *
     * @param account The account to claim all cashback for.
     */
    function claimAll(address account) external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Returns the cashback balance of a specific account.
     * @param account The account to check the cashback balance of.
     * @return The current cashback balance of the account.
     */
    function getAccountCashbackBalance(address account) external view returns (uint256);

    /**
     * @dev Returns the total cashback balance of the vault.
     * @return The total cashback balance of the vault.
     */
    function getTotalCashbackBalance() external view returns (uint256);

    /**
     * @dev Returns the complete cashback state of an account.
     * @param account The account to get the cashback state of.
     * @return result The complete cashback state of the account.
     */
    function getAccountCashbackState(address account) external view returns (AccountCashbackStateView memory);

    /// @dev Returns the address of the underlying token contract.
    function underlyingToken() external view returns (address);
}

/**
 * @title ICashbackVaultConfiguration interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The configuration part of the cashback vault smart contract interface.
 */
interface ICashbackVaultConfiguration {}

/**
 * @title ICashbackVaultErrors interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the custom errors used in the cashback vault contract.
 */
interface ICashbackVaultErrors {
    /// @dev Thrown if the provided account address is zero.
    error CashbackVault_AccountAddressZero();

    /// @dev Thrown if the provided amount is zero.
    error CashbackVault_AmountZero();

    /// @dev Thrown if the account’s cashback balance is insufficient for the operation.
    error CashbackVault_CashbackBalanceInsufficient();

    /// @dev Thrown if the provided new implementation address is not of a cashback vault contract.
    error CashbackVault_ImplementationAddressInvalid();

    /// @dev Thrown if the provided token address is zero during initialization.
    error CashbackVault_TokenAddressZero();
}

/**
 * @title ICashbackVault interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The full interface of the cashback vault smart contract.
 *
 * The smart contract manages cashback balances for accounts and allows:
 *
 * - Accounts with CASHBACK_OPERATOR_ROLE to increase/decrease cashback balances
 * - Accounts with MANAGER_ROLE to claim cashback on behalf of accounts
 * - To view account cashback balances
 * - To view the total cashback balance of the vault
 * - To view the cashback state of an account including the balance, total claimed and last claim timestamp
 *
 * The contract holds granted cashback tokens at its own address and maintains the corresponding
 * cashback balance mappings, providing a centralized cashback management system.
 */
interface ICashbackVault is ICashbackVaultPrimary, ICashbackVaultConfiguration, ICashbackVaultErrors {
    /**
     * @dev Proves the contract is the cashback vault one. A marker function.
     *
     * It is used for simple contract compliance checks, e.g. during an upgrade.
     * This avoids situations where a wrong contract address is specified by mistake.
     */
    function proveCashbackVault() external pure;
}
