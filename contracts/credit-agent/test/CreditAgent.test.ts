/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, AbiCoder } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  connect,
  getAddress,
  proveTx,
  checkEquality,
} from "../test-utils/eth";
import { setUpFixture } from "../test-utils/common";
import {
  AgentState,
  Fixture,
  HookIndex,
  initialAgentState,
  deployAndConfigureContracts as deployAndConfigureCoreContracts,
  CreditRequestStatus,
  initialCashOut,
  CashOut,
} from "../test-utils/creditAgent";

const ADDRESS_ZERO = ethers.ZeroAddress;

interface Version {
  major: number;
  minor: number;
  patch: number;
}
const abiCoder = AbiCoder.defaultAbiCoder();

describe("Abstract Contract 'CreditAgent'", () => {
  const TX_ID_STUB = ethers.encodeBytes32String("STUB_TRANSACTION_ID_ORDINARY");

  const EXPECTED_VERSION: Version = {
    major: 1,
    minor: 3,
    patch: 0,
  };

  // Events of the contracts under test
  const EVENT_NAME_CASHIER_CHANGED = "CashierChanged";
  const EVENT_NAME_LENDING_MARKET_CHANGED = "LendingMarketChanged";

  // Errors of the library contracts
  const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";
  const ERROR_NAME_ENFORCED_PAUSE = "EnforcedPause";
  const ERROR_NAME_INVALID_INITIALIZATION = "InvalidInitialization";

  // Errors of the contracts under test
  const ERROR_NAME_ALREADY_CONFIGURED = "CreditAgent_AlreadyConfigured";
  const ERROR_NAME_LENDING_MARKET_NOT_CONTRACT = "CreditAgent_LendingMarketNotContract";
  const ERROR_NAME_LENDING_MARKET_INCOMPATIBLE = "CreditAgent_LendingMarketIncompatible";
  const ERROR_NAME_LENDING_MARKET_CALL_FAILED = "LendingMarketMock_Fail";
  const ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE = "CreditAgent_CreditRequestStatusInappropriate";

  // Errors of the contracts under test
  const ERROR_NAME_LOAN_TAKING_FAILED = "CreditAgent_LoanTakingFailed";
  const ERROR_NAME_LOAN_REVOCATION_FAILED = "CreditAgent_LoanRevocationFailed";

  const ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST = "SafeCastOverflowedUintDowncast";

  let creditAgentFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let manager: HardhatEthersSigner;
  let borrower: HardhatEthersSigner;

  const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
  const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
  const PAUSER_ROLE: string = ethers.id("PAUSER_ROLE");
  const RESCUER_ROLE: string = ethers.id("RESCUER_ROLE");
  const ADMIN_ROLE: string = ethers.id("ADMIN_ROLE");
  const MANAGER_ROLE: string = ethers.id("MANAGER_ROLE");

  before(async () => {
    [deployer, admin, manager, borrower] = await ethers.getSigners();

    creditAgentFactory = await ethers.getContractFactory("CreditAgentMock");
    creditAgentFactory = creditAgentFactory.connect(deployer); // Explicitly specifying the initial account
  });

  async function deployLendingMarketMock(): Promise<Contract> {
    const lendingMarketMockFactory = await ethers.getContractFactory("LendingMarketMock");
    const lendingMarketMock = await lendingMarketMockFactory.deploy() as Contract;
    await lendingMarketMock.waitForDeployment();

    return connect(lendingMarketMock, deployer); // Explicitly specifying the initial account
  }

  async function deployCreditAgentMock(): Promise<Contract> {
    const creditAgent = await upgrades.deployProxy(creditAgentFactory) as Contract;
    await creditAgent.waitForDeployment();

    return connect(creditAgent, deployer); // Explicitly specifying the initial account
  }

  async function deployAndConfigureCreditAgentMock(): Promise<Contract> {
    const creditAgent = await deployCreditAgentMock();
    await proveTx(creditAgent.grantRole(GRANTOR_ROLE, deployer.address));
    await proveTx(creditAgent.grantRole(ADMIN_ROLE, admin.address));
    await proveTx(creditAgent.grantRole(MANAGER_ROLE, manager.address));
    await proveTx(creditAgent.grantRole(PAUSER_ROLE, deployer.address));

    return creditAgent;
  }

  async function deployAndConfigureContracts(): Promise<Fixture> {
    return deployAndConfigureCoreContracts(deployAndConfigureCreditAgentMock);
  }

  describe("Function 'initialize()'", () => {
    it("Configures the contract as expected", async () => {
      const creditAgent = await setUpFixture(deployCreditAgentMock);

      // Role hashes
      expect(await creditAgent.OWNER_ROLE()).to.equal(OWNER_ROLE);
      expect(await creditAgent.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
      expect(await creditAgent.PAUSER_ROLE()).to.equal(PAUSER_ROLE);
      expect(await creditAgent.RESCUER_ROLE()).to.equal(RESCUER_ROLE);
      expect(await creditAgent.ADMIN_ROLE()).to.equal(ADMIN_ROLE);
      expect(await creditAgent.MANAGER_ROLE()).to.equal(MANAGER_ROLE);

      // The role admins
      expect(await creditAgent.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await creditAgent.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
      expect(await creditAgent.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await creditAgent.getRoleAdmin(RESCUER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await creditAgent.getRoleAdmin(ADMIN_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await creditAgent.getRoleAdmin(MANAGER_ROLE)).to.equal(GRANTOR_ROLE);

      // The deployer should have the owner role and admin role, but not the other roles
      expect(await creditAgent.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
      expect(await creditAgent.hasRole(GRANTOR_ROLE, deployer.address)).to.equal(false);
      expect(await creditAgent.hasRole(ADMIN_ROLE, deployer.address)).to.equal(true);
      expect(await creditAgent.hasRole(PAUSER_ROLE, deployer.address)).to.equal(false);
      expect(await creditAgent.hasRole(RESCUER_ROLE, deployer.address)).to.equal(false);
      expect(await creditAgent.hasRole(MANAGER_ROLE, deployer.address)).to.equal(false);

      // The initial contract state is unpaused
      expect(await creditAgent.paused()).to.equal(false);

      // The initial settings
      expect(await creditAgent.cashier()).to.equal(ADDRESS_ZERO);
      expect(await creditAgent.lendingMarket()).to.equal(ADDRESS_ZERO);
      checkEquality(await creditAgent.agentState() as AgentState, initialAgentState);
    });

    it("Is reverted if it is called a second time", async () => {
      const creditAgent = await setUpFixture(deployCreditAgentMock);
      await expect(creditAgent.initialize())
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_INVALID_INITIALIZATION);
    });

    it("Is reverted for the contract implementation if it is called even for the first time", async () => {
      const creditAgentImplementation = await creditAgentFactory.deploy() as Contract;
      await creditAgentImplementation.waitForDeployment();

      await expect(creditAgentImplementation.initialize())
        .to.be.revertedWithCustomError(creditAgentImplementation, ERROR_NAME_INVALID_INITIALIZATION);
    });
  });

  describe("Function '$__VERSION()'", () => {
    it("Returns expected values", async () => {
      const creditAgent = await setUpFixture(deployCreditAgentMock);
      const creditAgentVersion = await creditAgent.$__VERSION();
      checkEquality(creditAgentVersion, EXPECTED_VERSION);
    });
  });

  describe("Function 'setCashier()'", () => {
    it("Executes as expected in different cases", async () => {
      const creditAgent = await setUpFixture(deployAndConfigureCreditAgentMock);
      const lendingMarketMock = await setUpFixture(deployLendingMarketMock);
      const cashierStubAddress1 = borrower.address;
      const cashierStubAddress2 = admin.address;

      expect(await creditAgent.cashier()).to.equal(ADDRESS_ZERO);

      // Change the initial configuration
      await expect(connect(creditAgent, admin).setCashier(cashierStubAddress1))
        .to.emit(creditAgent, EVENT_NAME_CASHIER_CHANGED)
        .withArgs(cashierStubAddress1, ADDRESS_ZERO);
      expect(await creditAgent.cashier()).to.equal(cashierStubAddress1);
      checkEquality(await creditAgent.agentState() as AgentState, initialAgentState);

      // Change to a new non-zero address
      await expect(connect(creditAgent, admin).setCashier(cashierStubAddress2))
        .to.emit(creditAgent, EVENT_NAME_CASHIER_CHANGED)
        .withArgs(cashierStubAddress2, cashierStubAddress1);
      expect(await creditAgent.cashier()).to.equal(cashierStubAddress2);
      checkEquality(await creditAgent.agentState() as AgentState, initialAgentState);

      // Set the zero address
      await expect(connect(creditAgent, admin).setCashier(ADDRESS_ZERO))
        .to.emit(creditAgent, EVENT_NAME_CASHIER_CHANGED)
        .withArgs(ADDRESS_ZERO, cashierStubAddress2);
      expect(await creditAgent.cashier()).to.equal(ADDRESS_ZERO);
      checkEquality(await creditAgent.agentState() as AgentState, initialAgentState);

      // Set the lending market address, then the cashier address to check the logic of configured status
      await proveTx(connect(creditAgent, admin).setLendingMarket(lendingMarketMock));
      await proveTx(connect(creditAgent, admin).setCashier(cashierStubAddress1));
      expect(await creditAgent.cashier()).to.equal(cashierStubAddress1);
      const expectedAgentState = { ...initialAgentState, configured: true };
      checkEquality(await creditAgent.agentState() as AgentState, expectedAgentState);

      // Set another cashier address must not change the configured status of the agent contract
      await proveTx(connect(creditAgent, admin).setCashier(cashierStubAddress2));
      expect(await creditAgent.cashier()).to.equal(cashierStubAddress2);
      checkEquality(await creditAgent.agentState() as AgentState, expectedAgentState);

      // Resetting the address must change the configured status appropriately
      await proveTx(connect(creditAgent, admin).setCashier(ADDRESS_ZERO));
      expectedAgentState.configured = false;
      checkEquality(await creditAgent.agentState() as AgentState, expectedAgentState);
    });

    it("Is reverted if the contract is paused", async () => {
      const creditAgent = await setUpFixture(deployAndConfigureCreditAgentMock);
      const cashierMockAddress = borrower.address;

      await proveTx(creditAgent.pause());
      await expect(connect(creditAgent, admin).setCashier(cashierMockAddress))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ENFORCED_PAUSE);
    });

    it("Is reverted if the caller does not have the admin role", async () => {
      const creditAgent = await setUpFixture(deployAndConfigureCreditAgentMock);
      const cashierMockAddress = borrower.address;

      await expect(connect(creditAgent, manager).setCashier(cashierMockAddress))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(manager.address, ADMIN_ROLE);
    });

    it("Is reverted if the configuration is unchanged", async () => {
      const creditAgent = await setUpFixture(deployAndConfigureCreditAgentMock);
      const cashierMockAddress = borrower.address;

      // Try to set the default value
      await expect(connect(creditAgent, admin).setCashier(ADDRESS_ZERO))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ALREADY_CONFIGURED);

      // Try to set the same value twice
      await proveTx(connect(creditAgent, admin).setCashier(cashierMockAddress));
      await expect(connect(creditAgent, admin).setCashier(cashierMockAddress))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ALREADY_CONFIGURED);
    });

    // Additional more complex checks are in the other sections
  });

  describe("Function 'setLendingMarket()'", () => {
    it("Executes as expected in different cases", async () => {
      const creditAgent = await setUpFixture(deployAndConfigureCreditAgentMock);
      const lendingMarketMock = await setUpFixture(deployLendingMarketMock);
      const lendingMarketMock2 = await deployLendingMarketMock();

      expect(await creditAgent.lendingMarket()).to.equal(ADDRESS_ZERO);

      // Change the initial configuration
      await expect(connect(creditAgent, admin).setLendingMarket(lendingMarketMock))
        .to.emit(creditAgent, EVENT_NAME_LENDING_MARKET_CHANGED)
        .withArgs(lendingMarketMock, ADDRESS_ZERO);
      expect(await creditAgent.lendingMarket()).to.equal(lendingMarketMock);
      checkEquality(await creditAgent.agentState() as AgentState, initialAgentState);

      // Change to a new non-zero address
      await expect(connect(creditAgent, admin).setLendingMarket(lendingMarketMock2))
        .to.emit(creditAgent, EVENT_NAME_LENDING_MARKET_CHANGED)
        .withArgs(lendingMarketMock2, lendingMarketMock);
      expect(await creditAgent.lendingMarket()).to.equal(lendingMarketMock2);
      checkEquality(await creditAgent.agentState() as AgentState, initialAgentState);

      // Set the zero address
      await expect(connect(creditAgent, admin).setLendingMarket(ADDRESS_ZERO))
        .to.emit(creditAgent, EVENT_NAME_LENDING_MARKET_CHANGED)
        .withArgs(ADDRESS_ZERO, lendingMarketMock2);
      expect(await creditAgent.lendingMarket()).to.equal(ADDRESS_ZERO);
      checkEquality(await creditAgent.agentState() as AgentState, initialAgentState);

      // Set the cashier address, then the lending market address to check the logic of configured status
      const cashierStubAddress = borrower.address;
      await proveTx(connect(creditAgent, admin).setCashier(cashierStubAddress));
      await proveTx(connect(creditAgent, admin).setLendingMarket(lendingMarketMock));
      expect(await creditAgent.lendingMarket()).to.equal(lendingMarketMock);
      const expectedAgentState = { ...initialAgentState, configured: true };
      checkEquality(await creditAgent.agentState() as AgentState, expectedAgentState);

      // Set another lending market address must not change the configured status of the agent contract
      await proveTx(connect(creditAgent, admin).setLendingMarket(lendingMarketMock2));
      expect(await creditAgent.lendingMarket()).to.equal(lendingMarketMock2);
      checkEquality(await creditAgent.agentState() as AgentState, expectedAgentState);

      // Resetting the address must change the configured status appropriately
      await proveTx(connect(creditAgent, admin).setLendingMarket(ADDRESS_ZERO));
      expectedAgentState.configured = false;
      checkEquality(await creditAgent.agentState() as AgentState, expectedAgentState);
    });

    it("Is reverted if the contract is paused", async () => {
      const creditAgent = await setUpFixture(deployAndConfigureCreditAgentMock);
      const lendingMarketMockAddress = borrower.address;

      await proveTx(creditAgent.pause());
      await expect(connect(creditAgent, admin).setLendingMarket(lendingMarketMockAddress))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ENFORCED_PAUSE);
    });

    it("Is reverted if the caller does not have the admin role", async () => {
      const creditAgent = await setUpFixture(deployAndConfigureCreditAgentMock);
      const lendingMarketMockAddress = borrower.address;

      await expect(connect(creditAgent, manager).setLendingMarket(lendingMarketMockAddress))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(manager.address, ADMIN_ROLE);
    });

    it("Is reverted if the configuration is unchanged", async () => {
      const creditAgent = await setUpFixture(deployAndConfigureCreditAgentMock);
      const lendingMarketMock = await setUpFixture(deployLendingMarketMock);

      // Try to set the default value
      await expect(connect(creditAgent, admin).setLendingMarket(ADDRESS_ZERO))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ALREADY_CONFIGURED);

      // Try to set the same value twice
      await proveTx(connect(creditAgent, admin).setLendingMarket(lendingMarketMock));
      await expect(connect(creditAgent, admin).setLendingMarket(lendingMarketMock))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ALREADY_CONFIGURED);
    });

    it("Is reverted if the provided lending market address is not a contract", async () => {
      const creditAgent = await setUpFixture(deployAndConfigureCreditAgentMock);
      const lendingMarketMockAddress = borrower.address;

      await expect(connect(creditAgent, admin).setLendingMarket(lendingMarketMockAddress))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_LENDING_MARKET_NOT_CONTRACT);
    });

    it("Is reverted if the provided lending market address is not compatible", async () => {
      const creditAgent = await setUpFixture(deployAndConfigureCreditAgentMock);
      const lendingMarketMock = await setUpFixture(deployLendingMarketMock);
      await lendingMarketMock.setCompatible(false);

      await expect(connect(creditAgent, admin).setLendingMarket(lendingMarketMock))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_LENDING_MARKET_INCOMPATIBLE);
    });

    // Additional more complex checks are in the other sections
  });

  describe("Function 'onCashierHook()'", () => {
    describe("Is reverted", () => {
      describe("For an unknown credit in the case of", () => {
        it("A cash-out request hook", async () => {
          const { creditAgent, cashierMock } = await setUpFixture(deployAndConfigureContracts);
          const txId = TX_ID_STUB;
          await expect(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId))
            .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
            .withArgs(txId, CreditRequestStatus.Nonexistent);
        });

        it("A cash-out confirmation hook", async () => {
          const { creditAgent, cashierMock } = await setUpFixture(deployAndConfigureContracts);
          const txId = TX_ID_STUB;
          await expect(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutConfirmationAfter, txId))
            .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
            .withArgs(txId, CreditRequestStatus.Nonexistent);
        });

        it("A cash-out reversal hook", async () => {
          const { creditAgent, cashierMock } = await setUpFixture(deployAndConfigureContracts);
          const txId = TX_ID_STUB;
          await expect(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutReversalAfter, txId))
            .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
            .withArgs(txId, CreditRequestStatus.Nonexistent);
        });
      });

      it("For a cash-out request hook when the take loan call fails", async () => {
        const { creditAgent, cashierMock, lendingMarketMock } = await setUpFixture(deployAndConfigureContracts);
        const txId = TX_ID_STUB;
        await cashierMock.setCashOut(txId, {
          ...initialCashOut,
          account: borrower.address,
          amount: 100n,
        } as CashOut);
        const failExecutionFunction = lendingMarketMock.interface.getFunction("failExecution")!;
        const revokeLoanFunction = lendingMarketMock.interface.getFunction("revokeLoan")!;
        await creditAgent.createCreditRequest(
          txId,
          borrower.address,
          100n,
          failExecutionFunction.selector,
          revokeLoanFunction.selector,
          abiCoder.encode(failExecutionFunction.inputs, [100n]),
        );
        // error thrown by the lending market mock
        const expectedErrorData = lendingMarketMock.interface.encodeErrorResult(
          ERROR_NAME_LENDING_MARKET_CALL_FAILED,
          [100n],
        );
        await expect(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_LOAN_TAKING_FAILED)
          .withArgs(txId, expectedErrorData);
      });

      it("For a cash-out request hook when the revoke loan call fails", async () => {
        const { creditAgent, cashierMock, lendingMarketMock } = await setUpFixture(deployAndConfigureContracts);
        const txId = TX_ID_STUB;
        await cashierMock.setCashOut(txId, {
          ...initialCashOut,
          account: borrower.address,
          amount: 100n,
        } as CashOut);

        const failExecutionFunction = lendingMarketMock.interface.getFunction("failExecution")!;
        const takeLoanFunction = lendingMarketMock.interface.getFunction("takeLoanFor")!;
        await creditAgent.createCreditRequest(
          txId,
          borrower.address,
          100n,
          takeLoanFunction.selector,
          failExecutionFunction.selector,
          abiCoder.encode(takeLoanFunction.inputs,
            [borrower.address, 100n, 100n, 100n, 100n],
          ),
        );
        await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));

        // error thrown by the lending market mock
        const expectedErrorData = lendingMarketMock.interface.encodeErrorResult(
          ERROR_NAME_LENDING_MARKET_CALL_FAILED,
          [await lendingMarketMock.LOAN_ID_STAB()],
        );

        await expect(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutReversalAfter, txId))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_LOAN_REVOCATION_FAILED)
          .withArgs(txId, expectedErrorData);
      });
    });
  });

  describe("Internal function _createCreditRequest()", () => {
    it("Is reverted if the provided cash-out amount exceeds the uint64.max value", async () => {
      const { creditAgent, lendingMarketMock } = await setUpFixture(deployAndConfigureContracts);
      const txId = TX_ID_STUB;
      const takeLoanFunction = lendingMarketMock.interface.getFunction("takeLoanFor")!;
      const revokeLoanFunction = lendingMarketMock.interface.getFunction("revokeLoan")!;
      await expect(creditAgent.createCreditRequest(
        txId,
        borrower.address,
        2n ** 64n,
        takeLoanFunction.selector,
        revokeLoanFunction.selector,
        abiCoder.encode(takeLoanFunction.inputs, [borrower.address, 1, 100, 0, 10]),
      )).to.be.revertedWithCustomError(creditAgent, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST);
    });
  });
});
