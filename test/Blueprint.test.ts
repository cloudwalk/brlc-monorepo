import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { checkContractUupsUpgrading, connect, getAddress, proveTx } from "../test-utils/eth";
import { checkEquality, maxUintForBits, setUpFixture } from "../test-utils/common";

const ADDRESS_ZERO = ethers.ZeroAddress;
const ALLOWANCE_MAX = ethers.MaxUint256;
const BALANCE_INITIAL = 1000_000_000_000n;

const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
const PAUSER_ROLE: string = ethers.id("PAUSER_ROLE");
const RESCUER_ROLE: string = ethers.id("RESCUER_ROLE");
const MANAGER_ROLE: string = ethers.id("MANAGER_ROLE");

const OP_ID_ARRAY: string[] = [
  ethers.encodeBytes32String("MOCK OP_ID 1"),
  ethers.encodeBytes32String("MOCK OP_ID 2"),
  ethers.encodeBytes32String("MOCK OP_ID 3"),
  ethers.encodeBytes32String("MOCK OP_ID 4"),
  ethers.encodeBytes32String("MOCK OP_ID 5"),
];
const OP_ID_ZERO = ethers.ZeroHash;
const TOKEN_AMOUNT = 12345678;
const TOKEN_AMOUNTS: number[] = [
  TOKEN_AMOUNT,
  TOKEN_AMOUNT * 2,
  TOKEN_AMOUNT * 3,
  TOKEN_AMOUNT * 4,
  TOKEN_AMOUNT * 5,
];

// Events of the contracts under test
const EVENT_NAME_BALANCE_UPDATED = "BalanceUpdated";
const EVENT_NAME_OPERATIONAL_TREASURY_CHANGED = "OperationalTreasuryChanged";

// Errors of the library contracts
const ERROR_NAME_Access_Control_Unauthorized_Account = "AccessControlUnauthorizedAccount";
const ERROR_NAME_Enforced_Pause = "EnforcedPause";
const ERROR_NAME_Invalid_Initialization = "InvalidInitialization";

// Errors of the contracts under test
const ERROR_NAME_ACCOUNT_ADDRESS_ZERO = "Blueprint_AccountAddressZero";
const ERROR_NAME_AMOUNT_EXCESS = "Blueprint_AmountExcess";
const ERROR_NAME_BALANCE_EXCESS = "Blueprint_BalanceExcess";
const ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID = "Blueprint_ImplementationAddressInvalid";
const ERROR_NAME_OPERATION_ALREADY_EXECUTED = "Blueprint_OperationAlreadyExecuted";
const ERROR_NAME_OPERATION_ID_ZERO = "Blueprint_OperationIdZero";
const ERROR_NAME_OPERATIONAL_TREASURY_ADDRESS_ZERO = "Blueprint_OperationalTreasuryAddressZero";
const ERROR_NAME_TOKEN_ADDRESS_ZERO = "Blueprint_TokenAddressZero";
const ERROR_NAME_TREASURY_ADDRESS_ALREADY_CONFIGURED = "Blueprint_TreasuryAddressAlreadyConfigured";
const ERROR_NAME_TREASURY_ALLOWANCE_ZERO = "Blueprint_TreasuryAllowanceZero";

const EXPECTED_VERSION: Version = {
  major: 1,
  minor: 1,
  patch: 1,
};

enum OperationStatus {
  Nonexistent = 0,
  Deposit = 1,
  Withdrawal = 2,
}

interface Version {
  major: number;
  minor: number;
  patch: number;

  [key: string]: number; // Indexing signature to ensure that fields are iterated over in a key-value style
}

interface Operation {
  status: OperationStatus;
  account: string;
  amount: bigint;

  // Indexing signature to ensure that fields are iterated over in a key-value style
  [key: string]: number | string | bigint;
}

interface AccountState {
  lastOpId: string;
  balance: bigint;
  operationCount: bigint;

  // Indexing signature to ensure that fields are iterated over in a key-value style
  [key: string]: string | bigint;
}

interface TestOperation extends Operation {
  opId: string;
}

const defaultOperation: Operation = {
  status: OperationStatus.Nonexistent,
  account: ADDRESS_ZERO,
  amount: 0n,
};

const defaultAccountState: AccountState = {
  lastOpId: ethers.ZeroHash,
  balance: 0n,
  operationCount: 0n,
};

interface Fixture {
  blueprint: Contract;
  tokenMock: Contract;
}

function convertToOperation(testOp: TestOperation): Operation {
  return {
    account: testOp.account,
    amount: testOp.amount,
    status: testOp.status,
  };
}

describe("Contracts 'Blueprint'", async () => {
  let blueprintFactory: ContractFactory;

  let deployer: HardhatEthersSigner;
  let manager: HardhatEthersSigner;
  let operationalTreasury: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let users: HardhatEthersSigner[];

  before(async () => {
    let moreUsers: HardhatEthersSigner[];
    [deployer, manager, operationalTreasury, stranger, user, ...moreUsers] = await ethers.getSigners();
    users = [user, ...moreUsers];

    // The contract factories with the explicitly specified deployer account
    blueprintFactory = await ethers.getContractFactory("BlueprintTestable");
    blueprintFactory = blueprintFactory.connect(deployer);
  });

  async function deployTokenMock(): Promise<Contract> {
    const name = "ERC20 Test";
    const symbol = "TEST";

    // The token contract factory with the explicitly specified deployer account
    let tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenMockFactory = tokenMockFactory.connect(deployer);

    // The token contract with the explicitly specified initial account
    let tokenMock = await tokenMockFactory.deploy(name, symbol) as Contract;
    await tokenMock.waitForDeployment();
    tokenMock = connect(tokenMock, deployer); // Explicitly specifying the initial account

    return tokenMock;
  }

  async function deployContracts(): Promise<Fixture> {
    const tokenMock = await deployTokenMock();
    let blueprint = await upgrades.deployProxy(blueprintFactory, [getAddress(tokenMock)]) as Contract;
    await blueprint.waitForDeployment();
    blueprint = connect(blueprint, deployer); // Explicitly specifying the initial account

    return {
      blueprint,
      tokenMock,
    };
  }

  async function deployAndConfigureContracts(): Promise<Fixture> {
    const fixture = await deployContracts();
    const { blueprint, tokenMock } = fixture;

    await proveTx(blueprint.grantRole(GRANTOR_ROLE, deployer.address));
    await proveTx(blueprint.grantRole(MANAGER_ROLE, manager.address));
    await proveTx(connect(tokenMock, operationalTreasury).approve(getAddress(blueprint), ALLOWANCE_MAX));
    await proveTx(blueprint.setOperationalTreasury(operationalTreasury.address));

    // Mint initial balances
    await proveTx(tokenMock.mint(operationalTreasury.address, BALANCE_INITIAL));
    for (let i = 0; i < OP_ID_ARRAY.length; ++i) {
      const account = users[i].address;
      await proveTx(tokenMock.mint(account, BALANCE_INITIAL));
    }

    // Approvals
    for (let i = 0; i < OP_ID_ARRAY.length; ++i) {
      await proveTx(connect(tokenMock, users[i]).approve(getAddress(blueprint), ALLOWANCE_MAX));
    }

    return fixture;
  }

  function createTestOperations(num = 1): TestOperation[] {
    const operations: TestOperation[] = [];
    const maxNum = Math.min(OP_ID_ARRAY.length, TOKEN_AMOUNTS.length, users.length);
    if (num > maxNum) {
      throw new Error(`The requested number of test operation structures is greater than ${maxNum}`);
    }
    for (let i = 0; i < num; ++i) {
      operations.push({
        opId: OP_ID_ARRAY[i],
        account: users[i].address,
        amount: BigInt(TOKEN_AMOUNTS[i]),
        status: OperationStatus.Nonexistent,
      });
    }
    return operations;
  }

  function processOperation(accountState: AccountState, testOp: TestOperation) {
    accountState.operationCount += 1n;
    accountState.lastOpId = testOp.opId;
    if (testOp.status == OperationStatus.Deposit) {
      accountState.balance += testOp.amount;
    }
    if (testOp.status == OperationStatus.Withdrawal) {
      accountState.balance -= testOp.amount;
    }
  }

  async function pauseContract(contract: Contract) {
    await proveTx(contract.grantRole(GRANTOR_ROLE, deployer.address));
    await proveTx(contract.grantRole(PAUSER_ROLE, deployer.address));
    await proveTx(contract.pause());
  }

  async function executeAndCheckOperation(props: { newOperationStatus: OperationStatus; amount: bigint }) {
    const { blueprint, tokenMock } = await setUpFixture(deployAndConfigureContracts);
    const [testOp] = createTestOperations();
    const expectedAccountState: AccountState = { ...defaultAccountState };
    const oldBalance = props.amount * 3n + 123n;
    testOp.status = props.newOperationStatus;
    testOp.amount = props.amount;
    expectedAccountState.balance = oldBalance;
    expectedAccountState.operationCount = 987654321n;
    await proveTx(blueprint.setAccountState(testOp.account, expectedAccountState)); // Call via the testable version.

    let tx: Promise<TransactionResponse>;
    if (props.newOperationStatus === OperationStatus.Deposit) {
      tx = connect(blueprint, manager).deposit(testOp.account, testOp.amount, testOp.opId);
    } else if (props.newOperationStatus === OperationStatus.Withdrawal) {
      tx = connect(blueprint, manager).withdraw(testOp.account, testOp.amount, testOp.opId);
    } else {
      throw new Error("Unknown new operation status");
    }
    await proveTx(tx);
    processOperation(expectedAccountState, testOp);
    const newBalance = expectedAccountState.balance;

    const actualOperation = await blueprint.getOperation(testOp.opId);
    const actualAccountState = await blueprint.getAccountState(testOp.account);
    const expectedOperation = convertToOperation(testOp);
    checkEquality(actualOperation, expectedOperation);
    checkEquality(actualAccountState, expectedAccountState);

    await expect(tx)
      .to.emit(blueprint, EVENT_NAME_BALANCE_UPDATED)
      .withArgs(testOp.opId, testOp.account, newBalance, oldBalance);

    await expect(tx).to.changeTokenBalances(
      tokenMock,
      [getAddress(blueprint), testOp.account, operationalTreasury.address],
      [0, oldBalance - newBalance, -(oldBalance - newBalance)],
    );
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected and emits the correct event", async () => {
      const { blueprint, tokenMock } = await setUpFixture(deployContracts);

      // The underlying token contract address
      expect(await blueprint.underlyingToken()).to.equal(getAddress(tokenMock));

      // Role hashes
      expect(await blueprint.OWNER_ROLE()).to.equal(OWNER_ROLE);
      expect(await blueprint.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
      expect(await blueprint.PAUSER_ROLE()).to.equal(PAUSER_ROLE);
      expect(await blueprint.RESCUER_ROLE()).to.equal(RESCUER_ROLE);
      expect(await blueprint.MANAGER_ROLE()).to.equal(MANAGER_ROLE);

      // The role admins
      expect(await blueprint.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await blueprint.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
      expect(await blueprint.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await blueprint.getRoleAdmin(RESCUER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await blueprint.getRoleAdmin(MANAGER_ROLE)).to.equal(GRANTOR_ROLE);

      // The deployer should have the owner role, but not the other roles
      expect(await blueprint.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
      expect(await blueprint.hasRole(GRANTOR_ROLE, deployer.address)).to.equal(false);
      expect(await blueprint.hasRole(PAUSER_ROLE, deployer.address)).to.equal(false);
      expect(await blueprint.hasRole(RESCUER_ROLE, deployer.address)).to.equal(false);
      expect(await blueprint.hasRole(MANAGER_ROLE, deployer.address)).to.equal(false);

      // The initial contract state is unpaused
      expect(await blueprint.paused()).to.equal(false);

      // Default values of the internal structures, mappings and variables. Also checks the set of fields
      checkEquality(await blueprint.getOperation(OP_ID_ZERO), defaultOperation);
      checkEquality(await blueprint.getAccountState(ADDRESS_ZERO), defaultAccountState);
      expect(await blueprint.operationalTreasury()).to.equal(ADDRESS_ZERO);
    });

    it("Is reverted if it is called a second time", async () => {
      const { blueprint, tokenMock } = await setUpFixture(deployContracts);
      await expect(blueprint.initialize(getAddress(tokenMock)))
        .to.be.revertedWithCustomError(blueprint, ERROR_NAME_Invalid_Initialization);
    });

    it("Is reverted if the passed token address is zero", async () => {
      const anotherBlueprintContract = await upgrades.deployProxy(
        blueprintFactory,
        [],
        { initializer: false },
      ) as Contract;

      await expect(anotherBlueprintContract.initialize(ADDRESS_ZERO))
        .to.be.revertedWithCustomError(anotherBlueprintContract, ERROR_NAME_TOKEN_ADDRESS_ZERO);
    });

    it("Is reverted for the contract implementation if it is called even for the first time", async () => {
      const tokenAddress = user.address;
      const blueprintImplementation = await blueprintFactory.deploy() as Contract;
      await blueprintImplementation.waitForDeployment();

      await expect(blueprintImplementation.initialize(tokenAddress))
        .to.be.revertedWithCustomError(blueprintImplementation, ERROR_NAME_Invalid_Initialization);
    });
  });

  describe("Function 'upgradeToAndCall()'", async () => {
    it("Executes as expected", async () => {
      const { blueprint } = await setUpFixture(deployContracts);
      await checkContractUupsUpgrading(blueprint, blueprintFactory);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { blueprint } = await setUpFixture(deployContracts);

      await expect(connect(blueprint, user).upgradeToAndCall(getAddress(blueprint), "0x"))
        .to.be.revertedWithCustomError(blueprint, ERROR_NAME_Access_Control_Unauthorized_Account)
        .withArgs(user.address, OWNER_ROLE);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { blueprint } = await setUpFixture(deployContracts);

      await expect(connect(blueprint, user).upgradeToAndCall(getAddress(blueprint), "0x"))
        .to.be.revertedWithCustomError(blueprint, ERROR_NAME_Access_Control_Unauthorized_Account)
        .withArgs(user.address, OWNER_ROLE);
    });

    it("Is reverted if the provided implementation address does not belong to a blueprint contract", async () => {
      const { blueprint, tokenMock } = await setUpFixture(deployContracts);

      await expect(blueprint.upgradeToAndCall(getAddress(tokenMock), "0x"))
        .to.be.revertedWithCustomError(blueprint, ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID);
    });
  });

  describe("Function '$__VERSION()'", async () => {
    it("Returns expected values", async () => {
      const { blueprint } = await setUpFixture(deployAndConfigureContracts);
      const blueprintVersion = await blueprint.$__VERSION();
      checkEquality(blueprintVersion, EXPECTED_VERSION);
    });
  });

  describe("Function 'setOperationalTreasury()", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { blueprint, tokenMock } = await setUpFixture(deployContracts);
      const allowance = 1; // This allowance should be enough
      await proveTx(connect(tokenMock, operationalTreasury).approve(getAddress(blueprint), allowance));

      await expect(blueprint.setOperationalTreasury(operationalTreasury.address))
        .to.emit(blueprint, EVENT_NAME_OPERATIONAL_TREASURY_CHANGED)
        .withArgs(operationalTreasury.address, ADDRESS_ZERO);

      expect(await blueprint.operationalTreasury()).to.eq(operationalTreasury.address);

      // Zeroing the operational treasury address is allowed
      await expect(blueprint.setOperationalTreasury(ADDRESS_ZERO))
        .to.emit(blueprint, EVENT_NAME_OPERATIONAL_TREASURY_CHANGED)
        .withArgs(ADDRESS_ZERO, operationalTreasury.address);

      expect(await blueprint.operationalTreasury()).to.eq(ADDRESS_ZERO);
    });

    it("Executes as expected even if the contract is paused", async () => {
      const { blueprint, tokenMock } = await setUpFixture(deployContracts);
      await proveTx(connect(tokenMock, operationalTreasury).approve(getAddress(blueprint), ALLOWANCE_MAX));
      await pauseContract(blueprint);

      await expect(blueprint.setOperationalTreasury(operationalTreasury.address))
        .to.emit(blueprint, EVENT_NAME_OPERATIONAL_TREASURY_CHANGED)
        .withArgs(operationalTreasury.address, ADDRESS_ZERO);
    });

    it("Is reverted if caller does not have the owner role", async () => {
      const { blueprint } = await setUpFixture(deployContracts);

      await expect(connect(blueprint, stranger).setOperationalTreasury(operationalTreasury.address))
        .to.be.revertedWithCustomError(blueprint, ERROR_NAME_Access_Control_Unauthorized_Account)
        .withArgs(stranger.address, OWNER_ROLE);
    });

    it("Is reverted if the new operational treasury address is the same as the previous one", async () => {
      const { blueprint, tokenMock } = await setUpFixture(deployContracts);

      await expect(blueprint.setOperationalTreasury(ADDRESS_ZERO))
        .to.be.revertedWithCustomError(blueprint, ERROR_NAME_TREASURY_ADDRESS_ALREADY_CONFIGURED);

      await proveTx(connect(tokenMock, operationalTreasury).approve(getAddress(blueprint), ALLOWANCE_MAX));
      await proveTx(blueprint.setOperationalTreasury(operationalTreasury.address));

      await expect(blueprint.setOperationalTreasury(operationalTreasury.address))
        .to.be.revertedWithCustomError(blueprint, ERROR_NAME_TREASURY_ADDRESS_ALREADY_CONFIGURED);
    });

    it("Is reverted if the operational treasury has not provided an allowance for the contract", async () => {
      const { blueprint } = await setUpFixture(deployContracts);

      await expect(blueprint.setOperationalTreasury(operationalTreasury.address))
        .to.be.revertedWithCustomError(blueprint, ERROR_NAME_TREASURY_ALLOWANCE_ZERO);
    });
  });

  describe("Function 'deposit()", async () => {
    describe("Executes as expected for a new account if", async () => {
      it("The amount is non-zero", async () => {
        await executeAndCheckOperation({ newOperationStatus: OperationStatus.Deposit, amount: 123456789n });
      });

      it("The amount is zero", async () => {
        await executeAndCheckOperation({ newOperationStatus: OperationStatus.Deposit, amount: 0n });
      });
    });

    describe("Is reverted if", async () => {
      it("The caller does not have the manager role", async () => {
        const { blueprint } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();

        await expect(connect(blueprint, stranger).deposit(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_Access_Control_Unauthorized_Account)
          .withArgs(stranger.address, MANAGER_ROLE);

        // Even if it is called by a deployer
        await expect(connect(blueprint, deployer).deposit(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_Access_Control_Unauthorized_Account)
          .withArgs(deployer.address, MANAGER_ROLE);
      });

      it("The contract is paused", async () => {
        const { blueprint } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();
        await pauseContract(blueprint);

        await expect(connect(blueprint, manager).deposit(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_Enforced_Pause);
      });

      it("The provided operation identifier is zero", async () => {
        const { blueprint } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();
        testOp.opId = OP_ID_ZERO;

        await expect(connect(blueprint, manager).deposit(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_OPERATION_ID_ZERO);
      });

      it("The provided account address is zero", async () => {
        const { blueprint } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();
        testOp.account = ADDRESS_ZERO;

        await expect(connect(blueprint, manager).deposit(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_ACCOUNT_ADDRESS_ZERO);
      });

      it("The provided amount is greater than 64-bit unsigned integer", async () => {
        const { blueprint, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();
        testOp.amount = maxUintForBits(64) + 1n;
        await proveTx(tokenMock.mint(testOp.account, testOp.amount));

        await expect(connect(blueprint, manager).deposit(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_AMOUNT_EXCESS);
      });

      it("The operational treasury is not configured", async () => {
        const { blueprint } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();
        await proveTx(blueprint.setOperationalTreasury(ADDRESS_ZERO));

        await expect(connect(blueprint, manager).deposit(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_OPERATIONAL_TREASURY_ADDRESS_ZERO);
      });

      it("The operation with the provided identifier is already executed", async () => {
        const { blueprint } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();
        await proveTx(connect(blueprint, manager).deposit(testOp.account, testOp.amount, testOp.opId));

        await expect(connect(blueprint, manager).deposit(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_OPERATION_ALREADY_EXECUTED)
          .withArgs(testOp.opId);
      });

      it("The result account balance is greater than 64-bit unsigned integer", async () => {
        const { blueprint } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();
        const accountState: AccountState = { ...defaultAccountState };
        accountState.balance = maxUintForBits(64) + 1n - testOp.amount;
        await proveTx(blueprint.setAccountState(testOp.account, accountState)); // Call via the testable version.

        await expect(connect(blueprint, manager).deposit(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_BALANCE_EXCESS);
      });

      it("The operation count is greater than 32-bit unsigned integer", async () => {
        const { blueprint } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();
        const accountState: AccountState = { ...defaultAccountState };
        accountState.operationCount = maxUintForBits(32);
        await proveTx(blueprint.setAccountState(testOp.account, accountState)); // Call via the testable version.

        await expect(connect(blueprint, manager).deposit(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithPanic("0x11");
      });
    });
  });

  describe("Function 'withdraw()", async () => {
    describe("Executes as expected for a new account if", async () => {
      it("The amount is non-zero", async () => {
        await executeAndCheckOperation({ newOperationStatus: OperationStatus.Withdrawal, amount: 123456789n });
      });

      it("The amount is zero", async () => {
        await executeAndCheckOperation({ newOperationStatus: OperationStatus.Withdrawal, amount: 0n });
      });
    });

    describe("Is reverted if", async () => {
      it("The caller does not have the manager role", async () => {
        const { blueprint } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();

        await expect(connect(blueprint, stranger).withdraw(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_Access_Control_Unauthorized_Account)
          .withArgs(stranger.address, MANAGER_ROLE);

        // Even if it is called by a deployer
        await expect(connect(blueprint, deployer).withdraw(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_Access_Control_Unauthorized_Account)
          .withArgs(deployer.address, MANAGER_ROLE);
      });

      it("The contract is paused", async () => {
        const { blueprint } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();
        await pauseContract(blueprint);

        await expect(connect(blueprint, manager).withdraw(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_Enforced_Pause);
      });

      it("The provided operation identifier is zero", async () => {
        const { blueprint } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();
        testOp.opId = OP_ID_ZERO;

        await expect(connect(blueprint, manager).withdraw(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_OPERATION_ID_ZERO);
      });

      it("The provided account address is zero", async () => {
        const { blueprint } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();
        testOp.account = ADDRESS_ZERO;

        await expect(connect(blueprint, manager).withdraw(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_ACCOUNT_ADDRESS_ZERO);
      });

      it("The provided amount is greater than 64-bit unsigned integer", async () => {
        const { blueprint, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();
        testOp.amount = maxUintForBits(64) + 1n;
        await proveTx(tokenMock.mint(testOp.account, testOp.amount));

        await expect(connect(blueprint, manager).withdraw(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_AMOUNT_EXCESS);
      });

      it("The operational treasury is not configured", async () => {
        const { blueprint } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();
        await proveTx(blueprint.setOperationalTreasury(ADDRESS_ZERO));

        await expect(connect(blueprint, manager).withdraw(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_OPERATIONAL_TREASURY_ADDRESS_ZERO);
      });

      it("The operation with the provided identifier is already executed", async () => {
        const { blueprint } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();
        await proveTx(connect(blueprint, manager).deposit(testOp.account, testOp.amount, testOp.opId));

        await expect(connect(blueprint, manager).withdraw(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithCustomError(blueprint, ERROR_NAME_OPERATION_ALREADY_EXECUTED)
          .withArgs(testOp.opId);
      });

      it("The result account balance is below zero", async () => {
        const { blueprint } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();
        const accountState: AccountState = { ...defaultAccountState };
        accountState.balance = testOp.amount - 1n;
        await proveTx(blueprint.setAccountState(testOp.account, accountState)); // Call via the testable version.

        await expect(connect(blueprint, manager).withdraw(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithPanic("0x11");
      });

      it("The operation count is greater than 32-bit unsigned integer", async () => {
        const { blueprint } = await setUpFixture(deployAndConfigureContracts);
        const [testOp] = createTestOperations();
        const accountState: AccountState = { ...defaultAccountState };
        accountState.operationCount = maxUintForBits(32);
        accountState.balance = maxUintForBits(64);
        await proveTx(blueprint.setAccountState(testOp.account, accountState)); // Call via the testable version.

        await expect(connect(blueprint, manager).withdraw(testOp.account, testOp.amount, testOp.opId))
          .to.be.revertedWithPanic("0x11");
      });
    });
  });

  describe("Function 'balanceOf()", async () => {
    it("Executes as expected", async () => {
      const { blueprint } = await setUpFixture(deployAndConfigureContracts);
      const accountState: AccountState = { ...defaultAccountState };
      accountState.balance = 987654321n;
      const account = user.address;
      await proveTx(blueprint.setAccountState(account, accountState)); // Call via the testable version.

      expect(await blueprint.balanceOf(account)).to.equal(accountState.balance);
    });
  });
});
