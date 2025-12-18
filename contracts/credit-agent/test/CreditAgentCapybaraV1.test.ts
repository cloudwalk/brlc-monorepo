import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

import {
  connect,
  getAddress,
  proveTx,
  checkEquality,
  getBlockTimestamp,
  checkContractUupsUpgrading,
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
const EXPIRATION_TIME_SECONDS = 5 * 60;

interface Credit {
  borrower: string;
  programId: number;
  durationInPeriods: number;
  status: CreditRequestStatus;
  loanAmount: bigint;
  loanAddon: bigint;
  loanId: bigint;
}

interface InstallmentCredit {
  borrower: string;
  programId: number;
  status: CreditRequestStatus;
  durationsInPeriods: number[];
  borrowAmounts: bigint[];
  addonAmounts: bigint[];
  penaltyInterestRates: number[];
  firstInstallmentId: bigint;
}

const initialCredit: Credit = {
  borrower: ADDRESS_ZERO,
  programId: 0,
  durationInPeriods: 0,
  status: CreditRequestStatus.Nonexistent,
  loanAmount: 0n,
  loanAddon: 0n,
  loanId: 0n,
};

const initialInstallmentCredit: InstallmentCredit = {
  borrower: ADDRESS_ZERO,
  programId: 0,
  status: CreditRequestStatus.Nonexistent,
  durationsInPeriods: [],
  borrowAmounts: [],
  addonAmounts: [],
  penaltyInterestRates: [],
  firstInstallmentId: 0n,
};

describe("Contract 'CreditAgentCapybaraV1'", () => {
  const TX_ID_STUB = ethers.encodeBytes32String("STUB_TRANSACTION_ID_ORDINARY");
  const TX_ID_STUB_INSTALLMENT = ethers.encodeBytes32String("STUB_TRANSACTION_ID_INSTALLMENT");
  const TX_ID_ZERO = ethers.ZeroHash;
  const LOAN_PROGRAM_ID_STUB = 0xFFFF_ABCD;
  const LOAN_DURATION_IN_SECONDS_STUB = 0xFFFF_DCBA;
  const LOAN_AMOUNT_STUB = BigInt("0xFFFFFFFFFFFF1234");
  const LOAN_ADDON_STUB = BigInt("0xFFFFFFFFFFFF4321");
  const OVERFLOW_UINT32 = 2 ** 32;
  const OVERFLOW_UINT64 = 2n ** 64n;
  const NEEDED_CASHIER_CASH_OUT_HOOK_FLAGS =
    (1 << HookIndex.CashOutRequestBefore) +
    (1 << HookIndex.CashOutConfirmationAfter) +
    (1 << HookIndex.CashOutReversalAfter);

  // Events of the contracts under test
  const EVENT_NAME_CREDIT_REQUEST_STATUS_CHANGED = "CreditRequestStatusChanged";
  const EVENT_NAME_MOCK_CONFIGURE_CASH_OUT_HOOKS_CALLED = "MockConfigureCashOutHooksCalled";
  const EVENT_NAME_MOCK_REVOKE_INSTALLMENT_LOAN_CALLED = "MockRevokeInstallmentLoanCalled";
  const EVENT_NAME_MOCK_REVOKE_LOAN_CALLED = "MockRevokeLoanCalled";
  const EVENT_NAME_MOCK_TAKE_INSTALLMENT_LOAN_CALLED = "MockTakeInstallmentLoanCalled";
  const EVENT_NAME_MOCK_TAKE_LOAN_FOR_CALLED = "MockTakeLoanForCalled";

  // Errors of the library contracts
  const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";
  const ERROR_NAME_ENFORCED_PAUSE = "EnforcedPause";

  // Errors of the contracts under test
  const ERROR_NAME_ACCOUNT_ADDRESS_ZERO = "CreditAgent_AccountAddressZero";
  const ERROR_NAME_CASH_OUT_PARAMETERS_INAPPROPRIATE = "CreditAgent_CashOutParametersInappropriate";
  const ERROR_NAME_CASHIER_HOOK_CALLER_UNAUTHORIZED = "CreditAgent_CashierHookCallerUnauthorized";
  const ERROR_NAME_CASHIER_HOOK_INDEX_UNEXPECTED = "CreditAgent_CashierHookIndexUnexpected";
  const ERROR_NAME_CONFIGURING_PROHIBITED = "CreditAgent_ConfiguringProhibited";
  const ERROR_NAME_CONTRACT_NOT_CONFIGURED = "CreditAgent_ContractNotConfigured";
  const ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE = "CreditAgent_CreditRequestStatusInappropriate";
  const ERROR_NAME_INPUT_ARRAYS_INVALID = "CreditAgentCapybaraV1_InputArraysInvalid";
  const ERROR_NAME_LOAN_AMOUNT_ZERO = "CreditAgentCapybaraV1_LoanAmountZero";
  const ERROR_NAME_LOAN_DURATION_ZERO = "CreditAgentCapybaraV1_LoanDurationZero";
  const ERROR_NAME_PROGRAM_ID_ZERO = "CreditAgentCapybaraV1_ProgramIdZero";
  const ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST = "SafeCastOverflowedUintDowncast";
  const ERROR_NAME_TX_ID_ZERO = "CreditAgent_TxIdZero";
  const ERROR_NAME_LENDING_MARKET_INCOMPATIBLE = "CreditAgent_LendingMarketIncompatible";
  const ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID = "CreditAgentCapybaraV1_ImplementationAddressInvalid";

  let creditAgentCapybaraV1Factory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let manager: HardhatEthersSigner;
  let borrower: HardhatEthersSigner;

  const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
  const PAUSER_ROLE: string = ethers.id("PAUSER_ROLE");
  const ADMIN_ROLE: string = ethers.id("ADMIN_ROLE");
  const MANAGER_ROLE: string = ethers.id("MANAGER_ROLE");

  before(async () => {
    [deployer, admin, manager, borrower] = await ethers.getSigners();

    creditAgentCapybaraV1Factory = await ethers.getContractFactory("CreditAgentCapybaraV1");
    // Explicitly specifying the initial account
    creditAgentCapybaraV1Factory = creditAgentCapybaraV1Factory.connect(deployer);
  });

  async function deployCreditAgent(): Promise<Contract> {
    const creditAgent = await upgrades.deployProxy(creditAgentCapybaraV1Factory) as Contract;
    await creditAgent.waitForDeployment();

    return connect(creditAgent, deployer); // Explicitly specifying the initial account
  }

  async function deployAndConfigureCreditAgent(): Promise<Contract> {
    const creditAgent = await deployCreditAgent();
    await proveTx(creditAgent.grantRole(GRANTOR_ROLE, deployer.address));
    await proveTx(creditAgent.grantRole(ADMIN_ROLE, admin.address));
    await proveTx(creditAgent.grantRole(MANAGER_ROLE, manager.address));
    await proveTx(creditAgent.grantRole(PAUSER_ROLE, deployer.address));

    return creditAgent;
  }

  async function deployAndConfigureContracts(): Promise<Fixture> {
    return deployAndConfigureCoreContracts(deployAndConfigureCreditAgent);
  }

  async function deployAndConfigureContractsThenInitiateOrdinaryCredit(): Promise<{
    fixture: Fixture;
    txId: string;
    initCredit: Credit;
    initCashOut: CashOut;
    initCreditTxTimestamp: number;
  }> {
    const fixture = await deployAndConfigureContracts();
    const { creditAgent, cashierMock } = fixture;
    const initCredit = defineCredit();
    const txId = TX_ID_STUB;
    const initCashOut: CashOut = {
      ...initialCashOut,
      account: borrower.address,
      amount: initCredit.loanAmount,
    };

    const initiateCreditTx = await proveTx(initiateOrdinaryCredit(creditAgent, { txId }));
    const initCreditTxTimestamp = await getBlockTimestamp(initiateCreditTx);
    await proveTx(cashierMock.setCashOut(txId, initCashOut));

    return { fixture, txId, initCredit, initCashOut, initCreditTxTimestamp };
  }

  function defineCredit(props: Partial<Credit> = {}): Credit {
    return {
      ...initialCredit,
      borrower: props.borrower ?? borrower.address,
      programId: props.programId ?? LOAN_PROGRAM_ID_STUB,
      durationInPeriods: props.durationInPeriods ?? LOAN_DURATION_IN_SECONDS_STUB,
      status: props.status ?? CreditRequestStatus.Nonexistent,
      loanAmount: props.loanAmount ?? LOAN_AMOUNT_STUB,
      loanAddon: props.loanAddon ?? LOAN_ADDON_STUB,
      loanId: props.loanId ?? 0n,
    };
  }

  function initiateOrdinaryCredit(creditAgent: Contract, props: {
    txId?: string;
    credit?: Credit;
    caller?: HardhatEthersSigner;
  } = {}): Promise<TransactionResponse> {
    const caller = props.caller ?? manager;
    const txId = props.txId ?? TX_ID_STUB;
    const credit = props.credit ?? defineCredit();
    return connect(creditAgent, caller).initiateOrdinaryCredit(
      txId,
      credit.borrower,
      credit.programId,
      credit.durationInPeriods,
      credit.loanAmount,
      credit.loanAddon,
    );
  }

  async function checkCreditInitiation(fixture: Fixture, props: {
    tx: Promise<TransactionResponse>;
    txId: string;
    credit: Credit;
    fromReversed?: boolean;
  }) {
    const { creditAgent, cashierMock } = fixture;
    const { tx, txId, credit } = props;

    await expect(tx).to.emit(creditAgent, EVENT_NAME_CREDIT_REQUEST_STATUS_CHANGED).withArgs(
      txId,
      credit.borrower,
      0n,
      CreditRequestStatus.Initiated, // newStatus
      props.fromReversed ? CreditRequestStatus.Reversed : CreditRequestStatus.Nonexistent, // oldStatus
      credit.loanAmount,
    );
    await expect(tx).to.emit(cashierMock, EVENT_NAME_MOCK_CONFIGURE_CASH_OUT_HOOKS_CALLED).withArgs(
      txId,
      getAddress(creditAgent), // newCallableContract
      NEEDED_CASHIER_CASH_OUT_HOOK_FLAGS, // newHookFlags
    );
    credit.status = CreditRequestStatus.Initiated;
    checkEquality(await creditAgent.getOrdinaryCredit(txId) as Credit, credit);
  }

  async function deployAndConfigureContractsThenInitiateInstallmentCredit(): Promise<{
    fixture: Fixture;
    txId: string;
    initCredit: InstallmentCredit;
    initCashOut: CashOut;
    initCreditTxTimestamp: number;
  }> {
    const fixture = await deployAndConfigureContracts();
    const { creditAgent, cashierMock } = fixture;
    const txId = TX_ID_STUB_INSTALLMENT;
    const initCredit = defineInstallmentCredit();
    const initCashOut: CashOut = {
      ...initialCashOut,
      account: borrower.address,
      amount: initCredit.borrowAmounts.reduce((acc, val) => acc + val, 0n),
    };

    const initiateInstallmentCreditTx =
      await proveTx(initiateInstallmentCredit(creditAgent, { txId, credit: initCredit }));
    const initCreditTxTimestamp = await getBlockTimestamp(initiateInstallmentCreditTx);
    await proveTx(cashierMock.setCashOut(txId, initCashOut));

    return { fixture, txId, initCredit, initCashOut, initCreditTxTimestamp };
  }

  function defineInstallmentCredit(props: Partial<InstallmentCredit> = {}): InstallmentCredit {
    return {
      ...initialInstallmentCredit,
      borrower: props.borrower ?? borrower.address,
      programId: props.programId ?? LOAN_PROGRAM_ID_STUB,
      status: props.status ?? CreditRequestStatus.Nonexistent,
      durationsInPeriods: props.durationsInPeriods ?? [10, 20],
      borrowAmounts: props.borrowAmounts ?? [BigInt(1000), BigInt(2000)],
      addonAmounts: props.addonAmounts ?? [BigInt(100), BigInt(200)],
      penaltyInterestRates: props.penaltyInterestRates ?? [0, 0],
      firstInstallmentId: props.firstInstallmentId ?? 0n,
    };
  }

  function initiateInstallmentCredit(
    creditAgent: Contract,
    props: {
      txId?: string;
      credit?: InstallmentCredit;
      caller?: HardhatEthersSigner;
    } = {},
  ): Promise<TransactionResponse> {
    const caller = props.caller ?? manager;
    const txId = props.txId ?? TX_ID_STUB_INSTALLMENT;
    const credit = props.credit ?? defineInstallmentCredit();
    return connect(creditAgent, caller).initiateInstallmentCredit(
      txId,
      credit.borrower,
      credit.programId,
      credit.durationsInPeriods,
      credit.borrowAmounts,
      credit.addonAmounts,
      credit.penaltyInterestRates,
    );
  }

  async function checkInstallmentCreditInitiation(fixture: Fixture, props: {
    tx: Promise<TransactionResponse>;
    txId: string;
    credit: InstallmentCredit;
    fromReversed?: boolean;
  }) {
    const { creditAgent, cashierMock } = fixture;
    const { tx, txId, credit } = props;
    await expect(tx).to.emit(creditAgent, EVENT_NAME_CREDIT_REQUEST_STATUS_CHANGED).withArgs(
      txId,
      credit.borrower,
      0n,
      CreditRequestStatus.Initiated, // newStatus
      props.fromReversed ? CreditRequestStatus.Reversed : CreditRequestStatus.Nonexistent, // oldStatus
      _sumArray(credit.borrowAmounts),
    );
    await expect(tx).to.emit(cashierMock, EVENT_NAME_MOCK_CONFIGURE_CASH_OUT_HOOKS_CALLED).withArgs(
      txId,
      getAddress(creditAgent), // newCallableContract
      NEEDED_CASHIER_CASH_OUT_HOOK_FLAGS, // newHookFlags
    );
    credit.status = CreditRequestStatus.Initiated;
    checkEquality(await creditAgent.getInstallmentCredit(txId) as InstallmentCredit, credit);
  }

  function _sumArray(array: bigint[]): bigint {
    return array.reduce((acc, val) => acc + val, 0n);
  }

  describe("Function 'upgradeToAndCall()'", () => {
    it("Executes as expected", async () => {
      const creditAgent = await setUpFixture(deployCreditAgent);
      await checkContractUupsUpgrading(creditAgent, creditAgentCapybaraV1Factory);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const creditAgent = await setUpFixture(deployCreditAgent);

      await expect(connect(creditAgent, admin).upgradeToAndCall(creditAgent, "0x"))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT);
    });
  });

  describe("Function 'upgradeTo()'", () => {
    it("Executes as expected", async () => {
      const creditAgent = await setUpFixture(deployCreditAgent);
      await checkContractUupsUpgrading(creditAgent, creditAgentCapybaraV1Factory, "upgradeTo(address)");
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const creditAgent = await setUpFixture(deployCreditAgent);

      await expect(connect(creditAgent, admin).upgradeTo(creditAgent))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT);
    });

    it("Is reverted if the provided implementation address is not a credit agent contract", async () => {
      const { creditAgent, cashierMock } = await setUpFixture(deployAndConfigureContracts);

      await expect(creditAgent.upgradeTo(cashierMock))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID);
    });
  });

  describe("Function '_validateLendingMarket()'", () => {
    it("Returns false for a non-compatible lending market contract and fails `proveLendingMarket()` call", async () => {
      const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
      const anotherCreditAgent = await deployCreditAgent();

      await expect(connect(creditAgent, admin).setLendingMarket(anotherCreditAgent))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_LENDING_MARKET_INCOMPATIBLE);
    });
  });

  describe("Function 'initiateOrdinaryCredit()'", () => {
    describe("Executes as expected if", () => {
      it("The 'loanAddon' value is not zero", async () => {
        const fixture = await setUpFixture(deployAndConfigureContracts);
        const credit = defineCredit({ loanAddon: LOAN_ADDON_STUB });
        const txId = TX_ID_STUB;
        const tx = initiateOrdinaryCredit(fixture.creditAgent, { txId, credit });
        await checkCreditInitiation(fixture, { tx, txId, credit });
      });

      it("The 'loanAddon' value is zero", async () => {
        const fixture = await setUpFixture(deployAndConfigureContracts);
        const credit = defineCredit({ loanAddon: 0n });
        const txId = TX_ID_STUB;
        const tx = initiateOrdinaryCredit(fixture.creditAgent, { txId, credit });
        await checkCreditInitiation(fixture, { tx, txId, credit });
      });
    });

    it("Makes a credit request expired after 5 minutes", async () => {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const credit = defineCredit({ loanAddon: LOAN_ADDON_STUB });
      const txId = TX_ID_STUB;
      const tx = await initiateOrdinaryCredit(fixture.creditAgent, { txId, credit });
      const txTimestamp = await getBlockTimestamp(tx);
      let creditRequest = await fixture.creditAgent.getOrdinaryCredit(txId);
      expect(creditRequest.status).to.equal(CreditRequestStatus.Initiated);
      expect(creditRequest.deadline).to.be.closeTo(txTimestamp + EXPIRATION_TIME_SECONDS, 10);
      await time.increaseTo(creditRequest.deadline + 1n);
      creditRequest = await fixture.creditAgent.getOrdinaryCredit(txId);
      expect(creditRequest.status).to.equal(CreditRequestStatus.Expired);
    });

    describe("Is reverted if", () => {
      it("The contract is paused", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        await proveTx(creditAgent.pause());

        await expect(initiateOrdinaryCredit(creditAgent))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ENFORCED_PAUSE);
      });

      it("The caller does not have the manager role", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);

        await expect(initiateOrdinaryCredit(creditAgent, { caller: deployer }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(deployer.address, MANAGER_ROLE);
      });

      it("The 'Cashier' contract address is not configured", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        await proveTx(creditAgent.setCashier(ADDRESS_ZERO));

        await expect(initiateOrdinaryCredit(creditAgent))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CONTRACT_NOT_CONFIGURED);
      });

      it("The 'LendingMarket' contract address is not configured", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        await proveTx(creditAgent.setLendingMarket(ADDRESS_ZERO));

        await expect(initiateOrdinaryCredit(creditAgent))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CONTRACT_NOT_CONFIGURED);
      });

      it("The provided 'txId' value is zero", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineCredit({});

        await expect(initiateOrdinaryCredit(creditAgent, { txId: TX_ID_ZERO, credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_TX_ID_ZERO);
      });

      it("The provided borrower address is zero", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineCredit({ borrower: ADDRESS_ZERO });

        await expect(initiateOrdinaryCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ACCOUNT_ADDRESS_ZERO);
      });

      it("The provided program ID is zero", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineCredit({ programId: 0 });

        await expect(initiateOrdinaryCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_PROGRAM_ID_ZERO);
      });

      it("The provided loan duration is zero", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineCredit({ durationInPeriods: 0 });

        await expect(initiateOrdinaryCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_LOAN_DURATION_ZERO);
      });

      it("The provided loan amount is zero", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineCredit({ loanAmount: 0n });

        await expect(initiateOrdinaryCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_LOAN_AMOUNT_ZERO);
      });

      it("A credit is already initiated for the provided transaction ID", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineCredit();
        const txId = TX_ID_STUB;
        await proveTx(initiateOrdinaryCredit(creditAgent, { txId, credit }));

        await expect(initiateOrdinaryCredit(creditAgent, { txId, credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
          .withArgs(txId, CreditRequestStatus.Initiated);
      });

      it("The 'programId' argument is greater than unsigned 32-bit integer", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineCredit({ programId: OVERFLOW_UINT32 });
        await expect(initiateOrdinaryCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
          .withArgs(32, credit.programId);
      });

      it("The 'durationInPeriods' argument is greater than unsigned 32-bit integer", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineCredit({ durationInPeriods: OVERFLOW_UINT32 });
        await expect(initiateOrdinaryCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
          .withArgs(32, credit.durationInPeriods);
      });

      it("The 'loanAmount' argument is greater than unsigned 64-bit integer", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineCredit({ loanAmount: OVERFLOW_UINT64 });
        await expect(initiateOrdinaryCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
          .withArgs(64, credit.loanAmount);
      });

      it("The 'loanAddon' argument is greater than unsigned 64-bit integer", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineCredit({ loanAddon: OVERFLOW_UINT64 });
        await expect(initiateOrdinaryCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
          .withArgs(64, credit.loanAddon);
      });

      // Additional more complex checks are in the other sections
    });
  });

  describe("Function 'revokeOrdinaryCredit()'", () => {
    it("Executes as expected", async () => {
      const { creditAgent, cashierMock } = await setUpFixture(deployAndConfigureContracts);
      const credit = defineCredit();
      const txId = TX_ID_STUB;
      await proveTx(initiateOrdinaryCredit(creditAgent, { txId }));

      const tx = connect(creditAgent, manager).revokeOrdinaryCredit(txId);
      await expect(tx).to.emit(creditAgent, EVENT_NAME_CREDIT_REQUEST_STATUS_CHANGED).withArgs(
        txId,
        credit.borrower,
        0n,
        CreditRequestStatus.Nonexistent, // newStatus
        CreditRequestStatus.Initiated, // oldStatus
        credit.loanAmount,
      );
      await expect(tx).to.emit(cashierMock, EVENT_NAME_MOCK_CONFIGURE_CASH_OUT_HOOKS_CALLED).withArgs(
        txId,
        ADDRESS_ZERO, // newCallableContract,
        0, // newHookFlags
      );
      checkEquality(await creditAgent.getOrdinaryCredit(txId) as Credit, initialCredit);
    });

    it("Executes as expected if the credit request is expired", async () => {
      const { creditAgent, cashierMock } = await setUpFixture(deployAndConfigureContracts);
      const credit = defineCredit();
      const txId = TX_ID_STUB;
      const initiateCreditTx = await proveTx(initiateOrdinaryCredit(creditAgent, { txId }));
      const initCreditTxTimestamp = await getBlockTimestamp(initiateCreditTx);

      await time.increaseTo(initCreditTxTimestamp + EXPIRATION_TIME_SECONDS * 2);
      const creditRequest = await creditAgent.getOrdinaryCredit(txId);
      // check that the credit is expired
      expect(creditRequest.status).to.equal(CreditRequestStatus.Expired);

      const tx = connect(creditAgent, manager).revokeOrdinaryCredit(txId);
      await expect(tx).to.emit(creditAgent, EVENT_NAME_CREDIT_REQUEST_STATUS_CHANGED).withArgs(
        txId,
        credit.borrower,
        0n,
        CreditRequestStatus.Nonexistent, // newStatus
        CreditRequestStatus.Expired, // oldStatus
        credit.loanAmount,
      );
      await expect(tx).to.emit(cashierMock, EVENT_NAME_MOCK_CONFIGURE_CASH_OUT_HOOKS_CALLED).withArgs(
        txId,
        ADDRESS_ZERO, // newCallableContract,
        0, // newHookFlags
      );
      checkEquality(await creditAgent.getOrdinaryCredit(txId) as Credit, initialCredit);
    });

    it("Is reverted if the contract is paused", async () => {
      const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(creditAgent.pause());

      await expect(connect(creditAgent, manager).revokeOrdinaryCredit(TX_ID_STUB))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ENFORCED_PAUSE);
    });

    it("Is reverted if the caller does not have the manager role", async () => {
      const { creditAgent } = await setUpFixture(deployAndConfigureContracts);

      await expect(connect(creditAgent, deployer).revokeOrdinaryCredit(TX_ID_STUB))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(deployer.address, MANAGER_ROLE);
    });

    it("Is reverted if the provided 'txId' value is zero", async () => {
      const { creditAgent } = await setUpFixture(deployAndConfigureContracts);

      await expect(connect(creditAgent, manager).revokeOrdinaryCredit(TX_ID_ZERO))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_TX_ID_ZERO);
    });

    it("Is reverted if the credit does not exist", async () => {
      const { creditAgent } = await setUpFixture(deployAndConfigureContracts);

      await expect(connect(creditAgent, manager).revokeOrdinaryCredit(TX_ID_STUB))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
        .withArgs(TX_ID_STUB, CreditRequestStatus.Nonexistent);
    });

    // Additional more complex checks are in the other sections
  });

  describe("Function 'onCashierHook()' for an ordinary credit", () => {
    async function checkCashierHookCalling(fixture: Fixture, props: {
      txId: string;
      credit: Credit;
      hookIndex: HookIndex;
      newCreditStatus: CreditRequestStatus;
      oldCreditStatus: CreditRequestStatus;
    }) {
      const { creditAgent, cashierMock, lendingMarketMock } = fixture;
      const { credit, txId, hookIndex, newCreditStatus, oldCreditStatus } = props;

      const tx = cashierMock.callCashierHook(getAddress(creditAgent), hookIndex, txId);

      credit.status = newCreditStatus;

      if (oldCreditStatus !== newCreditStatus) {
        await expect(tx).to.emit(creditAgent, EVENT_NAME_CREDIT_REQUEST_STATUS_CHANGED).withArgs(
          txId,
          credit.borrower,
          credit.loanId,
          newCreditStatus,
          oldCreditStatus,
          credit.loanAmount,
        );
        if (newCreditStatus == CreditRequestStatus.Pending) {
          await expect(tx).to.emit(lendingMarketMock, EVENT_NAME_MOCK_TAKE_LOAN_FOR_CALLED).withArgs(
            credit.borrower,
            credit.programId,
            credit.loanAmount, // borrowAmount,
            credit.loanAddon, // addonAmount,
            credit.durationInPeriods,
          );
        } else {
          await expect(tx).not.to.emit(lendingMarketMock, EVENT_NAME_MOCK_TAKE_LOAN_FOR_CALLED);
        }

        if (newCreditStatus == CreditRequestStatus.Reversed) {
          await expect(tx).to.emit(lendingMarketMock, EVENT_NAME_MOCK_REVOKE_LOAN_CALLED).withArgs(credit.loanId);
        } else {
          await expect(tx).not.to.emit(lendingMarketMock, EVENT_NAME_MOCK_REVOKE_LOAN_CALLED);
        }
      } else {
        await expect(tx).not.to.emit(creditAgent, EVENT_NAME_CREDIT_REQUEST_STATUS_CHANGED);
      }

      checkEquality(await creditAgent.getOrdinaryCredit(txId) as Credit, credit);
    }

    describe("Executes as expected if", () => {
      it("A cash-out requested and then confirmed with other proper conditions", async () => {
        const { fixture, txId, initCredit } = await setUpFixture(deployAndConfigureContractsThenInitiateOrdinaryCredit);
        const expectedAgentState: AgentState = {
          ...initialAgentState,
          initiatedRequestCounter: 1n,
          configured: true,
        };
        checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);
        const credit: Credit = { ...initCredit, loanId: fixture.loanIdStub };

        // Emulate cash-out request
        await checkCashierHookCalling(
          fixture,
          {
            txId,
            credit,
            hookIndex: HookIndex.CashOutRequestBefore,
            newCreditStatus: CreditRequestStatus.Pending,
            oldCreditStatus: CreditRequestStatus.Initiated,
          },
        );
        expectedAgentState.initiatedRequestCounter = 0n;
        expectedAgentState.pendingRequestCounter = 1n;
        checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);

        // Emulate cash-out confirmation
        await checkCashierHookCalling(
          fixture,
          {
            txId,
            credit,
            hookIndex: HookIndex.CashOutConfirmationAfter,
            newCreditStatus: CreditRequestStatus.Confirmed,
            oldCreditStatus: CreditRequestStatus.Pending,
          },
        );
        expectedAgentState.pendingRequestCounter = 0n;
        checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);
      });

      it("A cash-out requested and then reversed with other proper conditions", async () => {
        const { fixture, txId, initCredit } = await setUpFixture(deployAndConfigureContractsThenInitiateOrdinaryCredit);
        const credit: Credit = { ...initCredit, loanId: fixture.loanIdStub };

        // Emulate cash-out request
        await checkCashierHookCalling(
          fixture,
          {
            txId,
            credit,
            hookIndex: HookIndex.CashOutRequestBefore,
            newCreditStatus: CreditRequestStatus.Pending,
            oldCreditStatus: CreditRequestStatus.Initiated,
          },
        );
        const expectedAgentState: AgentState = {
          ...initialAgentState,
          pendingRequestCounter: 1n,
          configured: true,
        };
        checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);

        // Emulate cash-out reversal
        await checkCashierHookCalling(
          fixture,
          {
            txId,
            credit,
            hookIndex: HookIndex.CashOutReversalAfter,
            newCreditStatus: CreditRequestStatus.Reversed,
            oldCreditStatus: CreditRequestStatus.Pending,
          },
        );
        expectedAgentState.pendingRequestCounter = 0n;
        checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);
      });
    });

    describe("Is reverted if", () => {
      async function checkCashierHookInappropriateStatusError(fixture: Fixture, props: {
        txId: string;
        hookIndex: HookIndex;
        creditStatus: CreditRequestStatus;
      }) {
        const { creditAgent, cashierMock } = fixture;
        const { txId, hookIndex, creditStatus } = props;
        await expect(cashierMock.callCashierHook(getAddress(creditAgent), hookIndex, TX_ID_STUB))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
          .withArgs(txId, creditStatus);
      }

      it("The contract is paused", async () => {
        const { fixture } = await setUpFixture(deployAndConfigureContractsThenInitiateOrdinaryCredit);
        const { creditAgent, cashierMock } = fixture;
        const hookIndex = HookIndex.CashOutRequestBefore;
        await proveTx(creditAgent.pause());

        await expect(cashierMock.callCashierHook(getAddress(creditAgent), hookIndex, TX_ID_STUB))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ENFORCED_PAUSE);
      });

      it("The caller is not the configured 'Cashier' contract", async () => {
        const { fixture } = await setUpFixture(deployAndConfigureContractsThenInitiateOrdinaryCredit);
        const { creditAgent } = fixture;
        const hookIndex = HookIndex.CashOutRequestBefore;

        await expect(connect(creditAgent, deployer).onCashierHook(hookIndex, TX_ID_STUB))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CASHIER_HOOK_CALLER_UNAUTHORIZED);
      });

      it("The credit status is inappropriate to the provided hook index. Part 1", async () => {
        const { fixture, txId } = await setUpFixture(deployAndConfigureContractsThenInitiateOrdinaryCredit);
        const { creditAgent, cashierMock } = fixture;

        // Try for a credit with the initiated status
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutConfirmationAfter,
          creditStatus: CreditRequestStatus.Initiated,
        });
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutReversalAfter,
          creditStatus: CreditRequestStatus.Initiated,
        });

        // Try for a credit with the pending status
        await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutRequestBefore,
          creditStatus: CreditRequestStatus.Pending,
        });

        // Try for a credit with the confirmed status
        await proveTx(
          cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutConfirmationAfter, txId),
        );
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutRequestBefore,
          creditStatus: CreditRequestStatus.Confirmed,
        });
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutConfirmationAfter,
          creditStatus: CreditRequestStatus.Confirmed,
        });
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutReversalAfter,
          creditStatus: CreditRequestStatus.Confirmed,
        });
      });

      it("The credit status is inappropriate to the provided hook index. Part 2", async () => {
        const { fixture, txId } = await setUpFixture(deployAndConfigureContractsThenInitiateOrdinaryCredit);
        const { creditAgent, cashierMock } = fixture;

        // Try for a credit with the reversed status
        await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));
        await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutReversalAfter, txId));
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutRequestBefore,
          creditStatus: CreditRequestStatus.Reversed,
        });
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutConfirmationAfter,
          creditStatus: CreditRequestStatus.Reversed,
        });
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutReversalAfter,
          creditStatus: CreditRequestStatus.Reversed,
        });
      });

      it("The credit status is inappropriate to the provided hook because it is expired", async () => {
        const { fixture, txId, initCreditTxTimestamp } =
          await setUpFixture(deployAndConfigureContractsThenInitiateOrdinaryCredit);
        await time.increaseTo(initCreditTxTimestamp + EXPIRATION_TIME_SECONDS + 1);
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutRequestBefore,
          creditStatus: CreditRequestStatus.Expired,
        });
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutConfirmationAfter,
          creditStatus: CreditRequestStatus.Expired,
        });
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutReversalAfter,
          creditStatus: CreditRequestStatus.Expired,
        });
      });

      it("The cash-out account is not match the credit borrower before taking a loan", async () => {
        const { fixture, txId, initCashOut } =
          await setUpFixture(deployAndConfigureContractsThenInitiateOrdinaryCredit);
        const { creditAgent, cashierMock } = fixture;
        const cashOut: CashOut = {
          ...initCashOut,
          account: deployer.address,
        };
        await proveTx(cashierMock.setCashOut(txId, cashOut));

        await expect(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CASH_OUT_PARAMETERS_INAPPROPRIATE)
          .withArgs(txId);
      });

      it("The cash-out amount is not match the credit amount before taking a loan", async () => {
        const { fixture, txId, initCashOut } =
          await setUpFixture(deployAndConfigureContractsThenInitiateOrdinaryCredit);
        const { creditAgent, cashierMock } = fixture;
        const cashOut: CashOut = {
          ...initCashOut,
          amount: initCashOut.amount + 1n,
        };
        await proveTx(cashierMock.setCashOut(txId, cashOut));

        await expect(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CASH_OUT_PARAMETERS_INAPPROPRIATE)
          .withArgs(txId);
      });

      it("The provided hook index is unexpected", async () => {
        const { fixture } = await setUpFixture(deployAndConfigureContractsThenInitiateOrdinaryCredit);
        const { creditAgent, cashierMock } = fixture;
        const hookIndex = HookIndex.Unused;

        await expect(cashierMock.callCashierHook(getAddress(creditAgent), hookIndex, TX_ID_STUB))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CASHIER_HOOK_INDEX_UNEXPECTED)
          .withArgs(hookIndex, TX_ID_STUB, getAddress(cashierMock));
      });
    });
  });

  describe("Complex scenarios", () => {
    it("A revoked credit can be re-initiated", async () => {
      const { fixture, txId, initCredit } = await setUpFixture(deployAndConfigureContractsThenInitiateOrdinaryCredit);
      const { creditAgent } = fixture;
      const expectedAgentState: AgentState = {
        ...initialAgentState,
        initiatedRequestCounter: 1n,
        configured: true,
      };
      const credit: Credit = { ...initCredit };
      checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);

      await proveTx(connect(creditAgent, manager).revokeOrdinaryCredit(txId));
      expectedAgentState.initiatedRequestCounter = 0n;
      checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);

      const tx = initiateOrdinaryCredit(creditAgent, { txId, credit });
      await checkCreditInitiation(fixture, { tx, txId, credit });
      expectedAgentState.initiatedRequestCounter = 1n;
      checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);
    });

    it("A reversed credit can be re-initiated", async () => {
      const { fixture, txId, initCredit } = await setUpFixture(deployAndConfigureContractsThenInitiateOrdinaryCredit);
      const { creditAgent, cashierMock } = fixture;
      const credit: Credit = { ...initCredit };

      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));
      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutReversalAfter, txId));

      const tx = initiateOrdinaryCredit(creditAgent, { txId, credit });
      await checkCreditInitiation(fixture, { tx, txId, credit, fromReversed: true });
      const expectedAgentState: AgentState = {
        ...initialAgentState,
        initiatedRequestCounter: 1n,
        pendingRequestCounter: 0n,
        configured: true,
      };
      checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);
    });

    it("A pending or confirmed credit cannot be re-initiated", async () => {
      const { fixture, txId, initCredit } = await setUpFixture(deployAndConfigureContractsThenInitiateOrdinaryCredit);
      const { creditAgent, cashierMock } = fixture;
      const credit: Credit = { ...initCredit };

      // Try for a credit with the pending status
      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));
      await expect(initiateOrdinaryCredit(creditAgent, { txId, credit }))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
        .withArgs(txId, CreditRequestStatus.Pending);

      // Try for a credit with the confirmed status
      await proveTx(
        cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutConfirmationAfter, txId),
      );
      await expect(initiateOrdinaryCredit(creditAgent, { txId, credit }))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
        .withArgs(txId, CreditRequestStatus.Confirmed);
    });

    it("A credit with any status except initiated cannot be revoked", async () => {
      const { fixture, txId, initCredit } = await setUpFixture(deployAndConfigureContractsThenInitiateOrdinaryCredit);
      const { creditAgent, cashierMock } = fixture;
      const credit: Credit = { ...initCredit };

      // Try for a credit with the pending status
      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));
      await expect(connect(creditAgent, manager).revokeOrdinaryCredit(txId))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
        .withArgs(txId, CreditRequestStatus.Pending);

      // Try for a credit with the reversed status
      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutReversalAfter, txId));
      await expect(connect(creditAgent, manager).revokeOrdinaryCredit(txId))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
        .withArgs(txId, CreditRequestStatus.Reversed);

      // Try for a credit with the confirmed status
      await proveTx(initiateOrdinaryCredit(creditAgent, { txId, credit }));
      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));
      await proveTx(
        cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutConfirmationAfter, txId),
      );
      await expect(connect(creditAgent, manager).revokeOrdinaryCredit(txId))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
        .withArgs(txId, CreditRequestStatus.Confirmed);
    });

    it("Configuring is prohibited when not all credits are processed", async () => {
      const { fixture, txId, initCredit } = await setUpFixture(deployAndConfigureContractsThenInitiateOrdinaryCredit);
      const { creditAgent, cashierMock, lendingMarketMock } = fixture;
      const credit: Credit = { ...initCredit };

      async function checkConfiguringProhibition() {
        await expect(connect(creditAgent, admin).setCashier(ADDRESS_ZERO))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CONFIGURING_PROHIBITED);
        await expect(connect(creditAgent, admin).setLendingMarket(ADDRESS_ZERO))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CONFIGURING_PROHIBITED);
      }

      async function checkConfiguringAllowance() {
        await proveTx(connect(creditAgent, admin).setCashier(ADDRESS_ZERO));
        await proveTx(connect(creditAgent, admin).setLendingMarket(ADDRESS_ZERO));
        await proveTx(connect(creditAgent, admin).setCashier(getAddress(cashierMock)));
        await proveTx(connect(creditAgent, admin).setLendingMarket(getAddress(lendingMarketMock)));
      }

      // Configuring is prohibited if a credit is initiated
      await checkConfiguringProhibition();

      // Configuring is allowed when no credit is initiated
      await proveTx(connect(creditAgent, manager).revokeOrdinaryCredit(txId));
      await checkConfiguringAllowance();

      // Configuring is prohibited if a credit is pending
      await proveTx(initiateOrdinaryCredit(creditAgent, { txId, credit }));
      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));
      await checkConfiguringProhibition();

      // Configuring is allowed if a credit is reversed and no more active credits exist
      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutReversalAfter, txId));
      await checkConfiguringAllowance();

      // Configuring is prohibited if a credit is initiated
      await proveTx(initiateOrdinaryCredit(creditAgent, { txId, credit }));
      await checkConfiguringProhibition();

      // Configuring is allowed if credits are reversed or confirmed and no more active credits exist
      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));
      await proveTx(
        cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutConfirmationAfter, txId),
      );
      await checkConfiguringAllowance();
    });
  });

  describe("Function 'initiateInstallmentCredit()'", () => {
    describe("Executes as expected if", () => {
      it("The 'addonAmounts' values are not zero", async () => {
        const fixture = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({ addonAmounts: [LOAN_ADDON_STUB, LOAN_ADDON_STUB / 2n] });
        const txId = TX_ID_STUB_INSTALLMENT;
        const tx = initiateInstallmentCredit(fixture.creditAgent, { txId, credit });
        await checkInstallmentCreditInitiation(fixture, { tx, txId, credit });
      });
      it("One of the 'addonAmounts' values is zero", async () => {
        const fixture = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({ addonAmounts: [LOAN_ADDON_STUB, 0n] });
        const txId = TX_ID_STUB_INSTALLMENT;
        const tx = initiateInstallmentCredit(fixture.creditAgent, { txId, credit });
        await checkInstallmentCreditInitiation(fixture, { tx, txId, credit });
      });
    });

    it("Makes a credit request expired after 5 minutes", async () => {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const credit = defineInstallmentCredit({ addonAmounts: [LOAN_ADDON_STUB, LOAN_ADDON_STUB / 2n] });
      const txId = TX_ID_STUB_INSTALLMENT;
      const tx = await initiateInstallmentCredit(fixture.creditAgent, { txId, credit });
      const txTimestamp = await getBlockTimestamp(tx);
      let creditRequest = await fixture.creditAgent.getInstallmentCredit(txId);
      expect(creditRequest.status).to.equal(CreditRequestStatus.Initiated);
      expect(creditRequest.deadline).to.be.closeTo(txTimestamp + EXPIRATION_TIME_SECONDS, 10);
      await time.increaseTo(creditRequest.deadline + 1n);
      creditRequest = await fixture.creditAgent.getInstallmentCredit(txId);
      expect(creditRequest.status).to.equal(CreditRequestStatus.Expired);
    });

    describe("Is reverted if", () => {
      it("The contract is paused", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        await proveTx(creditAgent.pause());

        await expect(initiateInstallmentCredit(creditAgent))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ENFORCED_PAUSE);
      });

      it("The caller does not have the manager role", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);

        await expect(initiateInstallmentCredit(creditAgent, { caller: deployer }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(deployer.address, MANAGER_ROLE);
      });

      it("The 'Cashier' contract address is not configured", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        await proveTx(creditAgent.setCashier(ADDRESS_ZERO));

        await expect(initiateInstallmentCredit(creditAgent))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CONTRACT_NOT_CONFIGURED);
      });

      it("The 'LendingMarket' contract address is not configured", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        await proveTx(creditAgent.setLendingMarket(ADDRESS_ZERO));

        await expect(initiateInstallmentCredit(creditAgent))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CONTRACT_NOT_CONFIGURED);
      });

      it("The provided 'txId' value is zero", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({});

        await expect(initiateInstallmentCredit(creditAgent, { txId: TX_ID_ZERO, credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_TX_ID_ZERO);
      });

      it("The provided borrower address is zero", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({ borrower: ADDRESS_ZERO });

        await expect(initiateInstallmentCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ACCOUNT_ADDRESS_ZERO);
      });

      it("The provided program ID is zero", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({ programId: 0 });

        await expect(initiateInstallmentCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_PROGRAM_ID_ZERO);
      });

      it("The 'durationsInPeriods' array contains a zero value", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({ durationsInPeriods: [20, 0] });

        await expect(initiateInstallmentCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_LOAN_DURATION_ZERO);
      });

      it("The 'borrowAmounts' array contains a zero value", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({ borrowAmounts: [100n, 0n] });

        await expect(initiateInstallmentCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_LOAN_AMOUNT_ZERO);
      });

      it("A credit is already initiated for the provided transaction ID", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit();
        const txId = TX_ID_STUB_INSTALLMENT;
        await proveTx(initiateInstallmentCredit(creditAgent, { txId, credit }));

        await expect(initiateInstallmentCredit(creditAgent, { txId, credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
          .withArgs(txId, CreditRequestStatus.Initiated);
      });

      it("The 'programId' argument is greater than unsigned 32-bit integer", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({ programId: OVERFLOW_UINT32 });
        await expect(initiateInstallmentCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
          .withArgs(32, credit.programId);
      });

      it("The 'durationsInPeriods' array contains a value greater than unsigned 32-bit integer", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({ durationsInPeriods: [OVERFLOW_UINT32, 20] });
        await expect(initiateInstallmentCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
          .withArgs(32, credit.durationsInPeriods[0]);
      });

      it("The 'borrowAmounts' array contains a value greater than unsigned 64-bit integer", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({ borrowAmounts: [100n, OVERFLOW_UINT64] });
        await expect(initiateInstallmentCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
          .withArgs(64, credit.borrowAmounts[1]);
      });

      it("The 'addonAmounts' array contains a value greater than unsigned 64-bit integer", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({ addonAmounts: [100n, OVERFLOW_UINT64] });
        await expect(initiateInstallmentCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
          .withArgs(64, credit.addonAmounts[1]);
      });

      it("The 'penaltyInterestRates' array contains a value greater than unsigned 32-bit integer", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({ penaltyInterestRates: [OVERFLOW_UINT32, 0] });
        await expect(initiateInstallmentCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST)
          .withArgs(32, credit.penaltyInterestRates[0]);
      });

      it("The 'durationsInPeriods' array is empty", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({
          durationsInPeriods: [],
          borrowAmounts: [1000n, 2000n],
          addonAmounts: [100n, 200n],
        });
        await expect(initiateInstallmentCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_INPUT_ARRAYS_INVALID);
      });

      it("The 'durationsInPeriods' array has different length than other arrays", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({
          durationsInPeriods: [10],
          borrowAmounts: [1000n, 2000n],
          addonAmounts: [100n, 200n],
        });
        await expect(initiateInstallmentCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_INPUT_ARRAYS_INVALID);
      });

      it("The 'borrowAmounts' array has different length than other arrays", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({
          durationsInPeriods: [10, 20],
          borrowAmounts: [1000n],
          addonAmounts: [100n, 200n],
        });
        await expect(initiateInstallmentCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_INPUT_ARRAYS_INVALID);
      });

      it("The 'addonAmounts' array has different length than other arrays", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({
          durationsInPeriods: [10, 20],
          borrowAmounts: [1000n, 2000n],
          addonAmounts: [100n],
        });
        await expect(initiateInstallmentCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_INPUT_ARRAYS_INVALID);
      });

      it("The 'penaltyInterestRates' array has different length than other arrays", async () => {
        const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
        const credit = defineInstallmentCredit({
          durationsInPeriods: [10, 20],
          borrowAmounts: [1000n, 2000n],
          addonAmounts: [100n, 200n],
          penaltyInterestRates: [0],
        });
        await expect(initiateInstallmentCredit(creditAgent, { credit }))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_INPUT_ARRAYS_INVALID);
      });
    });
  });

  describe("Function 'revokeInstallmentCredit()", () => {
    it("Executes as expected", async () => {
      const { creditAgent, cashierMock } = await setUpFixture(deployAndConfigureContracts);
      const credit = defineInstallmentCredit();
      const txId = TX_ID_STUB_INSTALLMENT;
      await proveTx(initiateInstallmentCredit(creditAgent, { txId, credit }));

      const tx = connect(creditAgent, manager).revokeInstallmentCredit(txId);
      await expect(tx).to.emit(creditAgent, EVENT_NAME_CREDIT_REQUEST_STATUS_CHANGED).withArgs(
        txId,
        credit.borrower,
        credit.firstInstallmentId,
        CreditRequestStatus.Nonexistent, // newStatus
        CreditRequestStatus.Initiated, // oldStatus
        _sumArray(credit.borrowAmounts),
      );
      await expect(tx).to.emit(cashierMock, EVENT_NAME_MOCK_CONFIGURE_CASH_OUT_HOOKS_CALLED).withArgs(
        txId,
        ADDRESS_ZERO, // newCallableContract,
        0, // newHookFlags
      );
      checkEquality(await creditAgent.getInstallmentCredit(txId) as InstallmentCredit, initialInstallmentCredit);
    });

    it("Executes as expected if the credit request is expired", async () => {
      const { creditAgent, cashierMock } = await setUpFixture(deployAndConfigureContracts);
      const credit = defineInstallmentCredit();
      const txId = TX_ID_STUB_INSTALLMENT;
      const initiateInstallmentCreditTx = await proveTx(initiateInstallmentCredit(creditAgent, { txId, credit }));
      const initCreditTxTimestamp = await getBlockTimestamp(initiateInstallmentCreditTx);
      await time.increaseTo(initCreditTxTimestamp + EXPIRATION_TIME_SECONDS * 2);
      const creditRequest = await creditAgent.getInstallmentCredit(txId);
      // check that the credit is expired
      expect(creditRequest.status).to.equal(CreditRequestStatus.Expired);

      const tx = connect(creditAgent, manager).revokeInstallmentCredit(txId);
      await expect(tx).to.emit(creditAgent, EVENT_NAME_CREDIT_REQUEST_STATUS_CHANGED).withArgs(
        txId,
        credit.borrower,
        credit.firstInstallmentId,
        CreditRequestStatus.Nonexistent, // newStatus
        CreditRequestStatus.Expired, // oldStatus
        _sumArray(credit.borrowAmounts),
      );
      await expect(tx).to.emit(cashierMock, EVENT_NAME_MOCK_CONFIGURE_CASH_OUT_HOOKS_CALLED).withArgs(
        txId,
        ADDRESS_ZERO, // newCallableContract,
        0, // newHookFlags
      );
      checkEquality(await creditAgent.getInstallmentCredit(txId) as InstallmentCredit, initialInstallmentCredit);
    });

    it("Is reverted if the contract is paused", async () => {
      const { creditAgent } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(creditAgent.pause());

      await expect(connect(creditAgent, manager).revokeInstallmentCredit(TX_ID_STUB_INSTALLMENT))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ENFORCED_PAUSE);
    });

    it("Is reverted if the caller does not have the manager role", async () => {
      const { creditAgent } = await setUpFixture(deployAndConfigureContracts);

      await expect(connect(creditAgent, deployer).revokeInstallmentCredit(TX_ID_STUB_INSTALLMENT))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(deployer.address, MANAGER_ROLE);
    });

    it("Is reverted if the provided 'txId' value is zero", async () => {
      const { creditAgent } = await setUpFixture(deployAndConfigureContracts);

      await expect(connect(creditAgent, manager).revokeInstallmentCredit(TX_ID_ZERO))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_TX_ID_ZERO);
    });

    it("Is reverted if the credit does not exist", async () => {
      const { creditAgent } = await setUpFixture(deployAndConfigureContracts);

      await expect(connect(creditAgent, manager).revokeInstallmentCredit(TX_ID_STUB_INSTALLMENT))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
        .withArgs(TX_ID_STUB_INSTALLMENT, CreditRequestStatus.Nonexistent);
    });

    // Additional more complex checks are in the other sections
  });

  describe("Function 'onCashierHook()' for an installment credit", () => {
    async function checkCashierHookCalling(fixture: Fixture, props: {
      txId: string;
      credit: InstallmentCredit;
      hookIndex: HookIndex;
      newCreditStatus: CreditRequestStatus;
      oldCreditStatus: CreditRequestStatus;
    }) {
      const { creditAgent, cashierMock, lendingMarketMock } = fixture;
      const { credit, txId, hookIndex, newCreditStatus, oldCreditStatus } = props;

      const tx = cashierMock.callCashierHook(getAddress(creditAgent), hookIndex, txId);

      credit.status = newCreditStatus;

      if (oldCreditStatus !== newCreditStatus) {
        await expect(tx).to.emit(creditAgent, EVENT_NAME_CREDIT_REQUEST_STATUS_CHANGED).withArgs(
          txId,
          credit.borrower,
          credit.firstInstallmentId,
          newCreditStatus,
          oldCreditStatus,
          _sumArray(credit.borrowAmounts),
        );
        if (newCreditStatus == CreditRequestStatus.Pending) {
          await expect(tx).to.emit(lendingMarketMock, EVENT_NAME_MOCK_TAKE_INSTALLMENT_LOAN_CALLED).withArgs(
            credit.borrower,
            credit.programId,
            credit.borrowAmounts,
            credit.addonAmounts,
            credit.durationsInPeriods,
            credit.penaltyInterestRates,
          );
        } else {
          await expect(tx).not.to.emit(lendingMarketMock, EVENT_NAME_MOCK_TAKE_INSTALLMENT_LOAN_CALLED);
        }

        if (newCreditStatus == CreditRequestStatus.Reversed) {
          await expect(tx)
            .to.emit(lendingMarketMock, EVENT_NAME_MOCK_REVOKE_INSTALLMENT_LOAN_CALLED)
            .withArgs(credit.firstInstallmentId);
        } else {
          await expect(tx).not.to.emit(lendingMarketMock, EVENT_NAME_MOCK_REVOKE_INSTALLMENT_LOAN_CALLED);
        }
      } else {
        await expect(tx).not.to.emit(creditAgent, EVENT_NAME_CREDIT_REQUEST_STATUS_CHANGED);
      }

      checkEquality(await creditAgent.getInstallmentCredit(txId) as InstallmentCredit, credit);
    }

    describe("Executes as expected if", () => {
      it("A cash-out requested and then confirmed with other proper conditions", async () => {
        const {
          fixture,
          txId,
          initCredit,
        } = await setUpFixture(deployAndConfigureContractsThenInitiateInstallmentCredit);
        const expectedAgentState: AgentState = {
          ...initialAgentState,
          initiatedRequestCounter: 1n,
          configured: true,
        };
        checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);
        const credit: InstallmentCredit = { ...initCredit, firstInstallmentId: fixture.loanIdStub };

        // Emulate cash-out request
        await checkCashierHookCalling(
          fixture,
          {
            txId,
            credit,
            hookIndex: HookIndex.CashOutRequestBefore,
            newCreditStatus: CreditRequestStatus.Pending,
            oldCreditStatus: CreditRequestStatus.Initiated,
          },
        );
        expectedAgentState.initiatedRequestCounter = 0n;
        expectedAgentState.pendingRequestCounter = 1n;
        checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);

        // Emulate cash-out confirmation
        await checkCashierHookCalling(
          fixture,
          {
            txId,
            credit,
            hookIndex: HookIndex.CashOutConfirmationAfter,
            newCreditStatus: CreditRequestStatus.Confirmed,
            oldCreditStatus: CreditRequestStatus.Pending,
          },
        );
        expectedAgentState.pendingRequestCounter = 0n;
        checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);
      });

      it("A cash-out requested and then reversed with other proper conditions", async () => {
        const {
          fixture,
          txId,
          initCredit,
        } = await setUpFixture(deployAndConfigureContractsThenInitiateInstallmentCredit);
        const credit: InstallmentCredit = { ...initCredit, firstInstallmentId: fixture.loanIdStub };

        // Emulate cash-out request
        await checkCashierHookCalling(
          fixture,
          {
            txId,
            credit,
            hookIndex: HookIndex.CashOutRequestBefore,
            newCreditStatus: CreditRequestStatus.Pending,
            oldCreditStatus: CreditRequestStatus.Initiated,
          },
        );
        const expectedAgentState: AgentState = {
          ...initialAgentState,
          pendingRequestCounter: 1n,
          configured: true,
        };
        checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);

        // Emulate cash-out reversal
        await checkCashierHookCalling(
          fixture,
          {
            txId,
            credit,
            hookIndex: HookIndex.CashOutReversalAfter,
            newCreditStatus: CreditRequestStatus.Reversed,
            oldCreditStatus: CreditRequestStatus.Pending,
          },
        );
        expectedAgentState.pendingRequestCounter = 0n;
        checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);
      });
    });

    describe("Is reverted if", () => {
      async function checkCashierHookInappropriateStatusError(fixture: Fixture, props: {
        txId: string;
        hookIndex: HookIndex;
        creditStatus: CreditRequestStatus;
      }) {
        const { creditAgent, cashierMock } = fixture;
        const { txId, hookIndex, creditStatus } = props;
        await expect(cashierMock.callCashierHook(getAddress(creditAgent), hookIndex, TX_ID_STUB_INSTALLMENT))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
          .withArgs(txId, creditStatus);
      }

      it("The contract is paused (DUPLICATE)", async () => {
        const { fixture } = await setUpFixture(deployAndConfigureContractsThenInitiateInstallmentCredit);
        const { creditAgent, cashierMock } = fixture;
        const hookIndex = HookIndex.CashOutRequestBefore;
        await proveTx(creditAgent.pause());

        await expect(cashierMock.callCashierHook(getAddress(creditAgent), hookIndex, TX_ID_STUB))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_ENFORCED_PAUSE);
      });

      it("The caller is not the configured 'Cashier' contract (DUPLICATE)", async () => {
        const { fixture } = await setUpFixture(deployAndConfigureContractsThenInitiateOrdinaryCredit);
        const { creditAgent } = fixture;
        const hookIndex = HookIndex.CashOutRequestBefore;

        await expect(connect(creditAgent, deployer).onCashierHook(hookIndex, TX_ID_STUB))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CASHIER_HOOK_CALLER_UNAUTHORIZED);
      });

      it("The credit status is inappropriate to the provided hook index. Part 1", async () => {
        const { fixture, txId } = await setUpFixture(deployAndConfigureContractsThenInitiateInstallmentCredit);
        const { creditAgent, cashierMock } = fixture;

        // Try for a credit with the initiated status
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutConfirmationAfter,
          creditStatus: CreditRequestStatus.Initiated,
        });
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutReversalAfter,
          creditStatus: CreditRequestStatus.Initiated,
        });

        // Try for a credit with the pending status
        await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutRequestBefore,
          creditStatus: CreditRequestStatus.Pending,
        });

        // Try for a credit with the confirmed status
        await proveTx(
          cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutConfirmationAfter, txId),
        );
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutRequestBefore,
          creditStatus: CreditRequestStatus.Confirmed,
        });
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutConfirmationAfter,
          creditStatus: CreditRequestStatus.Confirmed,
        });
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutReversalAfter,
          creditStatus: CreditRequestStatus.Confirmed,
        });
      });

      it("The credit status is inappropriate to the provided hook index. Part 2", async () => {
        const { fixture, txId } = await setUpFixture(deployAndConfigureContractsThenInitiateInstallmentCredit);
        const { creditAgent, cashierMock } = fixture;

        // Try for a credit with the reversed status
        await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));
        await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutReversalAfter, txId));
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutRequestBefore,
          creditStatus: CreditRequestStatus.Reversed,
        });
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutConfirmationAfter,
          creditStatus: CreditRequestStatus.Reversed,
        });
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutReversalAfter,
          creditStatus: CreditRequestStatus.Reversed,
        });
      });

      it("The credit status is inappropriate to the provided hook because it is expired", async () => {
        const { fixture, txId, initCreditTxTimestamp } =
          await setUpFixture(deployAndConfigureContractsThenInitiateInstallmentCredit);
        await time.increaseTo(initCreditTxTimestamp + EXPIRATION_TIME_SECONDS + 1);
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutRequestBefore,
          creditStatus: CreditRequestStatus.Expired,
        });
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutConfirmationAfter,
          creditStatus: CreditRequestStatus.Expired,
        });
        await checkCashierHookInappropriateStatusError(fixture, {
          txId,
          hookIndex: HookIndex.CashOutReversalAfter,
          creditStatus: CreditRequestStatus.Expired,
        });
      });

      it("The cash-out account is not match the credit borrower before taking a loan", async () => {
        const {
          fixture,
          txId,
          initCashOut,
        } = await setUpFixture(deployAndConfigureContractsThenInitiateInstallmentCredit);
        const { creditAgent, cashierMock } = fixture;
        const cashOut: CashOut = {
          ...initCashOut,
          account: deployer.address,
        };
        await proveTx(cashierMock.setCashOut(txId, cashOut));

        await expect(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CASH_OUT_PARAMETERS_INAPPROPRIATE)
          .withArgs(txId);
      });

      it("The cash-out amount is not match the credit amount before taking a loan", async () => {
        const {
          fixture,
          txId,
          initCashOut,
        } = await setUpFixture(deployAndConfigureContractsThenInitiateInstallmentCredit);
        const { creditAgent, cashierMock } = fixture;
        const cashOut: CashOut = {
          ...initCashOut,
          amount: initCashOut.amount + 1n,
        };
        await proveTx(cashierMock.setCashOut(txId, cashOut));

        await expect(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CASH_OUT_PARAMETERS_INAPPROPRIATE)
          .withArgs(txId);
      });

      it("The provided hook index is unexpected", async () => {
        const { fixture } = await setUpFixture(deployAndConfigureContractsThenInitiateInstallmentCredit);
        const { creditAgent, cashierMock } = fixture;
        const hookIndex = HookIndex.Unused;

        await expect(cashierMock.callCashierHook(getAddress(creditAgent), hookIndex, TX_ID_STUB))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CASHIER_HOOK_INDEX_UNEXPECTED)
          .withArgs(hookIndex, TX_ID_STUB, getAddress(cashierMock));
      });
    });
  });

  describe("Complex scenarios for installment credit", () => {
    it("A revoked credit can be re-initiated", async () => {
      const {
        fixture,
        txId,
        initCredit,
      } = await setUpFixture(deployAndConfigureContractsThenInitiateInstallmentCredit);
      const { creditAgent } = fixture;
      const expectedAgentState: AgentState = {
        ...initialAgentState,
        initiatedRequestCounter: 1n,
        configured: true,
      };
      const credit: InstallmentCredit = { ...initCredit };
      checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);

      await proveTx(connect(creditAgent, manager).revokeInstallmentCredit(txId));
      expectedAgentState.initiatedRequestCounter = 0n;
      checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);

      const tx = initiateInstallmentCredit(creditAgent, { txId, credit });
      await checkInstallmentCreditInitiation(fixture, { tx, txId, credit });
      expectedAgentState.initiatedRequestCounter = 1n;
      checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);
    });

    it("A reversed credit can be re-initiated", async () => {
      const {
        fixture,
        txId,
        initCredit,
      } = await setUpFixture(deployAndConfigureContractsThenInitiateInstallmentCredit);
      const { creditAgent, cashierMock } = fixture;
      const credit: InstallmentCredit = { ...initCredit };

      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));
      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutReversalAfter, txId));

      const tx = initiateInstallmentCredit(creditAgent, { txId, credit });
      await checkInstallmentCreditInitiation(fixture, { tx, txId, credit, fromReversed: true });
      const expectedAgentState: AgentState = {
        initiatedRequestCounter: 1n,
        pendingRequestCounter: 0n,
        configured: true,
      };
      checkEquality(await fixture.creditAgent.agentState() as AgentState, expectedAgentState);
    });

    it("A pending or confirmed credit cannot be re-initiated", async () => {
      const {
        fixture,
        txId,
        initCredit,
      } = await setUpFixture(deployAndConfigureContractsThenInitiateInstallmentCredit);
      const { creditAgent, cashierMock } = fixture;
      const credit: InstallmentCredit = { ...initCredit };

      // Try for a credit with the pending status
      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));
      await expect(initiateInstallmentCredit(creditAgent, { txId, credit }))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
        .withArgs(txId, CreditRequestStatus.Pending);

      // confirm => confirmed
      await proveTx(
        cashierMock.callCashierHook(
          getAddress(creditAgent),
          HookIndex.CashOutConfirmationAfter,
          txId,
        ),
      );
      // try re-initiate => revert with status=Confirmed
      await expect(initiateInstallmentCredit(creditAgent, { txId, credit }))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
        .withArgs(txId, CreditRequestStatus.Confirmed);
    });

    it("A credit with any status except initiated cannot be revoked", async () => {
      const {
        fixture,
        txId,
        initCredit,
      } = await setUpFixture(deployAndConfigureContractsThenInitiateInstallmentCredit);
      const { creditAgent, cashierMock } = fixture;
      const credit: InstallmentCredit = { ...initCredit };

      // Try for a credit with the pending status
      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));
      await expect(connect(creditAgent, manager).revokeInstallmentCredit(txId))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
        .withArgs(txId, CreditRequestStatus.Pending);

      // Try for a credit with the reversed status
      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutReversalAfter, txId));
      await expect(connect(creditAgent, manager).revokeInstallmentCredit(txId))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
        .withArgs(txId, CreditRequestStatus.Reversed);

      // Try for a credit with the confirmed status
      await proveTx(initiateInstallmentCredit(creditAgent, { txId, credit }));
      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));
      await proveTx(
        cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutConfirmationAfter, txId),
      );
      await expect(connect(creditAgent, manager).revokeInstallmentCredit(txId))
        .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CREDIT_REQUEST_STATUS_INAPPROPRIATE)
        .withArgs(txId, CreditRequestStatus.Confirmed);
    });

    it("Configuring is prohibited when not all credits are processed", async () => {
      const {
        fixture,
        txId,
        initCredit,
      } = await setUpFixture(deployAndConfigureContractsThenInitiateInstallmentCredit);
      const { creditAgent, cashierMock, lendingMarketMock } = fixture;
      const credit: InstallmentCredit = { ...initCredit };

      async function checkConfiguringProhibition() {
        await expect(connect(creditAgent, admin).setCashier(ADDRESS_ZERO))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CONFIGURING_PROHIBITED);
        await expect(connect(creditAgent, admin).setLendingMarket(ADDRESS_ZERO))
          .to.be.revertedWithCustomError(creditAgent, ERROR_NAME_CONFIGURING_PROHIBITED);
      }

      async function checkConfiguringAllowance() {
        await proveTx(connect(creditAgent, admin).setCashier(ADDRESS_ZERO));
        await proveTx(connect(creditAgent, admin).setLendingMarket(ADDRESS_ZERO));
        await proveTx(connect(creditAgent, admin).setCashier(getAddress(cashierMock)));
        await proveTx(connect(creditAgent, admin).setLendingMarket(getAddress(lendingMarketMock)));
      }

      // Configuring is prohibited if a credit is initiated
      await checkConfiguringProhibition();

      // Configuring is allowed when no credit is initiated
      await proveTx(connect(creditAgent, manager).revokeInstallmentCredit(txId));
      await checkConfiguringAllowance();

      // Configuring is prohibited if a credit is pending
      await proveTx(initiateInstallmentCredit(creditAgent, { txId, credit }));
      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));
      await checkConfiguringProhibition();

      // Configuring is allowed if a credit is reversed and no more active credits exist
      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutReversalAfter, txId));
      await checkConfiguringAllowance();

      // Configuring is prohibited if a credit is initiated
      await proveTx(initiateInstallmentCredit(creditAgent, { txId, credit }));
      await checkConfiguringProhibition();

      // Configuring is allowed if credits are reversed or confirmed and no more active credits exist
      await proveTx(cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutRequestBefore, txId));
      await proveTx(
        cashierMock.callCashierHook(getAddress(creditAgent), HookIndex.CashOutConfirmationAfter, txId),
      );
      await checkConfiguringAllowance();
    });
  });
});
