import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  connect,
  getAddress,
  getLatestBlockTimestamp,
  getTxTimestamp,
  increaseBlockTimestamp,
  proveTx,
} from "../test-utils/eth";

const HOUR_IN_SECONDS = 3600;
const DAY_IN_SECONDS = 24 * HOUR_IN_SECONDS;
const NEGATIVE_TIME_SHIFT = 3 * HOUR_IN_SECONDS;
const ZERO_ADDRESS = ethers.ZeroAddress;
const ZERO_BIG_NUMBER = 0n;
const INIT_TOKEN_BALANCE = 1000_000_000_000n;
const MAX_UINT16 = 2 ** 16 - 1;
const OVERFLOW_UINT16 = 2 ** 16;
const OVERFLOW_UINT240 = 2n ** 240n;

interface BalanceRecord {
  accountAddress: string;
  index: number;
  day: number;
  value: bigint;
}

interface TokenTransfer {
  executionDay: number;
  addressFrom: string;
  addressTo: string;
  amount: bigint;
}

interface BalanceChange {
  executionDay: number;
  address: string;
  amountChange: bigint;
}

interface TestContext {
  balanceTracker: Contract;
  balanceTrackerInitDay: number;
  balanceByAddressMap: Map<string, bigint>;
  balanceRecordsByAddressMap: Map<string, BalanceRecord[]>;
}

interface DailyBalancesRequest {
  address: string;
  dayFrom: number;
  dayTo: number;
}

interface Version {
  major: number;
  minor: number;
  patch: number;

  [key: string]: number; // Indexing signature to ensure that fields are iterated over in a key-value style
}

export async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

function toDayAndTime(timestampInSeconds: number): { dayIndex: number; secondsOfDay: number } {
  const correctedTimestamp = timestampInSeconds - NEGATIVE_TIME_SHIFT;
  const dayIndex = Math.floor(correctedTimestamp / DAY_IN_SECONDS);
  const secondsOfDay = correctedTimestamp % DAY_IN_SECONDS;
  return {
    dayIndex,
    secondsOfDay,
  };
}

function toDayIndex(timestampInSeconds: number): number {
  const { dayIndex } = toDayAndTime(timestampInSeconds);
  return dayIndex;
}

async function increaseBlockchainTimeToSpecificRelativeDay(relativeDay: number) {
  relativeDay = Math.floor(relativeDay);
  if (relativeDay < 1) {
    return;
  }
  const currentTimestampInSeconds: number = await getLatestBlockTimestamp();
  const { secondsOfDay } = toDayAndTime(currentTimestampInSeconds);
  await increaseBlockTimestamp(DAY_IN_SECONDS - secondsOfDay + (relativeDay - 1) * DAY_IN_SECONDS + 1);
}

function toBalanceChanges(tokenTransfer: TokenTransfer): BalanceChange[] {
  const addressFromBalanceChange: BalanceChange = {
    executionDay: tokenTransfer.executionDay,
    address: tokenTransfer.addressFrom,
    amountChange: 0n - tokenTransfer.amount,
  };
  const addressToBalanceChange: BalanceChange = {
    executionDay: tokenTransfer.executionDay,
    address: tokenTransfer.addressTo,
    amountChange: tokenTransfer.amount,
  };
  return [addressFromBalanceChange, addressToBalanceChange];
}

async function checkBalanceRecordsForAccount(
  balanceTracker: Contract,
  accountAddress: string,
  expectedBalanceRecords: BalanceRecord[],
) {
  const expectedRecordArrayLength = expectedBalanceRecords.length;
  if (expectedRecordArrayLength == 0) {
    const actualBalanceRecordState = await balanceTracker.readBalanceRecord(accountAddress, 0);
    const actualBalanceRecord = actualBalanceRecordState[0];
    const actualRecordArrayLength = Number(actualBalanceRecordState[1]);
    expect(actualRecordArrayLength).to.equal(
      expectedRecordArrayLength,
      `Wrong record balance array length for account ${accountAddress}. The array should be empty`,
    );
    expect(actualBalanceRecord.day).to.equal(
      0,
      `Wrong field 'balanceRecord[0].day' for empty balance record array of account ${accountAddress}`,
    );
    expect(actualBalanceRecord.value).to.equal(
      0,
      `Wrong field 'balanceRecord[0].value' for empty balance record array of account ${accountAddress}`,
    );
  } else {
    for (let i = 0; i < expectedRecordArrayLength; ++i) {
      const expectedBalanceRecord: BalanceRecord = expectedBalanceRecords[i];
      const actualBalanceRecordState = await balanceTracker.readBalanceRecord(accountAddress, i);
      const actualBalanceRecord = actualBalanceRecordState[0];
      const actualRecordArrayLength = Number(actualBalanceRecordState[1]);
      expect(actualRecordArrayLength).to.equal(
        expectedRecordArrayLength,
        `Wrong record balance array length for account ${accountAddress}`,
      );
      expect(actualBalanceRecord.day).to.equal(
        expectedBalanceRecord.day,
        `Wrong field 'balanceRecord[${i}].day' for account ${accountAddress}`,
      );
      expect(actualBalanceRecord.value).to.equal(
        expectedBalanceRecord.value,
        `Wrong field 'balanceRecord[${i}].value' for account ${accountAddress}`,
      );
    }
  }
}

function applyBalanceChange(context: TestContext, balanceChange: BalanceChange): BalanceRecord | undefined {
  const { address, amountChange } = balanceChange;
  const { balanceByAddressMap, balanceRecordsByAddressMap } = context;
  if (address === ZERO_ADDRESS || amountChange === 0n) {
    return undefined;
  }
  const balance: bigint = balanceByAddressMap.get(address) ?? INIT_TOKEN_BALANCE;
  balanceByAddressMap.set(address, balance + amountChange);
  const balanceRecords: BalanceRecord[] = balanceRecordsByAddressMap.get(address) ?? [];
  let newBalanceRecord: BalanceRecord | undefined = {
    accountAddress: address,
    index: 0,
    day: balanceChange.executionDay - 1,
    value: balance,
  };
  if (balanceRecords.length === 0) {
    if (balanceChange.executionDay === context.balanceTrackerInitDay) {
      newBalanceRecord = undefined;
    } else {
      balanceRecords.push(newBalanceRecord);
    }
  } else {
    const lastRecord: BalanceRecord = balanceRecords[balanceRecords.length - 1];
    if (lastRecord.day == newBalanceRecord.day) {
      newBalanceRecord = undefined;
    } else {
      newBalanceRecord.index = lastRecord.index + 1;
      balanceRecords.push(newBalanceRecord);
    }
  }
  balanceRecordsByAddressMap.set(address, balanceRecords);
  return newBalanceRecord;
}

function defineExpectedDailyBalances(context: TestContext, dailyBalancesRequest: DailyBalancesRequest): bigint[] {
  const { address, dayFrom, dayTo } = dailyBalancesRequest;
  const balanceRecords: BalanceRecord[] = context.balanceRecordsByAddressMap.get(address) ?? [];
  const currentBalance: bigint = context.balanceByAddressMap.get(address) ?? ZERO_BIG_NUMBER;
  if (dayFrom < context.balanceTrackerInitDay) {
    throw new Error(
      `Cannot define daily balances because 'dayFrom' is less than the BalanceTracker init day. ` +
      `The 'dayFrom' value: ${dayFrom}. The init day: ${context.balanceTrackerInitDay}`,
    );
  }
  if (dayFrom > dayTo) {
    throw new Error(
      `Cannot define daily balances because 'dayFrom' is greater than 'dayTo'. ` +
      `The 'dayFrom' value: ${dayFrom}. The 'dayTo' value: ${dayTo}`,
    );
  }
  const dailyBalances: bigint[] = [];
  if (balanceRecords.length === 0) {
    for (let day = dayFrom; day <= dayTo; ++day) {
      dailyBalances.push(currentBalance);
    }
  } else {
    let recordIndex = 0;
    for (let day = dayFrom; day <= dayTo; ++day) {
      for (; recordIndex < balanceRecords.length; ++recordIndex) {
        if (balanceRecords[recordIndex].day >= day) {
          break;
        }
      }
      if (recordIndex >= balanceRecords.length || balanceRecords[recordIndex].day < day) {
        dailyBalances.push(currentBalance);
      } else {
        dailyBalances.push(balanceRecords[recordIndex].value);
      }
    }
  }
  return dailyBalances;
}

/*
 * Deploys a mock ERC20 token using a special account to ensure the token contract address
 * matches a predefined constant `TOKEN` in the `BalanceTracker` contract.
 *
 * This function uses a specific private key to deploy the contract. The transaction count of the
 * special account must be zero to ensure that the first deployed contract matches the `TOKEN`
 * address constant in `BalanceTracker`.
 *
 * If the account has already sent a transaction, the deployment will fail, and the developer
 * must either reset the network or use a different private key. If a new private key is used, the
 * developer must update the `TOKEN` constant in `BalanceTracker` to match the new contract address.
 *
 * Additionally, the function ensures that the special account has sufficient ETH to cover the
 * deployment gas costs. If gas is required, it calculates the estimated gas amount and sends
 * enough ETH from the deployer's account to the special account to cover the deployment.
 */
async function deployTokenMockFromSpecialAccount(deployer: HardhatEthersSigner): Promise<Contract> {
  const tokenMockFactory: ContractFactory = await ethers.getContractFactory("ERC20MockForBalanceTracker");
  const specialPrivateKey = "0x00000000c39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const wallet = new ethers.Wallet(specialPrivateKey, ethers.provider);

  const txCount = await ethers.provider.getTransactionCount(wallet.address);
  if (txCount !== 0) {
    throw new Error(
      "The special account has already sent transactions on this network. " +
      "Please reset (and restart if needed) the network or provide a different private key for the special account. " +
      "If you choose the latter, ensure the 'TOKEN' constant in 'BalanceTracker' is updated with the address " +
      "of the first contract deployed by the special account.",
    );
  }
  const gasPrice: bigint = (await ethers.provider.getFeeData()).gasPrice ?? 0n;

  if (gasPrice > 0n) {
    const deployTx = await tokenMockFactory.connect(wallet).getDeployTransaction();
    const gasEstimation = await ethers.provider.estimateGas(deployTx);
    const ethAmount = gasEstimation * gasPrice * 2n;

    await proveTx(deployer.sendTransaction({
      to: wallet.address,
      value: ethAmount.toString(),
    }));
  }

  const tokenMock = await tokenMockFactory.connect(wallet).deploy() as Contract;
  await tokenMock.waitForDeployment();

  return connect(tokenMock, deployer);
}

describe("Contract 'BalanceTracker'", async () => {
  // Errors of the harness contract under test
  const EVENT_NAME_Harness_Admin_Configured = "HarnessAdminConfigured";

  // Error messages of the library contracts
  const ERROR_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const ERROR_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER = "Ownable: caller is not the owner";

  // Errors of the contract under test
  const ERROR_NAME_FROM_DAY_PRIOR_INIT_DAY = "FromDayPriorInitDay";
  const ERROR_NAME_TO_DAY_PRIOR_FROM_DAY = "ToDayPriorFromDay";
  const ERROR_NAME_SAFE_CAST_OVERFLOW_UINT16 = "SafeCastOverflowUint16";
  const ERROR_NAME_SAFE_CAST_OVERFLOW_UINT240 = "SafeCastOverflowUint240";
  const ERROR_NAME_UNAUTHORIZED_CALLER = "UnauthorizedCaller";
  const ERROR_NAME_UNAUTHORIZED_HARNESS_ADMIN = "UnauthorizedHarnessAdmin";

  const EXPECTED_VERSION: Version = {
    major: 1,
    minor: 1,
    patch: 2,
  };

  let balanceTrackerFactory: ContractFactory;
  let tokenMock: Contract;
  let deployer: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  before(async () => {
    [deployer, attacker, user1, user2] = await ethers.getSigners();
    tokenMock = await deployTokenMockFromSpecialAccount(deployer);
    await increaseBlockchainTimeToSpecificRelativeDay(1);
    balanceTrackerFactory = await ethers.getContractFactory("BalanceTrackerHarness");
  });

  async function deployAndConfigureContracts(): Promise<{
    balanceTracker: Contract;
    balanceTrackerInitDay: number;
  }> {
    const balanceTracker = await upgrades.deployProxy(
      balanceTrackerFactory,
      [],
      { unsafeSkipProxyAdminCheck: true }, // This is necessary to run tests on other networks
    );
    await balanceTracker.waitForDeployment();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const tx = balanceTracker.deploymentTransaction()!;
    const deploymentTimestamp = await getTxTimestamp(tx);
    const balanceTrackerInitDay = toDayIndex(deploymentTimestamp);
    await proveTx(connect(balanceTracker, deployer).configureHarnessAdmin(deployer.address, true));
    await proveTx(tokenMock.setBalance(user1.address, INIT_TOKEN_BALANCE));
    await proveTx(tokenMock.setBalance(user2.address, INIT_TOKEN_BALANCE));
    return {
      balanceTracker: connect(balanceTracker, deployer),
      balanceTrackerInitDay,
    };
  }

  async function initTestContext(): Promise<TestContext> {
    const { balanceTracker, balanceTrackerInitDay } = await setUpFixture(deployAndConfigureContracts);
    const balanceByAddressMap = new Map<string, bigint>();
    balanceByAddressMap.set(user1.address, INIT_TOKEN_BALANCE);
    balanceByAddressMap.set(user2.address, INIT_TOKEN_BALANCE);
    const balanceRecordsByAddressMap = new Map<string, BalanceRecord[]>();
    return {
      balanceTracker,
      balanceTrackerInitDay,
      balanceByAddressMap,
      balanceRecordsByAddressMap,
    };
  }

  async function executeTokenTransfers(context: TestContext, transfers: TokenTransfer[]) {
    const { balanceTracker } = context;
    let previousTransferDay: number = toDayIndex(await getLatestBlockTimestamp());
    for (let i = 0; i < transfers.length; ++i) {
      const transfer: TokenTransfer = transfers[i];
      if (transfer.executionDay < previousTransferDay) {
        throw new Error(
          `In the array of token transfers transfer[${i}] has execution day lower than one of the previous transfer`,
        );
      }
      const nextRelativeDay = transfer.executionDay - previousTransferDay;
      await increaseBlockchainTimeToSpecificRelativeDay(nextRelativeDay);
      previousTransferDay = transfer.executionDay;

      const tx: TransactionResponse = await tokenMock.simulateHookedTransfer(
        getAddress(balanceTracker),
        transfer.addressFrom,
        transfer.addressTo,
        transfer.amount,
      );
      const balanceChanges: BalanceChange[] = toBalanceChanges(transfer);
      const newBalanceRecord1: BalanceRecord | undefined = applyBalanceChange(context, balanceChanges[0]);
      const newBalanceRecord2: BalanceRecord | undefined = applyBalanceChange(context, balanceChanges[1]);

      if (!newBalanceRecord1 && !newBalanceRecord2) {
        await expect(tx).not.to.emit(balanceTracker, "BalanceRecordCreated");
      } else {
        if (newBalanceRecord1) {
          await expect(tx)
            .to.emit(balanceTracker, "BalanceRecordCreated")
            .withArgs(
              newBalanceRecord1.accountAddress,
              newBalanceRecord1.day,
              newBalanceRecord1.value,
            );
        }
        if (newBalanceRecord2) {
          await expect(tx)
            .to.emit(balanceTracker, "BalanceRecordCreated")
            .withArgs(
              newBalanceRecord2.accountAddress,
              newBalanceRecord2.day,
              newBalanceRecord2.value,
            );
        }
      }
    }
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { balanceTracker, balanceTrackerInitDay } = await setUpFixture(deployAndConfigureContracts);
      expect(await balanceTracker.NEGATIVE_TIME_SHIFT()).to.equal(NEGATIVE_TIME_SHIFT);
      expect(await balanceTracker.TOKEN()).to.equal(getAddress(tokenMock));
      expect(await balanceTracker.token()).to.equal(getAddress(tokenMock));
      expect(await balanceTracker.INITIALIZATION_DAY()).to.equal(balanceTrackerInitDay);
      expect(await balanceTracker.owner()).to.equal(deployer.address);

      // To check the reading function against the empty balance record array
      await checkBalanceRecordsForAccount(balanceTracker, deployer.address, []);
    });

    it("Is reverted if called for the second time", async () => {
      const { balanceTracker } = await setUpFixture(deployAndConfigureContracts);
      await expect(balanceTracker.initialize())
        .to.be.revertedWith(ERROR_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the implementation contract is called even for the first time", async () => {
      const balanceTrackerImplementation = await balanceTrackerFactory.deploy() as Contract;
      await balanceTrackerImplementation.waitForDeployment();
      await expect(balanceTrackerImplementation.initialize())
        .to.be.revertedWith(ERROR_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });
  });

  describe("Function '$__VERSION()'", async () => {
    it("Returns expected values", async () => {
      const { balanceTracker } = await setUpFixture(deployAndConfigureContracts);
      const balanceTrackerVersion = await balanceTracker.$__VERSION();
      Object.keys(EXPECTED_VERSION).forEach((property) => {
        const value = balanceTrackerVersion[property];
        if (typeof value === "undefined" || typeof value === "function" || typeof value === "object") {
          throw Error(`Property "${property}" is not found`);
        }
        expect(value).to.eq(
          EXPECTED_VERSION[property],
          `Mismatch in the "${property}" property`,
        );
      });
    });
  });

  describe("Function 'afterTokenTransfer()'", async () => {
    async function checkTokenTransfers(context: TestContext, transfers: TokenTransfer[]) {
      await executeTokenTransfers(context, transfers);
      for (const address of context.balanceRecordsByAddressMap.keys()) {
        const expectedBalanceRecords: BalanceRecord[] = context.balanceRecordsByAddressMap.get(address) ?? [];
        await checkBalanceRecordsForAccount(context.balanceTracker, address, expectedBalanceRecords);
      }
    }

    describe("Executes as expected if", async () => {
      describe("A token transfer happens on the next day after the initialization and", async () => {
        describe("The amount of tokens is non-zero and", async () => {
          it("Addresses 'from' and 'to' are both non-zero", async () => {
            const context: TestContext = await initTestContext();
            const nextDayAfterInit = context.balanceTrackerInitDay + 1;
            const transfer: TokenTransfer = {
              executionDay: nextDayAfterInit,
              addressFrom: user1.address,
              addressTo: user2.address,
              amount: 123456789n,
            };
            await checkTokenTransfers(context, [transfer]);
          });

          it("Address 'from' is non-zero, address 'to' is zero", async () => {
            const context: TestContext = await initTestContext();
            const nextDayAfterInit = context.balanceTrackerInitDay + 1;
            const transfer: TokenTransfer = {
              executionDay: nextDayAfterInit,
              addressFrom: user1.address,
              addressTo: ZERO_ADDRESS,
              amount: 123456789n,
            };
            await checkTokenTransfers(context, [transfer]);
          });

          it("Address 'from' is zero, address 'to' is non-zero", async () => {
            const context: TestContext = await initTestContext();
            const nextDayAfterInit = context.balanceTrackerInitDay + 1;
            const transfer: TokenTransfer = {
              executionDay: nextDayAfterInit,
              addressFrom: ZERO_ADDRESS,
              addressTo: user2.address,
              amount: 123456789n,
            };
            await checkTokenTransfers(context, [transfer]);
          });
        });

        describe("The amount of tokens is zero and", async () => {
          it("Addresses 'from' and 'to' are both non-zero", async () => {
            const context: TestContext = await initTestContext();
            const nextDayAfterInit = context.balanceTrackerInitDay + 1;
            const transfer: TokenTransfer = {
              executionDay: nextDayAfterInit,
              addressFrom: user1.address,
              addressTo: user2.address,
              amount: ZERO_BIG_NUMBER,
            };
            await checkTokenTransfers(context, [transfer]);
          });
        });
      });

      describe("A token transfer happens on the same day as the initialization one and", async () => {
        it("The amount of tokens is non-zero and addresses 'from' and 'to' are both non-zero", async () => {
          const context: TestContext = await initTestContext();
          const transfer: TokenTransfer = {
            executionDay: context.balanceTrackerInitDay,
            addressFrom: user1.address,
            addressTo: user2.address,
            amount: 123456789n,
          };
          await checkTokenTransfers(context, [transfer]);
        });
      });

      describe("Two transfers happen on the next day after the initialization and", async () => {
        it("The amount of tokens is non-zero and addresses 'from' and 'to' are both non-zero", async () => {
          const context: TestContext = await initTestContext();
          const nextDayAfterInit = context.balanceTrackerInitDay + 1;
          const transfer1: TokenTransfer = {
            executionDay: nextDayAfterInit,
            addressFrom: user1.address,
            addressTo: user2.address,
            amount: 123456789n,
          };
          const transfer2: TokenTransfer = {
            executionDay: nextDayAfterInit,
            addressFrom: user2.address,
            addressTo: user1.address,
            amount: 987654321n,
          };
          await checkTokenTransfers(context, [transfer1, transfer2]);
        });
      });
    });

    describe("Is reverted if ", async () => {
      it("Is called not by a token", async () => {
        const context: TestContext = await initTestContext();
        await expect(connect(context.balanceTracker, attacker).afterTokenTransfer(user1.address, user2.address, 123))
          .to.be.revertedWithCustomError(context.balanceTracker, ERROR_NAME_UNAUTHORIZED_CALLER)
          .withArgs(attacker.address);
      });

      describe("A token transfer happens not on the initialization day and the amount is non-zero and", async () => {
        it("The initial token balance is greater than 240-bit unsigned value", async () => {
          const context: TestContext = await initTestContext();
          const wrongValue = (OVERFLOW_UINT240);
          await proveTx(
            tokenMock.setBalance(
              user1.address,
              wrongValue,
            ),
          );

          await increaseBlockchainTimeToSpecificRelativeDay(1);

          await expect(
            tokenMock.simulateHookedTransfer(
              getAddress(context.balanceTracker),
              user1.address,
              user2.address,
              1,
            ),
          ).to.be.revertedWithCustomError(context.balanceTracker, ERROR_NAME_SAFE_CAST_OVERFLOW_UINT240);
        });

        it("The transfer day index is greater than 16-bit unsigned value", async () => {
          const context: TestContext = await initTestContext();

          // `+1n` is because a balance records are created for a previous day, not the current one
          const wrongDayIndex = OVERFLOW_UINT16 + 1;

          await proveTx(context.balanceTracker.setUsingRealBlockTimestamps(false));
          await proveTx(context.balanceTracker.setBlockTimestamp(wrongDayIndex, NEGATIVE_TIME_SHIFT));

          await expect(
            tokenMock.simulateHookedTransfer(
              getAddress(context.balanceTracker),
              user1.address,
              user2.address,
              1,
            ),
          ).to.be.revertedWithCustomError(context.balanceTracker, ERROR_NAME_SAFE_CAST_OVERFLOW_UINT16);

          await proveTx(context.balanceTracker.setUsingRealBlockTimestamps(true));
        });
      });
    });
  });

  describe("Function 'beforeTokenTransfer()'", async () => {
    describe("Is reverted if ", async () => {
      it("Is called not by a token", async () => {
        const context: TestContext = await initTestContext();
        await expect(connect(context.balanceTracker, attacker).beforeTokenTransfer(user1.address, user2.address, 123))
          .to.be.revertedWithCustomError(context.balanceTracker, ERROR_NAME_UNAUTHORIZED_CALLER)
          .withArgs(attacker.address);
      });
    });
  });

  describe("Function 'getDailyBalances()'", async () => {
    describe("Executes as expected if", async () => {
      async function checkDailyBalances(
        context: TestContext,
        tokenTransfers: TokenTransfer[],
        dayFrom: number,
        dayTo: number,
      ) {
        await executeTokenTransfers(context, tokenTransfers);
        const expectedDailyBalancesForUser1: bigint[] = defineExpectedDailyBalances(context, {
          address: user1.address,
          dayFrom,
          dayTo,
        });
        const expectedDailyBalancesForUser2: bigint[] = defineExpectedDailyBalances(context, {
          address: user2.address,
          dayFrom,
          dayTo,
        });
        const actualDailyBalancesForUser1: bigint[] = await context.balanceTracker.getDailyBalances(
          user1.address,
          dayFrom,
          dayTo,
        );
        const actualDailyBalancesForUser2: bigint[] = await context.balanceTracker.getDailyBalances(
          user2.address,
          dayFrom,
          dayTo,
        );
        expect(expectedDailyBalancesForUser1).to.deep.equal(actualDailyBalancesForUser1);
        expect(expectedDailyBalancesForUser2).to.deep.equal(actualDailyBalancesForUser2);
      }

      function prepareTokenTransfers(firstTransferDay: number, numberOfTransfers = 3): TokenTransfer[] {
        const transfer1: TokenTransfer = {
          executionDay: firstTransferDay,
          addressFrom: user1.address,
          addressTo: user2.address,
          amount: 123456789n,
        };
        const transfer2: TokenTransfer = {
          executionDay: firstTransferDay + 3,
          addressFrom: user2.address,
          addressTo: user1.address,
          amount: 987654321n,
        };
        const transfer3: TokenTransfer = {
          executionDay: firstTransferDay + 7,
          addressFrom: user1.address,
          addressTo: user2.address,
          amount: 987654320n / 2n,
        };
        if (numberOfTransfers > 3 || numberOfTransfers < 1) {
          throw Error(`Invalid number of transfers: ${numberOfTransfers}`);
        }
        return [transfer1, transfer2, transfer3].slice(0, numberOfTransfers);
      }

      describe("There are 3 balance records starting from the init day with gaps and", async () => {
        it("The 'from' day equals the init day and the `to` day equals the 'from' day", async () => {
          const context: TestContext = await initTestContext();
          const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 1);
          const dayFrom: number = context.balanceTrackerInitDay;
          const dayTo: number = (dayFrom);
          await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
        });

        it("The 'from' day equals the init day and the `to` day is after the last record", async () => {
          const context: TestContext = await initTestContext();
          const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 1);
          const dayFrom: number = context.balanceTrackerInitDay;
          const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay + 1;
          await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
        });

        it("The 'from' day is after the init day and the `to` day is after the first record", async () => {
          const context: TestContext = await initTestContext();
          const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 1);
          const dayFrom: number = context.balanceTrackerInitDay + 1;
          const dayTo: number = tokenTransfers[0].executionDay + 1;
          await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
        });

        it("The 'from' day is after the init day and the `to` day is before the last record", async () => {
          const context: TestContext = await initTestContext();
          const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 1);
          const dayFrom: number = context.balanceTrackerInitDay + 1;
          const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 2;
          await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
        });
      });

      describe("There are 3 balance records starting 2 days after the init day with gaps and", async () => {
        describe("The 'from' day equals the init day and", async () => {
          it("The `to` day equals the 'from' day", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = context.balanceTrackerInitDay;
            const dayTo: number = (dayFrom);
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is before the first record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = context.balanceTrackerInitDay;
            const dayTo: number = tokenTransfers[0].executionDay - 2;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day equals the first record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = context.balanceTrackerInitDay;
            const dayTo: number = tokenTransfers[0].executionDay - 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is after the first record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = context.balanceTrackerInitDay;
            const dayTo: number = tokenTransfers[0].executionDay + 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is before the last record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = context.balanceTrackerInitDay;
            const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 2;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day equals the last record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = context.balanceTrackerInitDay;
            const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is after the last record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = context.balanceTrackerInitDay;
            const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay + 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });
        });

        describe("The 'from' day is before the first record", async () => {
          it("The `to` day equals the 'from' day", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[0].executionDay - 2;
            const dayTo: number = (dayFrom);
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day equals the first record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[0].executionDay - 2;
            const dayTo: number = tokenTransfers[0].executionDay - 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is after the first record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[0].executionDay - 2;
            const dayTo: number = tokenTransfers[0].executionDay + 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is before the last record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[0].executionDay - 2;
            const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 2;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day equals the last record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[0].executionDay - 2;
            const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is after the last record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[0].executionDay - 2;
            const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay + 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });
        });

        describe("The 'from' day equals the first record", async () => {
          it("The `to` day equals the 'from' day", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[0].executionDay - 1;
            const dayTo: number = (dayFrom);
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is after the first record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[0].executionDay - 1;
            const dayTo: number = tokenTransfers[0].executionDay + 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is before the last record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[0].executionDay - 1;
            const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 2;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day equals the last record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[0].executionDay - 1;
            const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is after the last record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[0].executionDay - 1;
            const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay + 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });
        });

        describe("The 'from' day is after the first record", async () => {
          it("The `to` day equals the 'from' day", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[0].executionDay + 1;
            const dayTo: number = (dayFrom);
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is before the last record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[0].executionDay + 1;
            const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 2;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day equals the last record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[0].executionDay + 1;
            const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is after the last record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[0].executionDay + 1;
            const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay + 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });
        });

        describe("The 'from' day is before the last record", async () => {
          it("The `to` day equals the 'from' day", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 2;
            const dayTo: number = (dayFrom);
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day equals the last record day", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 2;
            const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is after the last record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 2;
            const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay + 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });
        });

        describe("The 'from' day equals the last record", async () => {
          it("The `to` day equals the 'from' day", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 1;
            const dayTo: number = (dayFrom);
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is after the last record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[tokenTransfers.length - 1].executionDay - 1;
            const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay + 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });
        });

        describe("The 'from' day is after the last record", async () => {
          it("The `to` day equals the 'from' day", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[tokenTransfers.length - 1].executionDay + 1;
            const dayTo: number = (dayFrom);
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is after the last record and the 'from' day", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3);
            const dayFrom: number = tokenTransfers[tokenTransfers.length - 1].executionDay + 1;
            const dayTo: number = tokenTransfers[tokenTransfers.length - 1].executionDay + 3;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });
        });
      });

      describe("There is a single starting 2 days after the init day with gaps day and", async () => {
        describe("The 'from' day equals the init day and", async () => {
          it("The `to` day equals the 'from' day", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3, 1);
            const dayFrom: number = context.balanceTrackerInitDay;
            const dayTo: number = (dayFrom);
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is before the first record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3, 1);
            const dayFrom: number = context.balanceTrackerInitDay;
            const dayTo: number = tokenTransfers[0].executionDay - 2;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day equals the first record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3, 1);
            const dayFrom: number = context.balanceTrackerInitDay;
            const dayTo: number = tokenTransfers[0].executionDay - 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is after the first record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3, 1);
            const dayFrom: number = context.balanceTrackerInitDay;
            const dayTo: number = tokenTransfers[0].executionDay + 3;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });
        });

        describe("The 'from' day is before the first record", async () => {
          it("The `to` day equals the 'from' day", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3, 1);
            const dayFrom: number = tokenTransfers[0].executionDay - 2;
            const dayTo: number = (dayFrom);
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day equals the first record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3, 1);
            const dayFrom: number = tokenTransfers[0].executionDay - 2;
            const dayTo: number = tokenTransfers[0].executionDay - 1;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is after the first record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3, 1);
            const dayFrom: number = tokenTransfers[0].executionDay - 2;
            const dayTo: number = tokenTransfers[0].executionDay + 3;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });
        });

        describe("The 'from' day equals the first record", async () => {
          it("The `to` day equals the 'from' day", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3, 1);
            const dayFrom: number = tokenTransfers[0].executionDay - 1;
            const dayTo: number = (dayFrom);
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is after the first record", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3, 1);
            const dayFrom: number = tokenTransfers[0].executionDay - 1;
            const dayTo: number = tokenTransfers[0].executionDay + 3;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });
        });

        describe("The 'from' day is after the first record", async () => {
          it("The `to` day equals the 'from' day", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3, 1);
            const dayFrom: number = tokenTransfers[0].executionDay + 3;
            const dayTo: number = (dayFrom);
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });

          it("The `to` day is after the 'from' day", async () => {
            const context: TestContext = await initTestContext();
            const tokenTransfers: TokenTransfer[] = prepareTokenTransfers(context.balanceTrackerInitDay + 3, 1);
            const dayFrom: number = tokenTransfers[0].executionDay + 3;
            const dayTo: number = dayFrom + 3;
            await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
          });
        });
      });

      describe("There are no balance records", async () => {
        it("The 'from' day equals the init day and the `to` day equals the 'from' day", async () => {
          const context: TestContext = await initTestContext();
          const tokenTransfers: TokenTransfer[] = [];
          const dayFrom: number = context.balanceTrackerInitDay;
          const dayTo: number = (dayFrom);
          await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
        });

        it("The 'from' day equals the init day and the `to` day is three days after the init day", async () => {
          const context: TestContext = await initTestContext();
          const tokenTransfers: TokenTransfer[] = [];
          const dayFrom: number = context.balanceTrackerInitDay;
          const dayTo: number = context.balanceTrackerInitDay + 3;
          await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
        });

        it("The 'from' day is 3 days after the init day and the `to` day equals the 'from' day", async () => {
          const context: TestContext = await initTestContext();
          const tokenTransfers: TokenTransfer[] = [];
          const dayFrom: number = context.balanceTrackerInitDay + 3;
          const dayTo: number = (dayFrom);
          await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
        });

        it("The 'from' day is 3 days after the init day and the `to` day is 5 days after the init day", async () => {
          const context: TestContext = await initTestContext();
          const tokenTransfers: TokenTransfer[] = [];
          const dayFrom: number = context.balanceTrackerInitDay + 3;
          const dayTo: number = context.balanceTrackerInitDay + 5;
          await checkDailyBalances(context, tokenTransfers, dayFrom, dayTo);
        });
      });
    });

    describe("Is reverted if", async () => {
      it("The 'from' day is prior the contract init day", async () => {
        const context: TestContext = await initTestContext();
        const dayFrom = context.balanceTrackerInitDay - 1;
        const dayTo = context.balanceTrackerInitDay + 1;
        await expect(context.balanceTracker.getDailyBalances(user1.address, dayFrom, dayTo))
          .to.be.revertedWithCustomError(context.balanceTracker, ERROR_NAME_FROM_DAY_PRIOR_INIT_DAY);
      });

      it("The 'to' day is prior the 'from' day", async () => {
        const context: TestContext = await initTestContext();
        const dayFrom = context.balanceTrackerInitDay + 2;
        const dayTo = context.balanceTrackerInitDay + 1;
        await expect(context.balanceTracker.getDailyBalances(user1.address, dayFrom, dayTo))
          .to.be.revertedWithCustomError(context.balanceTracker, ERROR_NAME_TO_DAY_PRIOR_FROM_DAY);
      });
    });
  });

  describe("Harness functions", async () => {
    const accountAddress = "0x0000000000000000000000000000000000000001";
    const balanceRecords: BalanceRecord[] = [
      {
        accountAddress,
        index: 0,
        day: 123,
        value: 3456789n,
      },
      {
        accountAddress,
        index: 1,
        day: 321,
        value: 987654321n,
      },
    ];

    const balanceRecordsRaw: { day: number; value: bigint }[] = balanceRecords.map(record => (
      {
        day: record.day,
        value: record.value,
      }
    ));

    describe("Function `configureHarnessAdmin()`", async () => {
      it("Executes as expected if it is called by the owner", async () => {
        const context: TestContext = await initTestContext();
        const harnessAdminAddress = user1.address;

        await expect(context.balanceTracker.configureHarnessAdmin(harnessAdminAddress, true))
          .to.emit(context.balanceTracker, EVENT_NAME_Harness_Admin_Configured)
          .withArgs(harnessAdminAddress, true);
        expect(await context.balanceTracker.isHarnessAdmin(harnessAdminAddress)).to.equal(true);

        // Do not emit the event if called the second time with the same parameters
        await expect(context.balanceTracker.configureHarnessAdmin(harnessAdminAddress, true))
          .not.to.emit(context.balanceTracker, EVENT_NAME_Harness_Admin_Configured);

        await expect(context.balanceTracker.configureHarnessAdmin(harnessAdminAddress, false))
          .to.emit(context.balanceTracker, EVENT_NAME_Harness_Admin_Configured)
          .withArgs(harnessAdminAddress, false);
        expect(await context.balanceTracker.isHarnessAdmin(harnessAdminAddress)).to.equal(false);
      });

      it("Is reverted if called not by the owner", async () => {
        const context: TestContext = await initTestContext();
        await expect(connect(context.balanceTracker, attacker).configureHarnessAdmin(user1.address, true))
          .to.be.revertedWith(ERROR_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
      });
    });

    describe("Function `setInitializationDay()`", async () => {
      it("Executes as expected if it is called by the owner", async () => {
        const context: TestContext = await initTestContext();

        const oldInitializationDay = await context.balanceTracker.INITIALIZATION_DAY();
        const newInitializationDay = MAX_UINT16;
        expect(oldInitializationDay).not.to.equal(newInitializationDay);

        await proveTx(context.balanceTracker.setInitializationDay(newInitializationDay));
        expect(await context.balanceTracker.INITIALIZATION_DAY()).to.equal(newInitializationDay);
      });

      it("Is reverted if called not by the owner", async () => {
        const context: TestContext = await initTestContext();
        await expect(connect(context.balanceTracker, attacker).setInitializationDay(123))
          .to.be.revertedWith(ERROR_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
      });
    });

    describe("Function `addBalanceRecord()`", async () => {
      it("Executes as expected if it is called by a harness admin", async () => {
        const context: TestContext = await initTestContext();
        const balanceRecord = balanceRecords[0];

        await proveTx(context.balanceTracker.addBalanceRecord(
          balanceRecord.accountAddress,
          balanceRecord.day,
          balanceRecord.value,
        ));
        await checkBalanceRecordsForAccount(context.balanceTracker, balanceRecord.accountAddress, [balanceRecord]);
      });

      it("Is reverted if called not by a harness admin", async () => {
        const context: TestContext = await initTestContext();
        const balanceRecord = balanceRecords[0];

        await expect(
          connect(context.balanceTracker, attacker).addBalanceRecord(
            balanceRecord.accountAddress,
            balanceRecord.day,
            balanceRecord.value,
          ),
        ).to.be.revertedWithCustomError(
          context.balanceTracker,
          ERROR_NAME_UNAUTHORIZED_HARNESS_ADMIN,
        ).withArgs(attacker.address);
      });
    });

    describe("Function `setBalanceRecords()`", async () => {
      it("Executes as expected if it is called by a harness admin", async () => {
        const context: TestContext = await initTestContext();

        await proveTx(context.balanceTracker.setBalanceRecords(accountAddress, balanceRecordsRaw));
        await checkBalanceRecordsForAccount(context.balanceTracker, accountAddress, balanceRecords);
      });

      it("Is reverted if called not by a harness admin", async () => {
        const context: TestContext = await initTestContext();
        await expect(connect(context.balanceTracker, attacker).setBalanceRecords(accountAddress, balanceRecordsRaw))
          .to.be.revertedWithCustomError(context.balanceTracker, ERROR_NAME_UNAUTHORIZED_HARNESS_ADMIN)
          .withArgs(attacker.address);
      });
    });

    describe("Function `deleteBalanceRecords()`", async () => {
      it("Executes as expected if it is called by a harness admin", async () => {
        const context: TestContext = await initTestContext();

        await proveTx(context.balanceTracker.setBalanceRecords(accountAddress, balanceRecordsRaw));
        await checkBalanceRecordsForAccount(context.balanceTracker, accountAddress, balanceRecords);

        await proveTx(context.balanceTracker.deleteBalanceRecords(accountAddress));
        await checkBalanceRecordsForAccount(context.balanceTracker, accountAddress, []);
      });

      it("Is reverted if called not by a harness admin", async () => {
        const context: TestContext = await initTestContext();
        await expect(connect(context.balanceTracker, attacker).deleteBalanceRecords(accountAddress))
          .to.be.revertedWithCustomError(context.balanceTracker, ERROR_NAME_UNAUTHORIZED_HARNESS_ADMIN)
          .withArgs(attacker.address);
      });
    });

    describe("Function `setBlockTimestamp()`", async () => {
      const day = 123;
      const time = 456;

      it("Executes as expected if it is called by a harness admin", async () => {
        const context: TestContext = await initTestContext();
        const timestamp = day * 24 * 60 * 60 + time;
        const expectedDayAndTime = toDayAndTime(timestamp);
        const expectedDayAndTimeArray = [expectedDayAndTime.dayIndex, expectedDayAndTime.secondsOfDay];

        await proveTx(context.balanceTracker.setBlockTimestamp(day, time));
        expect(await context.balanceTracker.getCurrentBlockTimestamp()).to.equal(timestamp);
        expect(await context.balanceTracker.dayAndTime()).to.deep.equal(expectedDayAndTimeArray);

        // Check the case when the timestamp is less than NEGATIVE_TIME_SHIFT
        await proveTx(context.balanceTracker.setBlockTimestamp(0, NEGATIVE_TIME_SHIFT - 1));
        expect(await context.balanceTracker.getCurrentBlockTimestamp()).to.equal(NEGATIVE_TIME_SHIFT - 1);
        expect(await context.balanceTracker.dayAndTime()).to.deep.equal([0, 0]);
      });

      it("Is reverted if called not by a harness admin", async () => {
        const context: TestContext = await initTestContext();
        await expect(connect(context.balanceTracker, attacker).setBlockTimestamp(day, time))
          .to.be.revertedWithCustomError(context.balanceTracker, ERROR_NAME_UNAUTHORIZED_HARNESS_ADMIN)
          .withArgs(attacker.address);
      });
    });

    describe("Function `setUsingRealBlockTimestamps()`", async () => {
      it("Executes as expected if it is called by a harness admin", async () => {
        const context: TestContext = await initTestContext();

        await proveTx(context.balanceTracker.setUsingRealBlockTimestamps(true));
        expect(await context.balanceTracker.getUsingRealBlockTimestamps()).to.equal(true);
        expect(await context.balanceTracker.dayAndTime()).not.to.deep.equal([0, 0]);

        await proveTx(context.balanceTracker.setUsingRealBlockTimestamps(false));
        expect(await context.balanceTracker.getUsingRealBlockTimestamps()).to.equal(false);
        expect(await context.balanceTracker.dayAndTime()).to.deep.equal([0, 0]);
      });

      it("Is reverted if called not by the owner", async () => {
        const context: TestContext = await initTestContext();
        await expect(connect(context.balanceTracker, attacker).setUsingRealBlockTimestamps(true))
          .to.be.revertedWith(ERROR_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
      });
    });
  });
});
