import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { AddressLike, TransactionResponse } from "ethers";
import * as Contracts from "../typechain-types";
import { ICardPaymentProcessorHookTypes } from "../typechain-types/contracts/CashbackController";

import { checkEquality, resultToObject, setUpFixture } from "../test-utils/common";
import { checkTokenPath, getTxTimestamp, increaseBlockTimestamp } from "../test-utils/eth";

describe("Contract 'CashbackController'", () => {
  const TOKEN_DECIMALS = 6n;
  const CASHBACK_FACTOR = 1000n;
  const DIGITS_COEF = 10n ** TOKEN_DECIMALS;
  const INITIAL_TREASURY_BALANCE = (10n ** 6n) * DIGITS_COEF;
  const CASHBACK_TREASURY_ADDRESS_STUB1 = "0x0000000000000000000000000000000000000001";
  const CASHBACK_CAP_RESET_PERIOD = 30 * 24 * 60 * 60;
  const MAX_CASHBACK_FOR_CAP_PERIOD = 300n * DIGITS_COEF;

  const EXPECTED_VERSION = {
    major: 2n,
    minor: 4n,
    patch: 1n,
  } as const;

  const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
  const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
  const HOOK_TRIGGER_ROLE: string = ethers.id("HOOK_TRIGGER_ROLE");
  const CASHBACK_OPERATOR_ROLE = ethers.id("CASHBACK_OPERATOR_ROLE");
  const MANAGER_ROLE = ethers.id("MANAGER_ROLE");
  const RESCUER_ROLE = ethers.id("RESCUER_ROLE");
  const PAUSER_ROLE = ethers.id("PAUSER_ROLE");

  let cashbackControllerFactory: Contracts.CashbackController__factory;
  let cashbackControllerFactoryWithForcibleRole: Contracts.CashbackControllerWithForcibleRole__factory;
  let tokenMockFactory: Contracts.ERC20TokenMock__factory;
  let cashbackVaultFactory: Contracts.CashbackVault__factory;
  let cardPaymentProcessorFactory: Contracts.CardPaymentProcessor__factory;

  let cashbackController: Contracts.CashbackController;
  let cashbackControllerFromOwner: Contracts.CashbackController;
  let cashbackControllerFromHookTrigger: Contracts.CashbackController;
  let cashbackControllerFromStranger: Contracts.CashbackController;
  let cashbackControllerFromCashbackOperator: Contracts.CashbackController;

  let tokenMock: Contracts.ERC20TokenMock;

  let cashbackControllerAddress: string;

  let deployer: HardhatEthersSigner;
  let hookTrigger: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let payer: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let treasury2: HardhatEthersSigner;
  let sponsor: HardhatEthersSigner;
  let cashbackOperator: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;
  let cashOutAccount: HardhatEthersSigner;

  type PaymentHookData = ICardPaymentProcessorHookTypes.PaymentHookDataStruct;

  const EMPTY_PAYMENT_HOOK_DATA: PaymentHookData = {
    baseAmount: 0n,
    subsidyLimit: 0n,
    status: 0n,
    payer: ethers.ZeroAddress,
    cashbackRate: 0n,
    confirmedAmount: 0n,
    sponsor: ethers.ZeroAddress,
    extraAmount: 0n,
    refundAmount: 0n,
  };
  enum CashbackStatus {
    Undefined = 0,
    Success = 1,
    Partial = 2,
    Capped = 3,
    OutOfFunds = 4,
  }

  function paymentId(description: string) {
    return ethers.id(description);
  }

  async function deployTokenMock(nameSuffix = "") {
    const name = `ERC20 Test ${nameSuffix}`;
    const symbol = `TEST${nameSuffix}`;
    const tokenMockDeployment = await tokenMockFactory.deploy(name, symbol);
    await tokenMockDeployment.waitForDeployment();
    return tokenMockDeployment;
  }

  async function deployRegularCashbackController(tokenMock: Contracts.ERC20TokenMock) {
    const cashbackController = await upgrades.deployProxy(cashbackControllerFactory, [await tokenMock.getAddress()]);
    await cashbackController.waitForDeployment();
    return cashbackController;
  }

  async function deployCashbackControllerWithForcibleRole(tokenMock: Contracts.ERC20TokenMock) {
    const cashbackController = await upgrades.deployProxy(
      cashbackControllerFactoryWithForcibleRole,
      [await tokenMock.getAddress()],
    );
    await cashbackController.waitForDeployment();
    return cashbackController;
  }

  async function deployCashbackVault(tokenMock: Contracts.ERC20TokenMock) {
    const cashbackVault = await upgrades.deployProxy(cashbackVaultFactory, [await tokenMock.getAddress()]);
    await cashbackVault.waitForDeployment();
    return cashbackVault;
  }

  async function deployTestableContracts() {
    const tokenMock = await deployTokenMock();
    const cashbackController = await deployCashbackControllerWithForcibleRole(tokenMock);

    return { cashbackController, tokenMock };
  }

  async function deployContractsWithRegularCashbackController() {
    const tokenMock = await deployTokenMock();
    const cashbackController = await deployRegularCashbackController(tokenMock);

    return { cashbackController, tokenMock };
  }

  async function configureTestableContracts(
    cashbackController: Contracts.CashbackControllerWithForcibleRole,
    tokenMock: Contracts.ERC20TokenMock,
  ) {
    await cashbackController.grantRole(GRANTOR_ROLE, deployer.address);
    await cashbackController.forceHookTriggerRole(hookTrigger.address);
    await cashbackController.grantRole(CASHBACK_OPERATOR_ROLE, cashbackOperator.address);
    await cashbackController.grantRole(PAUSER_ROLE, pauser.address);

    await tokenMock.mint(treasury.address, INITIAL_TREASURY_BALANCE);
    await tokenMock.connect(treasury).approve(await cashbackController.getAddress(), ethers.MaxUint256);
    await tokenMock.connect(payer).approve(await cashbackController.getAddress(), ethers.MaxUint256);
  }

  async function deployAndConfigureContracts() {
    const contracts = await deployTestableContracts();
    await configureTestableContracts(contracts.cashbackController, contracts.tokenMock);
    return contracts;
  }

  before(async () => {
    [deployer, hookTrigger, stranger, treasury, treasury2, payer, sponsor, cashbackOperator, pauser, cashOutAccount] =
      await ethers.getSigners();

    // Contract factories with the explicitly specified deployer account
    cashbackControllerFactory = await ethers.getContractFactory("CashbackController");
    cashbackControllerFactory = cashbackControllerFactory.connect(deployer);
    cashbackControllerFactoryWithForcibleRole = await ethers.getContractFactory("CashbackControllerWithForcibleRole");
    cashbackControllerFactoryWithForcibleRole = cashbackControllerFactoryWithForcibleRole.connect(deployer);
    cardPaymentProcessorFactory = await ethers.getContractFactory("CardPaymentProcessor");
    cardPaymentProcessorFactory = cardPaymentProcessorFactory.connect(deployer);
    tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenMockFactory = tokenMockFactory.connect(deployer);
    cashbackVaultFactory = await ethers.getContractFactory("CashbackVault");
  });

  beforeEach(async () => {
    const contracts = await setUpFixture(deployAndConfigureContracts);
    cashbackController = cashbackControllerFromOwner = contracts.cashbackController;
    tokenMock = contracts.tokenMock;
    cashbackControllerAddress = await cashbackControllerFromOwner.getAddress();
    cashbackControllerFromHookTrigger = cashbackControllerFromOwner.connect(hookTrigger);
    cashbackControllerFromStranger = cashbackControllerFromOwner.connect(stranger);
    cashbackControllerFromCashbackOperator = cashbackControllerFromOwner.connect(cashbackOperator);
  });

  describe("Method 'initialize()'", () => {
    let deployedContract: Contracts.CashbackController;

    beforeEach(async () => {
      // deploying contract without configuration to test the default state
      const contracts = await setUpFixture(deployContractsWithRegularCashbackController);
      deployedContract = contracts.cashbackController;
    });

    describe("Should execute as expected when called properly and", () => {
      it("should expose the correct role hashes", async () => {
        expect(await deployedContract.OWNER_ROLE()).to.equal(OWNER_ROLE);
        expect(await deployedContract.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.HOOK_TRIGGER_ROLE()).to.equal(HOOK_TRIGGER_ROLE);
        expect(await deployedContract.CASHBACK_OPERATOR_ROLE()).to.equal(CASHBACK_OPERATOR_ROLE);
        expect(await deployedContract.RESCUER_ROLE()).to.equal(RESCUER_ROLE);
        expect(await deployedContract.PAUSER_ROLE()).to.equal(PAUSER_ROLE);
      });

      it("should set the correct role admins", async () => {
        expect(await deployedContract.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
        expect(await deployedContract.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
        expect(await deployedContract.getRoleAdmin(HOOK_TRIGGER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.getRoleAdmin(CASHBACK_OPERATOR_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.getRoleAdmin(RESCUER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
      });

      it("should set the correct roles for the deployer", async () => {
        expect(await deployedContract.hasRole(OWNER_ROLE, deployer.address)).to.eq(true);
        expect(await deployedContract.hasRole(GRANTOR_ROLE, deployer.address)).to.eq(false);
        expect(await deployedContract.hasRole(HOOK_TRIGGER_ROLE, deployer.address)).to.eq(false);
        expect(await deployedContract.hasRole(CASHBACK_OPERATOR_ROLE, deployer.address)).to.eq(false);
        expect(await deployedContract.hasRole(RESCUER_ROLE, deployer.address)).to.eq(false);
        expect(await deployedContract.hasRole(PAUSER_ROLE, deployer.address)).to.eq(false);
      });

      it("should set the correct underlying token address", async () => {
        expect(await cashbackControllerFromOwner.underlyingToken()).to.equal(await tokenMock.getAddress());
      });

      it("should not set the cashback treasury address", async () => {
        expect(await cashbackControllerFromOwner.getCashbackTreasury()).to.equal(ethers.ZeroAddress);
      });

      it("should not set the cashback vault address", async () => {
        expect(await cashbackControllerFromOwner.getCashbackVault()).to.equal(ethers.ZeroAddress);
      });
    });

    describe("Should revert if", () => {
      it("called a second time", async () => {
        await expect(deployedContract.initialize(await tokenMock.getAddress()))
          .to.be.revertedWithCustomError(deployedContract, "InvalidInitialization");
      });

      it("the provided token address is zero", async () => {
        const tx = upgrades.deployProxy(cashbackControllerFactory, [ethers.ZeroAddress]);
        await expect(tx)
          .to.be.revertedWithCustomError(cashbackControllerFactory, "CashbackController_TokenAddressZero");
      });
    });
  });

  describe("Method 'grantRole()' with HOOK_TRIGGER_ROLE", () => {
    let deployedContract: Contracts.CashbackController;
    let specificTokenMock: Contracts.ERC20TokenMock;

    beforeEach(async () => {
      // deploying contract without configuration to test the default state
      const contracts = await setUpFixture(deployContractsWithRegularCashbackController);
      deployedContract = contracts.cashbackController;
      specificTokenMock = contracts.tokenMock;
      await deployedContract.grantRole(GRANTOR_ROLE, deployer.address);
    });

    describe("Should execute as expected when called properly and", () => {
      it("should grant the role to the caller contract with the correct underlying token", async () => {
        const cardPaymentProcessor =
          await upgrades.deployProxy(
            cardPaymentProcessorFactory,
            [await specificTokenMock.getAddress(), cashOutAccount.address],
          );

        await expect(deployedContract.grantRole(HOOK_TRIGGER_ROLE, await cardPaymentProcessor.getAddress()))
          .to.emit(deployedContract, "RoleGranted")
          .withArgs(HOOK_TRIGGER_ROLE, await cardPaymentProcessor.getAddress(), deployer.address);
      });
    });

    describe("Should revert if", () => {
      it("provided account is EOA", async () => {
        await expect(deployedContract.grantRole(HOOK_TRIGGER_ROLE, stranger.address))
          .to.be.revertedWithCustomError(deployedContract, "CashbackController_HookTriggerRoleIncompatible");
      });

      it("provided account is a contract but not a CardPaymentProcessor contract", async () => {
        await expect(deployedContract.grantRole(HOOK_TRIGGER_ROLE, await tokenMock.getAddress()))
          .to.be.revertedWithCustomError(deployedContract, "CashbackController_HookTriggerRoleIncompatible");
      });

      it("provided account is CardPaymentProcessor but the underlying token does not match the controller token",
        async () => {
          const cardPaymentProcessor =
            await upgrades.deployProxy(
              cardPaymentProcessorFactory,
              [await tokenMock.getAddress(), cashOutAccount.address],
            );
          await expect(deployedContract.grantRole(HOOK_TRIGGER_ROLE, await cardPaymentProcessor.getAddress()))
            .to.be.revertedWithCustomError(deployedContract, "CashbackController_HookTriggerRoleIncompatible");
        });
    });
  });

  describe("Method 'upgradeToAndCall()'", () => {
    describe("Should execute as expected when called properly and", () => {
      it("should upgrade the contract to a new implementation", async () => {
        const newImplementation = await cashbackControllerFactory.deploy();
        await newImplementation.waitForDeployment();

        const tx = cashbackControllerFromOwner.upgradeToAndCall(await newImplementation.getAddress(), "0x");
        await expect(tx)
          .to.emit(cashbackControllerFromOwner, "Upgraded")
          .withArgs(
            await newImplementation.getAddress(),
          );
      });
    });

    describe("Should revert if", () => {
      it("called with the address of an incompatible implementation", async () => {
        const tx = cashbackControllerFromOwner.upgradeToAndCall(await tokenMock.getAddress(), "0x");
        await expect(tx)
          .to.be.revertedWithCustomError(cashbackController, "CashbackController_ImplementationAddressInvalid");
      });

      it("called by a non-owner", async () => {
        const tx = cashbackControllerFromStranger.upgradeToAndCall(await tokenMock.getAddress(), "0x");
        await expect(tx)
          .to.be.revertedWithCustomError(cashbackController, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, OWNER_ROLE);
      });
    });
  });

  describe("Method 'setCashbackTreasury()'", () => {
    describe("Should execute as expected when called properly and", () => {
      let tx: TransactionResponse;

      beforeEach(async () => {
        await tokenMock.connect(treasury).approve(cashbackControllerAddress, ethers.MaxUint256);
        tx = await cashbackControllerFromOwner.setCashbackTreasury(treasury.address);
      });

      it("should emit the required event", async () => {
        await expect(tx)
          .to.emit(cashbackControllerFromOwner, "CashbackTreasuryUpdated")
          .withArgs(treasury.address, ethers.ZeroAddress);
      });

      it("should change the cashback treasury address", async () => {
        expect(await cashbackControllerFromOwner.getCashbackTreasury()).to.equal(treasury.address);
      });

      describe("when the cashback treasury is changed again", () => {
        let tx2: TransactionResponse;
        beforeEach(async () => {
          await tokenMock.connect(treasury2).approve(cashbackControllerAddress, ethers.MaxUint256);
          tx2 = await cashbackControllerFromOwner.setCashbackTreasury(treasury2.address);
        });

        it("should emit the required event", async () => {
          await expect(tx2)
            .to.emit(cashbackControllerFromOwner, "CashbackTreasuryUpdated")
            .withArgs(treasury2.address, treasury.address);
        });

        it("should change the cashback treasury address", async () => {
          expect(await cashbackControllerFromOwner.getCashbackTreasury()).to.equal(treasury2.address);
        });
      });
    });

    describe("Should revert if", () => {
      it("the caller does not have the required role", async () => {
        await expect(cashbackControllerFromStranger.setCashbackTreasury(treasury.address))
          .to.be.revertedWithCustomError(cashbackControllerFromStranger, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, OWNER_ROLE);
      });

      it("the new cashback treasury address is zero", async () => {
        await expect(cashbackControllerFromOwner.setCashbackTreasury(ethers.ZeroAddress))
          .to.be.revertedWithCustomError(cashbackControllerFromOwner, "CashbackController_TreasuryAddressZero");
      });

      it("the cashback treasury is not changed", async () => {
        await cashbackControllerFromOwner.setCashbackTreasury(treasury.address);

        await expect(cashbackControllerFromOwner.setCashbackTreasury(treasury.address))
          .to.be.revertedWithCustomError(cashbackControllerFromOwner, "CashbackController_TreasuryUnchanged");
      });

      it("the cashback treasury has no allowance for the contract", async () => {
        await expect(cashbackControllerFromOwner.setCashbackTreasury(CASHBACK_TREASURY_ADDRESS_STUB1))
          .to.be.revertedWithCustomError(cashbackControllerFromOwner, "CashbackController_TreasuryAllowanceZero");
      });
    });
  });

  describe("Method '$__VERSION()'", () => {
    it("should return the expected version", async () => {
      expect(await cashbackControllerFromStranger.$__VERSION()).to.deep.equal([
        EXPECTED_VERSION.major,
        EXPECTED_VERSION.minor,
        EXPECTED_VERSION.patch,
      ]);
    });
  });

  describe("Method 'supportsHookMethod()'", () => {
    it("should return the expected value for supported hook methods", async () => {
      expect(await cashbackControllerFromHookTrigger.supportsHookMethod(
        cashbackController.afterPaymentMade.fragment.selector,
      )).to.equal(true);
      expect(await cashbackControllerFromHookTrigger.supportsHookMethod(
        cashbackController.afterPaymentUpdated.fragment.selector,
      )).to.equal(true);
      expect(await cashbackControllerFromHookTrigger.supportsHookMethod(
        cashbackController.afterPaymentCanceled.fragment.selector,
      )).to.equal(true);
    });

    it("should revert if the caller does not have the required role", async () => {
      await expect(cashbackControllerFromOwner.supportsHookMethod(
        cashbackController.afterPaymentMade.fragment.selector,
      )).to.be.revertedWithCustomError(cashbackController, "AccessControlUnauthorizedAccount")
        .withArgs(deployer.address, HOOK_TRIGGER_ROLE);
    });
  });

  describe("Method 'proveCashbackController()'", () => {
    it("should exist and not revert", async () => {
      await expect(cashbackControllerFromStranger.proveCashbackController()).to.be.not.reverted;
    });
  });

  describe("Method 'setCashbackVault()'", () => {
    let cashbackVaults: Contracts.CashbackVault[];

    beforeEach(async () => {
      cashbackVaults = await setUpFixture(async function deployCashbackVaultWithToken() {
        return [await deployCashbackVault(tokenMock), await deployCashbackVault(tokenMock)];
      });
    });

    describe(
      "Should execute as expected when initially setting the cashback vault (enabling claimable mode) and",
      () => {
        let tx: TransactionResponse;
        beforeEach(async () => {
          tx = await cashbackControllerFromOwner.setCashbackVault(await cashbackVaults[0].getAddress());
        });

        it("should set maximum allowance for the new cashback vault contract", async () => {
          expect(await tokenMock.allowance(cashbackControllerAddress, await cashbackVaults[0].getAddress()))
            .to.equal(ethers.MaxUint256);
        });

        it("should emit the required event", async () => {
          await expect(tx)
            .to.emit(cashbackController, "CashbackVaultUpdated")
            .withArgs(await cashbackVaults[0].getAddress(), ethers.ZeroAddress);
        });

        it("should update the cashback vault", async () => {
          expect(await cashbackController.getCashbackVault())
            .to.equal(await cashbackVaults[0].getAddress());
        });
      },
    );
    describe("Should execute as expected when updating the cashback vault and", () => {
      let tx: TransactionResponse;
      beforeEach(async () => {
        await cashbackControllerFromOwner.setCashbackVault(await cashbackVaults[0].getAddress());
        tx = await cashbackControllerFromOwner.setCashbackVault(await cashbackVaults[1].getAddress());
      });

      it("should set maximum allowance for the new cashback vault contract", async () => {
        expect(await tokenMock.allowance(cashbackControllerAddress, await cashbackVaults[1].getAddress()))
          .to.equal(ethers.MaxUint256);
      });

      it("should remove the allowance from the old cashback vault contract", async () => {
        expect(await tokenMock.allowance(cashbackControllerAddress, await cashbackVaults[0].getAddress()))
          .to.equal(0);
      });

      it("should emit the required event", async () => {
        await expect(tx)
          .to.emit(cashbackController, "CashbackVaultUpdated")
          .withArgs(await cashbackVaults[1].getAddress(), await cashbackVaults[0].getAddress());
      });

      it("should update the cashback vault", async () => {
        expect(await cashbackController.getCashbackVault())
          .to.equal(await cashbackVaults[1].getAddress());
      });
    });

    describe("Should execute as expected when setting the cashback vault to zero (disabling claimable mode) and",
      () => {
        let tx: TransactionResponse;
        beforeEach(async () => {
          await cashbackControllerFromOwner.setCashbackVault(await cashbackVaults[0].getAddress());

          tx = await cashbackControllerFromOwner.setCashbackVault(ethers.ZeroAddress);
        });

        it("should remove the allowance from the old cashback vault contract", async () => {
          expect(await tokenMock.allowance(cashbackControllerAddress, await cashbackVaults[0].getAddress()))
            .to.equal(0);
        });

        it("should emit the required event", async () => {
          await expect(tx)
            .to.emit(cashbackController, "CashbackVaultUpdated")
            .withArgs(ethers.ZeroAddress, await cashbackVaults[0].getAddress());
        });

        it("should update the cashback vault", async () => {
          expect(await cashbackController.getCashbackVault())
            .to.equal(ethers.ZeroAddress);
        });
      });

    describe("Should revert if", () => {
      it("the provided cashback vault contract is invalid", async () => {
        await expect(cashbackControllerFromOwner.setCashbackVault(await tokenMock.getAddress()))
          .to.be.revertedWithCustomError(cashbackController, "CashbackController_CashbackVaultInvalid");
      });

      it("the cashback vault underlying token does not match the controller token", async () => {
        const anotherTokenMock = await deployTokenMock("2");
        const anotherCashbackVault = await deployCashbackVault(anotherTokenMock);
        await expect(cashbackControllerFromOwner.setCashbackVault(await anotherCashbackVault.getAddress()))
          .to.be.revertedWithCustomError(cashbackController, "CashbackController_CashbackVaultTokenMismatch");
      });

      it("the caller does not have the required role", async () => {
        await expect(
          cashbackControllerFromStranger.setCashbackVault(await cashbackVaults[0].getAddress()),
        ).to.be.revertedWithCustomError(cashbackControllerFromStranger, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, OWNER_ROLE);
      });

      it("the same cashback vault contract is set again", async () => {
        await cashbackControllerFromOwner.setCashbackVault(await cashbackVaults[0].getAddress());

        await expect(cashbackControllerFromOwner.setCashbackVault(await cashbackVaults[0].getAddress()))
          .to.be.revertedWithCustomError(cashbackController, "CashbackController_CashbackVaultUnchanged");
      });

      it("the provided cashback vault account has no code", async () => {
        await expect(cashbackControllerFromOwner.setCashbackVault(CASHBACK_TREASURY_ADDRESS_STUB1))
          .to.be.revertedWithCustomError(cashbackController, "CashbackController_CashbackVaultInvalid");
      });
    });
  });

  describe("Method 'correctCashbackAmount()'", () => {
    const baseAmount = 100n * DIGITS_COEF;
    const cashbackRate = 100n;
    const cashbackAmount = cashbackRate * baseAmount / CASHBACK_FACTOR;
    beforeEach(async () => {
      await setUpFixture(async function setUpTreasury() {
        await cashbackControllerFromOwner.setCashbackTreasury(treasury.address);
      });
      const paymentHookData: PaymentHookData = {
        baseAmount,
        subsidyLimit: 0n,
        status: 1n,
        payer: payer.address,
        cashbackRate,
        confirmedAmount: 0n,
        sponsor: ethers.ZeroAddress,
        extraAmount: 0n,
        refundAmount: 0n,
      };
      await cashbackControllerFromHookTrigger.afterPaymentMade(
        paymentId("id1"),
        EMPTY_PAYMENT_HOOK_DATA,
        paymentHookData,
      );
    });

    describe("Should execute as expected when called properly and if", () => {
      describe("cashback amount is increased", () => {
        let tx: TransactionResponse;
        const newCashbackAmount = cashbackAmount + 10n * DIGITS_COEF;
        const increaseAmount = newCashbackAmount - cashbackAmount;
        beforeEach(async () => {
          tx = await cashbackControllerFromCashbackOperator.correctCashbackAmount(paymentId("id1"), newCashbackAmount);
        });

        it("should emit the required event", async () => {
          await expect(tx).to.emit(cashbackController, "CashbackIncreased")
            .withArgs(paymentId("id1"), payer.address, CashbackStatus.Success, increaseAmount, newCashbackAmount);
        });

        it("should update the payment cashback state", async () => {
          const operationState = resultToObject(await cashbackController
            .getPaymentCashback(paymentId("id1")));

          checkEquality(operationState, {
            balance: newCashbackAmount,
            recipient: payer.address,
          });
        });
      });

      describe("cashback amount is decreased", () => {
        let tx: TransactionResponse;
        const newCashbackAmount = cashbackAmount - 10n * DIGITS_COEF;
        const decreaseAmount = cashbackAmount - newCashbackAmount;
        beforeEach(async () => {
          tx = await cashbackControllerFromCashbackOperator.correctCashbackAmount(paymentId("id1"), newCashbackAmount);
        });

        it("should emit the required event", async () => {
          await expect(tx).to.emit(cashbackController, "CashbackDecreased")
            .withArgs(paymentId("id1"), payer.address, CashbackStatus.Success, decreaseAmount, newCashbackAmount);
        });

        it("should update the payment cashback state", async () => {
          const operationState = resultToObject(await cashbackController
            .getPaymentCashback(paymentId("id1")));

          checkEquality(operationState, {
            balance: newCashbackAmount,
            recipient: payer.address,
          });
        });
      });

      describe("cashback amount is set to zero", () => {
        let tx: TransactionResponse;
        const newCashbackAmount = 0n;
        const decreaseAmount = cashbackAmount - newCashbackAmount;
        beforeEach(async () => {
          tx = await cashbackControllerFromCashbackOperator.correctCashbackAmount(paymentId("id1"), newCashbackAmount);
        });

        it("should emit the required event", async () => {
          await expect(tx).to.emit(cashbackController, "CashbackDecreased")
            .withArgs(paymentId("id1"), payer.address, CashbackStatus.Success, decreaseAmount, newCashbackAmount);
        });

        it("should update the payment cashback state", async () => {
          const operationState = resultToObject(await cashbackController
            .getPaymentCashback(paymentId("id1")));

          checkEquality(operationState, {
            balance: newCashbackAmount,
            recipient: payer.address,
          });
        });
      });

      describe("cashback amount is the same as the current amount", () => {
        let tx: TransactionResponse;
        beforeEach(async () => {
          tx = await cashbackControllerFromCashbackOperator.correctCashbackAmount(paymentId("id1"), cashbackAmount);
        });

        it("should not emit the required event", async () => {
          await expect(tx).to.not.emit(cashbackController, "CashbackDecreased");
          await expect(tx).to.not.emit(cashbackController, "CashbackIncreased");
        });

        it("should update the payment cashback state", async () => {
          const operationState = resultToObject(await cashbackController
            .getPaymentCashback(paymentId("id1")));

          checkEquality(operationState, {
            balance: cashbackAmount,
            recipient: payer.address,
          });
        });
      });
    });

    describe("Should revert if", () => {
      it("the caller does not have the required role", async () => {
        await expect(cashbackControllerFromOwner.correctCashbackAmount(paymentId("id1"), cashbackAmount))
          .to.be.revertedWithCustomError(cashbackController, "AccessControlUnauthorizedAccount")
          .withArgs(deployer.address, CASHBACK_OPERATOR_ROLE);
      });

      it("the payment cashback does not exist", async () => {
        await expect(cashbackControllerFromCashbackOperator.correctCashbackAmount(paymentId("nothing"), cashbackAmount))
          .to.be.revertedWithCustomError(cashbackController, "CashbackController_CashbackDoesNotExist");
      });

      it("the contract is paused", async () => {
        await cashbackController.connect(pauser).pause();
        await expect(cashbackControllerFromCashbackOperator.correctCashbackAmount(paymentId("id1"), cashbackAmount))
          .to.be.revertedWithCustomError(cashbackControllerFromCashbackOperator, "EnforcedPause");
      });
    });
  });

  describe("Hook methods", () => {
    beforeEach(async () => {
      await setUpFixture(async function setUpTreasury() {
        await cashbackControllerFromOwner.setCashbackTreasury(treasury.address);
      });
    });
    for (const cashbackVaultSet of [true, false]) {
      describe(`Cashback vault is connected: ${cashbackVaultSet}`, () => {
        let cashbackVault: Contracts.CashbackVault;
        let cashbackReceiver: AddressLike;

        if (cashbackVaultSet) {
          beforeEach(async () => {
            await setUpFixture(async function configureCV() {
              cashbackVault = await deployCashbackVault(tokenMock);
              await cashbackVault.grantRole(GRANTOR_ROLE, deployer.address);
              await cashbackVault.grantRole(CASHBACK_OPERATOR_ROLE, await cashbackController.getAddress());
              await cashbackVault.grantRole(MANAGER_ROLE, deployer.address);
              await cashbackControllerFromOwner.setCashbackVault(await cashbackVault.getAddress());
            });
            cashbackReceiver = cashbackVault;
          });
        } else {
          beforeEach(() => {
            cashbackReceiver = payer;
          });
        }
        describe("Method 'afterPaymentMade()'", () => {
          describe("Should execute as expected when called properly and if", () => {
            describe("cashback rate is zero", () => {
              let tx: TransactionResponse;
              const baseAmount = 100n * DIGITS_COEF;
              const cashbackRate = 0n;

              beforeEach(async () => {
                const paymentHookData: PaymentHookData = {
                  baseAmount,
                  subsidyLimit: 0n,
                  status: 1n,
                  payer: payer.address,
                  cashbackRate,
                  confirmedAmount: 0n,
                  sponsor: ethers.ZeroAddress,
                  extraAmount: 0n,
                  refundAmount: 0n,
                };
                tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
                  paymentId("id1"),
                  EMPTY_PAYMENT_HOOK_DATA,
                  paymentHookData,
                );
              });

              it("should do nothing", async () => {
                await expect(tx).to.not.emit(cashbackController, "CashbackSent");

                await expect(tx).to.changeTokenBalances(tokenMock,
                  [treasury, cashbackReceiver, cashbackController],
                  [0n, 0n, 0n],
                );

                await expect(tx).to.not.emit(tokenMock, "Transfer");
                const accountCashbackState = resultToObject(await cashbackController
                  .getAccountCashback(payer.address));
                const operationState = resultToObject(await cashbackController
                  .getPaymentCashback(paymentId("id1")));

                checkEquality(operationState, {
                  balance: 0n,
                  recipient: ethers.ZeroAddress,
                });
                checkEquality(accountCashbackState, {
                  totalAmount: 0n,
                  capPeriodStartAmount: 0n,
                  capPeriodStartTime: 0n,
                });
              });
            });

            describe("cashback rate is not zero", () => {
              let tx: TransactionResponse;
              const baseAmount = 100n * DIGITS_COEF;
              const cashbackRate = 100n;
              const cashbackAmount = cashbackRate * baseAmount / CASHBACK_FACTOR;

              beforeEach(async () => {
                const paymentHookData: PaymentHookData = {
                  baseAmount,
                  subsidyLimit: 0n,
                  status: 1n,
                  payer: payer.address,
                  cashbackRate,
                  confirmedAmount: 0n,
                  sponsor: ethers.ZeroAddress,
                  extraAmount: 0n,
                  refundAmount: 0n,
                };
                tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
                  paymentId("id1"),
                  EMPTY_PAYMENT_HOOK_DATA,
                  paymentHookData,
                );
              });

              it("should emit the required event", async () => {
                await expect(tx).to.emit(cashbackController, "CashbackSent")
                  .withArgs(paymentId("id1"), payer.address, CashbackStatus.Success, cashbackAmount);
              });

              it("should update the payment cashback state", async () => {
                const operationState = resultToObject(await cashbackController
                  .getPaymentCashback(paymentId("id1")));

                checkEquality(operationState, {
                  balance: cashbackAmount,
                  recipient: payer.address,
                });
              });

              it("should update the account cashback state", async () => {
                const accountCashbackState = resultToObject(await cashbackController
                  .getAccountCashback(payer.address));
                checkEquality(accountCashbackState, {
                  totalAmount: cashbackAmount,
                  capPeriodStartAmount: 0n,
                  capPeriodStartTime: await getTxTimestamp(tx),
                });
              });

              it("should update token balances correctly", async () => {
                await expect(tx).to.changeTokenBalances(tokenMock,
                  [treasury, cashbackReceiver, cashbackController],
                  [-cashbackAmount, cashbackAmount, 0n],
                );
              });

              it("should transfer tokens correctly", async () => {
                await checkTokenPath(tx,
                  tokenMock,
                  [treasury, cashbackControllerAddress, cashbackReceiver],
                  cashbackAmount,
                );
              });
            });

            describe("cashback rate is not zero and treasury does not have enough funds", () => {
              let tx: TransactionResponse;
              const baseAmount = 100n * DIGITS_COEF;
              const cashbackRate = 100n;
              const cashbackAmount = cashbackRate * baseAmount / CASHBACK_FACTOR;

              beforeEach(async () => {
                const paymentHookData: PaymentHookData = {
                  baseAmount,
                  subsidyLimit: 0n,
                  status: 1n,
                  payer: payer.address,
                  cashbackRate,
                  confirmedAmount: 0n,
                  sponsor: ethers.ZeroAddress,
                  extraAmount: 0n,
                  refundAmount: 0n,
                };
                await tokenMock.connect(treasury).transfer(
                  await stranger.getAddress(),
                  await tokenMock.balanceOf(treasury.address) - cashbackAmount + 1n,
                );
                tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
                  paymentId("id1"),
                  EMPTY_PAYMENT_HOOK_DATA,
                  paymentHookData,
                );
              });

              it("should emit the required event", async () => {
                await expect(tx).to.emit(cashbackController, "CashbackSent")
                  .withArgs(paymentId("id1"), payer.address, CashbackStatus.OutOfFunds, 0n);
              });

              it("should update the payment cashback state", async () => {
                const operationState = resultToObject(await cashbackController
                  .getPaymentCashback(paymentId("id1")));

                checkEquality(operationState, {
                  balance: 0n,
                  recipient: payer.address,
                });
              });

              it("should not update the account cashback state", async () => {
                const accountCashbackState = resultToObject(await cashbackController
                  .getAccountCashback(payer.address));
                checkEquality(accountCashbackState, {
                  totalAmount: 0n,
                  capPeriodStartAmount: 0n,
                  capPeriodStartTime: 0n,
                });
              });

              it("should not update token balances", async () => {
                await expect(tx).to.changeTokenBalances(tokenMock,
                  [treasury, cashbackReceiver, cashbackController],
                  [0n, 0n, 0n],
                );
              });

              it("should not transfer tokens", async () => {
                await expect(tx).to.not.emit(tokenMock, "Transfer");
              });
            });

            describe("cashback rate is not zero and sponsor covers all base amount", () => {
              let tx: TransactionResponse;
              const baseAmount = 100n * DIGITS_COEF;
              const cashbackRate = 100n;

              beforeEach(async () => {
                const paymentHookData: PaymentHookData = {
                  baseAmount,
                  subsidyLimit: baseAmount,
                  status: 1n,
                  payer: payer.address,
                  cashbackRate,
                  confirmedAmount: 0n,
                  sponsor: sponsor.address,
                  extraAmount: 0n,
                  refundAmount: 0n,
                };
                tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
                  paymentId("id1"),
                  EMPTY_PAYMENT_HOOK_DATA,
                  paymentHookData,
                );
              });

              it("should emit the required event with zero cashback amount", async () => {
                await expect(tx).to.emit(cashbackController, "CashbackSent")
                  .withArgs(paymentId("id1"), payer.address, CashbackStatus.Success, 0n);
              });

              it("should not update token balances", async () => {
                await expect(tx).to.changeTokenBalances(tokenMock,
                  [treasury.address, cashbackReceiver, cashbackControllerAddress],
                  [0n, 0n, 0n],
                );
              });

              it("should update the payment cashback state", async () => {
                const operationState = resultToObject(await cashbackController
                  .getPaymentCashback(paymentId("id1")));

                checkEquality(operationState, {
                  balance: 0n,
                  recipient: payer.address,
                });
              });

              it("should not update the account cashback state", async () => {
                const accountCashbackState = resultToObject(await cashbackController
                  .getAccountCashback(payer.address));
                checkEquality(accountCashbackState, {
                  totalAmount: 0n,
                  capPeriodStartAmount: 0n,
                  capPeriodStartTime: 0n,
                });
              });

              it("should not transfer tokens", async () => {
                await expect(tx).to.not.emit(tokenMock, "Transfer");
              });
            });

            describe("cashback rate is not zero and sponsor covers a part of base amount", () => {
              let tx: TransactionResponse;
              const baseAmount = 100n * DIGITS_COEF;
              const subsidyLimit = baseAmount / 2n;
              const cashbackRate = 100n;
              const cashbackAmount = cashbackRate * (baseAmount - subsidyLimit) / CASHBACK_FACTOR;

              beforeEach(async () => {
                const paymentHookData: PaymentHookData = {
                  baseAmount,
                  subsidyLimit,
                  status: 1n,
                  payer: payer.address,
                  cashbackRate,
                  confirmedAmount: 0n,
                  sponsor: sponsor.address,
                  extraAmount: 0n,
                  refundAmount: 0n,
                };
                tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
                  paymentId("id1"),
                  EMPTY_PAYMENT_HOOK_DATA,
                  paymentHookData,
                );
              });

              it("should emit the required event", async () => {
                await expect(tx).to.emit(cashbackController, "CashbackSent")
                  .withArgs(paymentId("id1"), payer, CashbackStatus.Success, cashbackAmount);
              });

              it("should update token balances correctly", async () => {
                await expect(tx).to.changeTokenBalances(tokenMock,
                  [treasury, cashbackReceiver, cashbackControllerAddress],
                  [-cashbackAmount, cashbackAmount, 0n],
                );
              });

              it("should update the payment cashback state", async () => {
                const operationState = resultToObject(await cashbackController
                  .getPaymentCashback(paymentId("id1")));

                checkEquality(operationState, {
                  balance: cashbackAmount,
                  recipient: payer.address,
                });
              });

              it("should update the account cashback state", async () => {
                const accountCashbackState = resultToObject(await cashbackController
                  .getAccountCashback(payer.address));
                checkEquality(accountCashbackState, {
                  totalAmount: cashbackAmount,
                  capPeriodStartAmount: 0n,
                  capPeriodStartTime: await getTxTimestamp(tx),
                });
              });

              it("should transfer tokens correctly", async () => {
                await checkTokenPath(
                  tx,
                  tokenMock,
                  [treasury, cashbackControllerAddress, cashbackReceiver],
                  cashbackAmount,
                );
              });
            });
          });
          describe("Should revert if", () => {
            it("called by a non-hook trigger", async () => {
              await expect(cashbackControllerFromStranger.afterPaymentMade(
                paymentId("id1"),
                EMPTY_PAYMENT_HOOK_DATA,
                EMPTY_PAYMENT_HOOK_DATA,
              )).to.be.revertedWithCustomError(cashbackControllerFromStranger, "AccessControlUnauthorizedAccount")
                .withArgs(stranger.address, HOOK_TRIGGER_ROLE);
            });

            it("the cashback treasury is not configured", async () => {
              const { cashbackController: notConfiguredCashbackController } = await deployAndConfigureContracts();
              const paymentHookData: PaymentHookData = {
                baseAmount: 100n * DIGITS_COEF,
                subsidyLimit: 0n,
                status: 1n,
                payer: payer.address,
                cashbackRate: 100n,
                confirmedAmount: 0n,
                sponsor: ethers.ZeroAddress,
                extraAmount: 0n,
                refundAmount: 0n,
              };
              await expect(notConfiguredCashbackController.connect(hookTrigger).afterPaymentMade(
                paymentId("id1"),
                EMPTY_PAYMENT_HOOK_DATA,
                paymentHookData,
              )).to.be.revertedWithCustomError(
                notConfiguredCashbackController,
                "CashbackController_TreasuryNotConfigured",
              );
            });
          });
        });

        describe("Method 'afterPaymentUpdated()'", () => {
          describe("Should execute as expected when called properly and if", () => {
            describe("payment cashback rate is zero", () => {
              const baseAmount = 100n * DIGITS_COEF;
              const cashbackRate = 0n;
              let initialPayment: PaymentHookData;
              let initialAccountCashbackState: Awaited<ReturnType<typeof cashbackController.getAccountCashback>>;
              let initialOperationState: Awaited<ReturnType<typeof cashbackController.getPaymentCashback>>;

              beforeEach(async () => {
                initialPayment = {
                  baseAmount,
                  subsidyLimit: 0n,
                  status: 1n,
                  payer: payer.address,
                  cashbackRate,
                  confirmedAmount: 0n,
                  sponsor: ethers.ZeroAddress,
                  extraAmount: 0n,
                  refundAmount: 0n,
                };
                await cashbackControllerFromHookTrigger.afterPaymentMade(
                  paymentId("id1"),
                  EMPTY_PAYMENT_HOOK_DATA,
                  initialPayment,
                );
                initialAccountCashbackState = await cashbackController.getAccountCashback(payer.address);
                initialOperationState = await cashbackController.getPaymentCashback(paymentId("id1"));
              });

              it("should do nothing", async () => {
                const tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                  paymentId("id1"),
                  initialPayment,
                  {
                    ...initialPayment,
                    baseAmount: initialPayment.baseAmount as bigint + 50n * DIGITS_COEF,
                  },
                );
                await expect(tx).to.not.emit(cashbackController, "CashbackDecreased");
                await expect(tx).to.not.emit(cashbackController, "CashbackIncreased");
                await expect(tx).to.changeTokenBalances(tokenMock,
                  [treasury.address, cashbackReceiver, cashbackControllerAddress],
                  [0n, 0n, 0n],
                );
                await expect(tx).to.not.emit(tokenMock, "Transfer");
                checkEquality(
                  resultToObject(await cashbackController.getAccountCashback(payer.address)),
                  resultToObject(initialAccountCashbackState),
                );
                checkEquality(
                  resultToObject(await cashbackController.getPaymentCashback(paymentId("id1"))),
                  resultToObject(initialOperationState),
                );
              });
            });

            describe("payment cashback rate is not zero and no sponsor and", () => {
              const baseAmount = 100n * DIGITS_COEF;
              const cashbackRate = 100n;
              const cashbackAmount = cashbackRate * baseAmount / CASHBACK_FACTOR;
              let initialPayment: PaymentHookData;
              let initialAccountCashbackState: Awaited<ReturnType<typeof cashbackController.getAccountCashback>>;

              beforeEach(async () => {
                initialPayment = {
                  baseAmount,
                  subsidyLimit: 0n,
                  status: 1n,
                  payer: payer.address,
                  cashbackRate,
                  confirmedAmount: 0n,
                  sponsor: ethers.ZeroAddress,
                  extraAmount: 0n,
                  refundAmount: 0n,
                };
                await cashbackControllerFromHookTrigger.afterPaymentMade(
                  paymentId("id1"),
                  EMPTY_PAYMENT_HOOK_DATA,
                  initialPayment,
                );
                initialAccountCashbackState = await cashbackController.getAccountCashback(payer.address);
              });

              describe("base amount is increased", () => {
                const newBaseAmount = baseAmount + 50n * DIGITS_COEF;
                const newCashbackAmount = cashbackRate * newBaseAmount / CASHBACK_FACTOR;
                const increaseAmount = newCashbackAmount - cashbackAmount;

                let tx: TransactionResponse;

                beforeEach(async () => {
                  const updatedPayment: PaymentHookData = {
                    ...initialPayment,
                    baseAmount: newBaseAmount,
                  };
                  tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                    paymentId("id1"),
                    initialPayment,
                    updatedPayment,
                  );
                });

                it("should emit the required event", async () => {
                  await expect(tx).to.emit(cashbackController, "CashbackIncreased")
                    .withArgs(
                      paymentId("id1"),
                      payer.address,
                      CashbackStatus.Success,
                      increaseAmount,
                      newCashbackAmount,
                    );
                });

                it("should update the payment cashback state", async () => {
                  const operationState = resultToObject(await cashbackController
                    .getPaymentCashback(paymentId("id1")));

                  checkEquality(operationState, {
                    balance: newCashbackAmount,
                    recipient: payer.address,
                  });
                });

                it("should update the cashback amount in the account cashback state", async () => {
                  const accountCashbackState = resultToObject(await cashbackController
                    .getAccountCashback(payer.address));
                  checkEquality(accountCashbackState, {
                    totalAmount: newCashbackAmount,
                    capPeriodStartAmount: 0n,
                    capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                  });
                });

                it("should update token balances correctly", async () => {
                  await expect(tx).to.changeTokenBalances(tokenMock,
                    [treasury.address, cashbackReceiver, cashbackControllerAddress],
                    [-increaseAmount, increaseAmount, 0n],
                  );
                });

                it("should transfer tokens correctly", async () => {
                  await checkTokenPath(
                    tx,
                    tokenMock,
                    [treasury, cashbackControllerAddress, cashbackReceiver],
                    increaseAmount,
                  );
                });
              });

              describe("refund amount is increased", () => {
                const newRefundAmount = 50n * DIGITS_COEF;
                const newCashbackAmount = cashbackRate * (baseAmount - newRefundAmount) / CASHBACK_FACTOR;
                const decreaseAmount = cashbackAmount - newCashbackAmount;

                let tx: TransactionResponse;

                beforeEach(async () => {
                  const updatedPayment: PaymentHookData = {
                    ...initialPayment,
                    refundAmount: newRefundAmount,
                  };
                  tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                    paymentId("id1"),
                    initialPayment,
                    updatedPayment,
                  );
                });

                it("should emit the required event", async () => {
                  await expect(tx).to.emit(cashbackController, "CashbackDecreased")
                    .withArgs(
                      paymentId("id1"),
                      payer.address,
                      CashbackStatus.Success,
                      decreaseAmount,
                      newCashbackAmount,
                    );
                });

                it("should update the payment cashback state", async () => {
                  const operationState = resultToObject(await cashbackController
                    .getPaymentCashback(paymentId("id1")));

                  checkEquality(operationState, {
                    balance: newCashbackAmount,
                    recipient: payer.address,
                  });
                });

                it("should update the cashback amount in the account cashback state", async () => {
                  const accountCashbackState = resultToObject(await cashbackController
                    .getAccountCashback(payer.address));
                  checkEquality(accountCashbackState, {
                    totalAmount: newCashbackAmount,
                    capPeriodStartAmount: 0n,
                    capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                  });
                });

                it("should update token balances correctly", async () => {
                  await expect(tx).to.changeTokenBalances(tokenMock,
                    [treasury.address, cashbackReceiver, cashbackControllerAddress],
                    [decreaseAmount, -decreaseAmount, 0n],
                  );
                });

                it("should transfer tokens correctly", async () => {
                  await checkTokenPath(
                    tx,
                    tokenMock,
                    [cashbackReceiver, cashbackControllerAddress, treasury],
                    decreaseAmount,
                  );
                });
              });

              describe("changes are not relevant to the cashback calculation", () => {
                let tx: TransactionResponse;

                beforeEach(async () => {
                  const updatedPayment: PaymentHookData = {
                    ...initialPayment,
                    confirmedAmount: initialPayment.confirmedAmount as bigint + 1n, // just some irrelevant change
                  };
                  tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                    paymentId("id1"),
                    initialPayment,
                    updatedPayment,
                  );
                });

                it("should do nothing", async () => {
                  await expect(tx).to.not.emit(cashbackController, "CashbackDecreased");
                  await expect(tx).to.not.emit(cashbackController, "CashbackIncreased");
                  const operationState = resultToObject(await cashbackController
                    .getPaymentCashback(paymentId("id1")));

                  const accountCashbackState = resultToObject(await cashbackController
                    .getAccountCashback(payer.address));

                  checkEquality(accountCashbackState, {
                    totalAmount: initialAccountCashbackState.totalAmount,
                    capPeriodStartAmount: initialAccountCashbackState.capPeriodStartAmount,
                    capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                  });
                  checkEquality(operationState, {
                    balance: cashbackAmount,
                    recipient: payer.address,
                  });
                  await expect(tx).to.changeTokenBalances(tokenMock,
                    [treasury.address, payer.address, cashbackControllerAddress],
                    [0n, 0n, 0n],
                  );
                  await expect(tx).to.not.emit(tokenMock, "Transfer");
                });
              });
            });

            describe("payment cashback rate is not zero and sponsor exists and", () => {
              describe("the subsidy limit is less than the base amount and", () => {
                const baseAmount = 100n * DIGITS_COEF;
                const subsidyLimit = baseAmount / 2n;
                const cashbackRate = 100n;
                const cashbackAmount = cashbackRate * (baseAmount - subsidyLimit) / CASHBACK_FACTOR;
                let initialPayment: PaymentHookData;
                let initialAccountCashbackState: Awaited<ReturnType<typeof cashbackController.getAccountCashback>>;

                beforeEach(async () => {
                  initialPayment = {
                    baseAmount,
                    subsidyLimit,
                    status: 1n,
                    payer: payer.address,
                    cashbackRate,
                    confirmedAmount: 0n,
                    sponsor: sponsor.address,
                    extraAmount: 0n,
                    refundAmount: 0n,
                  };
                  await cashbackControllerFromHookTrigger.afterPaymentMade(
                    paymentId("id1"),
                    EMPTY_PAYMENT_HOOK_DATA,
                    initialPayment,
                  );
                  initialAccountCashbackState = await cashbackController.getAccountCashback(payer.address);
                });

                describe("base amount is increased", () => {
                  const newBaseAmount = baseAmount + 50n * DIGITS_COEF;
                  const newCashbackAmount = cashbackRate * (newBaseAmount - subsidyLimit) / CASHBACK_FACTOR;
                  const increaseAmount = newCashbackAmount - cashbackAmount;

                  let tx: TransactionResponse;

                  beforeEach(async () => {
                    const updatedPayment: PaymentHookData = {
                      ...initialPayment,
                      baseAmount: newBaseAmount,
                    };
                    tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                      paymentId("id1"),
                      initialPayment,
                      updatedPayment,
                    );
                  });

                  it("should emit the required event", async () => {
                    await expect(tx).to.emit(cashbackController, "CashbackIncreased")
                      .withArgs(
                        paymentId("id1"),
                        payer.address,
                        CashbackStatus.Success,
                        increaseAmount,
                        newCashbackAmount,
                      );
                  });

                  it("should update the payment cashback state", async () => {
                    const operationState = resultToObject(await cashbackController
                      .getPaymentCashback(paymentId("id1")));

                    checkEquality(operationState, {
                      balance: newCashbackAmount,
                      recipient: payer.address,
                    });
                  });

                  it("should update the cashback amount in the account cashback state", async () => {
                    const accountCashbackState = resultToObject(await cashbackController
                      .getAccountCashback(payer.address));
                    checkEquality(accountCashbackState, {
                      totalAmount: newCashbackAmount,
                      capPeriodStartAmount: 0n,
                      capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                    });
                  });

                  it("should update token balances correctly", async () => {
                    await expect(tx).to.changeTokenBalances(tokenMock,
                      [treasury.address, cashbackReceiver, cashbackControllerAddress],
                      [-increaseAmount, increaseAmount, 0n],
                    );
                  });

                  it("should transfer tokens correctly", async () => {
                    await checkTokenPath(
                      tx,
                      tokenMock,
                      [treasury, cashbackControllerAddress, cashbackReceiver],
                      increaseAmount,
                    );
                  });
                });

                describe("refund amount is increased", () => {
                  const refundAmount = 10n * DIGITS_COEF;
                  // refund is splitted between payer and sponsor according to base amount proportions
                  const newCashbackAmount = cashbackRate *
                    ((baseAmount - subsidyLimit) - refundAmount * subsidyLimit / baseAmount) /
                    CASHBACK_FACTOR;
                  const decreaseAmount = cashbackAmount - newCashbackAmount;

                  let tx: TransactionResponse;

                  beforeEach(async () => {
                    const updatedPayment: PaymentHookData = {
                      ...initialPayment,
                      refundAmount,
                    };
                    tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                      paymentId("id1"),
                      initialPayment,
                      updatedPayment,
                    );
                  });

                  it("should emit the required event", async () => {
                    await expect(tx).to.emit(cashbackController, "CashbackDecreased")
                      .withArgs(
                        paymentId("id1"),
                        payer.address,
                        CashbackStatus.Success,
                        decreaseAmount,
                        newCashbackAmount,
                      );
                  });

                  it("should update the payment cashback state", async () => {
                    const operationState = resultToObject(await cashbackController
                      .getPaymentCashback(paymentId("id1")));

                    checkEquality(operationState, {
                      balance: newCashbackAmount,
                      recipient: payer.address,
                    });
                  });

                  it("should update the cashback amount in the account cashback state", async () => {
                    const accountCashbackState = resultToObject(await cashbackController
                      .getAccountCashback(payer.address));
                    checkEquality(accountCashbackState, {
                      totalAmount: newCashbackAmount,
                      capPeriodStartAmount: 0n,
                      capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                    });
                  });

                  it("should update token balances correctly", async () => {
                    await expect(tx).to.changeTokenBalances(tokenMock,
                      [treasury.address, cashbackReceiver, cashbackControllerAddress],
                      [decreaseAmount, -decreaseAmount, 0n],
                    );
                  });

                  it("should transfer tokens correctly", async () => {
                    await checkTokenPath(
                      tx,
                      tokenMock,
                      [cashbackReceiver, cashbackControllerAddress, treasury],
                      decreaseAmount,
                    );
                  });
                });

                describe("the refund amount increases but the sponsor's refund is capped by the subsidy limit", () => {
                  const additionalRefundThatWillGoToPayer = 10n * DIGITS_COEF;
                  const refundAmount =
                    baseAmount + // amount of refund to make sponsor part equal to subsidy limit
                    additionalRefundThatWillGoToPayer; // additional refund that will cap sponsor part and goes to payer
                  // but we will not charge cashback for the additional refund that goes to payer
                  const newCashbackAmount = 0n;
                  const decreaseAmount = cashbackAmount;

                  let tx: TransactionResponse;

                  beforeEach(async () => {
                    const updatedPayment: PaymentHookData = {
                      ...initialPayment,
                      refundAmount,
                    };
                    tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                      paymentId("id1"),
                      initialPayment,
                      updatedPayment,
                    );
                  });

                  it("should emit the required event", async () => {
                    await expect(tx).to.emit(cashbackController, "CashbackDecreased")
                      .withArgs(
                        paymentId("id1"),
                        payer.address,
                        CashbackStatus.Success,
                        decreaseAmount,
                        newCashbackAmount,
                      );
                  });

                  it("should update the payment cashback state", async () => {
                    const operationState = resultToObject(await cashbackController
                      .getPaymentCashback(paymentId("id1")));

                    checkEquality(operationState, {
                      balance: 0n,
                      recipient: payer.address,
                    });
                  });

                  it("should update the cashback amount in the account cashback state", async () => {
                    const accountCashbackState = resultToObject(await cashbackController
                      .getAccountCashback(payer.address));
                    checkEquality(accountCashbackState, {
                      totalAmount: 0n,
                      capPeriodStartAmount: 0n,
                      capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                    });
                  });

                  it("should update token balances correctly", async () => {
                    await expect(tx).to.changeTokenBalances(tokenMock,
                      [treasury.address, cashbackReceiver, cashbackControllerAddress],
                      [decreaseAmount, -decreaseAmount, 0n],
                    );
                  });

                  it("should transfer tokens correctly", async () => {
                    await checkTokenPath(
                      tx,
                      tokenMock,
                      [cashbackReceiver, cashbackControllerAddress, treasury],
                      decreaseAmount,
                    );
                  });
                });
              });

              describe("subsidy limit is greater than base amount and", () => {
                const baseAmount = 100n * DIGITS_COEF;
                const subsidyLimit = baseAmount + 50n * DIGITS_COEF;
                const cashbackRate = 100n;
                let initialPayment: PaymentHookData;
                let initialAccountCashbackState: Awaited<ReturnType<typeof cashbackController.getAccountCashback>>;

                beforeEach(async () => {
                  initialPayment = {
                    baseAmount,
                    subsidyLimit,
                    status: 1n,
                    payer: payer.address,
                    cashbackRate,
                    confirmedAmount: 0n,
                    sponsor: sponsor.address,
                    extraAmount: 0n,
                    refundAmount: 0n,
                  };
                  await cashbackControllerFromHookTrigger.afterPaymentMade(
                    paymentId("id1"),
                    EMPTY_PAYMENT_HOOK_DATA,
                    initialPayment,
                  );
                  initialAccountCashbackState = await cashbackController.getAccountCashback(payer.address);
                });

                describe("the base amount is increased but remains below the subsidy limit", () => {
                  const newBaseAmount = baseAmount + 10n * DIGITS_COEF;

                  let tx: TransactionResponse;

                  beforeEach(async () => {
                    const updatedPayment: PaymentHookData = {
                      ...initialPayment,
                      baseAmount: newBaseAmount,
                    };
                    tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                      paymentId("id1"),
                      initialPayment,
                      updatedPayment,
                    );
                  });

                  it("should not emit events", async () => {
                    await expect(tx).to.not.emit(cashbackController, "CashbackIncreased");
                  });

                  it("should not change the payment cashback state", async () => {
                    const operationState = resultToObject(await cashbackController
                      .getPaymentCashback(paymentId("id1")));

                    checkEquality(operationState, {
                      balance: 0n,
                      recipient: payer.address,
                    });
                  });

                  it("should not update the cashback amount in the account cashback state", async () => {
                    const accountCashbackState = resultToObject(await cashbackController
                      .getAccountCashback(payer.address));
                    checkEquality(accountCashbackState, {
                      totalAmount: 0n,
                      capPeriodStartAmount: 0n,
                      capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                    });
                  });

                  it("should not update token balances", async () => {
                    await expect(tx).to.changeTokenBalances(tokenMock,
                      [treasury.address, cashbackReceiver, cashbackControllerAddress],
                      [0n, 0n, 0n],
                    );
                  });

                  it("should not transfer tokens", async () => {
                    await expect(tx).to.not.emit(tokenMock, "Transfer");
                  });
                });

                describe("the base amount is increased above the subsidy limit", () => {
                  const newBaseAmount = subsidyLimit + 50n * DIGITS_COEF;
                  const newCashbackAmount = cashbackRate * (newBaseAmount - subsidyLimit) / CASHBACK_FACTOR;

                  let tx: TransactionResponse;

                  beforeEach(async () => {
                    const updatedPayment: PaymentHookData = {
                      ...initialPayment,
                      baseAmount: newBaseAmount,
                    };
                    tx = await cashbackControllerFromHookTrigger.afterPaymentUpdated(
                      paymentId("id1"),
                      initialPayment,
                      updatedPayment,
                    );
                  });

                  it("should emit the required event", async () => {
                    await expect(tx).to.emit(cashbackController, "CashbackIncreased")
                      .withArgs(paymentId("id1"),
                        payer.address,
                        CashbackStatus.Success,
                        newCashbackAmount,
                        newCashbackAmount,
                      );
                  });

                  it("should update the payment cashback state", async () => {
                    const operationState = resultToObject(await cashbackController
                      .getPaymentCashback(paymentId("id1")));

                    checkEquality(operationState, {
                      balance: newCashbackAmount,
                      recipient: payer.address,
                    });
                  });

                  it("should update the account cashback state", async () => {
                    const accountCashbackState = resultToObject(await cashbackController
                      .getAccountCashback(payer.address));
                    checkEquality(accountCashbackState, {
                      totalAmount: newCashbackAmount,
                      capPeriodStartAmount: 0n,
                      capPeriodStartTime: await getTxTimestamp(tx),
                    });
                  });

                  it("should update token balances correctly", async () => {
                    await expect(tx).to.changeTokenBalances(tokenMock,
                      [treasury.address, cashbackReceiver, cashbackControllerAddress],
                      [-newCashbackAmount, newCashbackAmount, 0n],
                    );
                  });

                  it("should transfer tokens correctly", async () => {
                    await checkTokenPath(
                      tx,
                      tokenMock,
                      [treasury, cashbackControllerAddress, cashbackReceiver],
                      newCashbackAmount,
                    );
                  });
                });
              });
            });
          });
          describe("Should revert if", () => {
            it("called by a non-hook trigger", async () => {
              await expect(cashbackControllerFromStranger.afterPaymentUpdated(
                paymentId("id1"),
                EMPTY_PAYMENT_HOOK_DATA,
                EMPTY_PAYMENT_HOOK_DATA,
              )).to.be.revertedWithCustomError(cashbackControllerFromStranger, "AccessControlUnauthorizedAccount")
                .withArgs(stranger.address, HOOK_TRIGGER_ROLE);
            });
          });
        });

        describe("Method 'afterPaymentCanceled()'", () => {
          describe("Should execute as expected when called properly and if", () => {
            describe("cashback rate is zero", () => {
              const baseAmount = 100n * DIGITS_COEF;
              const cashbackRate = 0n;
              let initialPayment: PaymentHookData;
              let initialAccountCashbackState: Awaited<ReturnType<typeof cashbackController.getAccountCashback>>;
              let initialOperationState: Awaited<ReturnType<typeof cashbackController.getPaymentCashback>>;
              let tx: TransactionResponse;

              beforeEach(async () => {
                initialPayment = {
                  baseAmount,
                  subsidyLimit: 0n,
                  status: 1n,
                  payer: payer.address,
                  cashbackRate,
                  confirmedAmount: 0n,
                  sponsor: ethers.ZeroAddress,
                  extraAmount: 0n,
                  refundAmount: 0n,
                };
                await cashbackControllerFromHookTrigger.afterPaymentMade(
                  paymentId("id1"),
                  EMPTY_PAYMENT_HOOK_DATA,
                  initialPayment,
                );
                initialAccountCashbackState = await cashbackController.getAccountCashback(payer.address);
                initialOperationState = await cashbackController.getPaymentCashback(paymentId("id1"));
                tx = await cashbackControllerFromHookTrigger.afterPaymentCanceled(
                  paymentId("id1"),
                  initialPayment,
                  EMPTY_PAYMENT_HOOK_DATA,
                );
              });

              it("should do nothing", async () => {
                await expect(tx).to.not.emit(cashbackController, "CashbackDecreased");
                await expect(tx).to.not.emit(cashbackController, "CashbackIncreased");
                await expect(tx).to.changeTokenBalances(tokenMock,
                  [treasury.address, cashbackReceiver, cashbackControllerAddress],
                  [0n, 0n, 0n],
                );

                await expect(tx).to.not.emit(tokenMock, "Transfer");
                checkEquality(
                  resultToObject(await cashbackController.getAccountCashback(payer.address)),
                  resultToObject(initialAccountCashbackState),
                );
                checkEquality(
                  resultToObject(await cashbackController.getPaymentCashback(paymentId("id1"))),
                  resultToObject(initialOperationState),
                );
              });
            });

            describe("cashback rate is not zero", () => {
              const baseAmount = 100n * DIGITS_COEF;
              const cashbackRate = 100n;
              const cashbackAmount = cashbackRate * baseAmount / CASHBACK_FACTOR;

              let initialPayment: PaymentHookData;
              let initialAccountCashbackState: Awaited<ReturnType<typeof cashbackController.getAccountCashback>>;
              let tx: TransactionResponse;

              beforeEach(async () => {
                initialPayment = {
                  baseAmount,
                  subsidyLimit: 0n,
                  status: 1n,
                  payer: payer.address,
                  cashbackRate,
                  confirmedAmount: 0n,
                  sponsor: ethers.ZeroAddress,
                  extraAmount: 0n,
                  refundAmount: 0n,
                };
                await cashbackControllerFromHookTrigger.afterPaymentMade(
                  paymentId("id1"),
                  EMPTY_PAYMENT_HOOK_DATA,
                  initialPayment,
                );
                initialAccountCashbackState = await cashbackController.getAccountCashback(payer.address);
                tx = await cashbackControllerFromHookTrigger.afterPaymentCanceled(
                  paymentId("id1"),
                  initialPayment,
                  EMPTY_PAYMENT_HOOK_DATA,
                );
              });

              it("should emit the required event", async () => {
                await expect(tx).to.emit(cashbackController, "CashbackDecreased")
                  .withArgs(
                    paymentId("id1"),
                    payer.address,
                    CashbackStatus.Success,
                    cashbackAmount,
                    0n,
                  );
              });

              it("should update the payment cashback state", async () => {
                const operationState = resultToObject(await cashbackController
                  .getPaymentCashback(paymentId("id1")));

                checkEquality(operationState, {
                  balance: 0n,
                  recipient: payer.address,
                });
              });

              it("should update the cashback amount in the account cashback state", async () => {
                const accountCashbackState = resultToObject(await cashbackController
                  .getAccountCashback(payer.address));
                checkEquality(accountCashbackState, {
                  totalAmount: 0n,
                  capPeriodStartAmount: 0n,
                  capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                });
              });

              it("should update token balances correctly", async () => {
                await expect(tx).to.changeTokenBalances(tokenMock,
                  [treasury.address, cashbackReceiver, cashbackControllerAddress],
                  [cashbackAmount, -cashbackAmount, 0n],
                );
              });

              it("should transfer tokens correctly", async () => {
                await checkTokenPath(
                  tx,
                  tokenMock,
                  [cashbackReceiver, cashbackControllerAddress, treasury],
                  cashbackAmount,
                );
              });
            });

            describe("cashback rate is not zero but payment had no cashback because it was capped", () => {
              const cashbackRate = 100n;
              let initialPayment: PaymentHookData;
              let initialAccountCashbackState: Awaited<ReturnType<typeof cashbackController.getAccountCashback>>;
              let initialOperationState: Awaited<ReturnType<typeof cashbackController.getPaymentCashback>>;
              let tx: TransactionResponse;
              beforeEach(async () => {
                const cappingPayment: PaymentHookData = {
                  baseAmount: MAX_CASHBACK_FOR_CAP_PERIOD * CASHBACK_FACTOR / cashbackRate + 1n * DIGITS_COEF,
                  subsidyLimit: 0n,
                  status: 1n,
                  payer: payer.address,
                  cashbackRate,
                  confirmedAmount: 0n,
                  sponsor: ethers.ZeroAddress,
                  extraAmount: 0n,
                  refundAmount: 0n,
                };
                // spending cap limit
                await cashbackControllerFromHookTrigger.afterPaymentMade(
                  paymentId("capping payment"),
                  EMPTY_PAYMENT_HOOK_DATA,
                  cappingPayment,
                );

                initialPayment = {
                  baseAmount: 100n * DIGITS_COEF,
                  subsidyLimit: 0n,
                  status: 1n,
                  payer: payer.address,
                  cashbackRate,
                  confirmedAmount: 0n,
                  sponsor: ethers.ZeroAddress,
                  extraAmount: 0n,
                  refundAmount: 0n,
                };
                await cashbackControllerFromHookTrigger.afterPaymentMade(
                  paymentId("id1"),
                  EMPTY_PAYMENT_HOOK_DATA,
                  initialPayment,
                );
                initialAccountCashbackState = await cashbackController.getAccountCashback(payer.address);
                initialOperationState = await cashbackController.getPaymentCashback(paymentId("id1"));
                tx = await cashbackControllerFromHookTrigger.afterPaymentCanceled(
                  paymentId("id1"),
                  initialPayment,
                  EMPTY_PAYMENT_HOOK_DATA,
                );
              });

              it("should not emit the event", async () => {
                await expect(tx).to.not.emit(cashbackController, "CashbackDecreased");
              });

              it("should not change the payment cashback state", async () => {
                const operationState = resultToObject(await cashbackController
                  .getPaymentCashback(paymentId("id1")));

                checkEquality(operationState, {
                  balance: initialOperationState.balance,
                  recipient: payer.address,
                });
              });

              it("should not update the account cashback state", async () => {
                const accountCashbackState = resultToObject(await cashbackController
                  .getAccountCashback(payer.address));
                checkEquality(accountCashbackState, {
                  capPeriodStartAmount: initialAccountCashbackState.capPeriodStartAmount,
                  capPeriodStartTime: initialAccountCashbackState.capPeriodStartTime,
                  totalAmount: initialAccountCashbackState.totalAmount,
                });
              });

              it("should not update token balances", async () => {
                await expect(tx).to.changeTokenBalances(tokenMock,
                  [treasury.address, cashbackReceiver, cashbackControllerAddress],
                  [0n, 0n, 0n],
                );
              });

              it("should not transfer tokens", async () => {
                await expect(tx).to.not.emit(tokenMock, "Transfer");
              });
            });
          });

          describe("Should revert if", () => {
            it("called by a non-hook trigger", async () => {
              await expect(cashbackControllerFromStranger.afterPaymentCanceled(
                paymentId("id1"),
                EMPTY_PAYMENT_HOOK_DATA,
                EMPTY_PAYMENT_HOOK_DATA,
              )).to.be.revertedWithCustomError(cashbackControllerFromStranger, "AccessControlUnauthorizedAccount")
                .withArgs(stranger.address, HOOK_TRIGGER_ROLE);
            });
          });
        });
      });
    }

    describe("Specific cases with cashback vault", () => {
      let cashbackVault: Contracts.CashbackVault;
      beforeEach(async () => {
        await setUpFixture(async function configureCV() {
          cashbackVault = await deployCashbackVault(tokenMock);
          await cashbackVault.grantRole(GRANTOR_ROLE, deployer.address);
          await cashbackVault.grantRole(CASHBACK_OPERATOR_ROLE, await cashbackController.getAddress());
          await cashbackVault.grantRole(MANAGER_ROLE, deployer.address);
          await cashbackControllerFromOwner.setCashbackVault(await cashbackVault.getAddress());
        });
      });

      describe("Method 'afterPaymentCanceled()'", () => {
        const baseAmount = 100n * DIGITS_COEF;
        const cashbackRate = 100n;
        const cashbackAmount = baseAmount * cashbackRate / CASHBACK_FACTOR;
        let initialPayment: PaymentHookData;
        beforeEach(async () => {
          initialPayment = {
            baseAmount,
            subsidyLimit: 0n,
            status: 1n,
            payer: payer.address,
            cashbackRate,
            confirmedAmount: 0n,
            sponsor: ethers.ZeroAddress,
            extraAmount: 0n,
            refundAmount: 0n,
          };
          await cashbackControllerFromHookTrigger.afterPaymentMade(
            paymentId("id1"),
            EMPTY_PAYMENT_HOOK_DATA,
            initialPayment,
          );
        });

        describe("Revoking cashback from vault and from payer if vault cashback balance is not enough", () => {
          let tx: TransactionResponse;
          beforeEach(async () => {
            await cashbackVault.claim(payer.address, cashbackAmount / 2n);
            tx = await cashbackControllerFromHookTrigger.afterPaymentCanceled(
              paymentId("id1"),
              initialPayment,
              EMPTY_PAYMENT_HOOK_DATA,
            );
          });

          it("should update token balances correctly", async () => {
            await expect(tx).to.changeTokenBalances(tokenMock,
              [treasury.address, payer.address, cashbackControllerAddress, cashbackVault],
              [cashbackAmount, -cashbackAmount / 2n, 0n, -cashbackAmount / 2n],
            );
          });

          it("should transfer tokens from cashback vault and from payer to treasury", async () => {
            await checkTokenPath(tx, tokenMock, [cashbackVault, cashbackControllerAddress], cashbackAmount / 2n);
            await checkTokenPath(tx, tokenMock, [payer, cashbackControllerAddress], cashbackAmount / 2n);
            await checkTokenPath(tx, tokenMock, [cashbackControllerAddress, treasury], cashbackAmount);
          });

          it("should decrease the claimable amount in the vault for the payer", async () => {
            expect(await cashbackVault.getAccountCashbackBalance(payer.address)).to.equal(0n);
          });

          it("should emit the required event", async () => {
            await expect(tx).to.emit(cashbackVault, "CashbackRevoked")
              .withArgs(payer.address, cashbackControllerAddress, cashbackAmount / 2n, 0n);
          });
        });
      });
    });
  });

  describe("Scenario with cashback cap", () => {
    beforeEach(async () => {
      await setUpFixture(async function setUpTreasury() {
        await cashbackControllerFromOwner.setCashbackTreasury(treasury.address);
      });
    });

    describe("first payment that does not reach the cap", () => {
      const cashbackRate = 100n;
      let firstCashbackAmount: bigint;
      let capPeriodStartTime: number;
      let tx: TransactionResponse;

      beforeEach(async () => {
        const baseAmount = 100n * DIGITS_COEF;
        firstCashbackAmount = cashbackRate * baseAmount / CASHBACK_FACTOR;
        tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
          paymentId("id1"),
          EMPTY_PAYMENT_HOOK_DATA,
          {
            baseAmount,
            subsidyLimit: 0n,
            status: 1n,
            payer: payer.address,
            cashbackRate,
            confirmedAmount: 0n,
            sponsor: ethers.ZeroAddress,
            extraAmount: 0n,
            refundAmount: 0n,
          },
        );
        capPeriodStartTime = await getTxTimestamp(tx);
      });

      it("should increase the cashback amount in the account cashback state", async () => {
        const accountCashbackState = resultToObject(await cashbackController
          .getAccountCashback(payer.address));
        checkEquality(accountCashbackState, {
          capPeriodStartAmount: 0n,
          capPeriodStartTime: capPeriodStartTime,
          totalAmount: firstCashbackAmount,
        });
      });

      it("should emit the required event", async () => {
        await expect(tx).to.emit(cashbackController, "CashbackSent")
          .withArgs(paymentId("id1"), payer.address, CashbackStatus.Success, firstCashbackAmount);
      });

      it("should update token balances correctly", async () => {
        await expect(tx).to.changeTokenBalances(tokenMock,
          [treasury.address, payer.address, cashbackControllerAddress],
          [-firstCashbackAmount, firstCashbackAmount, 0n],
        );
      });

      it("should transfer tokens correctly", async () => {
        await checkTokenPath(tx, tokenMock, [treasury, cashbackControllerAddress, payer], firstCashbackAmount);
      });

      describe("second payment that reaches the cap", () => {
        let secondCashbackAmount: bigint;
        beforeEach(async () => {
          const baseAmount = MAX_CASHBACK_FOR_CAP_PERIOD * CASHBACK_FACTOR / cashbackRate + 1n * DIGITS_COEF;
          secondCashbackAmount = MAX_CASHBACK_FOR_CAP_PERIOD - firstCashbackAmount;
          tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
            paymentId("id2"),
            EMPTY_PAYMENT_HOOK_DATA,
            {
              baseAmount,
              subsidyLimit: 0n,
              status: 1n,
              payer: payer.address,
              cashbackRate,
              confirmedAmount: 0n,
              sponsor: ethers.ZeroAddress,
              extraAmount: 0n,
              refundAmount: 0n,
            },
          );
        });

        it("should cap the cashback amount in the account cashback state", async () => {
          const accountCashbackState = resultToObject(await cashbackController
            .getAccountCashback(payer.address));
          checkEquality(accountCashbackState, {
            capPeriodStartAmount: 0n,
            capPeriodStartTime: capPeriodStartTime,
            totalAmount: MAX_CASHBACK_FOR_CAP_PERIOD,
          });
        });

        it("should emit the required event", async () => {
          await expect(tx).to.emit(cashbackController, "CashbackSent")
            .withArgs(paymentId("id2"),
              payer.address,
              CashbackStatus.Partial,
              secondCashbackAmount,
            );
        });

        it("should update token balances correctly", async () => {
          await expect(tx).to.changeTokenBalances(tokenMock,
            [treasury.address, payer.address, cashbackControllerAddress],
            [-secondCashbackAmount, secondCashbackAmount, 0n],
          );
        });

        it("should transfer tokens correctly", async () => {
          await checkTokenPath(tx, tokenMock, [treasury, cashbackControllerAddress, payer], secondCashbackAmount);
        });

        describe("third payment that capped the cashback amount", () => {
          let tx: TransactionResponse;
          beforeEach(async () => {
            tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
              paymentId("id3"),
              EMPTY_PAYMENT_HOOK_DATA,
              {
                baseAmount: 100n * DIGITS_COEF,
                subsidyLimit: 0n,
                status: 1n,
                payer: payer.address,
                cashbackRate,
                confirmedAmount: 0n,
                sponsor: ethers.ZeroAddress,
                extraAmount: 0n,
                refundAmount: 0n,
              },
            );
          });

          it("should cap the cashback amount in the account cashback state", async () => {
            const accountCashbackState = resultToObject(await cashbackController
              .getAccountCashback(payer.address));
            checkEquality(accountCashbackState, {
              capPeriodStartAmount: 0n,
              capPeriodStartTime: capPeriodStartTime,
              totalAmount: MAX_CASHBACK_FOR_CAP_PERIOD,
            });
          });

          it("should emit the required event", async () => {
            await expect(tx).to.emit(cashbackController, "CashbackSent")
              .withArgs(paymentId("id3"), payer.address, CashbackStatus.Capped, 0n);
          });

          it("should not update token balances", async () => {
            await expect(tx).to.changeTokenBalances(tokenMock,
              [treasury.address, payer.address, cashbackControllerAddress],
              [0n, 0n, 0n],
            );
          });

          describe("fourth payment after cap period", () => {
            const cashbackAmount = 10n * DIGITS_COEF;
            beforeEach(async () => {
              await increaseBlockTimestamp(CASHBACK_CAP_RESET_PERIOD + 1);
              tx = await cashbackControllerFromHookTrigger.afterPaymentMade(
                paymentId("id4"),
                EMPTY_PAYMENT_HOOK_DATA,
                {
                  baseAmount: 100n * DIGITS_COEF,
                  subsidyLimit: 0n,
                  status: 1n,
                  payer: payer.address,
                  cashbackRate,
                  confirmedAmount: 0n,
                  sponsor: ethers.ZeroAddress,
                  extraAmount: 0n,
                  refundAmount: 0n,
                },
              );
            });

            it("should increase the cashback amount in the account cashback state", async () => {
              const accountCashbackState = resultToObject(await cashbackController
                .getAccountCashback(payer.address));
              checkEquality(accountCashbackState, {
                capPeriodStartAmount: MAX_CASHBACK_FOR_CAP_PERIOD,
                capPeriodStartTime: await getTxTimestamp(tx),
                totalAmount: MAX_CASHBACK_FOR_CAP_PERIOD + cashbackAmount,
              });
            });

            it("should emit the required event", async () => {
              await expect(tx).to.emit(cashbackController, "CashbackSent")
                .withArgs(paymentId("id4"), payer.address, CashbackStatus.Success, cashbackAmount);
            });

            it("should update token balances correctly", async () => {
              await expect(tx).to.changeTokenBalances(tokenMock,
                [treasury.address, payer.address, cashbackControllerAddress],
                [-cashbackAmount, cashbackAmount, 0n],
              );
            });

            it("should transfer tokens correctly", async () => {
              await checkTokenPath(tx, tokenMock, [treasury, cashbackControllerAddress, payer], cashbackAmount);
            });
          });
        });
      });
    });
  });
});
