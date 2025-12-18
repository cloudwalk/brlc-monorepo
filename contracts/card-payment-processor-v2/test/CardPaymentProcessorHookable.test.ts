import * as Contracts from "../typechain-types";
import { ethers, upgrades } from "hardhat";
import { setUpFixture } from "../test-utils/common";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { BaseContract, TransactionResponse } from "ethers";

const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
const EXECUTOR_ROLE: string = ethers.id("EXECUTOR_ROLE");
const HOOK_TRIGGER_ROLE: string = ethers.id("HOOK_TRIGGER_ROLE");

const CASHBACK_RATE_AS_IN_CONTRACT = -1n;

const EVENT_NAME_HOOK_REGISTERED = "HookRegistered";
const EVENT_NAME_HOOK_UNREGISTERED = "HookUnregistered";
const EVENT_NAME_LOG_AFTER_PAYMENT_MADE = "LogAfterPaymentMade";

const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";
const ERROR_NAME_REVERT_FROM_AFTER_PAYMENT_MADE = "RevertFromAfterPaymentMade";

let deployer: HardhatEthersSigner;
let user1: HardhatEthersSigner;
let cashOutAccount: HardhatEthersSigner;

let cardPaymentProcessorFactory: Contracts.CardPaymentProcessor__factory;
let tokenMockFactory: Contracts.ERC20TokenMock__factory;
let hookContractMockFactory: Contracts.HookContractMock__factory;
let cashbackControllerFactory: Contracts.CashbackController__factory;

async function calculateUnregistrationProof(hookContract: BaseContract, cardPaymentProcessor: BaseContract) {
  return ethers.toBeHex(
    BigInt(ethers.keccak256(ethers.toUtf8Bytes("unregisterHook"))) ^
    BigInt(await hookContract.getAddress()) ^
    BigInt(await cardPaymentProcessor.getAddress()),
    32,
  );
}

async function deployContracts() {
  const name = "ERC20 Test";
  const symbol = "TEST";

  const tokenMockDeployment = await tokenMockFactory.deploy(name, symbol);
  await tokenMockDeployment.waitForDeployment();

  const tokenMock = tokenMockDeployment.connect(deployer);
  const cardPaymentProcessor = await upgrades.deployProxy(
    cardPaymentProcessorFactory, [await tokenMock.getAddress(), cashOutAccount.address],
  );
  await cardPaymentProcessor.waitForDeployment();

  return { cardPaymentProcessor, tokenMock };
}

describe("Contract 'CardPaymentProcessorHookable'", () => {
  let cardPaymentProcessor: Contracts.CardPaymentProcessor;
  let tokenMock: Contracts.ERC20TokenMock;

  let cardPaymentProcessorAddress: string;

  let tokenMockAddress: string;

  async function configureContracts(
    cardPaymentProcessor: Contracts.CardPaymentProcessor,
  ) {
    await cardPaymentProcessor.grantRole(GRANTOR_ROLE, deployer.address);
    await cardPaymentProcessor.grantRole(EXECUTOR_ROLE, deployer.address);
  }

  async function deployAndConfigureMainContracts() {
    const contracts = await deployContracts();
    await configureContracts(contracts.cardPaymentProcessor);
    return contracts;
  }

  async function deployAndConfigureCashbackController() {
    const cashbackController = await upgrades.deployProxy(cashbackControllerFactory, [await tokenMock.getAddress()]);
    await cashbackController.waitForDeployment();
    return cashbackController;
  }

  async function deployHookContract() {
    const hookContract = await hookContractMockFactory.deploy();
    await hookContract.waitForDeployment();
    return hookContract;
  }

  before(async () => {
    [deployer, user1, cashOutAccount] = await ethers.getSigners();

    cardPaymentProcessorFactory = await ethers.getContractFactory("CardPaymentProcessor")
      .then(factory => factory.connect(deployer));
    tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock")
      .then(factory => factory.connect(deployer));
    hookContractMockFactory = await ethers.getContractFactory("HookContractMock")
      .then(factory => factory.connect(deployer));
    cashbackControllerFactory = await ethers.getContractFactory("CashbackController")
      .then(factory => factory.connect(deployer));
  });

  beforeEach(async () => {
    ({ cardPaymentProcessor, tokenMock } = await setUpFixture(deployAndConfigureMainContracts));
    cardPaymentProcessorAddress = await cardPaymentProcessor.getAddress();
    tokenMockAddress = await tokenMock.getAddress();
  });

  describe("Hook with only one method implemented", () => {
    let hookContract: Contracts.HookContractMock;
    let hookContractAddress: string;

    beforeEach(async () => {
      hookContract = await setUpFixture(deployHookContract);
      hookContractAddress = await hookContract.getAddress();
    });

    describe("Method 'registerHook()'", () => {
      describe("Should execute as expected when called the first time and", () => {
        let tx: TransactionResponse;
        beforeEach(async () => {
          tx = await cardPaymentProcessor.registerHook(hookContractAddress);
        });

        it("should emit the required event", async () => {
          await expect(tx)
            .to.emit(cardPaymentProcessor, EVENT_NAME_HOOK_REGISTERED)
            .withArgs(hookContractAddress, hookContract.afterPaymentMade.fragment.selector);
        });

        it("should emit the required count of events", async () => {
          const receipt = await tx.provider.getTransactionReceipt(tx.hash);
          const eventsCount = receipt?.logs.length || 0;
          expect(eventsCount).to.equal(1);
        });

        describe("Should execute as expected after the hook stops supporting a method and", () => {
          let tx: TransactionResponse;
          beforeEach(async () => {
            await hookContract.setSupportsAfterPaymentMade(false);
            tx = await cardPaymentProcessor.registerHook(hookContractAddress);
          });

          it("should emit the required event", async () => {
            await expect(tx)
              .to.emit(cardPaymentProcessor, EVENT_NAME_HOOK_UNREGISTERED)
              .withArgs(hookContractAddress, hookContract.afterPaymentMade.fragment.selector);
          });

          it("should emit the required count of events", async () => {
            const receipt = await tx.provider.getTransactionReceipt(tx.hash);
            const eventsCount = receipt?.logs.length || 0;
            expect(eventsCount).to.equal(1);
          });
        });
      });

      describe("Should revert if", () => {
        it("the caller does not have the required role", async () => {
          await expect(cardPaymentProcessor.connect(user1).registerHook(hookContractAddress))
            .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
            .withArgs(user1.address, OWNER_ROLE);
        });
      });
    });

    describe("Method 'unregisterHook()'", () => {
      beforeEach(async () => {
        await cardPaymentProcessor.registerHook(hookContractAddress);
      });

      it("should execute as expected and emit a single required event", async () => {
        const tx = await cardPaymentProcessor.unregisterHook(hookContractAddress,
          await calculateUnregistrationProof(hookContract, cardPaymentProcessor),
        );
        const receipt = await tx.provider.getTransactionReceipt(tx.hash);
        const eventsCount = receipt?.logs.length || 0;

        await expect(tx)
          .to.emit(cardPaymentProcessor, EVENT_NAME_HOOK_UNREGISTERED)
          .withArgs(hookContractAddress, hookContract.afterPaymentMade.fragment.selector);
        expect(eventsCount).to.equal(1);
      });

      describe("Should revert if", () => {
        it("the caller does not have the required role", async () => {
          await expect(cardPaymentProcessor.connect(user1).unregisterHook(hookContractAddress,
            await calculateUnregistrationProof(hookContract, cardPaymentProcessor),
          ))
            .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
            .withArgs(user1.address, OWNER_ROLE);
        });

        it("the proof is invalid", async () => {
          await expect(cardPaymentProcessor.unregisterHook(hookContractAddress, ethers.toBeHex(
            1337,
            32,
          )))
            .to.be.reverted;
        });
      });
    });

    describe("Internal method '_callHooks()'", () => {
      beforeEach(async () => {
        await cardPaymentProcessor.registerHook(hookContractAddress);
        await tokenMock.connect(user1).approve(cardPaymentProcessorAddress, 1);
        await tokenMock.mint(user1.address, 1);
      });

      it("should execute as expected and call the hook contract", async () => {
        const tx = cardPaymentProcessor.makePaymentFor(
          ethers.keccak256(ethers.toUtf8Bytes("good payment")),
          user1.address,
          1,
          0,
          ethers.ZeroAddress,
          0,
          CASHBACK_RATE_AS_IN_CONTRACT,
          0,
        );

        await expect(tx).to.emit(hookContract, EVENT_NAME_LOG_AFTER_PAYMENT_MADE);
      });

      it("should revert the transaction if the hook method reverts", async () => {
        const tx = cardPaymentProcessor.makePaymentFor(
          ethers.keccak256(ethers.toUtf8Bytes("please fail")),
          user1.address,
          1,
          0,
          ethers.ZeroAddress,
          0,
          CASHBACK_RATE_AS_IN_CONTRACT,
          0,
        );
        await expect(tx).to.be.revertedWithCustomError(hookContract, ERROR_NAME_REVERT_FROM_AFTER_PAYMENT_MADE);
      });
    });
  });

  describe("Hook with all methods implemented", () => {
    let cashbackController: Contracts.CashbackController;
    let cashbackControllerAddress: string;

    beforeEach(async () => {
      cashbackController = await setUpFixture(deployAndConfigureCashbackController);
      await cashbackController.grantRole(GRANTOR_ROLE, deployer.address);
      await cashbackController.grantRole(HOOK_TRIGGER_ROLE, cardPaymentProcessorAddress);
      cashbackControllerAddress = await cashbackController.getAddress();
    });

    describe("Method 'registerHook()'", () => {
      describe("Should execute as expected when called the first time and", () => {
        let tx: TransactionResponse;
        beforeEach(async () => {
          tx = await cardPaymentProcessor.registerHook(cashbackControllerAddress);
        });

        it("should emit the required events", async () => {
          const receipt = await tx.provider.getTransactionReceipt(tx.hash);
          const eventsCount = receipt?.logs.length || 0;
          await expect(tx)
            .to.emit(cardPaymentProcessor, EVENT_NAME_HOOK_REGISTERED)
            .withArgs(cashbackControllerAddress, cashbackController.afterPaymentMade.fragment.selector);
          await expect(tx)
            .to.emit(cardPaymentProcessor, EVENT_NAME_HOOK_REGISTERED)
            .withArgs(cashbackControllerAddress, cashbackController.afterPaymentUpdated.fragment.selector);
          await expect(tx)
            .to.emit(cardPaymentProcessor, EVENT_NAME_HOOK_REGISTERED)
            .withArgs(cashbackControllerAddress, cashbackController.afterPaymentCanceled.fragment.selector);

          expect(eventsCount).to.equal(3);
        });

        it("should not emit events when called a second time", async () => {
          const nextTx = cardPaymentProcessor.registerHook(cashbackControllerAddress);
          await expect(nextTx)
            .to.not.emit(cardPaymentProcessor, EVENT_NAME_HOOK_REGISTERED);
        });
      });

      describe("Should revert if", () => {
        it("the caller does not have the required role", async () => {
          await expect(cardPaymentProcessor.connect(user1).registerHook(cashbackControllerAddress))
            .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
            .withArgs(user1.address, OWNER_ROLE);
        });

        it("the hook has not implemented the required interface", async () => {
          await expect(cardPaymentProcessor.registerHook(tokenMockAddress))
            .to.be.reverted;
        });
      });
    });

    describe("Method 'unregisterHook()'", () => {
      beforeEach(async () => {
        await cardPaymentProcessor.registerHook(cashbackControllerAddress);
      });

      it("should emit the required events", async () => {
        const tx = cardPaymentProcessor.unregisterHook(
          cashbackControllerAddress,
          await calculateUnregistrationProof(cashbackController, cardPaymentProcessor),
        );
        await expect(tx)
          .to.emit(cardPaymentProcessor, EVENT_NAME_HOOK_UNREGISTERED)
          .withArgs(cashbackControllerAddress, cashbackController.afterPaymentMade.fragment.selector);
        await expect(tx)
          .to.emit(cardPaymentProcessor, EVENT_NAME_HOOK_UNREGISTERED)
          .withArgs(cashbackControllerAddress, cashbackController.afterPaymentUpdated.fragment.selector);
        await expect(tx)
          .to.emit(cardPaymentProcessor, EVENT_NAME_HOOK_UNREGISTERED)
          .withArgs(cashbackControllerAddress, cashbackController.afterPaymentCanceled.fragment.selector);
      });
    });
  });
});
