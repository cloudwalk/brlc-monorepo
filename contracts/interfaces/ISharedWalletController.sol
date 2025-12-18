// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { EnumerableMap } from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

/**
 * @title ISharedWalletControllerTypes interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the types used in the shared wallet controller smart contract.
 */
interface ISharedWalletControllerTypes {
    /**
     * @dev The data of a shared wallet to store in the contract.
     *
     * The fields:
     *
     * - status -------------- The status of the wallet according to the {WalletStatus} enum.
     * - balance ------------- The balance of the wallet that is shared among participants.
     * - participantBalances - The balances of the participants in the wallet.
     */
    struct WalletState {
        // Slot 1
        WalletStatus status;
        uint64 balance;
        // uint184 __reserved; // Reserved for future use until the end of the storage slot

        // Slot 2, 3, 4
        EnumerableMap.AddressToUintMap participantBalances;
        // No reserve until the end of the storage slot
    }

    /**
     * @dev Possible statuses of a shared wallet.
     *
     * The values:
     *
     * - Nonexistent = 0 -- The shared wallet with the provided address does not exist (the default value).
     * - Active = 1 ------- The shared wallet is active.
     * - Suspended = 2 ---- The shared wallet is suspended.
     *
     * Notes:
     *
     *  - 1. Any transfers to or from a suspended wallet will cause the transaction to revert.
     *  - 2. Only a wallet with the zero balance can be suspended.
     *  - 3. A suspended wallet can be resumed to become active again.
     */
    enum WalletStatus {
        Nonexistent,
        Active,
        Suspended
    }
    /**
     * @dev Possible statuses of a participant in a shared wallet.
     *
     * The values:
     *
     * - NotRegistered = 0 -- The participant with the provided address is not registered in the shared wallet.
     * - Registered = 1 ----- The participant is registered in the shared wallet.
     */
    enum ParticipantStatus {
        NotRegistered,
        Registered
    }

    /**
     * @dev A struct containing overview information about a shared wallet.
     *
     * The fields:
     *
     * - wallet ---------------- The address of the shared wallet.
     * - walletStatus ---------- The status of the wallet according to the {WalletStatus} enum.
     * - walletBalance --------- The total balance of the wallet that is shared among its participants.
     * - participantSummaries -- The participant summaries in the wallet according to the {ParticipantSummary} struct.
     */
    struct WalletOverview {
        address wallet;
        WalletStatus walletStatus;
        uint256 walletBalance;
        ParticipantSummary[] participantSummaries;
    }

    /**
     * @dev A struct containing summary information about a participant in a shared wallet.
     *
     * The fields:
     *
     * - participant --------- The address of the participant.
     * - participantBalance -- The balance of the participant in the shared wallet.
     */
    struct ParticipantSummary {
        address participant;
        uint256 participantBalance;
    }

    /**
     * @dev A struct containing overview information about a participant.
     *
     * The fields:
     *
     * - participant ----- The address of the participant.
     * - totalBalance ---- The total balance of the participant across all shared wallets.
     * - walletSummaries - The wallet summaries of the participant according to the {WalletSummary} struct.
     */
    struct ParticipantOverview {
        address participant;
        uint256 totalBalance;
        WalletSummary[] walletSummaries;
    }

    /**
     * @dev A struct containing summary information about a wallet of a participant.
     *
     * The fields:
     *
     * - wallet -------------- The address of the wallet.
     * - walletStatus -------- The status of the wallet according to the {WalletStatus} enum.
     * - walletBalance ------- The balance of the wallet.
     * - participantBalance -- The balance of the participant in the wallet.
     */
    struct WalletSummary {
        address wallet;
        WalletStatus walletStatus;
        uint256 walletBalance;
        uint256 participantBalance;
    }

    /**
     * @dev A struct containing a pair of a wallet and a participant to use as a parameter of a view function.
     *
     * The fields:
     *
     * - wallet ------- The address of the wallet.
     * - participant -- The address of the participant.
     *
     * Notes:
     *
     *  - 1. The zero address in the struct is used as a wildcard.
     *  - 2. If the wallet address is zero then all wallets with the provided participant address will be returned.
     *  - 3. If the participant address is zero then all participants with the provided wallet will be returned.
     *  - 4. The wallet address and the participant address must not be zero at the same time.
     *  - 5. Replacing of the pairs with the zero addresses is called normalization.
     */
    struct WalletParticipantPair {
        address wallet;
        address participant;
    }

    /**
     * @dev A struct containing overview information about a wallet-participant relationship.
     *
     * The fields:
     *
     * - wallet -------------- The address of the shared wallet.
     * - walletStatus -------- The status of the wallet according to the {WalletStatus} enum.
     * - walletBalance ------- The balance of the wallet that is shared among its participants.
     * - participant --------- The address of the participant.
     * - participantStatus --- The status of the participant according to the {ParticipantStatus} enum.
     * - participantBalance -- The balance of the participant in the shared wallet.
     */
    struct RelationshipOverview {
        // Wallet information
        address wallet;
        WalletStatus walletStatus;
        uint256 walletBalance;
        // Participant information
        address participant;
        ParticipantStatus participantStatus;
        uint256 participantBalance;
    }
}

/**
 * @title ISharedWalletControllerPrimary interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The primary part of the shared wallet controller smart contract interface.
 */
interface ISharedWalletControllerPrimary is ISharedWalletControllerTypes {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when a new shared wallet is created and activated.
     * @param wallet The address of the created wallet.
     */
    event WalletCreated(address indexed wallet);

    /**
     * @dev Emitted when a shared wallet is suspended.
     * @param wallet The address of the suspended wallet.
     */
    event WalletSuspended(address indexed wallet);

    /**
     * @dev Emitted when a shared wallet is resumed after being suspended.
     * @param wallet The address of the resumed wallet.
     */
    event WalletResumed(address indexed wallet);

    /**
     * @dev Emitted when a shared wallet is deleted.
     * @param wallet The address of the deleted wallet.
     */
    event WalletDeleted(address indexed wallet);

    /**
     * @dev Emitted when a participant is added to a shared wallet.
     * @param wallet The address of the wallet.
     * @param participant The address of the participant.
     */
    event ParticipantAdded(address indexed wallet, address indexed participant);

    /**
     * @dev Emitted when a participant is removed from a wallet.
     * @param wallet The address of the wallet.
     * @param participant The address of the participant.
     */
    event ParticipantRemoved(address indexed wallet, address indexed participant);

    /**
     * NOTE: The wallet balance operation events below are split into separate events for better readability
     * and granularity. To fetch the complete history of all balance operations, use a database query like:
     *
     * ```sql
     * SELECT * FROM logs
     * WHERE logs.first_topic IN (<deposit_hash>, <withdrawal_hash>, <transfer_in_hash>, <transfer_out_hash>)
     * ```
     */

    /**
     * @dev Emitted when a participant has deposited tokens to a shared wallet.
     * @param wallet The address of the shared wallet.
     * @param participant The address of the participant.
     * @param newParticipantBalance The balance of the participant after the deposit.
     * @param oldParticipantBalance The balance of the participant before the deposit.
     * @param newWalletBalance The balance of the shared wallet after the deposit.
     * @param oldWalletBalance The balance of the shared wallet before the deposit.
     */
    event Deposit(
        address indexed wallet,
        address indexed participant,
        uint256 newParticipantBalance,
        uint256 oldParticipantBalance,
        uint256 newWalletBalance,
        uint256 oldWalletBalance
    );

    /**
     * @dev Emitted when a participant has withdrawn tokens from a shared wallet.
     * @param wallet The address of the shared wallet.
     * @param participant The address of the participant.
     * @param newParticipantBalance The balance of the participant after the withdrawal.
     * @param oldParticipantBalance The balance of the participant before the withdrawal.
     * @param newWalletBalance The new balance of the shared wallet.
     * @param oldWalletBalance The old balance of the shared wallet.
     */
    event Withdrawal(
        address indexed wallet,
        address indexed participant,
        uint256 newParticipantBalance,
        uint256 oldParticipantBalance,
        uint256 newWalletBalance,
        uint256 oldWalletBalance
    );

    /**
     * @dev Emitted when tokens have been transferred to a shared wallet with distribution among participants.
     *
     * This event is emitted for each participant in the wallet whose balance has been changed.
     *
     * @param wallet The address of the shared wallet.
     * @param participant The address of the participant.
     * @param newParticipantBalance The balance of the participant after the transfer.
     * @param oldParticipantBalance The balance of the participant before the transfer.
     * @param newWalletBalance The new balance of the shared wallet.
     * @param oldWalletBalance The old balance of the shared wallet.
     */
    event TransferIn(
        address indexed wallet,
        address indexed participant,
        uint256 newParticipantBalance,
        uint256 oldParticipantBalance,
        uint256 newWalletBalance,
        uint256 oldWalletBalance
    );

    /**
     * @dev Emitted when tokens have been transferred from a shared wallet with distribution among participants.
     *
     * This event is emitted for each participant in the wallet whose balance has been changed.
     *
     * @param wallet The address of the shared wallet.
     * @param participant The address of the participant.
     * @param newParticipantBalance The balance of the participant after the transfer.
     * @param oldParticipantBalance The balance of the participant before the transfer.
     * @param newWalletBalance The balance of the shared wallet after the transfer.
     * @param oldWalletBalance The balance of the shared wallet before the transfer.
     */
    event TransferOut(
        address indexed wallet,
        address indexed participant,
        uint256 newParticipantBalance,
        uint256 oldParticipantBalance,
        uint256 newWalletBalance,
        uint256 oldWalletBalance
    );

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Creates a new shared wallet.
     * @param wallet The address of the shared wallet to create.
     * @param participants The addresses of the participants.
     */
    function createWallet(address wallet, address[] calldata participants) external;

    /**
     * @dev Suspends a shared wallet.
     * @param wallet The address of the shared wallet to suspend.
     */
    function suspendWallet(address wallet) external;

    /**
     * @dev Resumes a shared wallet that was previously suspended.
     * @param wallet The address of the shared wallet to resume.
     */
    function resumeWallet(address wallet) external;

    /**
     * @dev Adds participants to a shared wallet.
     * @param wallet The address of the shared wallet to add participants to.
     * @param participants The addresses of the participants.
     */
    function addParticipants(address wallet, address[] calldata participants) external;

    /**
     * @dev Removes participants from a shared wallet.
     * @param wallet The address of the shared wallet to remove participants from.
     * @param participants The addresses of the participants.
     */
    function removeParticipants(address wallet, address[] calldata participants) external;

    /**
     * @dev Deletes a shared wallet.
     * @param wallet The address of the shared wallet to delete.
     */
    function deleteWallet(address wallet) external;

    // ------------------ View functions --------------------------- //

    /**
     * @dev Checks if a participant is in a shared wallet.
     * @param wallet The address of the shared wallet to check.
     * @param participant The address of the participant to check.
     * @return True if the participant is in the shared wallet, false otherwise.
     */
    function isParticipant(address wallet, address participant) external view returns (bool);

    /**
     * @dev Returns the balance of a participant in a shared wallet.
     * @param wallet The address of the shared wallet to get the balance of.
     * @param participant The address of the participant to get the balance of.
     * @return balance The balance of the participant in the shared wallet.
     */
    function getParticipantBalance(address wallet, address participant) external view returns (uint256 balance);

    /**
     * @dev Returns the shared wallets that a participant is a part of.
     * @param participant The address of the participant.
     * @return wallets The addresses of the shared wallets of the participant.
     */
    function getParticipantWallets(address participant) external view returns (address[] memory wallets);

    /**
     * @dev Returns detailed information for participants.
     * @param participants The addresses of the participants to get details for.
     * @return overviews The detailed information for each participant.
     */
    function getParticipantOverviews(
        address[] calldata participants
    ) external view returns (ParticipantOverview[] memory overviews);

    /**
     * @dev Returns all participants of a shared wallet.
     * @param wallet The address of the shared wallet.
     * @return participants The addresses of all participants of the shared wallet.
     */
    function getWalletParticipants(address wallet) external view returns (address[] memory participants);

    /**
     * @dev Returns detailed information for shared wallets.
     * @param wallets The addresses of the shared wallets to get details for.
     * @return overviews The detailed information for each shared wallet.
     */
    function getWalletOverviews(address[] calldata wallets) external view returns (WalletOverview[] memory overviews);

    /**
     * @dev Returns detailed information for wallet-participant relationships.
     *
     * Wildcard support:
     * - Use zero wallet address to get all wallets for a participant;
     * - Use zero participant address to get all participants for a wallet;
     * - Specify both addresses for exact pair information.
     *
     * @param pairs The wallet-participant pairs to get details for (supports wildcards).
     * @return overviews The detailed information for each resolved pair after wildcard expansion.
     */
    function getRelationshipOverviews(
        WalletParticipantPair[] calldata pairs
    ) external view returns (RelationshipOverview[] memory overviews);

    /**
     * @dev Returns the number of existing shared wallets.
     * @return The number of existing shared wallets.
     */
    function getWalletCount() external view returns (uint256);

    /**
     * @dev Returns the aggregated balance across all shared wallets.
     * @return The aggregated balance across all shared wallets.
     */
    function getAggregatedBalance() external view returns (uint256);

    /// @dev Returns the address of the underlying token contract.
    function underlyingToken() external view returns (address);
}

/**
 * @title ISharedWalletControllerErrors interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The errors of the shared wallet controller smart contract.
 */
interface ISharedWalletControllerErrors is ISharedWalletControllerTypes {
    /// @dev Thrown if the aggregated balance across all shared wallets exceeds the limit.
    error SharedWalletController_AggregatedBalanceExceedsLimit();

    /// @dev Thrown if the implementation address provided for the contract upgrade is invalid.
    error SharedWalletController_ImplementationInvalid();

    /// @dev Thrown if the provided participant address is zero.
    error SharedWalletController_ParticipantAddressZero();

    /// @dev Thrown if the provided participant array is empty.
    error SharedWalletController_ParticipantArrayEmpty();

    /// @dev Thrown if the current participant balance is insufficient for the operation.
    error SharedWalletController_ParticipantBalanceInsufficient();

    /// @dev Thrown if the current participant balance is not zero.
    error SharedWalletController_ParticipantBalanceNotZero(address participant);

    /// @dev Thrown if during the operation the number of participants in the wallet exceeds the limit.
    error SharedWalletController_ParticipantCountExceedsLimit();

    /// @dev Thrown if the provided participant is not registered in the shared wallet.
    error SharedWalletController_ParticipantNotRegistered(address participant);

    /// @dev Thrown if the provided participant is already registered in the shared wallet.
    error SharedWalletController_ParticipantAlreadyRegistered(address participant);

    /// @dev Thrown if the provided participant is a shared wallet.
    error SharedWalletController_ParticipantIsSharedWallet(address participant);

    /**
     * @dev Thrown if the shares calculation is incorrect.
     *
     * It is expected that this error is extremely rare.
     * It can happen when the balance of a wallet equals the transfer amount but
     * the shares of the amount are incorrectly distributed among participants due to rounding.
     *
     * A numerical example:
     *
     * - The wallet balance is 1 BRLC.
     * - There are 3 participants (A, B, C) with the following balances: 0.33 BRLC, 0.33 BRLC, 0.34 BRLC.
     * - The transfer amount is 1 BRLC.
     * - The transfer is distributed among participants with the following shares: 0.34 BRLC, 0.33 BRLC, 0.33 BRLC.
     * - Because the share of account A is greater than its balance the transfer will fail with this error.
     *
     * Possible workaround: transfer 0.01 BRLC to account A, then repeat the transfer.
     */
    error SharedWalletController_SharesCalculationInvalid();

    /// @dev Thrown if the provided token is unauthorized.
    error SharedWalletController_TokenUnauthorized();

    /// @dev Thrown if the provided token address is zero.
    error SharedWalletController_TokenAddressZero();

    /// @dev Thrown if the provided wallet address is zero.
    error SharedWalletController_WalletAddressZero();

    /// @dev Thrown if the wallet address is a smart contract address.
    error SharedWalletController_WalletAddressIsContract();

    /// @dev Thrown if the wallet address has a non-zero token balance.
    error SharedWalletController_WalletAddressHasBalance();

    /// @dev Thrown if the number of existing shared wallets exceeds the limit.
    error SharedWalletController_WalletCountExceedsLimit();

    /// @dev Thrown if the provided wallet already exists.
    error SharedWalletController_WalletAlreadyExists();

    /// @dev Thrown if the current wallet balance is insufficient for the operation.
    error SharedWalletController_WalletBalanceInsufficient();

    /// @dev Thrown if the current wallet balance is not zero.
    error SharedWalletController_WalletBalanceNotZero();

    /// @dev Thrown if the provided wallet does not exist.
    error SharedWalletController_WalletNonexistent();

    /// @dev Thrown if the provided wallet and participant addresses are both zero.
    error SharedWalletController_WalletAndParticipantAddressesBothZero();

    /// @dev Thrown if the wallet has no participants and cannot be resumed.
    error SharedWalletController_WalletHasNoParticipants();

    /// @dev Thrown if the operation would result in an empty active wallet.
    error SharedWalletController_WalletWouldBecomeEmpty();

    /// @dev Thrown if the provided wallet status is incompatible.
    error SharedWalletController_WalletStatusIncompatible(WalletStatus expectedStatus, WalletStatus actualStatus);

    /// @dev Thrown if the transfer amount is not rounded to the expected accuracy.
    error SharedWalletController_TransferAmountNotRounded();
}

/**
 * @title ISharedWalletController interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The full interface of the shared wallet controller smart contract.
 */
interface ISharedWalletController is ISharedWalletControllerPrimary, ISharedWalletControllerErrors {
    /**
     * @dev Proves the contract is the shared wallet controller one. A marker function.
     *
     * It is used for simple contract compliance checks, e.g. during an upgrade.
     * This avoids situations where a wrong contract address is specified by mistake.
     */
    function proveSharedWalletController() external pure;
}
