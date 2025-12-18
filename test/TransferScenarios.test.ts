import * as Contracts from "@contracts";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { connect, getAddress, proveTx } from "../test-utils/eth";
import { setUpFixture } from "../test-utils/common";

// Test constants
const BALANCE_INITIAL = 1000000000000n;

// Roles of the contract under test
const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
const ADMIN_ROLE: string = ethers.id("ADMIN_ROLE");

// Error names for custom errors
const ERROR_NAME_TRANSFER_AMOUNT_NOT_ROUNDED = "SharedWalletController_TransferAmountNotRounded";

// Types for transfer test scenarios

interface BaseTransferTestCase {
  description: string;
  participantCount: 1 | 2 | 3;
  initialBalances: bigint[];
  transferAmount: bigint;
  expectedFinalBalances: bigint[];
  expectedWalletBalance: bigint;
  shouldRevert?: boolean;
  expectedError?: string;
  tags?: string[];
}

interface DepositTestCase extends BaseTransferTestCase {
  type: "deposit";
  participantIndex: number;
}

interface WithdrawalTestCase extends BaseTransferTestCase {
  type: "withdrawal";
  participantIndex: number;
}

interface SharedIncomingTestCase extends BaseTransferTestCase {
  type: "shared_incoming";
  externalAddress: string;
}

interface SharedOutgoingTestCase extends BaseTransferTestCase {
  type: "shared_outgoing";
  externalAddress: string;
}

type TransferTestCase = DepositTestCase | WithdrawalTestCase | SharedIncomingTestCase | SharedOutgoingTestCase;

// Helper functions for creating test cases

function createDepositCase(
  description: string,
  participantCount: 1 | 2 | 3,
  participantIndex: number,
  initialBalances: bigint[],
  amount: bigint,
  expectedFinalBalances: bigint[],
  expectedWalletBalance: bigint,
  shouldRevert = false,
  expectedError?: string,
): DepositTestCase {
  return {
    type: "deposit",
    description,
    participantCount,
    participantIndex,
    initialBalances,
    transferAmount: amount,
    expectedFinalBalances,
    expectedWalletBalance,
    shouldRevert,
    expectedError,
  };
}

function createWithdrawalCase(
  description: string,
  participantCount: 1 | 2 | 3,
  participantIndex: number,
  initialBalances: bigint[],
  amount: bigint,
  expectedFinalBalances: bigint[],
  expectedWalletBalance: bigint,
  shouldRevert = false,
  expectedError?: string,
): WithdrawalTestCase {
  return {
    type: "withdrawal",
    description,
    participantCount,
    participantIndex,
    initialBalances,
    transferAmount: amount,
    expectedFinalBalances,
    expectedWalletBalance,
    shouldRevert,
    expectedError,
  };
}

function createSharedIncomingCase(
  description: string,
  participantCount: 1 | 2 | 3,
  externalAddress: string,
  initialBalances: bigint[],
  amount: bigint,
  expectedFinalBalances: bigint[],
  expectedWalletBalance: bigint,
  shouldRevert = false,
  expectedError?: string,
): SharedIncomingTestCase {
  return {
    type: "shared_incoming",
    description,
    participantCount,
    externalAddress,
    initialBalances,
    transferAmount: amount,
    expectedFinalBalances,
    expectedWalletBalance,
    shouldRevert,
    expectedError,
  };
}

function createSharedOutgoingCase(
  description: string,
  participantCount: 1 | 2 | 3,
  externalAddress: string,
  initialBalances: bigint[],
  amount: bigint,
  expectedFinalBalances: bigint[],
  expectedWalletBalance: bigint,
  shouldRevert = false,
  expectedError?: string,
): SharedOutgoingTestCase {
  return {
    type: "shared_outgoing",
    description,
    participantCount,
    externalAddress,
    initialBalances,
    transferAmount: amount,
    expectedFinalBalances,
    expectedWalletBalance,
    shouldRevert,
    expectedError,
  };
}

// Contract deployment functions

async function deployTokenMock() {
  const name = "ERC20 Test";
  const symbol = "TEST";

  let tokenMockFactory = await ethers.getContractFactory("ERC20TokenMockWithHooks");
  const [deployer] = await ethers.getSigners();
  tokenMockFactory = tokenMockFactory.connect(deployer);

  let tokenMock = (await tokenMockFactory.deploy(name, symbol));
  await tokenMock.waitForDeployment();
  tokenMock = connect(tokenMock, deployer);

  return tokenMock;
}

async function deploySharedWalletController(tokenMock: Contracts.ERC20TokenMockWithHooks) {
  const sharedWalletControllerFactory = await ethers.getContractFactory("SharedWalletController");
  const [deployer] = await ethers.getSigners();

  let sharedWalletController = (await upgrades.deployProxy(sharedWalletControllerFactory, [
    getAddress(tokenMock),
  ]));

  await sharedWalletController.waitForDeployment();
  sharedWalletController = connect(sharedWalletController, deployer);

  return sharedWalletController;
}

async function deployAndConfigureContracts() {
  const tokenMock = await deployTokenMock();
  const sharedWalletController = await deploySharedWalletController(tokenMock);

  // Set up token hook contract
  await proveTx(tokenMock.setHookContract(getAddress(sharedWalletController)));

  return {
    sharedWalletController,
    tokenMock,
  };
}

// Helper functions for common test patterns
async function createWalletWithParticipants(
  sharedWalletController: Contracts.SharedWalletController,
  admin: SignerWithAddress,
  walletAddress: string,
  participantAddresses: string[],
) {
  await proveTx(connect(sharedWalletController, admin).createWallet(walletAddress, participantAddresses));
}

// Test engine class

class TransferTestEngine {
  private sharedWalletController: Contracts.SharedWalletController;
  private tokenMock: Contracts.ERC20TokenMockWithHooks;
  private walletAddress: string;
  private participants: SignerWithAddress[];
  private admin: SignerWithAddress;
  private stranger: SignerWithAddress;

  constructor(
    sharedWalletController: Contracts.SharedWalletController,
    tokenMock: Contracts.ERC20TokenMockWithHooks,
    walletAddress: string,
    participants: SignerWithAddress[],
    admin: SignerWithAddress,
    stranger: SignerWithAddress,
  ) {
    this.sharedWalletController = sharedWalletController;
    this.tokenMock = tokenMock;
    this.walletAddress = walletAddress;
    this.participants = participants;
    this.admin = admin;
    this.stranger = stranger;
  }

  static async create(): Promise<TransferTestEngine> {
    const { sharedWalletController, tokenMock } = await setUpFixture(deployAndConfigureContracts);

    const [deployer, grantor, , admin, stranger, ...allParticipants] = await ethers.getSigners();

    // Grant roles to grantor and admin
    await proveTx(connect(sharedWalletController, deployer).grantRole(GRANTOR_ROLE, grantor.address));
    await proveTx(connect(sharedWalletController, grantor).grantRole(ADMIN_ROLE, admin.address));

    // Create a test wallet address - use one of the later signers as wallet
    const walletAddress = allParticipants[10].address;

    // Get the first 3 participants for testing
    const participants = allParticipants.slice(0, 3);

    // Mint initial balances for participants and stranger
    const accounts = [...participants, stranger];
    for (const account of accounts) {
      await proveTx(tokenMock.mint(account.address, BALANCE_INITIAL));
    }

    return new TransferTestEngine(sharedWalletController, tokenMock, walletAddress, participants, admin, stranger);
  }

  async executeTestCase(testCase: TransferTestCase): Promise<void> {
    await this.setupInitialState(testCase);

    if (testCase.shouldRevert) {
      await this.executeAndExpectRevert(testCase);
    } else {
      await this.executeAndValidateSuccess(testCase);
    }
  }

  private async setupInitialState(testCase: TransferTestCase): Promise<void> {
    // Create wallet with required participants
    const participantAddresses = this.participants.slice(0, testCase.participantCount).map(p => p.address);

    await createWalletWithParticipants(
      this.sharedWalletController,
      this.admin,
      this.walletAddress,
      participantAddresses,
    );

    // Set initial balances by transferring tokens to the wallet
    for (let i = 0; i < testCase.initialBalances.length; i++) {
      if (testCase.initialBalances[i] > 0n) {
        await proveTx(
          connect(this.tokenMock, this.participants[i]).transfer(this.walletAddress, testCase.initialBalances[i]),
        );
      }
    }
  }

  private async executeAndExpectRevert(testCase: TransferTestCase): Promise<void> {
    const transferPromise = this.executeTransfer(testCase);

    if (testCase.expectedError) {
      await expect(transferPromise).to.be.revertedWithCustomError(this.sharedWalletController, testCase.expectedError);
    } else {
      await expect(transferPromise).to.be.reverted;
    }
  }

  private async executeAndValidateSuccess(testCase: TransferTestCase): Promise<void> {
    // Execute the transfer
    await this.executeTransfer(testCase);

    // Validate final balances
    await this.validateFinalBalances(testCase);
  }

  private async executeTransfer(testCase: TransferTestCase): Promise<void> {
    switch (testCase.type) {
      case "deposit":
        await this.executeDeposit(testCase);
        break;
      case "withdrawal":
        await this.executeWithdrawal(testCase);
        break;
      case "shared_incoming":
        await this.executeSharedIncoming(testCase);
        break;
      case "shared_outgoing":
        await this.executeSharedOutgoing(testCase);
        break;
    }
  }

  private async executeDeposit(testCase: DepositTestCase): Promise<void> {
    const participant = this.participants[testCase.participantIndex];
    await proveTx(connect(this.tokenMock, participant).transfer(this.walletAddress, testCase.transferAmount));
  }

  private async executeWithdrawal(testCase: WithdrawalTestCase): Promise<void> {
    const participant = this.participants[testCase.participantIndex];

    // Execute withdrawal transfer using impersonated wallet signer
    const walletSigner = await ethers.getImpersonatedSigner(this.walletAddress);
    await proveTx(connect(this.tokenMock, walletSigner).transfer(participant.address, testCase.transferAmount));
  }

  private async executeSharedIncoming(testCase: SharedIncomingTestCase): Promise<void> {
    await proveTx(connect(this.tokenMock, this.stranger).transfer(this.walletAddress, testCase.transferAmount));
  }

  private async executeSharedOutgoing(testCase: SharedOutgoingTestCase): Promise<void> {
    // Execute outgoing transfer using impersonated wallet signer
    const walletSigner = await ethers.getImpersonatedSigner(this.walletAddress);
    await proveTx(connect(this.tokenMock, walletSigner).transfer(this.stranger.address, testCase.transferAmount));
  }

  private async validateFinalBalances(testCase: TransferTestCase): Promise<void> {
    // Validate wallet balance
    const actualWalletBalance = await this.tokenMock.balanceOf(this.walletAddress);
    expect(actualWalletBalance).to.equal(
      testCase.expectedWalletBalance,
      `Wallet balance mismatch. Expected: ${testCase.expectedWalletBalance}, Actual: ${actualWalletBalance}`,
    );

    // Validate participant balances
    for (let i = 0; i < testCase.participantCount; i++) {
      const actualBalance = await this.sharedWalletController.getParticipantBalance(
        this.walletAddress,
        this.participants[i].address,
      );
      expect(actualBalance).to.equal(
        testCase.expectedFinalBalances[i],
        `Participant ${i} balance mismatch. Expected: ${testCase.expectedFinalBalances[i]}, Actual: ${actualBalance}`,
      );
    }
  }

  private async getParticipantBalances(participantCount: number): Promise<bigint[]> {
    const balances: bigint[] = [];
    for (let i = 0; i < participantCount; i++) {
      const balance = await this.sharedWalletController.getParticipantBalance(
        this.walletAddress,
        this.participants[i].address,
      );
      balances.push(balance);
    }
    return balances;
  }
}

// Test scenario definitions
// TODO: Curently the test cases are not comprehensive
// We need to add more test cases to cover all the edge cases

const oneParticipantMinimal: TransferTestCase[] = [
  // Core functionality
  createDepositCase(
    // Prettier-ignore
    "A single participant deposits tokens to empty wallet",
    1,
    0,
    [0n],
    10000n,
    [10000n],
    10000n,
  ),

  createWithdrawalCase(
    // Prettier-ignore
    "A single participant withdraws partial balance",
    1,
    0,
    [20000n],
    10000n,
    [10000n],
    10000n,
  ),

  createSharedIncomingCase(
    "An external transfer to a single participant wallet",
    1,
    "stranger",
    [10000n],
    20000n,
    [30000n],
    30000n,
  ),

  createSharedOutgoingCase(
    "An external withdrawal from a single participant wallet",
    1,
    "stranger",
    [20000n],
    10000n,
    [10000n],
    10000n,
  ),

  // Error scenario
  createWithdrawalCase(
    "A single participant attempts to withdraw more than balance",
    1,
    0,
    [10000n],
    20000n,
    [10000n],
    10000n,
    true,
  ),
];

const twoParticipantMinimal: TransferTestCase[] = [
  // Core functionality
  createDepositCase(
    // Prettier-ignore
    "The first participant deposits to empty wallet",
    2,
    0,
    [0n, 0n],
    10000n,
    [10000n, 0n],
    10000n,
  ),

  createWithdrawalCase(
    "The second participant withdraws from balanced wallet",
    2,
    1,
    [10000n, 20000n],
    10000n,
    [10000n, 10000n],
    20000n,
  ),

  createSharedIncomingCase(
    "An external transfer with equal participant balances (1:1 ratio)",
    2,
    "stranger",
    [10000n, 10000n],
    20000n,
    [20000n, 20000n],
    40000n,
  ),

  createSharedOutgoingCase(
    "An external withdrawal from a two-participant wallet",
    2,
    "stranger",
    [20000n, 20000n],
    20000n,
    [10000n, 10000n],
    20000n,
  ),

  // Remainder assignment test
  createSharedIncomingCase(
    "An external transfer with the remainder assigned to the first participant",
    2,
    "stranger",
    [10000n, 20000n], // Initial balances: participant 1: 10000, participant 2: 20000, total: 30000
    50000n, // Transfer amount: 50000 (divisible by ACCURACY_FACTOR)
    /*
     * Share calculation with ACCURACY_FACTOR = 10000:
     * - Participant 1: (50000 * 10000) / 30000 = 16666.67 → rounded down to 10000
     * - Participant 2: (50000 * 20000) / 30000 = 33333.33 → rounded down to 30000
     * - Total distributed: 10000 + 30000 = 40000
     * - Remainder: 50000 - 40000 = 10000 → assigned to first participant (index 0)
     * - Final shares: [10000 + 10000, 30000] = [20000, 30000]
     * - Final balances: [10000 + 20000, 20000 + 30000] = [30000, 50000]
     */
    [30000n, 50000n],
    80000n,
  ),

  // Error scenario
  createSharedOutgoingCase(
    "An external withdrawal exceeds the total wallet balance",
    2,
    "stranger",
    [10000n, 10000n],
    30000n,
    [10000n, 10000n],
    20000n,
    true,
  ),
];

const threeParticipantMinimal: TransferTestCase[] = [
  // Core functionality
  createDepositCase(
    "The first participant deposits to a three-participant wallet",
    3,
    0,
    [0n, 0n, 0n],
    10000n,
    [10000n, 0n, 0n],
    10000n,
  ),

  createWithdrawalCase(
    "The last participant withdraws from a balanced wallet",
    3,
    2,
    [10000n, 10000n, 10000n],
    10000n,
    [10000n, 10000n, 0n],
    20000n,
  ),

  createSharedIncomingCase(
    "An external transfer with equal balances (1:1:1 ratio)",
    3,
    "stranger",
    [10000n, 10000n, 10000n],
    30000n,
    [20000n, 20000n, 20000n],
    60000n,
  ),

  createSharedOutgoingCase(
    "An external withdrawal with equal balances",
    3,
    "stranger",
    [20000n, 20000n, 20000n],
    30000n,
    [10000n, 10000n, 10000n],
    30000n,
  ),

  // Remainder assignment test
  createSharedIncomingCase(
    "An external transfer with the remainder assigned to the first participant",
    3,
    "stranger",
    // Initial balances: participant 1: 10000, participant 2: 20000, participant 3: 30000, total: 60000
    [10000n, 20000n, 30000n],
    50000n, // Transfer amount: 50000 (divisible by ACCURACY_FACTOR)
    /*
     * Share calculation with ACCURACY_FACTOR = 10000:
     * - Participant 1: (50000 * 10000) / 60000 = 8333.33 → rounded down to 0 (8333 < 10000)
     * - Participant 2: (50000 * 20000) / 60000 = 16666.67 → rounded down to 10000
     * - Participant 3: (50000 * 30000) / 60000 = 25000.00 → rounded down to 20000
     * - Total distributed: 0 + 10000 + 20000 = 30000
     * - Remainder: 50000 - 30000 = 20000 → assigned to first participant (index 0)
     * - Final shares: [0 + 20000, 10000, 20000] = [20000, 10000, 20000]
     * - Final balances: [10000 + 20000, 20000 + 10000, 30000 + 20000] = [30000, 30000, 50000]
     */
    [30000n, 30000n, 50000n],
    110000n,
  ),

  // Error scenario
  createSharedIncomingCase(
    "An external transfer with a non-rounded amount",
    3,
    "stranger",
    [10000n, 10000n, 10000n],
    15001n,
    [10000n, 10000n, 10000n],
    30000n,
    true,
    ERROR_NAME_TRANSFER_AMOUNT_NOT_ROUNDED,
  ),
];

// Main test suites

describe("SharedWalletController Transfer Scenarios", () => {
  let engine: TransferTestEngine;

  beforeEach(async () => {
    engine = await TransferTestEngine.create();
  });

  describe("One Participant Scenarios", () => {
    oneParticipantMinimal.forEach((testCase) => {
      it(testCase.description, async () => {
        await engine.executeTestCase(testCase);
      });
    });
  });

  describe("Two Participants Scenarios", () => {
    twoParticipantMinimal.forEach((testCase) => {
      it(testCase.description, async () => {
        await engine.executeTestCase(testCase);
      });
    });
  });

  describe("Three Participants Scenarios", () => {
    threeParticipantMinimal.forEach((testCase) => {
      it(testCase.description, async () => {
        await engine.executeTestCase(testCase);
      });
    });
  });
});
