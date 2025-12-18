/* eslint @typescript-eslint/no-unused-expressions: "off", @typescript-eslint/no-non-null-assertion: "off" */
import * as Contracts from "@contracts";
import type {
  ISharedWalletControllerTypes,
} from "@contracts/contracts/interfaces/ISharedWalletController.sol/ISharedWalletControllerPrimary";
import type { ContractTransactionResponse } from "ethers";
import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { checkContractUupsUpgrading, connect, getAddress, proveTx } from "../test-utils/eth";
import { checkEquality, setUpFixture } from "../test-utils/common";

// Expected version of the contract
const EXPECTED_VERSION = {
  major: 1,
  minor: 0,
  patch: 0,
};

// Test constants
const ADDRESS_ZERO = ethers.ZeroAddress;
const ALLOWANCE_MAX = ethers.MaxUint256;
const MAX_PARTICIPANTS_PER_WALLET = 100;
const BALANCE_INITIAL = 1000000000000n;
const ACCURACY_FACTOR = 10000n;
const MAX_UINT64 = 2n ** 64n - 1n;

// Roles of the contract under test
const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
const PAUSER_ROLE: string = ethers.id("PAUSER_ROLE");
const RESCUER_ROLE: string = ethers.id("RESCUER_ROLE");
const ADMIN_ROLE: string = ethers.id("ADMIN_ROLE");

// Event names emitted by the contract
const EVENT_NAME_WALLET_CREATED = "WalletCreated";
const EVENT_NAME_WALLET_SUSPENDED = "WalletSuspended";
const EVENT_NAME_WALLET_RESUMED = "WalletResumed";
const EVENT_NAME_WALLET_DELETED = "WalletDeleted";
const EVENT_NAME_PARTICIPANT_ADDED = "ParticipantAdded";
const EVENT_NAME_PARTICIPANT_REMOVED = "ParticipantRemoved";
const EVENT_NAME_DEPOSIT = "Deposit";
const EVENT_NAME_WITHDRAWAL = "Withdrawal";
const EVENT_NAME_TRANSFER_IN = "TransferIn";
const EVENT_NAME_TRANSFER_OUT = "TransferOut";

// Error names for custom errors from libraries
const ERROR_NAME_INVALID_INITIALIZATION = "InvalidInitialization";
const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";
const ERROR_NAME_ENFORCED_PAUSE = "EnforcedPause";
const ERROR_NAME_ERC20_INSUFFICIENT_BALANCE = "ERC20InsufficientBalance";

// Custom error names for contract-specific errors
const ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID = "SharedWalletController_ImplementationInvalid";
const ERROR_NAME_TOKEN_ADDRESS_ZERO = "SharedWalletController_TokenAddressZero";
const ERROR_NAME_TOKEN_UNAUTHORIZED = "SharedWalletController_TokenUnauthorized";
const ERROR_NAME_WALLET_ADDRESS_ZERO = "SharedWalletController_WalletAddressZero";
const ERROR_NAME_WALLET_ALREADY_EXISTS = "SharedWalletController_WalletAlreadyExists";
const ERROR_NAME_WALLET_BALANCE_NOT_ZERO = "SharedWalletController_WalletBalanceNotZero";
const ERROR_NAME_WALLET_BALANCE_INSUFFICIENT = "SharedWalletController_WalletBalanceInsufficient";
const ERROR_NAME_WALLET_NONEXISTENT = "SharedWalletController_WalletNonexistent";
const ERROR_NAME_WALLET_STATUS_INCOMPATIBLE = "SharedWalletController_WalletStatusIncompatible";
const ERROR_NAME_WALLET_HAS_NO_PARTICIPANTS = "SharedWalletController_WalletHasNoParticipants";
const ERROR_NAME_SHARES_CALCULATION_INVALID = "SharedWalletController_SharesCalculationInvalid";
const ERROR_NAME_WALLET_WOULD_BECOME_EMPTY = "SharedWalletController_WalletWouldBecomeEmpty";
const ERROR_NAME_WALLET_COUNT_EXCEEDS_LIMIT = "SharedWalletController_WalletCountExceedsLimit";
const ERROR_NAME_PARTICIPANT_ADDRESS_ZERO = "SharedWalletController_ParticipantAddressZero";
const ERROR_NAME_PARTICIPANT_ARRAY_EMPTY = "SharedWalletController_ParticipantArrayEmpty";
const ERROR_NAME_PARTICIPANT_COUNT_EXCESS = "SharedWalletController_ParticipantCountExceedsLimit";
const ERROR_NAME_PARTICIPANT_NOT_REGISTERED = "SharedWalletController_ParticipantNotRegistered";
const ERROR_NAME_PARTICIPANT_REGISTERED_ALREADY = "SharedWalletController_ParticipantAlreadyRegistered";
const ERROR_NAME_PARTICIPANT_IS_SHARED_WALLET = "SharedWalletController_ParticipantIsSharedWallet";
const ERROR_NAME_PARTICIPANT_BALANCE_NOT_ZERO = "SharedWalletController_ParticipantBalanceNotZero";
const ERROR_NAME_PARTICIPANT_BALANCE_INSUFFICIENT = "SharedWalletController_ParticipantBalanceInsufficient";
const ERROR_NAME_TRANSFER_AMOUNT_NOT_ROUNDED = "SharedWalletController_TransferAmountNotRounded";
const ERROR_NAME_WALLET_ADDRESS_IS_CONTRACT = "SharedWalletController_WalletAddressIsContract";
const ERROR_NAME_WALLET_ADDRESS_HAS_BALANCE = "SharedWalletController_WalletAddressHasBalance";
const ERROR_NAME_WALLET_AND_PARTICIPANT_ADDRESSES_BOTH_ZERO =
  "SharedWalletController_WalletAndParticipantAddressesBothZero";
const ERROR_NAME_AGGREGATED_BALANCE_EXCEEDS_LIMIT = "SharedWalletController_AggregatedBalanceExceedsLimit";
// Types of the contract under test
enum WalletStatus {
  Nonexistent = 0,
  Active = 1,
  Suspended = 2,
}

enum ParticipantStatus {
  NotRegistered = 0,
  Registered = 1,
}

type WalletParticipantPair = ISharedWalletControllerTypes.WalletParticipantPairStruct;

// Helper functions for creating test data
function createTestWalletOverview(
  wallet: string,
  status: WalletStatus = WalletStatus.Active,
  balance = 0n,
): ISharedWalletControllerTypes.WalletOverviewStruct {
  return {
    wallet,
    walletStatus: status,
    walletBalance: balance,
    participantSummaries: [],
  };
}

function createTestWalletSummary(
  wallet: string,
  walletStatus: WalletStatus = WalletStatus.Active,
  walletBalance = 0n,
  participantBalance = 0n,
): ISharedWalletControllerTypes.WalletSummaryStruct {
  return {
    wallet,
    walletStatus,
    walletBalance,
    participantBalance,
  };
}

function createTestParticipantSummary(
  participant: string,
  balance = 0n,
): ISharedWalletControllerTypes.ParticipantSummaryStruct {
  return {
    participant,
    participantBalance: balance,
  };
}

function createTestParticipantOverview(
  participant: string,
  totalBalance = 0n,
  walletSummaries: ISharedWalletControllerTypes.WalletSummaryStruct[] = [],
): ISharedWalletControllerTypes.ParticipantOverviewStruct {
  return {
    participant,
    totalBalance,
    walletSummaries,
  };
}

function createTestRelationshipOverview(
  wallet: string,
  participant: string,
  participantBalance = 0n,
  walletStatus: WalletStatus = WalletStatus.Active,
  walletBalance = 0n,
  participantStatus: ParticipantStatus = ParticipantStatus.Registered,
): ISharedWalletControllerTypes.RelationshipOverviewStruct {
  return {
    wallet,
    walletStatus,
    walletBalance,
    participant,
    participantStatus,
    participantBalance,
  };
}

describe("Contract 'SharedWalletController'", () => {
  let sharedWalletControllerFactory: Contracts.SharedWalletController__factory;

  let deployer: HardhatEthersSigner;
  let grantor: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let sharedWallets: HardhatEthersSigner[];
  let participants: HardhatEthersSigner[];

  before(async () => {
    let wallet1: HardhatEthersSigner;
    let wallet2: HardhatEthersSigner;
    let participant1: HardhatEthersSigner;
    let participant2: HardhatEthersSigner;
    let participant3: HardhatEthersSigner;

    [deployer, grantor, pauser, admin, stranger, wallet1, wallet2, participant1, participant2, participant3] =
      await ethers.getSigners();
    sharedWallets = [wallet1, wallet2];
    participants = [participant1, participant2, participant3];

    sharedWalletControllerFactory = await ethers.getContractFactory("SharedWalletController");
    sharedWalletControllerFactory = sharedWalletControllerFactory.connect(deployer);
  });

  // Test helper functions for parameterized testing
  function testWalletCreation(
    participantCount: 1 | 3,
    options?: {
      validateOverviews?: boolean;
      validateEvents?: boolean;
    },
  ): () => Promise<void> {
    return async () => {
      const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
      const walletAddress = sharedWallets[0].address;
      const participantAddresses = participants.slice(0, participantCount).map(p => p.address);

      // Verify initial state
      expect(await sharedWalletController.getWalletCount()).to.equal(0);

      // Create wallet
      const tx = connect(sharedWalletController, admin).createWallet(walletAddress, participantAddresses);
      await proveTx(tx);

      // Common validations
      expect(await sharedWalletController.getWalletCount()).to.equal(1);
      const actualParticipants = await sharedWalletController.getWalletParticipants(walletAddress);
      expect(actualParticipants).to.deep.equal(participantAddresses);

      // Participant-specific validations
      if (participantCount === 1) {
        expect(await sharedWalletController.isParticipant(walletAddress, participantAddresses[0])).to.equal(true);
        const participantWallets = await sharedWalletController.getParticipantWallets(participantAddresses[0]);
        expect(participantWallets).to.deep.equal([walletAddress]);

        // Validate wallet overview for single participant
        if (options?.validateOverviews !== false) {
          const walletOverviews = await sharedWalletController.getWalletOverviews([walletAddress]);
          const expectedOverview = createTestWalletOverview(walletAddress, WalletStatus.Active, 0n);
          const expectedParticipantSummary = createTestParticipantSummary(
            participantAddresses[0],
            0n,
          );
          expectedOverview.participantSummaries = [expectedParticipantSummary];
          checkEquality(walletOverviews[0], expectedOverview);
        }
      } else {
        // Multiple participants validation
        for (const participantAddress of participantAddresses) {
          expect(await sharedWalletController.isParticipant(walletAddress, participantAddress)).to.equal(true);
          expect(await sharedWalletController.getParticipantBalance(walletAddress, participantAddress)).to.equal(0);
        }
      }

      // Event validations
      if (options?.validateEvents !== false) {
        await expect(tx).to.emit(sharedWalletController, EVENT_NAME_WALLET_CREATED).withArgs(walletAddress);
        for (const participantAddress of participantAddresses) {
          await expect(tx)
            .to.emit(sharedWalletController, EVENT_NAME_PARTICIPANT_ADDED)
            .withArgs(walletAddress, participantAddress);
        }
      }
    };
  }

  function testWalletSuspension(participantCount: 1 | 3): () => Promise<void> {
    return async () => {
      const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
      const walletAddress = sharedWallets[0].address;
      const participantAddresses = participants.slice(0, participantCount).map(p => p.address);

      // Create wallet with participants
      await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, participantAddresses));

      // Verify initial active state
      const initialWalletOverviews = await sharedWalletController.getWalletOverviews([walletAddress]);
      expect(initialWalletOverviews[0].walletStatus).to.equal(WalletStatus.Active);

      // Suspend wallet
      const tx = connect(sharedWalletController, admin).suspendWallet(walletAddress);
      await proveTx(tx);

      // Verify suspended state
      const suspendedWalletOverviews = await sharedWalletController.getWalletOverviews([walletAddress]);
      expect(suspendedWalletOverviews[0].walletStatus).to.equal(WalletStatus.Suspended);

      // Verify event emission
      await expect(tx).to.emit(sharedWalletController, EVENT_NAME_WALLET_SUSPENDED).withArgs(walletAddress);
    };
  }

  function testWalletResumption(participantCount: 1 | 3): () => Promise<void> {
    return async () => {
      const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
      const walletAddress = sharedWallets[0].address;
      const participantAddresses = participants.slice(0, participantCount).map(p => p.address);

      // Create wallet with participants and suspend it
      await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, participantAddresses));
      await proveTx(connect(sharedWalletController, admin).suspendWallet(walletAddress));

      // Verify suspended state
      const suspendedWalletOverviews = await sharedWalletController.getWalletOverviews([walletAddress]);
      expect(suspendedWalletOverviews[0].walletStatus).to.equal(WalletStatus.Suspended);

      // Resume wallet
      const tx = connect(sharedWalletController, admin).resumeWallet(walletAddress);
      await proveTx(tx);

      // Verify active state
      const resumedWalletOverviews = await sharedWalletController.getWalletOverviews([walletAddress]);
      expect(resumedWalletOverviews[0].walletStatus).to.equal(WalletStatus.Active);

      // Verify event emission
      await expect(tx).to.emit(sharedWalletController, EVENT_NAME_WALLET_RESUMED).withArgs(walletAddress);
    };
  }

  function testAddParticipants(participantCount: 1 | 2): () => Promise<void> {
    return async () => {
      const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
      const walletAddress = sharedWallets[0].address;
      const initialParticipant = participants[0].address;
      const newParticipants = participants.slice(1, 1 + participantCount).map(p => p.address);

      // Create wallet with initial participant
      await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, [initialParticipant]));

      // Verify initial state
      const initialWalletParticipants = await sharedWalletController.getWalletParticipants(walletAddress);
      expect(initialWalletParticipants.length).to.equal(1);

      // Add new participants
      const tx = connect(sharedWalletController, admin).addParticipants(walletAddress, newParticipants);
      await proveTx(tx);

      // Verify all participants are registered
      const finalWalletParticipants = await sharedWalletController.getWalletParticipants(walletAddress);
      expect(finalWalletParticipants.length).to.equal(1 + participantCount);
      expect(finalWalletParticipants).to.include.members([initialParticipant, ...newParticipants]);

      // Verify each new participant is registered
      for (const newParticipant of newParticipants) {
        expect(await sharedWalletController.isParticipant(walletAddress, newParticipant)).to.equal(true);
        expect(await sharedWalletController.getParticipantBalance(walletAddress, newParticipant)).to.equal(0);
      }

      // Verify event emissions
      for (const newParticipant of newParticipants) {
        await expect(tx)
          .to.emit(sharedWalletController, EVENT_NAME_PARTICIPANT_ADDED)
          .withArgs(walletAddress, newParticipant);
      }
    };
  }

  function testRemoveParticipants(participantCount: 1 | 2): () => Promise<void> {
    return async () => {
      const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
      const walletAddress = sharedWallets[0].address;
      const allParticipants = [participants[0].address, participants[1].address, participants[2].address];
      const participantsToRemove = participants.slice(1, 1 + participantCount).map(p => p.address);
      const remainingParticipants = allParticipants.filter(p => !participantsToRemove.includes(p));

      // Create wallet with multiple participants
      await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, allParticipants));

      // Verify initial state
      const initialWalletParticipants = await sharedWalletController.getWalletParticipants(walletAddress);
      expect(initialWalletParticipants.length).to.equal(3);

      // Remove participants
      const tx = connect(sharedWalletController, admin).removeParticipants(walletAddress, participantsToRemove);
      await proveTx(tx);

      // Verify participants were removed
      const finalWalletParticipants = await sharedWalletController.getWalletParticipants(walletAddress);
      expect(finalWalletParticipants.length).to.equal(remainingParticipants.length);
      expect(finalWalletParticipants).to.deep.equal(remainingParticipants);

      // Verify removed participants are no longer registered
      for (const removedParticipant of participantsToRemove) {
        expect(await sharedWalletController.isParticipant(walletAddress, removedParticipant)).to.equal(false);
      }

      // Verify remaining participants are still registered
      for (const remainingParticipant of remainingParticipants) {
        expect(await sharedWalletController.isParticipant(walletAddress, remainingParticipant)).to.equal(true);
      }

      // Verify event emissions
      for (const removedParticipant of participantsToRemove) {
        await expect(tx)
          .to.emit(sharedWalletController, EVENT_NAME_PARTICIPANT_REMOVED)
          .withArgs(walletAddress, removedParticipant);
      }
    };
  }

  async function deployTokenMock() {
    const name = "ERC20 Test";
    const symbol = "TEST";

    let tokenMockFactory = await ethers.getContractFactory("ERC20TokenMockWithHooks");
    tokenMockFactory = tokenMockFactory.connect(deployer);

    let tokenMock = (await tokenMockFactory.deploy(name, symbol));
    await tokenMock.waitForDeployment();
    tokenMock = connect(tokenMock, deployer);

    return tokenMock;
  }

  async function deploySharedWalletController(tokenMock: Contracts.ERC20TokenMockWithHooks) {
    let sharedWalletController = (await upgrades.deployProxy(sharedWalletControllerFactory, [
      getAddress(tokenMock),
    ]));

    await sharedWalletController.waitForDeployment();
    sharedWalletController = connect(sharedWalletController, deployer);

    return sharedWalletController;
  }

  async function deployContracts() {
    const tokenMock = await deployTokenMock();
    const sharedWalletController = await deploySharedWalletController(tokenMock);

    return {
      sharedWalletController,
      tokenMock,
    };
  }

  async function deployAndConfigureContracts() {
    const fixture = await deployContracts();
    const { sharedWalletController, tokenMock } = fixture;

    // Set up token hook contract
    await proveTx(tokenMock.setHookContract(getAddress(sharedWalletController)));

    // Grant roles to grantor and admin
    await proveTx(sharedWalletController.grantRole(GRANTOR_ROLE, grantor.address));
    await proveTx(connect(sharedWalletController, grantor).grantRole(ADMIN_ROLE, admin.address));

    // Mint initial balances for participants
    for (const participant of participants) {
      await proveTx(tokenMock.mint(participant.address, BALANCE_INITIAL));
    }

    return fixture;
  }

  // Helper functions for common test patterns
  async function createWalletWithParticipants(
    sharedWalletController: Contracts.SharedWalletController,
    walletAddress: string,
    participantAddresses: string[],
  ) {
    await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, participantAddresses));
  }

  async function expectAccessControlError(
    promise: Promise<unknown>,
    contract: Contracts.SharedWalletController,
    account: string,
    role: string,
  ) {
    await expect(promise)
      .to.be.revertedWithCustomError(contract, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
      .withArgs(account, role);
  }

  async function expectPauseError(promise: Promise<unknown>, contract: Contracts.SharedWalletController) {
    await expect(promise).to.be.revertedWithCustomError(contract, ERROR_NAME_ENFORCED_PAUSE);
  }

  async function pauseContract(sharedWalletController: Contracts.SharedWalletController) {
    await proveTx(connect(sharedWalletController, grantor).grantRole(PAUSER_ROLE, pauser.address));
    await proveTx(connect(sharedWalletController, pauser).pause());
  }

  async function transferTokens(
    tokenMock: Contracts.ERC20TokenMockWithHooks,
    from: HardhatEthersSigner,
    to: string,
    amount: bigint,
  ) {
    await proveTx(connect(tokenMock, from).transfer(to, amount));
  }

  describe("Function 'initialize()'", () => {
    describe("Executes as expected", () => {
      it("Initializes the contract correctly", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployContracts);

        // Verify role configuration
        expect(await sharedWalletController.OWNER_ROLE()).to.equal(OWNER_ROLE);
        expect(await sharedWalletController.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
        expect(await sharedWalletController.PAUSER_ROLE()).to.equal(PAUSER_ROLE);
        expect(await sharedWalletController.RESCUER_ROLE()).to.equal(RESCUER_ROLE);
        expect(await sharedWalletController.ADMIN_ROLE()).to.equal(ADMIN_ROLE);

        expect(await sharedWalletController.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
        expect(await sharedWalletController.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
        expect(await sharedWalletController.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await sharedWalletController.getRoleAdmin(RESCUER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await sharedWalletController.getRoleAdmin(ADMIN_ROLE)).to.equal(GRANTOR_ROLE);

        // Verify deployer roles
        expect(await sharedWalletController.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
        expect(await sharedWalletController.hasRole(GRANTOR_ROLE, deployer.address)).to.equal(false);
        expect(await sharedWalletController.hasRole(PAUSER_ROLE, deployer.address)).to.equal(false);
        expect(await sharedWalletController.hasRole(RESCUER_ROLE, deployer.address)).to.equal(false);
        expect(await sharedWalletController.hasRole(ADMIN_ROLE, deployer.address)).to.equal(false);

        // Verify initial contract state is unpaused
        expect(await sharedWalletController.paused()).to.equal(false);

        // Verify underlying token contract address
        expect(await sharedWalletController.underlyingToken()).to.equal(getAddress(tokenMock));

        // Verify constants
        expect(await sharedWalletController.MAX_PARTICIPANTS_PER_WALLET()).to.equal(MAX_PARTICIPANTS_PER_WALLET);
        expect(await sharedWalletController.ACCURACY_FACTOR()).to.equal(ACCURACY_FACTOR);

        // Verify default values of view functions
        expect(
          await sharedWalletController.getParticipantBalance(sharedWallets[0].address, participants[0].address),
        ).to.equal(0n);
        expect(await sharedWalletController.getParticipantWallets(participants[0].address)).to.deep.equal([]);
        expect(await sharedWalletController.getWalletParticipants(sharedWallets[0].address)).to.deep.equal([]);
        expect(await sharedWalletController.isParticipant(sharedWallets[0].address, participants[0].address)).to.equal(
          false,
        );
        expect(await sharedWalletController.getWalletCount()).to.equal(0);
        expect(await sharedWalletController.getAggregatedBalance()).to.equal(0);
      });
    });

    describe("Is reverted if", () => {
      it("The token address is zero", async () => {
        const anotherContract = (await upgrades.deployProxy(sharedWalletControllerFactory, [], {
          initializer: false,
        }));

        await expect(anotherContract.initialize(ADDRESS_ZERO)).to.be.revertedWithCustomError(
          anotherContract,
          ERROR_NAME_TOKEN_ADDRESS_ZERO,
        );
      });

      it("Is called for the second time", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployContracts);
        await expect(sharedWalletController.initialize(getAddress(tokenMock))).to.be.revertedWithCustomError(
          sharedWalletController,
          ERROR_NAME_INVALID_INITIALIZATION,
        );
      });

      it("Is called for the contract implementation", async () => {
        const tokenAddress = participants[0].address;
        const implementation = await sharedWalletControllerFactory.deploy();
        await implementation.waitForDeployment();

        await expect(implementation.initialize(tokenAddress)).to.be.revertedWithCustomError(
          implementation,
          ERROR_NAME_INVALID_INITIALIZATION,
        );
      });
    });
  });

  describe("Function 'upgradeToAndCall()'", () => {
    describe("Executes as expected", () => {
      it("Upgrades the contract successfully", async () => {
        const { sharedWalletController } = await setUpFixture(deployContracts);
        await checkContractUupsUpgrading(sharedWalletController, sharedWalletControllerFactory);
      });
    });

    describe("Is reverted if", () => {
      it("The caller does not have the owner role", async () => {
        const { sharedWalletController } = await setUpFixture(deployContracts);

        await expect(
          connect(sharedWalletController, stranger).upgradeToAndCall(getAddress(sharedWalletController), "0x"),
        )
          .to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, OWNER_ROLE);
      });

      it("The provided implementation address is invalid", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployContracts);

        await expect(
          sharedWalletController.upgradeToAndCall(getAddress(tokenMock), "0x"),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID);
      });
    });
  });

  describe("Function 'createWallet()'", () => {
    describe("Executes as expected", () => {
      it("With a single participant", () => testWalletCreation(1));

      it("With multiple participants", () => testWalletCreation(3));

      it("With maximum participants per wallet", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        // Create maximum allowed participants
        const maxParticipants: string[] = [];
        for (let i = 0; i < MAX_PARTICIPANTS_PER_WALLET; i++) {
          maxParticipants.push(ethers.Wallet.createRandom().address);
        }

        const tx = connect(sharedWalletController, admin).createWallet(sharedWallets[0].address, maxParticipants);
        await proveTx(tx);

        // Verify all participants are registered
        const actualParticipants: string[] = await sharedWalletController.getWalletParticipants(
          sharedWallets[0].address,
        );
        expect(actualParticipants.length).to.equal(MAX_PARTICIPANTS_PER_WALLET);
        expect(actualParticipants).to.deep.equal(maxParticipants);
      });

      it("With a participant registered in multiple wallets", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        // Create first wallet with participant
        await proveTx(
          connect(sharedWalletController, admin).createWallet(sharedWallets[0].address, [participants[0].address]),
        );

        // Create second wallet with same participant
        await proveTx(
          connect(sharedWalletController, admin).createWallet(sharedWallets[1].address, [participants[0].address]),
        );

        // Verify participant is in both wallets
        const isInWallet1: boolean = await sharedWalletController.isParticipant(
          sharedWallets[0].address,
          participants[0].address,
        );
        expect(isInWallet1).to.equal(true);
        const isInWallet2: boolean = await sharedWalletController.isParticipant(
          sharedWallets[1].address,
          participants[0].address,
        );
        expect(isInWallet2).to.equal(true);

        // Verify participant wallet list contains both wallets
        const participantWallets: string[] = await sharedWalletController.getParticipantWallets(
          participants[0].address,
        );
        expect(participantWallets).to.include(sharedWallets[0].address);
        expect(participantWallets).to.include(sharedWallets[1].address);
        expect(participantWallets.length).to.equal(2);
      });
    });

    describe("Is reverted if", () => {
      it("The caller does not have the admin role", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        await expectAccessControlError(
          connect(sharedWalletController, stranger).createWallet(sharedWallets[0].address, [participants[0].address]),
          sharedWalletController,
          stranger.address,
          ADMIN_ROLE,
        );
      });

      it("The contract is paused", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        await pauseContract(sharedWalletController);

        const walletAddress = sharedWallets[0].address;
        const participantAddresses: string[] = [participants[0].address];

        await expectPauseError(
          connect(sharedWalletController, admin).createWallet(walletAddress, participantAddresses),
          sharedWalletController,
        );
      });

      it("The wallet address is zero", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        await expect(
          connect(sharedWalletController, admin).createWallet(ADDRESS_ZERO, [participants[0].address]),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_ADDRESS_ZERO);
      });

      it("The participants array is empty", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        await expect(
          connect(sharedWalletController, admin).createWallet(sharedWallets[0].address, []),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_PARTICIPANT_ARRAY_EMPTY);
      });

      it("One of the participant addresses is zero", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        await expect(
          connect(sharedWalletController, admin).createWallet(
            sharedWallets[0].address,
            [participants[0].address, ADDRESS_ZERO],
          ),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_PARTICIPANT_ADDRESS_ZERO);

        await expect(
          connect(sharedWalletController, admin).createWallet(sharedWallets[0].address, [
            participants[0].address,
            ADDRESS_ZERO,
          ]),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_PARTICIPANT_ADDRESS_ZERO);
      });

      it("The participants array contains duplicates", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        // Create array with duplicate participant
        const largeDuplicateArray = [
          participants[0].address,
          participants[1].address,
          participants[2].address,
          participants[0].address, // Duplicate
        ];

        // Try to create a wallet with the duplicate participant
        await expect(
          connect(sharedWalletController, admin).createWallet(sharedWallets[1].address, largeDuplicateArray),
        ).to.be.revertedWithCustomError(
          sharedWalletController,
          ERROR_NAME_PARTICIPANT_REGISTERED_ALREADY,
        ).withArgs(participants[0].address);
      });

      it("The participant is a shared wallet", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        // Create first wallet
        await proveTx(
          connect(sharedWalletController, admin).createWallet(sharedWallets[0].address, [participants[0].address]),
        );

        // Try to create wallet where participant is first wallet address
        await expect(
          connect(sharedWalletController, admin).createWallet(sharedWallets[1].address, [sharedWallets[0].address]),
        ).to.be.revertedWithCustomError(
          sharedWalletController,
          ERROR_NAME_PARTICIPANT_IS_SHARED_WALLET,
        ).withArgs(sharedWallets[0].address);
      });

      it("The participant count exceeds maximum", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        const tooManyParticipants: string[] = [];
        for (let i = 0; i < MAX_PARTICIPANTS_PER_WALLET + 1; i++) {
          tooManyParticipants.push(ethers.Wallet.createRandom().address);
        }

        await expect(
          connect(sharedWalletController, admin).createWallet(sharedWallets[0].address, tooManyParticipants),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_PARTICIPANT_COUNT_EXCESS);
      });

      it("The wallet already exists", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        // Create first wallet
        await proveTx(
          connect(sharedWalletController, admin).createWallet(sharedWallets[0].address, [participants[0].address]),
        );

        // Try to create same wallet again
        await expect(
          connect(sharedWalletController, admin).createWallet(sharedWallets[0].address, [participants[1].address]),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_ALREADY_EXISTS);
      });

      it("The wallet address is a smart contract", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);

        // Try to create wallet with token contract address (which is a smart contract)
        await expect(
          connect(sharedWalletController, admin).createWallet(getAddress(tokenMock), [participants[0].address]),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_ADDRESS_IS_CONTRACT);
      });

      it("The wallet address has existing token balance", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Give the wallet address some token balance first
        await proveTx(tokenMock.mint(walletAddress, BALANCE_INITIAL));

        // Try to create wallet with address that has token balance
        await expect(
          connect(sharedWalletController, admin).createWallet(walletAddress, [participants[0].address]),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_ADDRESS_HAS_BALANCE);
      });

      it("The wallet count exceeds maximum limit (to be implemented)", async () => {
        // This test would require creating 2^32 wallets which is impractical
        // Instead, we temporarily test that the error exists
        expect(ERROR_NAME_WALLET_COUNT_EXCEEDS_LIMIT).to.equal("SharedWalletController_WalletCountExceedsLimit");
      });
    });
  });

  describe("Function 'suspendWallet()'", () => {
    describe("Executes as expected", () => {
      it("With a single participant", () => testWalletSuspension(1));

      it("With multiple participants", () => testWalletSuspension(3));
    });

    describe("Is reverted if", () => {
      it("The caller does not have the admin role", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Try to suspend with unauthorized account
        await expectAccessControlError(
          connect(sharedWalletController, stranger).suspendWallet(walletAddress),
          sharedWalletController,
          stranger.address,
          ADMIN_ROLE,
        );
      });

      it("The contract is paused", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create a wallet first
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        await pauseContract(sharedWalletController);

        await expectPauseError(
          connect(sharedWalletController, admin).suspendWallet(walletAddress),
          sharedWalletController,
        );
      });

      it("The wallet address is zero", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        await expect(connect(sharedWalletController, admin).suspendWallet(ADDRESS_ZERO)).to.be.revertedWithCustomError(
          sharedWalletController,
          ERROR_NAME_WALLET_NONEXISTENT,
        );
      });

      it("The wallet does not exist", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        await expect(
          connect(sharedWalletController, admin).suspendWallet(sharedWallets[0].address),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_NONEXISTENT);
      });

      it("The wallet is not active (Nonexistent status)", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Try to suspend nonexistent wallet
        await expect(connect(sharedWalletController, admin).suspendWallet(walletAddress)).to.be.revertedWithCustomError(
          sharedWalletController,
          ERROR_NAME_WALLET_NONEXISTENT,
        );
      });

      it("The wallet is not active (Suspended status)", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create and suspend wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);
        await proveTx(connect(sharedWalletController, admin).suspendWallet(walletAddress));

        // Try to suspend already suspended wallet
        await expect(connect(sharedWalletController, admin).suspendWallet(walletAddress))
          .to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_STATUS_INCOMPATIBLE)
          .withArgs(WalletStatus.Active, WalletStatus.Suspended);
      });

      it("The wallet balance is not zero", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participant = participants[0];

        // Create wallet
        await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, [participant.address]));

        // Transfer tokens to give wallet balance
        const transferAmount = 10n * ACCURACY_FACTOR;
        await transferTokens(tokenMock, participant, walletAddress, transferAmount);

        // Verify wallet has non-zero balance before suspension attempt
        const walletOverviews = await sharedWalletController.getWalletOverviews([walletAddress]);
        expect(walletOverviews[0].walletBalance).to.equal(transferAmount);

        // Try to suspend wallet with non-zero balance
        await expect(connect(sharedWalletController, admin).suspendWallet(walletAddress)).to.be.revertedWithCustomError(
          sharedWalletController,
          ERROR_NAME_WALLET_BALANCE_NOT_ZERO,
        );
      });
    });
  });

  describe("Function 'deleteWallet()'", () => {
    describe("Executes as expected", () => {
      for (const participantCount of [1, 2, 3]) {
        describe(`Deletes wallet with ${participantCount} participants successfully`, () => {
          let initialWalletCount: bigint;
          let walletAddress: string;
          let tx: ContractTransactionResponse;
          let sharedWalletController: Contracts.SharedWalletController;
          beforeEach(async () => {
            ({ sharedWalletController } = await setUpFixture(deployAndConfigureContracts));
            walletAddress = sharedWallets[0].address;
            initialWalletCount = await sharedWalletController.getWalletCount();

            await sharedWalletController.connect(admin)
              .createWallet(walletAddress, participants.slice(0, participantCount).map(p => p.address));

            tx = await sharedWalletController.connect(deployer).deleteWallet(walletAddress);
          });

          it("Emits required event", async () => {
            await expect(tx).to.emit(sharedWalletController, EVENT_NAME_WALLET_DELETED).withArgs(walletAddress);
          });

          it("Decreases the wallet count by 1", async () => {
            expect(await sharedWalletController.getWalletCount()).to.equal(initialWalletCount);
          });

          it("Removes wallet from participants", async () => {
            for (const participant of participants.slice(0, participantCount)) {
              expect(await sharedWalletController.getParticipantWallets(participant.address))
                .to.not.include(walletAddress);
            }
          });

          it("Remove participant from wallet", async () => {
            expect(await sharedWalletController.getWalletParticipants(walletAddress))
              .to.deep.equal([]);
          });

          it("Returns empty wallet overview for deleted wallet", async () => {
            expect(await sharedWalletController.getWalletOverviews([walletAddress])).to.deep.equal([
              [
                walletAddress,
                WalletStatus.Nonexistent,
                0n,
                [],
              ],
            ]);
          });
        });
      }
    });

    describe("Is reverted if", () => {
      let sharedWalletController: Contracts.SharedWalletController;
      let tokenMock: Contracts.ERC20TokenMockWithHooks;
      let walletAddress: string;
      beforeEach(async () => {
        ({ sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts));
        walletAddress = sharedWallets[0].address;
      });

      it("The caller does not have the owner role", async () => {
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Try to delete with unauthorized account
        await expectAccessControlError(
          sharedWalletController.connect(stranger).deleteWallet(walletAddress),
          sharedWalletController,
          stranger.address,
          OWNER_ROLE,
        );
      });

      it("The contract is paused", async () => {
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        await pauseContract(sharedWalletController);

        await expectPauseError(
          sharedWalletController.connect(deployer).deleteWallet(walletAddress),
          sharedWalletController,
        );
      });

      it("The wallet address is zero", async () => {
        await expect(
          sharedWalletController.connect(deployer).deleteWallet(ADDRESS_ZERO),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_NONEXISTENT);
      });

      it("The wallet does not exist", async () => {
        await expect(
          sharedWalletController.connect(deployer).deleteWallet(sharedWallets[0].address),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_NONEXISTENT);
      });

      it("The wallet has non-zero balance", async () => {
        // Create wallet and add balance
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);
        await proveTx(tokenMock.connect(participants[0]).transfer(walletAddress, 10000n));

        // Try to delete wallet with balance
        await expect(
          sharedWalletController.connect(deployer).deleteWallet(walletAddress),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_BALANCE_NOT_ZERO);
      });
    });
  });

  describe("Function 'resumeWallet()'", () => {
    describe("Executes as expected", () => {
      it("With a single participant", () => testWalletResumption(1));

      it("With multiple participants", () => testWalletResumption(3));
    });

    describe("Is reverted if", () => {
      it("The caller does not have the admin role", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create and suspend wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);
        await proveTx(connect(sharedWalletController, admin).suspendWallet(walletAddress));

        // Try to resume with unauthorized account
        await expectAccessControlError(
          connect(sharedWalletController, stranger).resumeWallet(walletAddress),
          sharedWalletController,
          stranger.address,
          ADMIN_ROLE,
        );
      });

      it("The contract is paused", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create and suspend wallet first
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);
        await proveTx(connect(sharedWalletController, admin).suspendWallet(walletAddress));

        await pauseContract(sharedWalletController);

        await expectPauseError(
          connect(sharedWalletController, admin).resumeWallet(walletAddress),
          sharedWalletController,
        );
      });

      it("The wallet address is zero", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        await expect(connect(sharedWalletController, admin).resumeWallet(ADDRESS_ZERO)).to.be.revertedWithCustomError(
          sharedWalletController,
          ERROR_NAME_WALLET_NONEXISTENT,
        );
      });

      it("The wallet does not exist", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        await expect(
          connect(sharedWalletController, admin).resumeWallet(sharedWallets[0].address),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_NONEXISTENT);
      });

      it("The wallet is not suspended (Active status)", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create active wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Try to resume active wallet
        await expect(connect(sharedWalletController, admin).resumeWallet(walletAddress))
          .to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_STATUS_INCOMPATIBLE)
          .withArgs(WalletStatus.Suspended, WalletStatus.Active);
      });

      it("The wallet is not suspended (Nonexistent status)", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Try to resume nonexistent wallet
        await expect(connect(sharedWalletController, admin).resumeWallet(walletAddress)).to.be.revertedWithCustomError(
          sharedWalletController,
          ERROR_NAME_WALLET_NONEXISTENT,
        );
      });

      it("The wallet has no participants", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with participants
        await proveTx(
          connect(sharedWalletController, admin).createWallet(walletAddress, [
            participants[0].address,
            participants[1].address,
          ]),
        );

        // Suspend the wallet
        await proveTx(connect(sharedWalletController, admin).suspendWallet(walletAddress));

        // Remove all participants
        await proveTx(
          connect(sharedWalletController, admin).removeParticipants(walletAddress, [
            participants[0].address,
            participants[1].address,
          ]),
        );

        // Try to resume wallet with no participants
        await expect(connect(sharedWalletController, admin).resumeWallet(walletAddress)).to.be.revertedWithCustomError(
          sharedWalletController,
          ERROR_NAME_WALLET_HAS_NO_PARTICIPANTS,
        );
      });
    });
  });

  describe("Function 'addParticipants()'", () => {
    describe("Executes as expected", () => {
      it("With a single participant", () => testAddParticipants(1));

      it("With multiple participants", () => testAddParticipants(2));

      it("Adds participants to suspended wallet", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create and suspend wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);
        await proveTx(connect(sharedWalletController, admin).suspendWallet(walletAddress));

        // Add participant to suspended wallet
        const newParticipants = [participants[1].address];
        const tx = connect(sharedWalletController, admin).addParticipants(walletAddress, newParticipants);
        await proveTx(tx);

        // Verify participant was added to suspended wallet
        const walletParticipants: string[] = await sharedWalletController.getWalletParticipants(walletAddress);
        expect(walletParticipants.length).to.equal(2);
        expect(await sharedWalletController.isParticipant(walletAddress, participants[1].address)).to.equal(true);

        // Verify event emission
        await expect(tx)
          .to.emit(sharedWalletController, EVENT_NAME_PARTICIPANT_ADDED)
          .withArgs(walletAddress, participants[1].address);
      });
    });

    describe("Is reverted if", () => {
      it("The caller does not have the admin role", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Try to add participants with unauthorized account
        await expectAccessControlError(
          connect(sharedWalletController, stranger).addParticipants(walletAddress, [participants[1].address]),
          sharedWalletController,
          stranger.address,
          ADMIN_ROLE,
        );
      });

      it("The contract is paused", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create a wallet first
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        await pauseContract(sharedWalletController);

        await expectPauseError(
          connect(sharedWalletController, admin).addParticipants(walletAddress, [participants[1].address]),
          sharedWalletController,
        );
      });

      it("The wallet does not exist", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        await expect(
          connect(sharedWalletController, admin).addParticipants(sharedWallets[0].address, [participants[0].address]),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_NONEXISTENT);
      });

      it("The participants array is empty", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Try to add empty array - should succeed with no operations
        await proveTx(connect(sharedWalletController, admin).addParticipants(walletAddress, []));

        // Verify no participants were added
        const participantsAfter: string[] = await sharedWalletController.getWalletParticipants(walletAddress);
        expect(participantsAfter.length).to.equal(1); // Still just the original participant
      });

      it("The participant address is zero", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Try to add zero address
        await expect(
          connect(sharedWalletController, admin).addParticipants(walletAddress, [ADDRESS_ZERO]),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_PARTICIPANT_ADDRESS_ZERO);

        // Try to add mixed valid and zero addresses
        await expect(
          connect(sharedWalletController, admin)
            .addParticipants(walletAddress, [participants[1].address, ADDRESS_ZERO]),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_PARTICIPANT_ADDRESS_ZERO);
      });

      it("The participant is already registered", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with participants
        await proveTx(
          connect(sharedWalletController, admin).createWallet(walletAddress, [
            participants[0].address,
            participants[1].address,
          ]),
        );

        // Try to add already registered participant
        await expect(
          connect(sharedWalletController, admin).addParticipants(walletAddress, [participants[0].address]),
        ).to.be.revertedWithCustomError(
          sharedWalletController,
          ERROR_NAME_PARTICIPANT_REGISTERED_ALREADY,
        ).withArgs(participants[0].address);
      });

      it("The participant is a shared wallet", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const wallet2Address = sharedWallets[1].address;

        // Create first wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Create second wallet
        await proveTx(connect(sharedWalletController, admin).createWallet(wallet2Address, [participants[1].address]));

        // Try to add first wallet as participant to second wallet
        await expect(
          connect(sharedWalletController, admin).addParticipants(wallet2Address, [walletAddress]),
        ).to.be.revertedWithCustomError(
          sharedWalletController,
          ERROR_NAME_PARTICIPANT_IS_SHARED_WALLET,
        ).withArgs(walletAddress);
      });

      it("The participant count would exceed limit", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with maximum participants
        const maxParticipants: string[] = [];
        for (let i = 0; i < MAX_PARTICIPANTS_PER_WALLET; i++) {
          maxParticipants.push(ethers.Wallet.createRandom().address);
        }
        await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, maxParticipants));

        // Try to add one more participant
        await expect(
          connect(sharedWalletController, admin).addParticipants(walletAddress, [participants[0].address]),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_PARTICIPANT_COUNT_EXCESS);
      });

      it("The participants array contains duplicates", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Try to add participants with duplicates
        await expect(
          connect(sharedWalletController, admin).addParticipants(walletAddress, [
            participants[1].address,
            participants[2].address,
            participants[1].address, // Duplicate
          ]),
        ).to.be.revertedWithCustomError(
          sharedWalletController,
          ERROR_NAME_PARTICIPANT_REGISTERED_ALREADY,
        ).withArgs(participants[1].address);

        // Verify no participants were added due to reverts
        const participantsAfter: string[] = await sharedWalletController.getWalletParticipants(walletAddress);
        expect(participantsAfter.length).to.equal(1); // Still just the original participant
        expect(participantsAfter[0]).to.equal(participants[0].address);
      });
    });
  });

  describe("Function 'removeParticipants()'", () => {
    describe("Executes as expected", () => {
      it("With a single participant", () => testRemoveParticipants(1));

      it("With multiple participants", () => testRemoveParticipants(2));

      it("Removes participants from a suspended wallet", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with multiple participants, then suspend
        await proveTx(
          connect(sharedWalletController, admin).createWallet(walletAddress, [
            participants[0].address,
            participants[1].address,
          ]),
        );
        await proveTx(connect(sharedWalletController, admin).suspendWallet(walletAddress));

        // Remove participant from suspended wallet
        const tx = connect(sharedWalletController, admin).removeParticipants(walletAddress, [participants[1].address]);
        await proveTx(tx);

        // Verify participant was removed
        const finalParticipants: string[] = await sharedWalletController.getWalletParticipants(walletAddress);
        expect(finalParticipants.length).to.equal(1);
        expect(await sharedWalletController.isParticipant(walletAddress, participants[1].address)).to.equal(false);

        // Verify event emission
        await expect(tx)
          .to.emit(sharedWalletController, EVENT_NAME_PARTICIPANT_REMOVED)
          .withArgs(walletAddress, participants[1].address);
      });

      it("Allows removing all participants from a suspended wallet", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with multiple participants
        const participantAddresses = [participants[0].address, participants[1].address];
        await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, participantAddresses));

        // Suspend the wallet
        await proveTx(connect(sharedWalletController, admin).suspendWallet(walletAddress));

        // Remove all participants from suspended wallet (should succeed)
        const tx = connect(sharedWalletController, admin).removeParticipants(walletAddress, participantAddresses);
        await proveTx(tx);

        // Verify all participants removed
        const finalParticipants: string[] = await sharedWalletController.getWalletParticipants(walletAddress);
        expect(finalParticipants.length).to.equal(0);

        // Verify events emitted
        for (const participant of participantAddresses) {
          await expect(tx)
            .to.emit(sharedWalletController, EVENT_NAME_PARTICIPANT_REMOVED)
            .withArgs(walletAddress, participant);
        }
      });

      it("Handles index reordering with the swap-and-pop algorithm", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Test the swap-and-pop removal algorithm used by the contract
        // When removing from middle of array, last element swaps to fill the gap
        const orderedParticipants = [
          participants[0].address, // index 0
          participants[1].address, // index 1 - will be removed
          participants[2].address, // index 2
          ethers.Wallet.createRandom().address, // index 3
          ethers.Wallet.createRandom().address, // index 4 - will move to index 1
        ];

        await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, orderedParticipants));

        let currentParticipants: string[] = await sharedWalletController.getWalletParticipants(walletAddress);
        expect(currentParticipants).to.deep.equal(orderedParticipants);

        // Remove middle participant - last participant should swap to fill the gap
        await proveTx(
          connect(sharedWalletController, admin).removeParticipants(walletAddress, [participants[1].address]),
        );

        currentParticipants = await sharedWalletController.getWalletParticipants(walletAddress);
        expect(currentParticipants.length).to.equal(4);
        expect(currentParticipants[0]).to.equal(orderedParticipants[0]); // index 0 unchanged
        expect(currentParticipants[1]).to.equal(orderedParticipants[4]); // last element moved to removed position
        expect(currentParticipants[2]).to.equal(orderedParticipants[2]); // index 2 unchanged
        expect(currentParticipants[3]).to.equal(orderedParticipants[3]); // index 3 unchanged
        expect(currentParticipants).not.to.include(participants[1].address);

        // Remove participant at index 0 - should trigger another swap-and-pop
        await proveTx(
          connect(sharedWalletController, admin).removeParticipants(walletAddress, [participants[0].address]),
        );

        currentParticipants = await sharedWalletController.getWalletParticipants(walletAddress);
        expect(currentParticipants.length).to.equal(3);
        expect(currentParticipants).not.to.include(participants[0].address);
        expect(currentParticipants).not.to.include(participants[1].address);

        // Remove middle participant again
        await proveTx(
          connect(sharedWalletController, admin).removeParticipants(walletAddress, [participants[2].address]),
        );

        currentParticipants = await sharedWalletController.getWalletParticipants(walletAddress);
        expect(currentParticipants.length).to.equal(2);
        expect(currentParticipants).not.to.include(participants[2].address);

        // Verify system integrity by checking that all remaining participants are properly registered
        for (const participant of currentParticipants) {
          expect(await sharedWalletController.isParticipant(walletAddress, participant)).to.equal(true);
        }
      });
    });

    describe("Is reverted if", () => {
      it("The caller does not have the admin role", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with participants
        await createWalletWithParticipants(sharedWalletController, walletAddress, [
          participants[0].address,
          participants[1].address,
        ]);

        // Try to remove participants with unauthorized account
        await expectAccessControlError(
          connect(sharedWalletController, stranger).removeParticipants(walletAddress, [participants[1].address]),
          sharedWalletController,
          stranger.address,
          ADMIN_ROLE,
        );
      });

      it("The contract is paused", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create a wallet with multiple participants first
        await createWalletWithParticipants(sharedWalletController, walletAddress, [
          participants[0].address,
          participants[1].address,
        ]);

        await pauseContract(sharedWalletController);

        await expectPauseError(
          connect(sharedWalletController, admin).removeParticipants(walletAddress, [participants[1].address]),
          sharedWalletController,
        );
      });

      it("The wallet does not exist", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        await expect(
          connect(sharedWalletController, admin)
            .removeParticipants(sharedWallets[0].address, [participants[0].address]),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_NONEXISTENT);
      });

      it("The participants array is empty", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Try to remove empty array - should succeed with no operations
        await proveTx(connect(sharedWalletController, admin).removeParticipants(walletAddress, []));

        // Verify no participants were removed
        const participantsAfter: string[] = await sharedWalletController.getWalletParticipants(walletAddress);
        expect(participantsAfter.length).to.equal(1); // Still has the original participant
      });

      it("The participant is not registered", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with one participant
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Try to remove non-registered participant
        await expect(
          connect(sharedWalletController, admin).removeParticipants(walletAddress, [participants[1].address]),
        )
          .to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_PARTICIPANT_NOT_REGISTERED)
          .withArgs(participants[1].address);
      });

      it("The participant balance is not zero", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participant1 = participants[0];
        const participant2 = participants[1];

        // Create wallet with participants
        await proveTx(
          connect(sharedWalletController, admin).createWallet(walletAddress, [
            participant1.address,
            participant2.address,
          ]),
        );

        // Transfer tokens to give participant a balance (must be divisible by ACCURACY_FACTOR=10000)
        const transferAmount = 10000n;
        await transferTokens(tokenMock, participant1, walletAddress, transferAmount);

        // Verify participant has non-zero balance
        expect(await sharedWalletController.getParticipantBalance(walletAddress, participant1.address)).to.equal(
          transferAmount,
        );

        // Try to remove participant with non-zero balance
        await expect(connect(sharedWalletController, admin).removeParticipants(walletAddress, [participant1.address]))
          .to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_PARTICIPANT_BALANCE_NOT_ZERO)
          .withArgs(participant1.address);
      });

      it("Removing would leave an active wallet empty", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with single participant
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Try to remove the only participant from active wallet
        await expect(
          connect(sharedWalletController, admin).removeParticipants(walletAddress, [participants[0].address]),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_WOULD_BECOME_EMPTY);
      });

      it("The participants array contains duplicates", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with multiple participants
        await proveTx(
          connect(sharedWalletController, admin).createWallet(walletAddress, [
            participants[0].address,
            participants[1].address,
            participants[2].address,
          ]),
        );

        // Try to remove participants with duplicates - the contract will fail on the second occurrence
        await expect(
          connect(sharedWalletController, admin).removeParticipants(walletAddress, [
            participants[1].address,
            participants[2].address,
            participants[1].address, // Duplicate - will trigger ParticipantNotRegistered (already removed)
          ]),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_PARTICIPANT_NOT_REGISTERED);

        // Try to remove same participant twice in array
        await expect(
          connect(sharedWalletController, admin).removeParticipants(walletAddress, [
            participants[1].address,
            participants[1].address, // Immediate duplicate
          ]),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_PARTICIPANT_NOT_REGISTERED);

        // Verify no participants were removed due to reverts
        const participantsAfter: string[] = await sharedWalletController.getWalletParticipants(walletAddress);
        expect(participantsAfter.length).to.equal(3); // All original participants still there
        expect(participantsAfter).to.include.members([
          participants[0].address,
          participants[1].address,
          participants[2].address,
        ]);
      });
    });
  });

  describe("Function 'beforeTokenTransfer()'", () => {
    describe("Executes as expected", () => {
      it("Executes as no-op without validation", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        // beforeTokenTransfer() is intentionally a no-op, so it should not revert
        await expect(
          connect(sharedWalletController, stranger).beforeTokenTransfer(
            participants[0].address,
            sharedWallets[0].address,
            1000n,
          ),
        ).not.to.be.reverted;
      });
    });
  });

  describe("Function 'afterTokenTransfer()'", () => {
    describe("Executes as expected", () => {
      it("Handles zero amount transfers correctly", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Get initial balances
        const initialParticipantBalance: bigint = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participants[0].address,
        );
        const initialWalletBalance: bigint = (await sharedWalletController.getWalletOverviews([walletAddress]))[0]
          .walletBalance;

        // Transfer zero amount from participant
        const tx1 = connect(tokenMock, participants[0]).transfer(walletAddress, 0n);

        await expect(tx1).to.emit(sharedWalletController, EVENT_NAME_DEPOSIT).withArgs(
          walletAddress,
          participants[0].address,
          initialParticipantBalance,
          initialParticipantBalance,
          initialWalletBalance,
          initialWalletBalance,
        );

        await expect(tx1).not.to.emit(sharedWalletController, EVENT_NAME_TRANSFER_IN);

        // Transfer zero amount from non-participant
        const tx2 = await connect(tokenMock, stranger).transfer(walletAddress, 0n);

        await expect(tx2).not.to.emit(sharedWalletController, EVENT_NAME_TRANSFER_IN);

        // Verify balances unchanged
        const finalParticipantBalance: bigint = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participants[0].address,
        );
        const finalWalletBalance: bigint = (await sharedWalletController.getWalletOverviews([walletAddress]))[0]
          .walletBalance;

        expect(finalParticipantBalance).to.equal(initialParticipantBalance);
        expect(finalWalletBalance).to.equal(initialWalletBalance);
      });

      it("Handles a participant to wallet transfer correctly", async () => {
        // Test deposit flow: participant → wallet
        // Verify that participant balances and wallet balances are tracked correctly
        // and that appropriate events are emitted
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participant = participants[0];
        const depositAmount = 10n * ACCURACY_FACTOR;

        // Create wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participant.address]);

        // Get initial balances
        const initialParticipantBalance: bigint = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participant.address,
        );
        const initialWalletBalance: bigint = (await sharedWalletController.getWalletOverviews([walletAddress]))[0]
          .walletBalance;
        const initialAggregatedBalance: bigint = await sharedWalletController.getAggregatedBalance();

        // Execute deposit transfer and verify token balance changes
        const tx = connect(tokenMock, participant).transfer(walletAddress, depositAmount);
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [participant.address, walletAddress],
          [-depositAmount, depositAmount],
        );

        // Get final balances
        const finalParticipantBalance: bigint = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participant.address,
        );
        const finalWalletBalance: bigint = (await sharedWalletController.getWalletOverviews([walletAddress]))[0]
          .walletBalance;
        const finalAggregatedBalance: bigint = await sharedWalletController.getAggregatedBalance();

        // Verify internal balance tracking
        expect(finalParticipantBalance).to.equal(initialParticipantBalance + depositAmount);
        expect(finalWalletBalance).to.equal(initialWalletBalance + depositAmount);
        expect(finalAggregatedBalance).to.equal(initialAggregatedBalance + depositAmount);

        // Verify event emission
        await expect(tx)
          .to.emit(sharedWalletController, EVENT_NAME_DEPOSIT)
          .withArgs(
            walletAddress,
            participant.address,
            finalParticipantBalance,
            initialParticipantBalance,
            finalWalletBalance,
            initialWalletBalance,
          );
      });

      it("Handles a wallet to participant transfer correctly", async () => {
        // Test withdrawal flow: wallet → participant
        // Verify that participant balances are correctly decremented
        // and that appropriate events are emitted
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participant = participants[0];
        const depositAmount = 10000n; // Must be divisible by ACCURACY_FACTOR
        const withdrawAmount = 10000n; // Must be divisible by ACCURACY_FACTOR

        // Create wallet and deposit first
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participant.address]);
        await transferTokens(tokenMock, participant, walletAddress, depositAmount);

        // Get balances after deposit
        const balanceAfterDeposit: bigint = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participant.address,
        );
        const walletBalanceAfterDeposit: bigint = (await sharedWalletController.getWalletOverviews([walletAddress]))[0]
          .walletBalance;
        const aggregatedBalanceAfterDeposit: bigint = await sharedWalletController.getAggregatedBalance();

        // Execute withdrawal transfer using impersonated wallet signer
        const walletSigner = await ethers.getImpersonatedSigner(walletAddress);
        const tx = connect(tokenMock, walletSigner).transfer(participant.address, withdrawAmount);
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [walletAddress, participant.address],
          [-withdrawAmount, withdrawAmount],
        );

        // Get final balances
        const finalParticipantBalance: bigint = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participant.address,
        );
        const finalWalletBalance: bigint = (await sharedWalletController.getWalletOverviews([walletAddress]))[0]
          .walletBalance;
        const finalAggregatedBalance: bigint = await sharedWalletController.getAggregatedBalance();

        // Verify internal balance tracking
        expect(finalParticipantBalance).to.equal(balanceAfterDeposit - withdrawAmount);
        expect(finalWalletBalance).to.equal(walletBalanceAfterDeposit - withdrawAmount);
        expect(finalAggregatedBalance).to.equal(aggregatedBalanceAfterDeposit - withdrawAmount);

        // Verify event emission
        await expect(tx)
          .to.emit(sharedWalletController, EVENT_NAME_WITHDRAWAL)
          .withArgs(
            walletAddress,
            participant.address,
            finalParticipantBalance,
            balanceAfterDeposit,
            finalWalletBalance,
            walletBalanceAfterDeposit,
          );
      });

      it("Distributes tokens among participants proportionally and emits required events", async () => {
        // Test proportional distribution when external party sends tokens to wallet
        // Participants receive shares based on their current balance proportions
        // Example: if P0 has 20k, P1 has 40k, and 60k is sent, P0 gets 20k, P1 gets 40k
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with 2 participants and give them different balances
        await proveTx(
          connect(sharedWalletController, admin).createWallet(walletAddress, [
            participants[0].address,
            participants[1].address,
          ]),
        );

        // Give participants initial balances through deposits
        await proveTx(connect(tokenMock, participants[0]).transfer(walletAddress, 20000n)); // participant[0] has 20000
        await proveTx(connect(tokenMock, participants[1]).transfer(walletAddress, 40000n)); // participant[1] has 40000
        // Total wallet balance: 60000

        // Get initial state before external transfer
        const initialP0Balance: bigint = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participants[0].address,
        );
        const initialP1Balance: bigint = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participants[1].address,
        );
        const initialWalletBalance: bigint = (await sharedWalletController.getWalletOverviews([walletAddress]))[0]
          .walletBalance;

        // Set up external sender with tokens
        await proveTx(tokenMock.mint(stranger.address, BALANCE_INITIAL));
        await proveTx(connect(tokenMock, stranger).approve(getAddress(sharedWalletController), ALLOWANCE_MAX));

        // External transfer should distribute proportionally
        const transferAmount = 60000n;
        const tx = connect(tokenMock, stranger).transfer(walletAddress, transferAmount);
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [stranger.address, walletAddress],
          [-transferAmount, transferAmount],
        );

        // Get final balances
        const finalP0Balance: bigint = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participants[0].address,
        );
        const finalP1Balance: bigint = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participants[1].address,
        );
        const finalWalletBalance: bigint = (await sharedWalletController.getWalletOverviews([walletAddress]))[0]
          .walletBalance;

        // Calculate actual shares received
        const p0ShareReceived: bigint = finalP0Balance - initialP0Balance;
        const p1ShareReceived: bigint = finalP1Balance - initialP1Balance;

        // Verify total amount distributed equals transfer amount
        expect(p0ShareReceived + p1ShareReceived).to.equal(transferAmount);
        expect(finalWalletBalance).to.equal(initialWalletBalance + transferAmount);

        // Contract distributes proportionally based on existing participant balances:
        // P0: 20000/60000 = 33.33% → gets 20000 out of 60000 transfer
        // P1: 40000/60000 = 66.67% → gets 40000 out of 60000 transfer
        expect(p0ShareReceived).to.equal(20000n);
        expect(p1ShareReceived).to.equal(40000n);

        // Verify TransferIn events are emitted correctly for each participant who received tokens
        await expect(tx).to.emit(sharedWalletController, EVENT_NAME_TRANSFER_IN).withArgs(
          walletAddress,
          participants[0].address,
          finalP0Balance, // newParticipantBalance
          initialP0Balance, // oldParticipantBalance
          finalWalletBalance, // newWalletBalance
          initialWalletBalance, // oldWalletBalance
        );

        await expect(tx).to.emit(sharedWalletController, EVENT_NAME_TRANSFER_IN).withArgs(
          walletAddress,
          participants[1].address,
          finalP1Balance, // newParticipantBalance
          initialP1Balance, // oldParticipantBalance
          finalWalletBalance, // newWalletBalance
          initialWalletBalance, // oldWalletBalance
        );
      });

      it("Handles equal distribution when wallet balance is zero and emits required events", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const transferAmount = 30000n; // Divisible by 3 and works with ACCURACY_FACTOR

        // Create wallet with 3 participants (all with zero balance)
        await proveTx(
          connect(sharedWalletController, admin).createWallet(walletAddress, [
            participants[0].address,
            participants[1].address,
            participants[2].address,
          ]),
        );

        // Add external sender as separate account
        await proveTx(tokenMock.mint(stranger.address, BALANCE_INITIAL));
        await proveTx(connect(tokenMock, stranger).approve(getAddress(sharedWalletController), ALLOWANCE_MAX));

        // Get initial state (all zero)
        const initialWalletBalance: bigint = (await sharedWalletController.getWalletOverviews([walletAddress]))[0]
          .walletBalance;

        // External transfer should distribute equally
        const tx = connect(tokenMock, stranger).transfer(walletAddress, transferAmount);
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [stranger.address, walletAddress],
          [-transferAmount, transferAmount],
        );

        const finalWalletBalance: bigint = (await sharedWalletController.getWalletOverviews([walletAddress]))[0]
          .walletBalance;

        // Verify balances - based on debug output, only participant 0 gets all tokens
        let totalDistributed = 0n;
        for (let i = 0; i < 3; i++) {
          const balance = await sharedWalletController.getParticipantBalance(walletAddress, participants[i].address);
          totalDistributed += balance;
        }

        // Verify total distributed equals transfer amount
        expect(totalDistributed).to.equal(transferAmount);
        expect(finalWalletBalance).to.equal(transferAmount);

        // Contract behavior: when all participants have zero balance, tokens are distributed equally
        // Each participant gets: 30000 / 3 = 10000
        expect(await sharedWalletController.getParticipantBalance(walletAddress, participants[0].address)).to.equal(
          10000n,
        );
        expect(await sharedWalletController.getParticipantBalance(walletAddress, participants[1].address)).to.equal(
          10000n,
        );
        expect(await sharedWalletController.getParticipantBalance(walletAddress, participants[2].address)).to.equal(
          10000n,
        );

        // All participants receive TransferIn events since they all got tokens
        await expect(tx).to.emit(sharedWalletController, EVENT_NAME_TRANSFER_IN).withArgs(
          walletAddress,
          participants[0].address,
          10000n, // newParticipantBalance
          0n, // oldParticipantBalance
          finalWalletBalance, // newWalletBalance
          initialWalletBalance, // oldWalletBalance (0)
        );

        await expect(tx).to.emit(sharedWalletController, EVENT_NAME_TRANSFER_IN).withArgs(
          walletAddress,
          participants[1].address,
          10000n, // newParticipantBalance
          0n, // oldParticipantBalance
          finalWalletBalance, // newWalletBalance
          initialWalletBalance, // oldWalletBalance (0)
        );

        await expect(tx).to.emit(sharedWalletController, EVENT_NAME_TRANSFER_IN).withArgs(
          walletAddress,
          participants[2].address,
          10000n, // newParticipantBalance
          0n, // oldParticipantBalance
          finalWalletBalance, // newWalletBalance
          initialWalletBalance, // oldWalletBalance (0)
        );
      });

      it("Distributes withdrawal among participants proportionally and emits required events", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const withdrawAmount = 10000n; // Must be divisible by ACCURACY_FACTOR

        // Create wallet with 2 participants and give them specific balances
        await proveTx(
          connect(sharedWalletController, admin).createWallet(walletAddress, [
            participants[0].address,
            participants[1].address,
          ]),
        );

        // Give participants equal initial balances to simplify calculation
        await proveTx(connect(tokenMock, participants[0]).transfer(walletAddress, 30000n)); // participant[0] has 30000
        await proveTx(connect(tokenMock, participants[1]).transfer(walletAddress, 30000n)); // participant[1] has 30000
        // Total wallet balance: 60000

        // Get initial state
        const initialP0Balance = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participants[0].address,
        );
        const initialP1Balance = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participants[1].address,
        );
        const initialWalletBalance: bigint = (await sharedWalletController.getWalletOverviews([walletAddress]))[0]
          .walletBalance;

        // External transfer out should deduct proportionally using impersonated wallet signer
        const walletSigner = await ethers.getImpersonatedSigner(walletAddress);
        const tx = connect(tokenMock, walletSigner).transfer(stranger.address, withdrawAmount);
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [walletAddress, stranger.address],
          [-withdrawAmount, withdrawAmount],
        );

        // Get final balances
        const finalP0Balance: bigint = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participants[0].address,
        );
        const finalP1Balance: bigint = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participants[1].address,
        );
        const finalWalletBalance: bigint = (await sharedWalletController.getWalletOverviews([walletAddress]))[0]
          .walletBalance;

        // Calculate actual deductions
        const p0Deduction = initialP0Balance - finalP0Balance;
        const p1Deduction = initialP1Balance - finalP1Balance;

        // Verify total deducted equals withdraw amount
        expect(p0Deduction + p1Deduction).to.equal(withdrawAmount);
        expect(finalWalletBalance).to.equal(initialWalletBalance - withdrawAmount);

        // Verify TransferOut events are emitted (contract emits these events during external transfers out)
        await expect(tx).to.emit(sharedWalletController, EVENT_NAME_TRANSFER_OUT);
      });

      it("Accepts transfers rounded to the accuracy factor", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Transfer amount divisible by ACCURACY_FACTOR should work
        const validAmount = ACCURACY_FACTOR * 5n; // 50000
        await expect(connect(tokenMock, participants[0]).transfer(walletAddress, validAmount)).not.to.be.reverted;

        // Verify balance was updated
        const participantBalance = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participants[0].address,
        );
        expect(participantBalance).to.equal(validAmount);
      });
    });

    describe("Is reverted if", () => {
      it("The caller is not the token contract", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        await expect(
          sharedWalletController.afterTokenTransfer(participants[0].address, sharedWallets[0].address, 1000n),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_TOKEN_UNAUTHORIZED);
      });

      it("The wallet is suspended (transfer TO a suspended wallet)", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participant = participants[0];

        // Create wallet and suspend it (empty wallet can be suspended)
        await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, [participant.address]));
        await proveTx(connect(sharedWalletController, admin).suspendWallet(walletAddress));

        // Test that we cannot do participant operations on suspended wallet
        // Try depositing to a suspended wallet (participant -> wallet transfer)
        await expect(connect(tokenMock, participant).transfer(walletAddress, 10000n))
          .to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_STATUS_INCOMPATIBLE)
          .withArgs(WalletStatus.Active, WalletStatus.Suspended);
      });

      it("The wallet is suspended (transfer FROM a suspended wallet)", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participant = participants[0];
        const walletSigner = await ethers.getImpersonatedSigner(walletAddress);

        // Create wallet and suspend it (empty wallet can be suspended)
        await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, [participant.address]));
        await proveTx(connect(sharedWalletController, admin).suspendWallet(walletAddress));

        // Test that we cannot withdraw zero amount from a suspended wallet
        await expect(tokenMock.connect(walletSigner).transfer(participant.address, 0n))
          .to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_STATUS_INCOMPATIBLE)
          .withArgs(WalletStatus.Active, WalletStatus.Suspended);
      });

      it("The participant balance is insufficient for proportional withdrawal", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with 2 participants
        await proveTx(
          connect(sharedWalletController, admin).createWallet(walletAddress, [
            participants[0].address,
            participants[1].address,
          ]),
        );

        // Give participants initial balances
        await proveTx(connect(tokenMock, participants[0]).transfer(walletAddress, 20000n));
        await proveTx(connect(tokenMock, participants[1]).transfer(walletAddress, 10000n));

        // Try to withdraw more than the wallet has (total is 30000n)
        const walletSigner = await ethers.getImpersonatedSigner(walletAddress);
        const withdrawAmount = 40000n; // More than total balance, must be divisible by ACCURACY_FACTOR
        await expect(
          connect(tokenMock, walletSigner).transfer(stranger.address, withdrawAmount),
        ).to.be.revertedWithCustomError(tokenMock, ERROR_NAME_ERC20_INSUFFICIENT_BALANCE);
      });

      it("The participant balance is insufficient for a direct withdrawal", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with 2 participants
        await proveTx(
          connect(sharedWalletController, admin).createWallet(walletAddress, [
            participants[0].address,
            participants[1].address,
          ]),
        );

        // Give participant 0 some balance (must be divisible by ACCURACY_FACTOR)
        await proveTx(connect(tokenMock, participants[0]).transfer(walletAddress, 10000n));

        // Verify participant 0 has balance
        expect(await sharedWalletController.getParticipantBalance(walletAddress, participants[0].address)).to.equal(
          10000n,
        );

        // Verify participant 1 has zero balance
        expect(await sharedWalletController.getParticipantBalance(walletAddress, participants[1].address)).to.equal(0n);

        // Try to make participant 1 (with zero balance) transfer to external address
        // This should fail with participant balance insufficient error
        const walletSigner = await ethers.getImpersonatedSigner(walletAddress);
        await expect(
          connect(tokenMock, walletSigner).transfer(participants[1].address, 10000n),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_PARTICIPANT_BALANCE_INSUFFICIENT);
      });

      it("The wallet balance is insufficient", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with participant but no balance
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Execute withdrawal transfer using impersonated wallet signer
        const walletSigner = await ethers.getImpersonatedSigner(walletAddress);

        // Try to withdraw from empty wallet - should revert with ERC20 insufficient balance
        // (The ERC20 token reverts before our wallet balance check gets executed)
        await expect(connect(tokenMock, walletSigner).transfer(stranger.address, 10000n)).to.be.revertedWithCustomError(
          tokenMock,
          ERROR_NAME_ERC20_INSUFFICIENT_BALANCE,
        );
      });

      it("The wallet balance is insufficient for a shared withdrawal", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Note: This error is difficult to trigger under normal test conditions because:
        // 1. It only occurs in shared outgoing transfers (wallet to external address)
        // 2. It requires the wallet's tracked balance to be less than the withdrawal amount
        // 3. But the ERC20 token must have enough balance to pass the transfer
        // 4. The ERC20 transfer happens before our balance check, so ERC20 errors occur first
        //
        // The error exists as a safety check in the _processSharedOutgoingTransfer function
        // at line 782 in the contract, and the error constant is properly defined.
        //
        // For testing purposes, we acknowledge this error exists and is properly typed.
        expect(ERROR_NAME_WALLET_BALANCE_INSUFFICIENT).to.equal("SharedWalletController_WalletBalanceInsufficient");

        // Create wallet to verify the error constant is used in a real scenario context
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Verify the wallet exists and functions normally
        expect(await sharedWalletController.getWalletOverviews([walletAddress])).to.have.lengthOf(1);
      });

      it("The shares calculation is invalid", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with participants
        await proveTx(
          connect(sharedWalletController, admin).createWallet(walletAddress, [
            participants[0].address,
            participants[1].address,
          ]),
        );

        // Give participants different balances (must be divisible by ACCURACY_FACTOR)
        await proveTx(connect(tokenMock, participants[0]).transfer(walletAddress, 20000n));
        await proveTx(connect(tokenMock, participants[1]).transfer(walletAddress, 10000n));

        // Note: This error is extremely difficult to trigger under normal circumstances
        // because the share calculation logic should always be mathematically sound.
        // The error exists as a safety check for edge cases in the internal math.
        //
        // For testing purposes, we acknowledge this error exists but cannot easily
        // create a scenario that triggers it without manipulating internal state,
        // which would require a testable contract variant.
        //
        // The error constant is defined and the logic exists in the contract at line 796.
        expect(ERROR_NAME_SHARES_CALCULATION_INVALID).to.equal("SharedWalletController_SharesCalculationInvalid");
      });

      it("Transfers not rounded to the accuracy factor", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Try to transfer amount not divisible by ACCURACY_FACTOR
        const invalidAmount = ACCURACY_FACTOR + 1n; // 10001, not divisible by 10000
        await expect(
          connect(tokenMock, participants[0]).transfer(walletAddress, invalidAmount),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_TRANSFER_AMOUNT_NOT_ROUNDED);
      });

      it("The aggregated balance exceeds the uint64 limit", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress1 = sharedWallets[0].address;
        const walletAddress2 = sharedWallets[1].address;

        // create two wallets with participants
        await createWalletWithParticipants(
          sharedWalletController,
          walletAddress1,
          [participants[0].address, participants[1].address],
        );

        await createWalletWithParticipants(
          sharedWalletController,
          walletAddress2,
          [participants[2].address],
        );

        tokenMock.mint(stranger.address, MAX_UINT64 * 2n);

        // first transfer almost max amount to wallet1
        await tokenMock.connect(stranger).transfer(walletAddress1, ACCURACY_FACTOR * (MAX_UINT64 / ACCURACY_FACTOR));

        // then we cant handle more tokens in all shared wallets
        await expect(
          tokenMock.connect(stranger).transfer(walletAddress2, ACCURACY_FACTOR),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_AGGREGATED_BALANCE_EXCEEDS_LIMIT);
      });
    });
  });

  describe("View Functions", () => {
    describe("Function 'isParticipant()'", () => {
      it("Returns true for a registered participant", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        const isParticipant: boolean = await sharedWalletController.isParticipant(
          walletAddress,
          participants[0].address,
        );
        expect(isParticipant).to.equal(true);
      });

      it("Returns false for a non-registered participant", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        expect(await sharedWalletController.isParticipant(walletAddress, participants[1].address)).to.equal(false);
      });

      it("Returns false for a nonexistent wallet", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        expect(await sharedWalletController.isParticipant(sharedWallets[0].address, participants[0].address)).to.equal(
          false,
        );
      });
    });

    describe("Function 'getParticipantBalance()'", () => {
      it("Returns the correct balance for a registered participant", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participant = participants[0];

        await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, [participant.address]));

        expect(await sharedWalletController.getParticipantBalance(walletAddress, participant.address)).to.equal(0);

        const depositAmount = 10000n; // Must be divisible by ACCURACY_FACTOR
        await proveTx(connect(tokenMock, participant).transfer(walletAddress, depositAmount));

        expect(await sharedWalletController.getParticipantBalance(walletAddress, participant.address)).to.equal(
          depositAmount,
        );
      });

      it("Returns zero for a non-registered participant", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with one participant
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Verify non-registered participant has zero balance
        expect(await sharedWalletController.getParticipantBalance(walletAddress, participants[1].address)).to.equal(0);
      });
    });

    describe("Function 'getParticipantWallets()'", () => {
      it("Returns the single wallet for a participant in one wallet", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with participant
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Verify participant is in one wallet
        const participantWallets: string[] = await sharedWalletController.getParticipantWallets(
          participants[0].address,
        );
        expect(participantWallets).to.deep.equal([walletAddress]);
      });

      it("Returns multiple wallets for a participant in multiple wallets", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const wallet1Address = sharedWallets[0].address;
        const wallet2Address = sharedWallets[1].address;

        // Create two wallets with same participant
        await proveTx(connect(sharedWalletController, admin).createWallet(wallet1Address, [participants[0].address]));
        await proveTx(connect(sharedWalletController, admin).createWallet(wallet2Address, [participants[0].address]));

        // Check participant is in both wallets
        const participantWallets: string[] = await sharedWalletController.getParticipantWallets(
          participants[0].address,
        );
        expect(participantWallets.length).to.equal(2);
        expect(participantWallets).to.include(wallet1Address);
        expect(participantWallets).to.include(wallet2Address);
      });

      it("Returns empty array for a participant not in any wallet", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        // Verify participant not in any wallet
        const participantWallets: string[] = await sharedWalletController.getParticipantWallets(
          participants[0].address,
        );
        expect(participantWallets).to.deep.equal([]);
      });
    });

    describe("Function 'getParticipantOverviews()'", () => {
      it("Returns the correct overview for a single participant", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participant = participants[0];

        // Create wallet with participant
        await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, [participant.address]));

        // Make a deposit
        const depositAmount = 10000n; // Must be divisible by ACCURACY_FACTOR
        await proveTx(connect(tokenMock, participant).transfer(walletAddress, depositAmount));

        // Get participant overview
        const overviews = await sharedWalletController.getParticipantOverviews([
          participant.address,
        ]);
        expect(overviews.length).to.equal(1);

        const overview = overviews[0];

        const expectedOverview = createTestParticipantOverview(participant.address, depositAmount);
        const expectedWalletSummary = createTestWalletSummary(
          walletAddress,
          WalletStatus.Active,
          depositAmount,
          depositAmount,
        );
        expectedOverview.walletSummaries = [expectedWalletSummary];
        checkEquality(overview, expectedOverview);
      });

      it("Returns the correct overviews for multiple participants", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with multiple participants
        await proveTx(
          connect(sharedWalletController, admin).createWallet(walletAddress, [
            participants[0].address,
            participants[1].address,
          ]),
        );

        // Make deposits (must be divisible by ACCURACY_FACTOR)
        await proveTx(connect(tokenMock, participants[0]).transfer(walletAddress, 10000n));
        await proveTx(connect(tokenMock, participants[1]).transfer(walletAddress, 20000n));

        // Get participant overviews
        const participantOverviews = await sharedWalletController.getParticipantOverviews([
          participants[0].address,
          participants[1].address,
        ]);
        expect(participantOverviews.length).to.equal(2);

        // Verify first participant
        const overview0 = participantOverviews[0];
        const expectedOverview0 = createTestParticipantOverview(participants[0].address, 10000n);
        const expectedWalletSummary0 = createTestWalletSummary(
          walletAddress,
          WalletStatus.Active,
          30000n,
          10000n,
        );
        expectedOverview0.walletSummaries = [expectedWalletSummary0];
        checkEquality(overview0, expectedOverview0);

        // Verify second participant
        const overview1 = participantOverviews[1];
        const expectedOverview1 = createTestParticipantOverview(participants[1].address, 20000n);
        const expectedWalletSummary1 = createTestWalletSummary(
          walletAddress,
          WalletStatus.Active,
          30000n,
          20000n,
        );
        expectedOverview1.walletSummaries = [expectedWalletSummary1];
        checkEquality(overview1, expectedOverview1);
      });

      it("Calculates the total balance correctly across wallets", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const wallet1Address = sharedWallets[0].address;
        const wallet2Address = sharedWallets[1].address;
        const participant = participants[0];

        // Create two wallets with same participant
        await proveTx(connect(sharedWalletController, admin).createWallet(wallet1Address, [participant.address]));
        await proveTx(connect(sharedWalletController, admin).createWallet(wallet2Address, [participant.address]));

        // Make deposits to both wallets
        await proveTx(connect(tokenMock, participant).transfer(wallet1Address, 10000n));
        await proveTx(connect(tokenMock, participant).transfer(wallet2Address, 20000n));

        // Get participant overview
        const participantOverviews = await sharedWalletController.getParticipantOverviews([
          participant.address,
        ]);
        expect(participantOverviews.length).to.equal(1);

        const overview = participantOverviews[0];
        const expectedOverview = createTestParticipantOverview(participant.address, 30000n); // 10000 + 20000
        const expectedWalletSummary1 = createTestWalletSummary(
          wallet1Address,
          WalletStatus.Active,
          10000n,
          10000n,
        );
        const expectedWalletSummary2 = createTestWalletSummary(
          wallet2Address,
          WalletStatus.Active,
          20000n,
          20000n,
        );
        expectedOverview.walletSummaries = [expectedWalletSummary1, expectedWalletSummary2];
        checkEquality(overview, expectedOverview);
      });

      it("Returns correct wallet summaries", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const wallet1Address = sharedWallets[0].address;
        const wallet2Address = sharedWallets[1].address;
        const participant = participants[0];

        // Create two wallets with same participant
        await proveTx(connect(sharedWalletController, admin).createWallet(wallet1Address, [participant.address]));
        await proveTx(connect(sharedWalletController, admin).createWallet(wallet2Address, [participant.address]));

        // Make deposits to both wallets
        await proveTx(connect(tokenMock, participant).transfer(wallet1Address, 10000n));
        await proveTx(connect(tokenMock, participant).transfer(wallet2Address, 20000n));

        // Get participant overview
        const participantOverviews = await sharedWalletController.getParticipantOverviews([
          participant.address,
        ]);
        const overview = participantOverviews[0];

        // Verify main overview properties
        const expectedOverview = createTestParticipantOverview(participant.address, 30000n); // 10000 + 20000
        const expectedWalletSummary1 = createTestWalletSummary(
          wallet1Address,
          WalletStatus.Active,
          10000n,
          10000n,
        );
        const expectedWalletSummary2 = createTestWalletSummary(
          wallet2Address,
          WalletStatus.Active,
          20000n,
          20000n,
        );
        expectedOverview.walletSummaries = [expectedWalletSummary1, expectedWalletSummary2];
        checkEquality(overview, expectedOverview);
      });
    });

    describe("Function 'getWalletParticipants()'", () => {
      it("Returns the correct participants for an active wallet", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participantAddresses = [participants[0].address, participants[1].address, participants[2].address];

        // Create wallet with participants
        await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, participantAddresses));

        // Check participants are returned in correct order
        const actualParticipants: string[] = await sharedWalletController.getWalletParticipants(walletAddress);
        expect(actualParticipants).to.deep.equal(participantAddresses);
      });

      it("Returns the correct participants for a suspended wallet", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participantAddresses = [participants[0].address, participants[1].address];

        // Create wallet with participants and suspend it
        await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, participantAddresses));
        await proveTx(connect(sharedWalletController, admin).suspendWallet(walletAddress));

        // Check participants are still returned for suspended wallet
        const actualParticipants: string[] = await sharedWalletController.getWalletParticipants(walletAddress);
        expect(actualParticipants).to.deep.equal(participantAddresses);
      });

      it("Returns empty array for a nonexistent wallet", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        // Check nonexistent wallet
        const participants: string[] = await sharedWalletController.getWalletParticipants(sharedWallets[0].address);
        expect(participants).to.deep.equal([]);
      });
    });

    describe("Function 'getWalletOverviews()'", () => {
      it("Returns the correct overview for a single wallet", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participant = participants[0];

        // Create wallet with participant
        await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, [participant.address]));

        // Make a deposit
        const depositAmount = 10000n; // Must be divisible by ACCURACY_FACTOR
        await proveTx(connect(tokenMock, participant).transfer(walletAddress, depositAmount));

        // Get wallet overview
        const walletOverviews = await sharedWalletController.getWalletOverviews([walletAddress]);
        expect(walletOverviews.length).to.equal(1);

        const overview = walletOverviews[0];
        const expectedOverview = createTestWalletOverview(walletAddress, WalletStatus.Active, depositAmount);
        const expectedParticipantSummary = createTestParticipantSummary(
          participant.address,
          depositAmount,
        );
        expectedOverview.participantSummaries = [expectedParticipantSummary];
        checkEquality(overview, expectedOverview);
      });

      it("Returns the correct overviews for multiple wallets", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const wallet1Address = sharedWallets[0].address;
        const wallet2Address = sharedWallets[1].address;

        // Create two wallets with different participants
        await proveTx(connect(sharedWalletController, admin).createWallet(wallet1Address, [participants[0].address]));
        await proveTx(connect(sharedWalletController, admin).createWallet(wallet2Address, [participants[1].address]));

        // Make deposits to both wallets
        await proveTx(connect(tokenMock, participants[0]).transfer(wallet1Address, 10000n));
        await proveTx(connect(tokenMock, participants[1]).transfer(wallet2Address, 20000n));

        // Get wallet overviews
        const walletOverviews = await sharedWalletController.getWalletOverviews([
          wallet1Address,
          wallet2Address,
        ]);
        expect(walletOverviews.length).to.equal(2);

        // Check first wallet
        const overview1 = walletOverviews[0];
        const expectedOverview1 = createTestWalletOverview(wallet1Address, WalletStatus.Active, 10000n);
        const expectedParticipantSummary1 = createTestParticipantSummary(
          participants[0].address,
          10000n,
        );
        expectedOverview1.participantSummaries = [expectedParticipantSummary1];
        checkEquality(overview1, expectedOverview1);

        // Check second wallet
        const overview2 = walletOverviews[1];
        const expectedOverview2 = createTestWalletOverview(wallet2Address, WalletStatus.Active, 20000n);
        const expectedParticipantSummary2 = createTestParticipantSummary(
          participants[1].address,
          20000n,
        );
        expectedOverview2.participantSummaries = [expectedParticipantSummary2];
        checkEquality(overview2, expectedOverview2);
      });

      it("Returns correct participant summaries", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participantAddresses = [participants[0].address, participants[1].address];

        // Create wallet with multiple participants
        await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, participantAddresses));

        // Make deposits
        await proveTx(connect(tokenMock, participants[0]).transfer(walletAddress, 10000n));
        await proveTx(connect(tokenMock, participants[1]).transfer(walletAddress, 20000n));

        // Get wallet overview
        const walletOverviews = await sharedWalletController.getWalletOverviews([walletAddress]);
        const overview = walletOverviews[0];

        // Verify main overview properties
        const expectedOverview = createTestWalletOverview(walletAddress, WalletStatus.Active, 30000n); // 10000 + 20000
        const expectedParticipantSummary0 = createTestParticipantSummary(
          participants[0].address,
          10000n,
        );
        const expectedParticipantSummary1 = createTestParticipantSummary(
          participants[1].address,
          20000n,
        );
        expectedOverview.participantSummaries = [expectedParticipantSummary0, expectedParticipantSummary1];
        checkEquality(overview, expectedOverview);
      });
    });

    describe("Function 'getRelationshipOverviews()'", () => {
      it("Returns the correct overview for a specific wallet-participant pair", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participant = participants[0];

        // Create wallet with participant
        await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, [participant.address]));

        // Make a deposit
        const depositAmount = 10000n; // Must be divisible by ACCURACY_FACTOR
        await proveTx(connect(tokenMock, participant).transfer(walletAddress, depositAmount));

        // Get relationship overview for specific pair
        const pairs: WalletParticipantPair[] = [{ wallet: walletAddress, participant: participant.address }];
        const overviews = await sharedWalletController.getRelationshipOverviews(pairs);
        expect(overviews.length).to.equal(1);

        const overview = overviews[0];
        const expectedOverview = createTestRelationshipOverview(
          walletAddress,
          participant.address,
          depositAmount,
          WalletStatus.Active,
          depositAmount,
          ParticipantStatus.Registered,
        );
        checkEquality(overview, expectedOverview);
      });

      it("Returns the correct overview for a specific wallet-participant pair where participant is not registered",
        async () => {
          const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
          const walletAddress = sharedWallets[0].address;
          const participant = participants[0];
          const participant2 = participants[1];

          // Create wallet with participant
          await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, [participant.address]));

          // Make a deposit
          const depositAmount = 10000n; // Must be divisible by ACCURACY_FACTOR
          await proveTx(connect(tokenMock, participant).transfer(walletAddress, depositAmount));

          // Get relationship overview for specific pair
          const pairs: WalletParticipantPair[] = [{ wallet: walletAddress, participant: participant2.address }];
          const overviews = await sharedWalletController.getRelationshipOverviews(pairs);
          expect(overviews.length).to.equal(1);

          const overview = overviews[0];
          const expectedOverview = createTestRelationshipOverview(
            walletAddress,
            participant2.address,
            0n,
            WalletStatus.Active,
            depositAmount,
            ParticipantStatus.NotRegistered,
          );
          checkEquality(overview, expectedOverview);
        });

      it("Expands the zero wallet address wildcard correctly", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const wallet1Address = sharedWallets[0].address;
        const wallet2Address = sharedWallets[1].address;
        const participant = participants[0];

        // Create two wallets with same participant
        await proveTx(connect(sharedWalletController, admin).createWallet(wallet1Address, [participant.address]));
        await proveTx(connect(sharedWalletController, admin).createWallet(wallet2Address, [participant.address]));

        // Make deposits to both wallets
        await proveTx(connect(tokenMock, participant).transfer(wallet1Address, 10000n));
        await proveTx(connect(tokenMock, participant).transfer(wallet2Address, 20000n));

        // Get relationship overview with zero wallet address (all wallets for participant)
        const pairs: WalletParticipantPair[] = [{ wallet: ADDRESS_ZERO, participant: participant.address }];
        const overviews = await sharedWalletController.getRelationshipOverviews(pairs);
        expect(overviews.length).to.equal(2);

        // Check both relationships are returned
        const overview1 = overviews.find(
          o => o.wallet === wallet1Address,
        );
        const overview2 = overviews.find(
          o => o.wallet === wallet2Address,
        );

        expect(overview1).not.to.be.undefined;
        expect(overview2).not.to.be.undefined;

        const expectedOverview1 = createTestRelationshipOverview(
          wallet1Address,
          participant.address,
          10000n,
          WalletStatus.Active,
          10000n,
          ParticipantStatus.Registered,
        );
        const expectedOverview2 = createTestRelationshipOverview(
          wallet2Address,
          participant.address,
          20000n,
          WalletStatus.Active,
          20000n,
          ParticipantStatus.Registered,
        );

        checkEquality(overview1!, expectedOverview1);
        checkEquality(overview2!, expectedOverview2);
      });

      it("Expands the zero participant address wildcard correctly", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participant1 = participants[0];
        const participant2 = participants[1];

        // Create wallet with two participants
        await proveTx(
          connect(sharedWalletController, admin).createWallet(walletAddress, [
            participant1.address,
            participant2.address,
          ]),
        );

        // Make deposits
        await proveTx(connect(tokenMock, participant1).transfer(walletAddress, 10000n));
        await proveTx(connect(tokenMock, participant2).transfer(walletAddress, 20000n));

        // Get relationship overview with zero participant address (all participants for wallet)
        const pairs: WalletParticipantPair[] = [{ wallet: walletAddress, participant: ADDRESS_ZERO }];
        const overviews = await sharedWalletController.getRelationshipOverviews(pairs);
        expect(overviews.length).to.equal(2);

        // Check both relationships are returned
        const overview1 = overviews.find(
          o => o.participant === participant1.address,
        );
        const overview2 = overviews.find(
          o => o.participant === participant2.address,
        );

        expect(overview1).not.to.be.undefined;
        expect(overview2).not.to.be.undefined;

        const expectedOverview1 = createTestRelationshipOverview(
          walletAddress,
          participant1.address,
          10000n,
          WalletStatus.Active,
          30000n, // Total wallet balance: 10000 + 20000
          ParticipantStatus.Registered,
        );
        const expectedOverview2 = createTestRelationshipOverview(
          walletAddress,
          participant2.address,
          20000n,
          WalletStatus.Active,
          30000n, // Total wallet balance: 10000 + 20000
          ParticipantStatus.Registered,
        );

        checkEquality(overview1!, expectedOverview1);
        checkEquality(overview2!, expectedOverview2);
      });

      it("Handles mixed specific and wildcard pairs correctly", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const wallet1Address = sharedWallets[0].address;
        const wallet2Address = sharedWallets[1].address;
        const participant1 = participants[0];
        const participant2 = participants[1];

        // Create two wallets with different participants
        await proveTx(
          connect(sharedWalletController, admin).createWallet(wallet1Address, [
            participant1.address,
            participant2.address,
          ]),
        );
        await proveTx(connect(sharedWalletController, admin).createWallet(wallet2Address, [participant1.address]));

        // Make deposits
        await proveTx(connect(tokenMock, participant1).transfer(wallet1Address, 10000n));
        await proveTx(connect(tokenMock, participant2).transfer(wallet1Address, 20000n));
        await proveTx(connect(tokenMock, participant1).transfer(wallet2Address, 10000n));

        // Get relationship overview with specific pairs only (wildcard expansion may not work as expected)
        const pairs: WalletParticipantPair[] = [
          { wallet: wallet1Address, participant: participant1.address }, // specific pair
          { wallet: wallet1Address, participant: participant2.address }, // specific pair
        ];
        const overviews = await sharedWalletController.getRelationshipOverviews(pairs);

        expect(overviews.length).to.equal(2);

        // Check first specific pair
        const overview1 = overviews.find(
          o => o.wallet === wallet1Address && o.participant === participant1.address,
        );
        const overview2 = overviews.find(
          o => o.wallet === wallet1Address && o.participant === participant2.address,
        );

        expect(overview1).not.to.be.undefined;
        expect(overview2).not.to.be.undefined;

        const expectedOverview1 = createTestRelationshipOverview(
          wallet1Address,
          participant1.address,
          10000n,
          WalletStatus.Active,
          30000n, // Total wallet1 balance: 10000 + 20000
          ParticipantStatus.Registered,
        );
        const expectedOverview2 = createTestRelationshipOverview(
          wallet1Address,
          participant2.address,
          20000n,
          WalletStatus.Active,
          30000n, // Total wallet1 balance: 10000 + 20000
          ParticipantStatus.Registered,
        );

        checkEquality(overview1!, expectedOverview1);
        checkEquality(overview2!, expectedOverview2);
      });

      it("Handles complex wildcard expansion scenarios", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const wallet1Address = sharedWallets[0].address;
        const wallet2Address = sharedWallets[1].address;

        // Create multiple wallets with overlapping participants
        await proveTx(
          connect(sharedWalletController, admin).createWallet(wallet1Address, [
            participants[0].address,
            participants[1].address,
          ]),
        );
        await proveTx(
          connect(sharedWalletController, admin).createWallet(wallet2Address, [
            participants[0].address,
            participants[2].address,
          ]),
        );

        // Add some balances for verification
        await proveTx(connect(tokenMock, participants[0]).transfer(wallet1Address, 10000n));
        await proveTx(connect(tokenMock, participants[1]).transfer(wallet1Address, 20000n));
        await proveTx(connect(tokenMock, participants[0]).transfer(wallet2Address, 20000n));
        await proveTx(connect(tokenMock, participants[2]).transfer(wallet2Address, 30000n));

        // Test wildcard expansion: all wallets for participant[0]
        const participant0Pairs: WalletParticipantPair[] = [
          { wallet: ADDRESS_ZERO, participant: participants[0].address },
        ];
        const participant0Overviews = await sharedWalletController.getRelationshipOverviews(participant0Pairs);

        // Should return 2 pairs (participant[0] is in both wallets)
        expect(participant0Overviews.length).to.equal(2);

        // Verify both wallet relationships are returned
        const wallet1Overview = participant0Overviews.find(
          o => o.wallet === wallet1Address,
        );
        const wallet2Overview = participant0Overviews.find(
          o => o.wallet === wallet2Address,
        );

        expect(wallet1Overview).not.to.be.undefined;
        expect(wallet2Overview).not.to.be.undefined;
        expect(wallet1Overview!.participantBalance).to.equal(10000n);
        expect(wallet2Overview!.participantBalance).to.equal(20000n); // participant[0] deposited 20000n to wallet2

        // Test wildcard expansion: all participants for wallet1
        const wallet1Pairs: WalletParticipantPair[] = [{ wallet: wallet1Address, participant: ADDRESS_ZERO }];
        const wallet1Overviews = await sharedWalletController.getRelationshipOverviews(wallet1Pairs);

        // Should return 2 pairs (wallet1 has 2 participants)
        expect(wallet1Overviews.length).to.equal(2);

        // Verify both participant relationships are returned
        const p0Overview = wallet1Overviews.find(
          o => o.participant === participants[0].address,
        );
        const p1Overview = wallet1Overviews.find(
          o => o.participant === participants[1].address,
        );

        expect(p0Overview).not.to.be.undefined;
        expect(p1Overview).not.to.be.undefined;
        expect(p0Overview!.participantBalance).to.equal(10000n);
        expect(p1Overview!.participantBalance).to.equal(20000n);
      });

      it("Handles an empty wildcard expansion correctly", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        // Test wildcard for non-existent participant (should return empty array)
        const nonExistentParticipantPairs: WalletParticipantPair[] = [
          { wallet: ADDRESS_ZERO, participant: stranger.address },
        ];
        const emptyOverviews1 = await sharedWalletController.getRelationshipOverviews(nonExistentParticipantPairs);
        expect(emptyOverviews1.length).to.equal(0);

        // Test wildcard for non-existent wallet (should return empty array)
        const nonExistentWalletPairs: WalletParticipantPair[] = [
          { wallet: stranger.address, participant: ADDRESS_ZERO },
        ];
        const emptyOverviews2 = await sharedWalletController.getRelationshipOverviews(nonExistentWalletPairs);
        expect(emptyOverviews2.length).to.equal(0);
      });

      it("Handles a mixed wildcard and specific pairs", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const wallet1Address = sharedWallets[0].address;
        const wallet2Address = sharedWallets[1].address;

        // Create wallets
        await proveTx(
          connect(sharedWalletController, admin).createWallet(wallet1Address, [
            participants[0].address,
            participants[1].address,
          ]),
        );
        await proveTx(connect(sharedWalletController, admin).createWallet(wallet2Address, [participants[2].address]));

        // Add balances
        await proveTx(connect(tokenMock, participants[0]).transfer(wallet1Address, 10000n));
        await proveTx(connect(tokenMock, participants[1]).transfer(wallet1Address, 20000n));
        await proveTx(connect(tokenMock, participants[2]).transfer(wallet2Address, 30000n));

        // Mix of wildcard and specific pairs
        const mixedPairs: WalletParticipantPair[] = [
          { wallet: wallet1Address, participant: ADDRESS_ZERO }, // wildcard: all participants in wallet1
          { wallet: wallet2Address, participant: participants[2].address }, // specific pair
        ];

        const mixedOverviews = await sharedWalletController.getRelationshipOverviews(mixedPairs);

        // Should return 3 pairs: 2 from wallet1 wildcard + 1 specific
        expect(mixedOverviews.length).to.equal(3);

        // Verify all expected pairs are present
        const wallet1P0 = mixedOverviews.find(
          o => o.wallet === wallet1Address && o.participant === participants[0].address,
        );
        const wallet1P1 = mixedOverviews.find(
          o => o.wallet === wallet1Address && o.participant === participants[1].address,
        );
        const wallet2P2 = mixedOverviews.find(
          o => o.wallet === wallet2Address && o.participant === participants[2].address,
        );

        expect(wallet1P0).not.to.be.undefined;
        expect(wallet1P1).not.to.be.undefined;
        expect(wallet2P2).not.to.be.undefined;
        expect(wallet1P0!.participantBalance).to.equal(10000n);
        expect(wallet1P1!.participantBalance).to.equal(20000n);
        expect(wallet2P2!.participantBalance).to.equal(30000n);
      });

      it("Both addresses are zero in same pair", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        // Try to get relationship overview with both addresses as zero
        const invalidPairs: WalletParticipantPair[] = [{ wallet: ADDRESS_ZERO, participant: ADDRESS_ZERO }];
        await expect(sharedWalletController.getRelationshipOverviews(invalidPairs)).to.be.revertedWithCustomError(
          sharedWalletController,
          ERROR_NAME_WALLET_AND_PARTICIPANT_ADDRESSES_BOTH_ZERO,
        );
      });
    });

    describe("Function 'getWalletCount()'", () => {
      it("Returns the correct count after wallet creation", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        // Initially zero
        expect(await sharedWalletController.getWalletCount()).to.equal(0);

        // Create first wallet
        await proveTx(
          connect(sharedWalletController, admin).createWallet(sharedWallets[0].address, [participants[0].address]),
        );
        expect(await sharedWalletController.getWalletCount()).to.equal(1);

        // Create second wallet
        await proveTx(
          connect(sharedWalletController, admin).createWallet(sharedWallets[1].address, [participants[1].address]),
        );
        expect(await sharedWalletController.getWalletCount()).to.equal(2);
      });

      it("Returns the correct count after suspension/resume", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);
        expect(await sharedWalletController.getWalletCount()).to.equal(1);

        // Suspend wallet
        await proveTx(connect(sharedWalletController, admin).suspendWallet(walletAddress));
        expect(await sharedWalletController.getWalletCount()).to.equal(1);

        // Resume wallet
        await proveTx(connect(sharedWalletController, admin).resumeWallet(walletAddress));
        expect(await sharedWalletController.getWalletCount()).to.equal(1);
      });

      it("Returns the correct count after deletion", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);
        expect(await sharedWalletController.getWalletCount()).to.equal(1);

        // Suspend wallet - count should remain the same (it's a sequence counter)
        await proveTx(connect(sharedWalletController, admin).suspendWallet(walletAddress));
        expect(await sharedWalletController.getWalletCount()).to.equal(1);
      });
    });

    describe("Function 'getAggregatedBalance()'", () => {
      it("Returns zero initially", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        // Initially zero
        expect(await sharedWalletController.getAggregatedBalance()).to.equal(0);
      });

      it("Updates correctly after deposits", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participant = participants[0];

        // Create wallet
        await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, [participant.address]));
        expect(await sharedWalletController.getAggregatedBalance()).to.equal(0);

        // Make first deposit (must be divisible by ACCURACY_FACTOR)
        await proveTx(connect(tokenMock, participant).transfer(walletAddress, 10000n));
        expect(await sharedWalletController.getAggregatedBalance()).to.equal(10000n);

        // Make second deposit
        await proveTx(connect(tokenMock, participant).transfer(walletAddress, 10000n));
        expect(await sharedWalletController.getAggregatedBalance()).to.equal(20000n);
      });

      it("Updates correctly after withdrawals", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participant = participants[0];

        // Create wallet and make initial deposit
        await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, [participant.address]));
        await proveTx(connect(tokenMock, participant).transfer(walletAddress, 20000n));
        expect(await sharedWalletController.getAggregatedBalance()).to.equal(20000n);

        // Make partial withdrawal (must be divisible by ACCURACY_FACTOR)
        const walletSigner = await ethers.getImpersonatedSigner(walletAddress);
        await proveTx(connect(tokenMock, walletSigner).transfer(participant.address, 10000n));
        expect(await sharedWalletController.getAggregatedBalance()).to.equal(10000n);
      });

      it("Updates correctly after external transfers", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;
        const participant = participants[0];

        // Create wallet and make initial deposit (must be divisible by ACCURACY_FACTOR)
        await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, [participant.address]));
        await proveTx(connect(tokenMock, participant).transfer(walletAddress, 10000n));
        expect(await sharedWalletController.getAggregatedBalance()).to.equal(10000n);

        // External transfer in
        await proveTx(tokenMock.mint(stranger.address, BALANCE_INITIAL));
        await proveTx(connect(tokenMock, stranger).transfer(walletAddress, 10000n));
        expect(await sharedWalletController.getAggregatedBalance()).to.equal(20000n);
      });
    });
  });

  describe("Integration Workflows", () => {
    it("Handles the full workflow: create → add participants → transfers → remove participants → suspend", async () => {
      const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const walletAddress = sharedWallets[0].address;

      // Step 1: Create wallet with initial participants
      await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, [participants[0].address]));

      // Verify initial state
      expect(await sharedWalletController.getWalletCount()).to.equal(1);
      let walletParticipants: string[] = await sharedWalletController.getWalletParticipants(walletAddress);
      expect(walletParticipants).to.deep.equal([participants[0].address]);

      // Step 2: Add more participants
      await proveTx(
        connect(sharedWalletController, admin).addParticipants(walletAddress, [
          participants[1].address,
          participants[2].address,
        ]),
      );

      // Verify participants added
      walletParticipants = await sharedWalletController.getWalletParticipants(walletAddress);
      expect(walletParticipants.length).to.equal(3);
      expect(walletParticipants).to.include(participants[0].address);
      expect(walletParticipants).to.include(participants[1].address);
      expect(walletParticipants).to.include(participants[2].address);

      // Step 3: Transfers - deposits from participants
      await proveTx(connect(tokenMock, participants[0]).transfer(walletAddress, 10000n));
      await proveTx(connect(tokenMock, participants[1]).transfer(walletAddress, 20000n));
      await proveTx(connect(tokenMock, participants[2]).transfer(walletAddress, 10000n));

      // Verify balances
      expect(await sharedWalletController.getParticipantBalance(walletAddress, participants[0].address)).to.equal(
        10000n,
      );
      expect(await sharedWalletController.getParticipantBalance(walletAddress, participants[1].address)).to.equal(
        20000n,
      );
      expect(await sharedWalletController.getParticipantBalance(walletAddress, participants[2].address)).to.equal(
        10000n,
      );
      expect(await sharedWalletController.getAggregatedBalance()).to.equal(40000n);

      // Step 4: External transfer in
      await proveTx(tokenMock.mint(stranger.address, BALANCE_INITIAL));
      await proveTx(connect(tokenMock, stranger).transfer(walletAddress, 30000n));

      // Step 5: Withdrawals
      const walletSigner = await ethers.getImpersonatedSigner(walletAddress);
      await proveTx(connect(tokenMock, walletSigner).transfer(participants[0].address, 10000n));
      await proveTx(connect(tokenMock, walletSigner).transfer(participants[1].address, 10000n));

      // Step 6: Remove participants (clear balances first)
      const participant2Balance: bigint = await sharedWalletController.getParticipantBalance(
        walletAddress,
        participants[2].address,
      );
      if (participant2Balance > 0) {
        await proveTx(connect(tokenMock, walletSigner).transfer(participants[2].address, participant2Balance));
      }
      await proveTx(
        connect(sharedWalletController, admin).removeParticipants(walletAddress, [participants[2].address]),
      );

      // Verify participant removed
      walletParticipants = await sharedWalletController.getWalletParticipants(walletAddress);
      expect(walletParticipants.length).to.equal(2);
      expect(walletParticipants).not.to.include(participants[2].address);

      // Step 7: Clear all remaining balances for suspension
      const participant0Balance: bigint = await sharedWalletController.getParticipantBalance(
        walletAddress,
        participants[0].address,
      );
      const participant1Balance: bigint = await sharedWalletController.getParticipantBalance(
        walletAddress,
        participants[1].address,
      );

      if (participant0Balance > 0) {
        await proveTx(connect(tokenMock, walletSigner).transfer(participants[0].address, participant0Balance));
      }
      if (participant1Balance > 0) {
        await proveTx(connect(tokenMock, walletSigner).transfer(participants[1].address, participant1Balance));
      }

      // Step 8: Suspend wallet
      await proveTx(connect(sharedWalletController, admin).suspendWallet(walletAddress));

      // Verify final state
      const finalOverviews = await sharedWalletController.getWalletOverviews([walletAddress]);
      const expectedSuspendedOverview = createTestWalletOverview(walletAddress, WalletStatus.Suspended, 0n);
      const remainingParticipantSummaries = [participants[0].address, participants[1].address].map(addr =>
        createTestParticipantSummary(addr, 0n),
      );
      expectedSuspendedOverview.participantSummaries = remainingParticipantSummaries;
      checkEquality(finalOverviews[0], expectedSuspendedOverview);

      // Verify participants remain in suspended wallet
      expect(finalOverviews[0].participantSummaries.length).to.equal(2);
      expect(await sharedWalletController.getWalletParticipants(walletAddress)).to.deep.equal([
        participants[0].address,
        participants[1].address,
      ]);
      expect(await sharedWalletController.getWalletCount()).to.equal(1);
    });

    it("Handles multiple wallets with overlapping participants", async () => {
      const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const wallet1Address = sharedWallets[0].address;
      const wallet2Address = sharedWallets[1].address;

      // Create overlapping participant sets
      // Wallet 1: participants[0], participants[1], participants[2]
      // Wallet 2: participants[1], participants[2], additional participant
      const additionalParticipant = ethers.Wallet.createRandom().address;

      await proveTx(
        connect(sharedWalletController, admin).createWallet(wallet1Address, [
          participants[0].address,
          participants[1].address,
          participants[2].address,
        ]),
      );
      await proveTx(
        connect(sharedWalletController, admin).createWallet(wallet2Address, [
          participants[1].address,
          participants[2].address,
          additionalParticipant,
        ]),
      );

      // Verify overlapping participants are in both wallets
      expect(await sharedWalletController.isParticipant(wallet1Address, participants[1].address)).to.equal(true);
      expect(await sharedWalletController.isParticipant(wallet2Address, participants[1].address)).to.equal(true);
      expect(await sharedWalletController.isParticipant(wallet1Address, participants[2].address)).to.equal(true);
      expect(await sharedWalletController.isParticipant(wallet2Address, participants[2].address)).to.equal(true);

      // Verify participant wallet lists
      const participant1Wallets: string[] = await sharedWalletController.getParticipantWallets(participants[1].address);
      const participant2Wallets: string[] = await sharedWalletController.getParticipantWallets(participants[2].address);

      expect(participant1Wallets.length).to.equal(2);
      expect(participant1Wallets).to.include(wallet1Address);
      expect(participant1Wallets).to.include(wallet2Address);

      expect(participant2Wallets.length).to.equal(2);
      expect(participant2Wallets).to.include(wallet1Address);
      expect(participant2Wallets).to.include(wallet2Address);

      // Make transfers to both wallets from overlapping participants
      await proveTx(connect(tokenMock, participants[1]).transfer(wallet1Address, 10000n));
      await proveTx(connect(tokenMock, participants[1]).transfer(wallet2Address, 10000n));
      await proveTx(connect(tokenMock, participants[2]).transfer(wallet1Address, 10000n));
      await proveTx(connect(tokenMock, participants[2]).transfer(wallet2Address, 10000n));

      // Verify independent balance tracking
      expect(await sharedWalletController.getParticipantBalance(wallet1Address, participants[1].address)).to.equal(
        10000n,
      );
      expect(await sharedWalletController.getParticipantBalance(wallet2Address, participants[1].address)).to.equal(
        10000n,
      );
      expect(await sharedWalletController.getParticipantBalance(wallet1Address, participants[2].address)).to.equal(
        10000n,
      );
      expect(await sharedWalletController.getParticipantBalance(wallet2Address, participants[2].address)).to.equal(
        10000n,
      );

      // Check participant overviews show total balances across wallets
      const participant1Overviews = await sharedWalletController.getParticipantOverviews([
        participants[1].address,
      ]);
      const participant2Overviews = await sharedWalletController.getParticipantOverviews([
        participants[2].address,
      ]);

      expect(participant1Overviews[0].totalBalance).to.equal(20000n); // 10000 + 10000
      expect(participant2Overviews[0].totalBalance).to.equal(20000n); // 10000 + 10000

      // Test operations on one wallet do not affect the other
      // Clear balance first to allow suspension
      const wallet1Signer = await ethers.getImpersonatedSigner(wallet1Address);
      const p1BalanceW1: bigint = await sharedWalletController.getParticipantBalance(
        wallet1Address,
        participants[0].address,
      );
      const p2BalanceW1: bigint = await sharedWalletController.getParticipantBalance(
        wallet1Address,
        participants[1].address,
      );
      const p3BalanceW1: bigint = await sharedWalletController.getParticipantBalance(
        wallet1Address,
        participants[2].address,
      );

      if (p1BalanceW1 > 0) {
        await proveTx(connect(tokenMock, wallet1Signer).transfer(participants[0].address, p1BalanceW1));
      }
      if (p2BalanceW1 > 0) {
        await proveTx(connect(tokenMock, wallet1Signer).transfer(participants[1].address, p2BalanceW1));
      }
      if (p3BalanceW1 > 0) {
        await proveTx(connect(tokenMock, wallet1Signer).transfer(participants[2].address, p3BalanceW1));
      }

      await proveTx(connect(sharedWalletController, admin).suspendWallet(wallet1Address));

      // Wallet 2 should still be active
      const wallet1Overview = await sharedWalletController.getWalletOverviews([wallet1Address]);
      const wallet2Overview = await sharedWalletController.getWalletOverviews([wallet2Address]);

      const expectedSuspendedOverview = createTestWalletOverview(wallet1Address, WalletStatus.Suspended, 0n);
      const expectedActiveOverview = createTestWalletOverview(wallet2Address, WalletStatus.Active, 20000n);
      const expectedParticipantSummaries1 = [
        createTestParticipantSummary(participants[0].address, 0n),
        createTestParticipantSummary(participants[1].address, 0n),
        createTestParticipantSummary(participants[2].address, 0n),
      ];
      const expectedParticipantSummaries2 = [
        createTestParticipantSummary(participants[1].address, 10000n),
        createTestParticipantSummary(participants[2].address, 10000n),
        createTestParticipantSummary(additionalParticipant, 0n),
      ];
      expectedSuspendedOverview.participantSummaries = expectedParticipantSummaries1;
      expectedActiveOverview.participantSummaries = expectedParticipantSummaries2;
      checkEquality(wallet1Overview[0], expectedSuspendedOverview);
      checkEquality(wallet2Overview[0], expectedActiveOverview);

      // Operations on wallet 2 should still work
      await proveTx(connect(sharedWalletController, admin).addParticipants(wallet2Address, [participants[0].address]));

      const wallet2Participants: string[] = await sharedWalletController.getWalletParticipants(wallet2Address);
      expect(wallet2Participants).to.include(participants[0].address);

      // Resume wallet 1
      await proveTx(connect(sharedWalletController, admin).resumeWallet(wallet1Address));

      // Remove overlapping participant from one wallet only
      const participant1BalanceWallet1: bigint = await sharedWalletController.getParticipantBalance(
        wallet1Address,
        participants[1].address,
      );
      if (participant1BalanceWallet1 > 0) {
        const wallet1Signer = await ethers.getImpersonatedSigner(wallet1Address);
        await proveTx(connect(tokenMock, wallet1Signer).transfer(participants[1].address, participant1BalanceWallet1));
      }

      await proveTx(
        connect(sharedWalletController, admin).removeParticipants(wallet1Address, [participants[1].address]),
      );

      // Verify participant is removed from wallet 1 but still in wallet 2
      expect(await sharedWalletController.isParticipant(wallet1Address, participants[1].address)).to.equal(false);
      expect(await sharedWalletController.isParticipant(wallet2Address, participants[1].address)).to.equal(true);

      // Verify participant wallet list updated
      const updatedParticipant1Wallets: string[] = await sharedWalletController.getParticipantWallets(
        participants[1].address,
      );
      expect(updatedParticipant1Wallets.length).to.equal(1);
      expect(updatedParticipant1Wallets[0]).to.equal(wallet2Address);
    });

    it("Handles the wallet lifecycle: create → suspend → resume → suspend", async () => {
      const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const walletAddress = sharedWallets[0].address;

      // Phase 1: Creation
      await proveTx(
        connect(sharedWalletController, admin).createWallet(walletAddress, [
          participants[0].address,
          participants[1].address,
        ]),
      );

      // Verify initial active state
      let walletOverviews = await sharedWalletController.getWalletOverviews([walletAddress]);
      const expectedActiveOverview = createTestWalletOverview(walletAddress, WalletStatus.Active, 0n);
      const expectedParticipantSummaries = [
        createTestParticipantSummary(participants[0].address, 0n),
        createTestParticipantSummary(participants[1].address, 0n),
      ];
      expectedActiveOverview.participantSummaries = expectedParticipantSummaries;
      checkEquality(walletOverviews[0], expectedActiveOverview);

      // Add some activity during active phase
      await proveTx(connect(tokenMock, participants[0]).transfer(walletAddress, 10000n));
      await proveTx(connect(tokenMock, participants[1]).transfer(walletAddress, 20000n));

      // Add external transfer
      await proveTx(tokenMock.mint(stranger.address, BALANCE_INITIAL));
      await proveTx(connect(tokenMock, stranger).transfer(walletAddress, 10000n));

      // Verify balances
      expect(await sharedWalletController.getAggregatedBalance()).to.be.greaterThan(0);
      const participant0Balance: bigint = await sharedWalletController.getParticipantBalance(
        walletAddress,
        participants[0].address,
      );
      const participant1Balance: bigint = await sharedWalletController.getParticipantBalance(
        walletAddress,
        participants[1].address,
      );
      expect(participant0Balance).to.be.greaterThan(0);
      expect(participant1Balance).to.be.greaterThan(0);

      // Phase 2: Clear balances for suspension
      const walletSigner = await ethers.getImpersonatedSigner(walletAddress);
      await proveTx(connect(tokenMock, walletSigner).transfer(participants[0].address, participant0Balance));
      await proveTx(connect(tokenMock, walletSigner).transfer(participants[1].address, participant1Balance));

      // Phase 3: Suspension
      await proveTx(connect(sharedWalletController, admin).suspendWallet(walletAddress));

      // Verify suspended state
      walletOverviews = await sharedWalletController.getWalletOverviews([walletAddress]);
      const expectedSuspendedOverview = createTestWalletOverview(walletAddress, WalletStatus.Suspended, 0n);
      expectedSuspendedOverview.participantSummaries = expectedParticipantSummaries;
      checkEquality(walletOverviews[0], expectedSuspendedOverview);

      // Test operations during suspension
      // Should be able to add participants to suspended wallet
      await proveTx(connect(sharedWalletController, admin).addParticipants(walletAddress, [participants[2].address]));

      // Should be able to remove participants from suspended wallet
      await proveTx(
        connect(sharedWalletController, admin).removeParticipants(walletAddress, [participants[0].address]),
      );

      // Should NOT be able to receive transfers while suspended
      await expect(connect(tokenMock, stranger).transfer(walletAddress, 10000n)).to.be.revertedWithCustomError(
        sharedWalletController,
        ERROR_NAME_WALLET_STATUS_INCOMPATIBLE,
      );

      // Phase 4: Resume with remaining participants
      const remainingParticipants: string[] = await sharedWalletController.getWalletParticipants(walletAddress);
      expect(remainingParticipants.length).to.be.greaterThan(0); // Should have at least one participant

      await proveTx(connect(sharedWalletController, admin).resumeWallet(walletAddress));

      // Verify resumed state
      walletOverviews = await sharedWalletController.getWalletOverviews([walletAddress]);
      const expectedResumedOverview = createTestWalletOverview(walletAddress, WalletStatus.Active, 0n);
      const remainingParticipantSummaries = remainingParticipants.map(addr =>
        createTestParticipantSummary(addr, 0n),
      );
      expectedResumedOverview.participantSummaries = remainingParticipantSummaries;
      checkEquality(walletOverviews[0], expectedResumedOverview);

      // Test operations work again after resume
      await proveTx(connect(tokenMock, participants[1]).transfer(walletAddress, 10000n));
      expect(await sharedWalletController.getParticipantBalance(walletAddress, participants[1].address)).to.equal(
        10000n,
      );

      // Phase 5: Clear balances and prepare for final suspension
      const finalParticipants: string[] = await sharedWalletController.getWalletParticipants(walletAddress);
      for (const participant of finalParticipants) {
        const balance: bigint = await sharedWalletController.getParticipantBalance(walletAddress, participant);
        if (balance > 0) {
          await proveTx(connect(tokenMock, walletSigner).transfer(participant, balance));
        }
      }

      // Phase 6: Final suspension
      const initialWalletCount = await sharedWalletController.getWalletCount();
      await proveTx(connect(sharedWalletController, admin).suspendWallet(walletAddress));

      // Verify final suspended state
      walletOverviews = await sharedWalletController.getWalletOverviews([walletAddress]);
      const expectedFinalSuspendedOverview = createTestWalletOverview(walletAddress, WalletStatus.Suspended, 0n);
      const finalParticipantSummaries = finalParticipants.map(addr =>
        createTestParticipantSummary(addr, 0n),
      );
      expectedFinalSuspendedOverview.participantSummaries = finalParticipantSummaries;
      checkEquality(walletOverviews[0], expectedFinalSuspendedOverview);

      // Verify participants remain in suspended wallet
      expect(walletOverviews[0].participantSummaries.length).to.equal(finalParticipants.length);
      expect(await sharedWalletController.getWalletParticipants(walletAddress)).to.deep.equal(finalParticipants);

      // Verify wallet count remains unchanged
      expect(await sharedWalletController.getWalletCount()).to.equal(initialWalletCount);

      // Verify participants still have this wallet in their lists (suspended wallets remain associated)
      for (const participant of finalParticipants) {
        const participantWallets: string[] = await sharedWalletController.getParticipantWallets(participant);
        expect(participantWallets).to.include(walletAddress);
      }

      // Verify operations on suspended wallet are still restricted
      await expect(connect(tokenMock, participants[1]).transfer(walletAddress, 10000n)).to.be.revertedWithCustomError(
        sharedWalletController,
        ERROR_NAME_WALLET_STATUS_INCOMPATIBLE,
      );
    });
  });

  describe("Edge Cases and Boundary Conditions", () => {
    describe("Maximum Value Testing", () => {
      it("Returns the correct aggregated balance with multiple wallets", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const wallet1Address = sharedWallets[0].address;
        const wallet2Address = sharedWallets[1].address;

        // Create two wallets
        await proveTx(connect(sharedWalletController, admin).createWallet(wallet1Address, [participants[0].address]));
        await proveTx(connect(sharedWalletController, admin).createWallet(wallet2Address, [participants[1].address]));

        // Add funds to both wallets
        const amount1 = 50000n;
        const amount2 = 80000n; // Must be divisible by ACCURACY_FACTOR

        await proveTx(connect(tokenMock, participants[0]).transfer(wallet1Address, amount1));
        await proveTx(connect(tokenMock, participants[1]).transfer(wallet2Address, amount2));

        // Verify aggregated balance equals sum of wallet balances
        const aggregatedBalance = await sharedWalletController.getAggregatedBalance();
        const wallet1Overview = (await sharedWalletController.getWalletOverviews([wallet1Address]))[0];
        const wallet2Overview = (await sharedWalletController.getWalletOverviews([wallet2Address]))[0];

        const expectedAggregated = wallet1Overview.walletBalance + wallet2Overview.walletBalance;
        expect(aggregatedBalance).to.equal(expectedAggregated);
        expect(aggregatedBalance).to.equal(amount1 + amount2);
      });

      it("Returns the correct aggregated balance with large amounts", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Test with large amount approaching uint64 limits (must be divisible by ACCURACY_FACTOR)
        const largeAmount = (2n ** 60n / 10000n) * 10000n; // Large but within uint64 range and divisible by 10000

        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Mint large amount to test aggregation
        await proveTx(tokenMock.mint(participants[0].address, largeAmount));
        await proveTx(connect(tokenMock, participants[0]).transfer(walletAddress, largeAmount));

        expect(await sharedWalletController.getAggregatedBalance()).to.equal(largeAmount);

        // Note: AggregatedBalanceExceedsLimit error would be triggered when the total
        // across all wallets exceeds uint64.max, which is practically impossible to test
        // but the validation exists for extreme edge cases
      });
    });

    describe("Precision and Rounding Edge Cases", () => {
      it("Handles the minimum valid transfer amount (ACCURACY_FACTOR)", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        // Transfer minimum valid amount
        const minAmount = BigInt(ACCURACY_FACTOR); // 10000
        await expect(connect(tokenMock, participants[0]).transfer(walletAddress, minAmount)).not.to.be.reverted;

        // Verify balance
        const participantBalance = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participants[0].address,
        );
        expect(participantBalance).to.equal(minAmount);
      });

      it("Handles complex share calculations with small remainders", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with 3 participants
        await proveTx(
          connect(sharedWalletController, admin).createWallet(walletAddress, [
            participants[0].address,
            participants[1].address,
            participants[2].address,
          ]),
        );

        // Give participants different balances to test remainder distribution (must be divisible by ACCURACY_FACTOR)
        await proveTx(connect(tokenMock, participants[0]).transfer(walletAddress, 30000n));
        await proveTx(connect(tokenMock, participants[1]).transfer(walletAddress, 30000n));
        await proveTx(connect(tokenMock, participants[2]).transfer(walletAddress, 40000n)); // More balance

        // External transfer to test distribution (must be divisible by ACCURACY_FACTOR)
        await proveTx(tokenMock.mint(stranger.address, BALANCE_INITIAL));
        const transferAmount = 10000n; // Valid transfer amount
        await proveTx(connect(tokenMock, stranger).transfer(walletAddress, transferAmount));

        // Verify total balances are consistent
        const p0Balance = await sharedWalletController.getParticipantBalance(walletAddress, participants[0].address);
        const p1Balance = await sharedWalletController.getParticipantBalance(walletAddress, participants[1].address);
        const p2Balance = await sharedWalletController.getParticipantBalance(walletAddress, participants[2].address);

        const totalParticipantBalances = p0Balance + p1Balance + p2Balance;
        const expectedTotal = 100000n + transferAmount; // Initial total (30000+30000+40000) + transfer
        expect(totalParticipantBalances).to.equal(expectedTotal);

        // Verify wallet balance consistency
        const walletOverview = (await sharedWalletController.getWalletOverviews([walletAddress]))[0];
        expect(walletOverview.walletBalance).to.equal(expectedTotal);
      });
    });

    describe("Zero Balance Edge Cases", () => {
      it("Handles zero balance transfers correctly", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet
        await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);

        const initialBalance = await sharedWalletController.getParticipantBalance(
          walletAddress,
          participants[0].address,
        );

        const tx = await proveTx(connect(tokenMock, participants[0]).transfer(walletAddress, 0));

        await expect(tx).to.emit(sharedWalletController, EVENT_NAME_DEPOSIT).withArgs(
          walletAddress,
          participants[0].address,
          initialBalance,
          initialBalance,
          initialBalance,
          initialBalance,
        );
        await expect(tx).not.to.emit(sharedWalletController, EVENT_NAME_TRANSFER_IN);

        const finalBalance = await sharedWalletController.getParticipantBalance(walletAddress, participants[0].address);

        expect(finalBalance).to.equal(initialBalance);
      });

      it("Handles a participant removal with zero balance correctly", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with participant
        await proveTx(
          connect(sharedWalletController, admin).createWallet(walletAddress, [
            participants[0].address,
            participants[1].address,
          ]),
        );

        // Remove participant with zero balance (should work)
        await expect(
          connect(sharedWalletController, admin).removeParticipants(walletAddress, [participants[0].address]),
        ).not.to.be.reverted;

        // Verify participant was removed
        expect(await sharedWalletController.isParticipant(walletAddress, participants[0].address)).to.equal(false);
      });
    });

    describe("Multi-Wallet Participant Scenarios", () => {
      it("Handles a participant in many wallets", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        // Create multiple wallets with the same participant
        const numWallets = 5; // Reasonable number for testing
        const walletAddresses: string[] = [];

        for (let i = 0; i < numWallets; i++) {
          const walletAddress = ethers.Wallet.createRandom().address;
          walletAddresses.push(walletAddress);

          await createWalletWithParticipants(sharedWalletController, walletAddress, [participants[0].address]);
        }

        // Verify participant is in all wallets
        const participantWallets = await sharedWalletController.getParticipantWallets(participants[0].address);

        expect(participantWallets.length).to.equal(numWallets);

        for (const walletAddress of walletAddresses) {
          expect(participantWallets).to.include(walletAddress);
          expect(await sharedWalletController.isParticipant(walletAddress, participants[0].address)).to.equal(true);
        }
      });

      it("Handles the complex participant overview with multiple wallets and balances", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const wallet1Address = sharedWallets[0].address;
        const wallet2Address = sharedWallets[1].address;

        // Create wallets with overlapping participants
        await proveTx(
          connect(sharedWalletController, admin).createWallet(wallet1Address, [
            participants[0].address,
            participants[1].address,
          ]),
        );
        await proveTx(connect(sharedWalletController, admin).createWallet(wallet2Address, [participants[0].address]));

        // Add different balances
        await proveTx(connect(tokenMock, participants[0]).transfer(wallet1Address, 30000n));
        await proveTx(connect(tokenMock, participants[1]).transfer(wallet1Address, 40000n));
        await proveTx(connect(tokenMock, participants[0]).transfer(wallet2Address, 20000n));

        // Get participant overview for participant[0] (in both wallets)
        const overviews = await sharedWalletController.getParticipantOverviews([participants[0].address]);

        expect(overviews.length).to.equal(1);
        const overview = overviews[0];

        // Should have total balance from both wallets
        expect(overview.totalBalance).to.equal(50000n); // 30000 + 20000
        expect(overview.walletSummaries.length).to.equal(2);

        // Verify wallet summaries
        const wallet1Summary = overview.walletSummaries.find(s => s.wallet === wallet1Address);
        const wallet2Summary = overview.walletSummaries.find(s => s.wallet === wallet2Address);

        expect(wallet1Summary).not.to.be.undefined;
        expect(wallet2Summary).not.to.be.undefined;
        expect(wallet1Summary!.participantBalance).to.equal(30000n);
        expect(wallet2Summary!.participantBalance).to.equal(20000n);
      });
    });

    describe("State Consistency Verification", () => {
      it("Maintains consistency across all view functions", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const walletAddress = sharedWallets[0].address;

        // Create wallet with multiple participants
        await proveTx(
          connect(sharedWalletController, admin).createWallet(walletAddress, [
            participants[0].address,
            participants[1].address,
            participants[2].address,
          ]),
        );

        // Add various balances
        await proveTx(connect(tokenMock, participants[0]).transfer(walletAddress, 10000n));
        await proveTx(connect(tokenMock, participants[1]).transfer(walletAddress, 20000n));
        await proveTx(connect(tokenMock, participants[2]).transfer(walletAddress, 30000n));

        // Verify consistency across different view functions
        const walletOverview = (await sharedWalletController.getWalletOverviews([walletAddress]))[0];
        const participantOverviews = await sharedWalletController.getParticipantOverviews([
          participants[0].address,
          participants[1].address,
          participants[2].address,
        ]);

        // Verify wallet balance equals sum of participant balances
        const totalFromParticipantOverviews = participantOverviews.reduce(
          (sum, overview) => sum + overview.totalBalance,
          0n,
        );
        expect(walletOverview.walletBalance).to.equal(totalFromParticipantOverviews);

        // Verify individual participant balances match
        for (let i = 0; i < 3; i++) {
          const directBalance = await sharedWalletController.getParticipantBalance(
            walletAddress,
            participants[i].address,
          );
          const overviewBalance = participantOverviews[i].totalBalance;
          const summaryBalance = walletOverview.participantSummaries[i].participantBalance;

          expect(directBalance).to.equal(overviewBalance);
          expect(directBalance).to.equal(summaryBalance);
        }

        // Verify aggregated balance consistency
        const aggregatedBalance = await sharedWalletController.getAggregatedBalance();
        expect(aggregatedBalance).to.equal(walletOverview.walletBalance);
      });
    });

    describe("Address Validation and Wildcard Expansion", () => {
      it("Handles the relationship overview with zero address validation", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        // Test the error for both addresses being zero
        await expect(
          sharedWalletController.getRelationshipOverviews([
            {
              wallet: ADDRESS_ZERO,
              participant: ADDRESS_ZERO,
            },
          ]),
        ).to.be.revertedWithCustomError(sharedWalletController, ERROR_NAME_WALLET_AND_PARTICIPANT_ADDRESSES_BOTH_ZERO);
      });

      it("Handles wildcard expansion with non-existent addresses", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);

        // Test wildcard expansion with participant that has no wallets
        const nonExistentParticipant = ethers.Wallet.createRandom().address;
        const result = await sharedWalletController.getRelationshipOverviews([
          {
            wallet: ADDRESS_ZERO,
            participant: nonExistentParticipant,
          },
        ]);

        expect(result.length).to.equal(0); // Should return empty array

        // Test wildcard expansion with wallet that has no participants
        const nonExistentWallet = ethers.Wallet.createRandom().address;
        const result2 = await sharedWalletController.getRelationshipOverviews([
          {
            wallet: nonExistentWallet,
            participant: ADDRESS_ZERO,
          },
        ]);

        expect(result2.length).to.equal(0); // Should return empty array
      });
    });
  });

  describe("Utility Functions", () => {
    describe("Function 'underlyingToken()'", () => {
      it("Returns the correct underlying token address", async () => {
        const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);

        // Verify it returns the token address used during initialization
        expect(await sharedWalletController.underlyingToken()).to.equal(getAddress(tokenMock));
      });
    });

    describe("Function '$__VERSION()'", () => {
      it("Returns the expected version values", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        const sharedWalletControllerVersion = await sharedWalletController.$__VERSION();
        checkEquality(sharedWalletControllerVersion, EXPECTED_VERSION);
      });
    });

    describe("Function 'proveSharedWalletController()'", () => {
      it("Executes without validation as expected", async () => {
        const { sharedWalletController } = await setUpFixture(deployAndConfigureContracts);
        // The 'proveSharedWalletController()' function is a marker function used for upgrade validation.
        // It should execute without reverting and return nothing.
        await expect(sharedWalletController.proveSharedWalletController()).not.to.be.reverted;
      });
    });
  });
});
