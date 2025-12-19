import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import * as Contracts from "../typechain-types";
import {
  checkContractUupsUpgrading,
  checkEquality,
  maxUintForBits,
  resultToObject,
  setUpFixture,
} from "../test-utils/common";
import { EXPECTED_VERSION } from "../test-utils/specific";
import { ContractTransactionResponse } from "ethers";
import { getAddress, proveTx } from "../test-utils/eth";

const ADDRESS_ZERO = ethers.ZeroAddress;

const OWNER_ROLE = ethers.id("OWNER_ROLE");
const GRANTOR_ROLE = ethers.id("GRANTOR_ROLE");
const ADMIN_ROLE = ethers.id("ADMIN_ROLE");
const PAUSER_ROLE = ethers.id("PAUSER_ROLE");
const LOAN_OPERATOR_ROLE = ethers.id("LOAN_OPERATOR_ROLE");

// Events of the contracts under test
const EVENT_NAME_LINKED_CREDIT_LINE_CHANGED = "LinkedCreditLineChanged";
const EVENT_NAME_BORROWER_CONFIGURED = "BorrowerConfigured";
const EVENT_NAME_LOAN_CLOSED = "LoanClosed";
const EVENT_NAME_LOAN_OPENED = "LoanOpened";

// Errors of the base contracts
const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";
const ERROR_NAME_ENFORCED_PAUSED = "EnforcedPause";
const ERROR_NAME_INVALID_INITIALIZATION = "InvalidInitialization";

// Errors of the contract under test
const ERROR_NAME_LINKED_CREDIT_LINE_UNCHANGED = "CreditLineV2_LinkedCreditLineUnchanged";
const ERROR_NAME_LINKED_CREDIT_LINE_NOT_CONTRACT = "CreditLineV2_LinkedCreditLineNotContract";
const ERROR_NAME_LINKED_CREDIT_LINE_CONTRACT_INVALID = "CreditLineV2_LinkedCreditLineContractInvalid";
const ERROR_NAME_BORROWER_ADDRESS_ZERO = "CreditLineV2_BorrowerAddressZero";
const ERROR_NAME_MAX_BORROWED_AMOUNT_EXCESS = "CreditLineV2_MaxBorrowedAmountExcess";
const ERROR_NAME_LOANS_PROHIBITED = "CreditLineV2_LoansProhibited";
const ERROR_NAME_LIMIT_VIOLATION_ON_SINGLE_ACTIVE_LOAN = "CreditLineV2_LimitViolationOnSingleActiveLoan";
const ERROR_NAME_LIMIT_VIOLATION_ON_TOTAL_ACTIVE_LOAN_AMOUNT =
  "CreditLoneV2_LimitViolationOnTotalActiveLoanAmount";
const ERROR_NAME_BORROWER_STATE_OVERFLOW = "CreditLineV2_BorrowerStateOverflow";
const ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID = "CreditLineV2_ImplementationAddressInvalid";

let creditLineFactory: Contracts.CreditLineV2Testable__factory;
let creditLineV1MockFactory: Contracts.CreditLineV1Mock__factory;
let uupsExtMockFactory: Contracts.UUPSExtUpgradeableMock__factory;

let deployer: HardhatEthersSigner;
let grantor: HardhatEthersSigner;
let admin: HardhatEthersSigner;
let pauser: HardhatEthersSigner;
let loanOperator: HardhatEthersSigner;
let borrower: HardhatEthersSigner;
let stranger: HardhatEthersSigner;

interface Fixture {
  creditLine: Contracts.CreditLineV2Testable;
  linkedCreditLineV1: Contracts.CreditLineV1Mock;
}

enum BorrowingPolicy {
  Prohibited = 0,
  SingleActiveLoan = 1,
  TotalActiveAmountLimit = 2,
  UnlimitedActiveLoans = 3,
}

interface BorrowerState {
  activeLoanCount: number;
  closedLoanCount: number;
  totalActiveLoanAmount: bigint;
  totalClosedLoanAmount: bigint;
}

interface BorrowerStateView {
  activeLoanCount: bigint;
  closedLoanCount: bigint;
  totalActiveLoanAmount: bigint;
  totalClosedLoanAmount: bigint;

  [key: string]: bigint; // Index signature
}

interface BorrowerConfigView {
  borrowingPolicy: BorrowingPolicy;
  maxBorrowedAmount: bigint;

  [key: string]: bigint | BorrowingPolicy; // Index signature
}

const defaultBorrowerState: BorrowerState = {
  activeLoanCount: 0,
  closedLoanCount: 0,
  totalActiveLoanAmount: 0n,
  totalClosedLoanAmount: 0n,
};

async function deployContracts(): Promise<Fixture> {
  const creditLineDeployment = await upgrades.deployProxy(
    creditLineFactory,
    [],
    { kind: "uups" },
  );
  await creditLineDeployment.waitForDeployment();
  const creditLine = creditLineDeployment.connect(deployer);

  const linkedCreditLineV1Deployment = await creditLineV1MockFactory.deploy();
  await linkedCreditLineV1Deployment.waitForDeployment();
  const linkedCreditLineV1 = linkedCreditLineV1Deployment.connect(deployer);

  return { creditLine, linkedCreditLineV1 };
}

async function deployAndConfigureContracts(): Promise<Fixture> {
  const fixture = await deployContracts();
  const { creditLine } = fixture;

  // Configure roles
  await creditLine.grantRole(GRANTOR_ROLE, grantor.address);
  await creditLine.connect(grantor).grantRole(ADMIN_ROLE, admin.address);
  await creditLine.connect(grantor).grantRole(PAUSER_ROLE, pauser.address);
  await creditLine.connect(grantor).grantRole(LOAN_OPERATOR_ROLE, loanOperator.address);

  return fixture;
}

describe("Contract 'CreditLineV2'", () => {
  before(async () => {
    [deployer, grantor, admin, pauser, loanOperator, borrower, stranger] = await ethers.getSigners();

    creditLineFactory = (await ethers.getContractFactory("CreditLineV2Testable")).connect(deployer);
    creditLineV1MockFactory = (await ethers.getContractFactory("CreditLineV1Mock")).connect(deployer);
    uupsExtMockFactory = (await ethers.getContractFactory("UUPSExtUpgradeableMock")).connect(deployer);
  });

  describe("Function 'initialize()'", () => {
    let creditLine: Contracts.CreditLineV2Testable;

    beforeEach(async () => {
      ({ creditLine } = await setUpFixture(deployContracts));
    });

    describe("Executes as expected when called properly and", () => {
      it("exposes correct role hashes", async () => {
        expect(await creditLine.OWNER_ROLE()).to.equal(OWNER_ROLE);
        expect(await creditLine.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
        expect(await creditLine.ADMIN_ROLE()).to.equal(ADMIN_ROLE);
        expect(await creditLine.PAUSER_ROLE()).to.equal(PAUSER_ROLE);
        expect(await creditLine.LOAN_OPERATOR_ROLE()).to.equal(LOAN_OPERATOR_ROLE);
      });

      it("sets correct role admins", async () => {
        expect(await creditLine.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
        expect(await creditLine.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
        expect(await creditLine.getRoleAdmin(ADMIN_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await creditLine.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await creditLine.getRoleAdmin(LOAN_OPERATOR_ROLE)).to.equal(GRANTOR_ROLE);
      });

      it("sets correct roles for the deployer", async () => {
        expect(await creditLine.hasRole(OWNER_ROLE, deployer)).to.equal(true);
        expect(await creditLine.hasRole(GRANTOR_ROLE, deployer)).to.equal(false);
        expect(await creditLine.hasRole(ADMIN_ROLE, deployer)).to.equal(false);
        expect(await creditLine.hasRole(PAUSER_ROLE, deployer)).to.equal(false);
        expect(await creditLine.hasRole(LOAN_OPERATOR_ROLE, deployer)).to.equal(false);
      });

      it("does not pause the contract", async () => {
        expect(await creditLine.paused()).to.equal(false);
      });
    });

    describe("Is reverted if", () => {
      it("called a second time", async () => {
        await expect(creditLine.initialize())
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_INVALID_INITIALIZATION);
      });
    });
  });

  describe("Function '$__VERSION()'", () => {
    it("returns the expected version", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      expect(await creditLine.$__VERSION()).to.deep.equal([
        EXPECTED_VERSION.major,
        EXPECTED_VERSION.minor,
        EXPECTED_VERSION.patch,
      ]);
    });
  });

  describe("Function 'upgradeToAndCall()'", () => {
    it("executes as expected if called properly", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      await checkContractUupsUpgrading(creditLine, creditLineFactory);
    });

    it("is reverted if the caller does not have the owner role", async () => {
      const { creditLine } = await setUpFixture(deployContracts);

      await expect(creditLine.connect(stranger).upgradeToAndCall(creditLine, "0x"))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(stranger.address, OWNER_ROLE);
    });

    it("is reverted if the provided implementation address is not a credit line V2 contract", async () => {
      const { creditLine } = await setUpFixture(deployContracts);
      const mockContract = await uupsExtMockFactory.deploy();
      await mockContract.waitForDeployment();

      await expect(creditLine.upgradeToAndCall(mockContract, "0x"))
        .to.be.revertedWithCustomError(creditLine, ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID);
    });
  });

  describe("Function 'setLinkedCreditLine()'", () => {
    let creditLine: Contracts.CreditLineV2Testable;
    let linkedCreditLineV1: Contracts.CreditLineV1Mock;

    beforeEach(async () => {
      ({ creditLine, linkedCreditLineV1 } = await setUpFixture(deployAndConfigureContracts));
    });

    describe("Executes as expected in a typical case when called properly, and does the following:", () => {
      let tx: Promise<ContractTransactionResponse>;

      beforeEach(async () => {
        tx = creditLine.connect(deployer).setLinkedCreditLine(linkedCreditLineV1);
        await proveTx(tx);
      });

      it("sets the expected linked credit line address", async () => {
        expect(await creditLine.linkedCreditLine()).to.equal(getAddress(linkedCreditLineV1));
      });

      it("emits the expected event", async () => {
        await expect(tx)
          .to.emit(creditLine, EVENT_NAME_LINKED_CREDIT_LINE_CHANGED)
          .withArgs(getAddress(linkedCreditLineV1), ADDRESS_ZERO);
      });
    });

    describe("Executes as expected when", () => {
      it("the linked credit line address is reset to zero", async () => {
        await creditLine.connect(deployer).setLinkedCreditLine(linkedCreditLineV1);

        await expect(creditLine.connect(deployer).setLinkedCreditLine(ADDRESS_ZERO))
          .to.emit(creditLine, EVENT_NAME_LINKED_CREDIT_LINE_CHANGED)
          .withArgs(ADDRESS_ZERO, getAddress(linkedCreditLineV1));

        expect(await creditLine.linkedCreditLine()).to.equal(ADDRESS_ZERO);
      });
    });

    describe("Is reverted if", () => {
      it("the caller does not have the owner role", async () => {
        await expect(creditLine.connect(admin).setLinkedCreditLine(ADDRESS_ZERO))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(admin.address, OWNER_ROLE);
        await expect(creditLine.connect(stranger).setLinkedCreditLine(ADDRESS_ZERO))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, OWNER_ROLE);
      });

      it("the new linked credit line address is the same as the current one", async () => {
        await creditLine.connect(deployer).setLinkedCreditLine(linkedCreditLineV1);

        await expect(creditLine.connect(deployer).setLinkedCreditLine(linkedCreditLineV1))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_LINKED_CREDIT_LINE_UNCHANGED);
      });

      it("the new linked credit line address is not a contract", async () => {
        await expect(creditLine.connect(deployer).setLinkedCreditLine(stranger.address))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_LINKED_CREDIT_LINE_NOT_CONTRACT);
      });

      it("the new linked credit line address does not implement the expected proof function", async () => {
        const wrongLinkedCreditLineAddress = getAddress(creditLine);

        await expect(creditLine.connect(deployer).setLinkedCreditLine(wrongLinkedCreditLineAddress))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_LINKED_CREDIT_LINE_CONTRACT_INVALID);
      });
    });
  });

  describe("Function 'configureBorrower()'", () => {
    let creditLine: Contracts.CreditLineV2Testable;

    beforeEach(async () => {
      ({ creditLine } = await setUpFixture(deployAndConfigureContracts));
    });

    describe("Executes as expected in a typical case when called properly, and does the following:", () => {
      const borrowingPolicy = BorrowingPolicy.TotalActiveAmountLimit;
      const maxBorrowedAmount = maxUintForBits(64);

      let tx: Promise<ContractTransactionResponse>;

      beforeEach(async () => {
        tx = creditLine.connect(admin).configureBorrower(borrower.address, borrowingPolicy, maxBorrowedAmount);
        await proveTx(tx);
      });

      it("sets borrower configuration as expected", async () => {
        const actualConfigView = await creditLine.getBorrowerConfiguration(borrower.address);
        const expectedConfigView: BorrowerConfigView = {
          borrowingPolicy,
          maxBorrowedAmount,
        };
        checkEquality(resultToObject(actualConfigView), expectedConfigView);
      });

      it("emits the expected event", async () => {
        await expect(tx)
          .to.emit(creditLine, EVENT_NAME_BORROWER_CONFIGURED)
          .withArgs(borrower.address, borrowingPolicy, maxBorrowedAmount);
      });
    });

    describe("Executes as expected when", () => {
      interface TestContext {
        borrowerAddress: string;
        borrowingPolicy: BorrowingPolicy;
        maxBorrowedAmount: bigint;
      }

      async function configureBorrowerAndCheck(context: TestContext) {
        const { borrowerAddress, borrowingPolicy, maxBorrowedAmount } = context;

        const tx = creditLine.connect(admin).configureBorrower(borrowerAddress, borrowingPolicy, maxBorrowedAmount);
        await proveTx(tx);

        const actualConfigView = await creditLine.getBorrowerConfiguration(borrowerAddress);
        const expectedConfigView: BorrowerConfigView = { borrowingPolicy, maxBorrowedAmount };
        checkEquality(resultToObject(actualConfigView), expectedConfigView);
        await expect(tx)
          .to.emit(creditLine, EVENT_NAME_BORROWER_CONFIGURED)
          .withArgs(borrowerAddress, borrowingPolicy, maxBorrowedAmount);
      }

      it("the same borrower configuration is changed several times", async () => {
        const context: TestContext = {
          borrowerAddress: borrower.address,
          borrowingPolicy: BorrowingPolicy.TotalActiveAmountLimit,
          maxBorrowedAmount: 0n,
        };
        await configureBorrowerAndCheck(context);

        context.borrowingPolicy = BorrowingPolicy.UnlimitedActiveLoans;
        context.maxBorrowedAmount = maxUintForBits(64);
        await configureBorrowerAndCheck(context);

        context.borrowingPolicy = BorrowingPolicy.SingleActiveLoan;
        context.maxBorrowedAmount = 1n;
        await configureBorrowerAndCheck(context);

        context.borrowingPolicy = BorrowingPolicy.Prohibited;
        context.maxBorrowedAmount = 1000_000n;
        await configureBorrowerAndCheck(context);
      });
    });

    describe("Is reverted if", () => {
      const borrowingPolicy = BorrowingPolicy.TotalActiveAmountLimit;
      const maxBorrowedAmount = maxUintForBits(64);

      it("the caller does not have the admin role", async () => {
        await expect(
          creditLine.connect(deployer).configureBorrower(borrower.address, borrowingPolicy, maxBorrowedAmount),
        ).to.be.revertedWithCustomError(
          creditLine,
          ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT,
        ).withArgs(deployer.address, ADMIN_ROLE);

        await expect(
          creditLine.connect(stranger).configureBorrower(borrower.address, borrowingPolicy, maxBorrowedAmount),
        ).to.be.revertedWithCustomError(
          creditLine,
          ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT,
        ).withArgs(stranger.address, ADMIN_ROLE);
      });

      it("the contract is paused", async () => {
        await creditLine.connect(grantor).grantRole(PAUSER_ROLE, pauser.address);
        await creditLine.connect(pauser).pause();

        await expect(
          creditLine.connect(admin).configureBorrower(borrower.address, borrowingPolicy, maxBorrowedAmount),
        ).to.be.revertedWithCustomError(creditLine, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("the borrower address is zero", async () => {
        const borrowerAddress = (ADDRESS_ZERO);

        await expect(
          creditLine.connect(admin).configureBorrower(borrowerAddress, borrowingPolicy, maxBorrowedAmount),
        ).to.be.revertedWithCustomError(creditLine, ERROR_NAME_BORROWER_ADDRESS_ZERO);
      });

      it("the max borrowed amount is greater than uint64 max", async () => {
        const wrongMaxBorrowedAmount = maxUintForBits(64) + 1n;

        await expect(
          creditLine.connect(admin).configureBorrower(borrower.address, borrowingPolicy, wrongMaxBorrowedAmount),
        ).to.be.revertedWithCustomError(creditLine, ERROR_NAME_MAX_BORROWED_AMOUNT_EXCESS);
      });
    });
  });

  describe("Function 'onBeforeLoanOpened()'", () => {
    const firstSubLoanId = 123n;
    const borrowingPolicy = BorrowingPolicy.TotalActiveAmountLimit;
    const maxBorrowedAmount = maxUintForBits(64);
    const borrowedAmount = 10_000_000n;

    const borrowerStateLinked: BorrowerState = {
      activeLoanCount: 1,
      closedLoanCount: 2,
      totalActiveLoanAmount: 10_000_000n,
      totalClosedLoanAmount: 20_000_000n,
    };
    const borrowerStateMain: BorrowerState = {
      activeLoanCount: 3,
      closedLoanCount: Number(maxUintForBits(16) - 3n - 2n - 1n),
      totalActiveLoanAmount: 30_000_000n,
      totalClosedLoanAmount: maxUintForBits(64) - 30_000_000n - 20_000_000n - borrowedAmount,
    };

    let creditLine: Contracts.CreditLineV2Testable;
    let linkedCreditLineV1: Contracts.CreditLineV1Mock;

    async function setUp(): Promise<Fixture> {
      const fixture = await deployAndConfigureContracts();
      await proveTx(fixture.creditLine.connect(admin).configureBorrower(
        borrower.address,
        borrowingPolicy,
        maxBorrowedAmount,
      ));
      await proveTx(fixture.creditLine.setLinkedCreditLine(fixture.linkedCreditLineV1));
      await proveTx(fixture.linkedCreditLineV1.setBorrowerState(borrower.address, borrowerStateLinked));
      await proveTx(fixture.creditLine.setBorrowerState(borrower.address, borrowerStateMain));
      return fixture;
    }

    beforeEach(async () => {
      ({ creditLine, linkedCreditLineV1 } = await setUpFixture(setUp));
    });

    describe("Executes as expected in a typical case when called properly, and does the following:", () => {
      let tx: Promise<ContractTransactionResponse>;

      beforeEach(async () => {
        tx = creditLine.connect(loanOperator).onBeforeLoanOpened(firstSubLoanId, borrower.address, borrowedAmount);
        await proveTx(tx);
      });

      it("changes the borrower state as expected", async () => {
        const actualBorrowerStateView = await creditLine.getBorrowerState(borrower.address);
        const expectedBorrowerStateView: BorrowerStateView = {
          activeLoanCount: BigInt(borrowerStateLinked.activeLoanCount + borrowerStateMain.activeLoanCount + 1),
          closedLoanCount: BigInt(borrowerStateLinked.closedLoanCount + borrowerStateMain.closedLoanCount),
          totalActiveLoanAmount:
            borrowerStateLinked.totalActiveLoanAmount + borrowerStateMain.totalActiveLoanAmount + borrowedAmount,
          totalClosedLoanAmount:
            borrowerStateLinked.totalClosedLoanAmount + borrowerStateMain.totalClosedLoanAmount,
        };
        checkEquality(resultToObject(actualBorrowerStateView), expectedBorrowerStateView);
      });

      it("emits the expected event", async () => {
        await expect(tx)
          .to.emit(creditLine, EVENT_NAME_LOAN_OPENED)
          .withArgs(firstSubLoanId, borrower.address, borrowedAmount);
      });
    });

    describe("Executes as expected when", () => {
      async function executeAndCheck(
        initialBorrowerStateLinked: BorrowerState,
        initialBorrowerStateMain: BorrowerState,
      ) {
        const tx = creditLine.connect(loanOperator).onBeforeLoanOpened(
          firstSubLoanId,
          borrower.address,
          borrowedAmount,
        );
        await proveTx(tx);

        const actualBorrowerStateView = await creditLine.getBorrowerState(borrower.address);
        const expectedBorrowerStateView: BorrowerStateView = {
          activeLoanCount:
            BigInt(initialBorrowerStateLinked.activeLoanCount + initialBorrowerStateMain.activeLoanCount + 1),
          closedLoanCount:
            BigInt(initialBorrowerStateLinked.closedLoanCount + initialBorrowerStateMain.closedLoanCount),
          totalActiveLoanAmount: initialBorrowerStateLinked.totalActiveLoanAmount +
            initialBorrowerStateMain.totalActiveLoanAmount + borrowedAmount,
          totalClosedLoanAmount:
              initialBorrowerStateLinked.totalClosedLoanAmount + initialBorrowerStateMain.totalClosedLoanAmount,
        };
        checkEquality(resultToObject(actualBorrowerStateView), expectedBorrowerStateView);

        await expect(tx)
          .to.emit(creditLine, EVENT_NAME_LOAN_OPENED)
          .withArgs(firstSubLoanId, borrower.address, borrowedAmount);
      }

      it("the borrowing policy is a single active loan", async () => {
        await creditLine.connect(admin).configureBorrower(
          borrower.address,
          BorrowingPolicy.SingleActiveLoan,
          maxBorrowedAmount,
        );
        const newBorrowerStateLinked = {
          ...borrowerStateLinked,
          activeLoanCount: 0,
        };
        const newBorrowerStateMain = {
          ...borrowerStateMain,
          activeLoanCount: 0,
        };
        await proveTx(linkedCreditLineV1.setBorrowerState(borrower.address, newBorrowerStateLinked));
        await proveTx(creditLine.setBorrowerState(borrower.address, newBorrowerStateMain));

        await executeAndCheck(newBorrowerStateLinked, newBorrowerStateMain);
      });

      it("the borrowing policy is unlimited active loans", async () => {
        await creditLine.connect(admin).configureBorrower(
          borrower.address,
          BorrowingPolicy.UnlimitedActiveLoans,
          maxBorrowedAmount,
        );
        await executeAndCheck(borrowerStateLinked, borrowerStateMain);
      });
    });

    describe("Is reverted if", () => {
      it("the caller does not have the loan operator role", async () => {
        await expect(creditLine.connect(deployer).onBeforeLoanOpened(firstSubLoanId, borrower.address, borrowedAmount))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(deployer.address, LOAN_OPERATOR_ROLE);
        await expect(creditLine.connect(admin).onBeforeLoanOpened(firstSubLoanId, borrower.address, borrowedAmount))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(admin.address, LOAN_OPERATOR_ROLE);
        await expect(creditLine.connect(stranger).onBeforeLoanOpened(firstSubLoanId, borrower.address, borrowedAmount))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, LOAN_OPERATOR_ROLE);
      });

      it("the contract is paused", async () => {
        await creditLine.connect(pauser).pause();

        await expect(creditLine.connect(stranger).onBeforeLoanOpened(firstSubLoanId, borrower.address, borrowedAmount))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("the borrowing policy prohibits loans for the borrower", async () => {
        await creditLine.connect(admin).configureBorrower(
          borrower.address,
          BorrowingPolicy.Prohibited,
          maxBorrowedAmount,
        );
        const borrowedAmount = 1;

        await expect(
          creditLine.connect(loanOperator).onBeforeLoanOpened(firstSubLoanId, borrower.address, borrowedAmount),
        ).to.be.revertedWithCustomError(creditLine, ERROR_NAME_LOANS_PROHIBITED);
      });

      it("the borrowing policy is a single active loan and there is another loan on the main line", async () => {
        await creditLine.connect(admin).configureBorrower(
          borrower.address,
          BorrowingPolicy.SingleActiveLoan,
          maxBorrowedAmount,
        );
        const newBorrowerStateLinked = {
          ...borrowerStateLinked,
          activeLoanAmount: 0,
        };
        const newBorrowerStateMain = {
          ...borrowerStateLinked,
          activeLoanAmount: 1,
        };
        await proveTx(linkedCreditLineV1.setBorrowerState(borrower.address, newBorrowerStateLinked));
        await proveTx(creditLine.setBorrowerState(borrower.address, newBorrowerStateMain));

        await expect(
          creditLine.connect(loanOperator).onBeforeLoanOpened(firstSubLoanId, borrower.address, borrowedAmount),
        ).to.be.revertedWithCustomError(creditLine, ERROR_NAME_LIMIT_VIOLATION_ON_SINGLE_ACTIVE_LOAN);
      });

      it("the borrowing policy is a single active loan and there is another loan on the linked line", async () => {
        await creditLine.connect(admin).configureBorrower(
          borrower.address,
          BorrowingPolicy.SingleActiveLoan,
          maxBorrowedAmount,
        );
        const newBorrowerStateLinked = {
          ...borrowerStateLinked,
          activeLoanAmount: 1,
        };
        const newBorrowerStateMain = {
          ...borrowerStateLinked,
          activeLoanAmount: 0,
        };
        await proveTx(linkedCreditLineV1.setBorrowerState(borrower.address, newBorrowerStateLinked));
        await proveTx(creditLine.setBorrowerState(borrower.address, newBorrowerStateMain));

        await expect(
          creditLine.connect(loanOperator).onBeforeLoanOpened(firstSubLoanId, borrower.address, borrowedAmount),
        ).to.be.revertedWithCustomError(creditLine, ERROR_NAME_LIMIT_VIOLATION_ON_SINGLE_ACTIVE_LOAN);
      });

      it("the borrowing policy is total active amount limit and the limit is exceeded", async () => {
        await creditLine.connect(admin).configureBorrower(
          borrower.address,
          BorrowingPolicy.TotalActiveAmountLimit,
          maxBorrowedAmount,
        );

        const currentTotalActiveAmount =
          borrowerStateLinked.totalActiveLoanAmount + borrowerStateMain.totalActiveLoanAmount;
        const borrowedAmount = maxBorrowedAmount - currentTotalActiveAmount + 1n;
        await expect(
          creditLine.connect(loanOperator).onBeforeLoanOpened(firstSubLoanId, borrower.address, borrowedAmount),
        ).to.be.revertedWithCustomError(
          creditLine,
          ERROR_NAME_LIMIT_VIOLATION_ON_TOTAL_ACTIVE_LOAN_AMOUNT,
        ).withArgs(currentTotalActiveAmount + borrowedAmount, maxBorrowedAmount);
      });

      it("the future closed loan count of the borrower exceeds the uint16 maximum", async () => {
        await creditLine.connect(admin).configureBorrower(
          borrower.address,
          BorrowingPolicy.UnlimitedActiveLoans,
          maxBorrowedAmount,
        );
        const borrowerState: BorrowerState = {
          ...defaultBorrowerState,
          closedLoanCount: Number(maxUintForBits(16)),
        };
        await proveTx(creditLine.setBorrowerState(borrower.address, borrowerState));

        await expect(
          creditLine.connect(loanOperator).onBeforeLoanOpened(firstSubLoanId, borrower.address, borrowedAmount),
        ).to.be.revertedWithCustomError(creditLine, ERROR_NAME_BORROWER_STATE_OVERFLOW);
      });

      it("the future total closed loan amount of the borrower exceeds the uint64 max", async () => {
        await creditLine.connect(admin).configureBorrower(
          borrower.address,
          BorrowingPolicy.UnlimitedActiveLoans,
          maxBorrowedAmount,
        );
        const borrowerState: BorrowerState = {
          ...defaultBorrowerState,
          totalClosedLoanAmount: maxUintForBits(64),
        };
        await proveTx(creditLine.setBorrowerState(borrower.address, borrowerState));

        const borrowedAmount = 1n;
        await expect(
          creditLine.connect(loanOperator).onBeforeLoanOpened(firstSubLoanId, borrower.address, borrowedAmount),
        ).to.be.revertedWithCustomError(creditLine, ERROR_NAME_BORROWER_STATE_OVERFLOW);
      });
    });
  });

  describe("Function 'onAfterLoanClosed()'", () => {
    const firstSubLoanId = 123n;
    const borrowedAmount = maxUintForBits(64) - 1n;
    const borrowerState: BorrowerState = {
      activeLoanCount: 1,
      closedLoanCount: Number(maxUintForBits(16) - 1n),
      totalActiveLoanAmount: borrowedAmount,
      totalClosedLoanAmount: 1n,
    };

    let creditLine: Contracts.CreditLineV2Testable;

    async function setUp(): Promise<Fixture> {
      const fixture = await deployAndConfigureContracts();

      await proveTx(fixture.creditLine.setBorrowerState(borrower.address, borrowerState));

      return fixture;
    }

    beforeEach(async () => {
      ({ creditLine } = await setUp());
    });

    describe("Executes as expected in a typical case when called properly, and does the following:", () => {
      let tx: Promise<ContractTransactionResponse>;

      beforeEach(async () => {
        tx = creditLine.connect(loanOperator).onAfterLoanClosed(firstSubLoanId, borrower.address, borrowedAmount);
        await proveTx(tx);
      });

      it("changes the borrower state as expected", async () => {
        const actualBorrowerStateView = await creditLine.getBorrowerState(borrower.address);
        const expectedBorrowerStateView: BorrowerStateView = {
          activeLoanCount: BigInt(borrowerState.activeLoanCount - 1),
          closedLoanCount: BigInt(borrowerState.closedLoanCount + 1),
          totalActiveLoanAmount: BigInt(borrowerState.totalActiveLoanAmount - borrowedAmount),
          totalClosedLoanAmount: BigInt(borrowerState.totalClosedLoanAmount + borrowedAmount),
        };
        checkEquality(resultToObject(actualBorrowerStateView), expectedBorrowerStateView);
      });

      it("emits the expected event", async () => {
        await expect(tx)
          .to.emit(creditLine, EVENT_NAME_LOAN_CLOSED)
          .withArgs(firstSubLoanId, borrower.address, borrowedAmount);
      });
    });

    describe("Is reverted if", () => {
      it("the caller does not have the loan operator role", async () => {
        await expect(creditLine.connect(deployer).onAfterLoanClosed(firstSubLoanId, borrower.address, borrowedAmount))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(deployer.address, LOAN_OPERATOR_ROLE);
        await expect(creditLine.connect(admin).onAfterLoanClosed(firstSubLoanId, borrower.address, borrowedAmount))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(admin.address, LOAN_OPERATOR_ROLE);
        await expect(creditLine.connect(stranger).onAfterLoanClosed(firstSubLoanId, borrower.address, borrowedAmount))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, LOAN_OPERATOR_ROLE);
      });

      it("the contract is paused", async () => {
        await creditLine.connect(pauser).pause();

        await expect(creditLine.connect(stranger).onAfterLoanClosed(firstSubLoanId, borrower.address, borrowedAmount))
          .to.be.revertedWithCustomError(creditLine, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("the current active loan count of the borrower is zero", async () => {
        const newBorrowerState: BorrowerState = {
          ...borrowerState,
          activeLoanCount: 0,
        };
        await proveTx(creditLine.setBorrowerState(borrower.address, newBorrowerState));

        await expect(
          creditLine.connect(loanOperator).onAfterLoanClosed(firstSubLoanId, borrower.address, borrowedAmount),
        ).to.be.revertedWithPanic("0x11");
      });

      it("the current closed loan count of the borrower exceeds the uint16 max", async () => {
        const newBorrowerState: BorrowerState = {
          ...borrowerState,
          closedLoanCount: Number(maxUintForBits(16)),
        };
        await proveTx(creditLine.setBorrowerState(borrower.address, newBorrowerState));

        await expect(
          creditLine.connect(loanOperator).onAfterLoanClosed(firstSubLoanId, borrower.address, borrowedAmount),
        ).to.be.revertedWithPanic("0x11");
      });

      it("the current total active loan amount of the borrower is less than the borrowed amount", async () => {
        const newBorrowerState: BorrowerState = {
          ...borrowerState,
          totalActiveLoanAmount: borrowedAmount - 1n,
        };
        await proveTx(creditLine.setBorrowerState(borrower.address, newBorrowerState));

        await expect(
          creditLine.connect(loanOperator).onAfterLoanClosed(firstSubLoanId, borrower.address, borrowedAmount),
        ).to.be.revertedWithPanic("0x11");
      });

      it("the current total closed loan amount of the borrower exceeds the uint64 max", async () => {
        const newBorrowerState: BorrowerState = {
          ...borrowerState,
          totalClosedLoanAmount: maxUintForBits(64) + 1n - borrowedAmount,
        };
        await proveTx(creditLine.setBorrowerState(borrower.address, newBorrowerState));

        await expect(
          creditLine.connect(loanOperator).onAfterLoanClosed(firstSubLoanId, borrower.address, borrowedAmount),
        ).to.be.revertedWithPanic("0x11");
      });
    });
  });
});
