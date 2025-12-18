import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  checkContractUupsUpgrading,
  checkEquality,
  maxUintForBits,
  resultToObject,
  setUpFixture,
} from "../test-utils/common";
import * as Contracts from "../typechain-types";
import {
  checkTokenPath,
  getAddress,
  getBlockTimestamp,
  getNumberOfEvents,
  getTxTimestamp,
  increaseBlockTimestampTo,
  proveTx,
} from "../test-utils/eth";
import { DeployProxyOptions } from "@openzeppelin/hardhat-upgrades/dist/utils";
import { ContractTransactionResponse } from "ethers";

enum LendingProgramStatus {
  Nonexistent = 0,
  Active = 1,
  Closed = 2,
}

enum SubLoanStatus {
  Nonexistent = 0,
  Ongoing = 1,
  Repaid = 2,
  Revoked = 3,
}

enum GracePeriodStatus {
  None = 0,
  Active = 1,
}

enum OperationStatus {
  Nonexistent = 0,
  Pending = 1,
  Applied = 2,
  Skipped = 3,
  Dismissed = 4,
  Revoked = 5,
}

enum OperationKind {
  Nonexistent = 0,
  Repayment = 1,
  Discount = 2,
  Revocation = 3,
  Freezing = 4,
  Unfreezing = 5,
  RemuneratoryRateSetting = 6,
  MoratoryRateSetting = 7,
  LateFeeRateSetting = 8,
  GraceDiscountRateSetting = 9,
  DurationSetting = 10,
}

interface Fixture {
  market: Contracts.LendingMarketV2Testable;
  engine: Contracts.LendingEngineV2;
  tokenMock: Contracts.ERC20TokenMock;
  CreditLineV2Mock: Contracts.CreditLineV2Mock;
  liquidityPoolMock: Contracts.LiquidityPoolMock;
  programId: number;
}

interface LoanTakingRequest {
  borrower: string;
  programId: number;
  startTimestamp: number;
}

interface SubLoanTakingRequest {
  borrowedAmount: bigint;
  addonAmount: bigint;
  duration: number;
  remuneratoryRate: number;
  moratoryRate: number;
  lateFeeRate: number;
  graceDiscountRate: number;
}

interface SubLoanInception {
  borrowedAmount: bigint;
  addonAmount: bigint;
  initialRemuneratoryRate: number;
  initialMoratoryRate: number;
  initialLateFeeRate: number;
  initialGraceDiscountRate: number;

  initialDuration: number;
  startTimestamp: number;
  programId: number;
  borrower: string;

  [key: string]: bigint | number | string; // Index signature
}

interface SubLoanMetadata {
  subLoanIndex: number;
  subLoanCount: number;
  updateIndex: number;
  pendingTimestamp: number;
  operationCount: number;
  earliestOperationId: number;
  recentOperationId: number;
  latestOperationId: number;

  [key: string]: number; // Index signature
}

interface SubLoanState {
  status: SubLoanStatus;
  gracePeriodStatus: GracePeriodStatus;
  duration: number;
  freezeTimestamp: number;
  trackedTimestamp: number;
  remuneratoryRate: number;
  moratoryRate: number;
  lateFeeRate: number;
  graceDiscountRate: number;

  trackedPrincipal: bigint;
  trackedRemuneratoryInterest: bigint;
  trackedMoratoryInterest: bigint;
  trackedLateFee: bigint;

  repaidPrincipal: bigint;
  repaidRemuneratoryInterest: bigint;
  repaidMoratoryInterest: bigint;
  repaidLateFee: bigint;

  discountPrincipal: bigint;
  discountRemuneratoryInterest: bigint;
  discountMoratoryInterest: bigint;
  discountLateFee: bigint;

  [key: string]: bigint | number; // Index signature
}

interface SubLoan {
  id: bigint;
  indexInLoan: number;
  inception: SubLoanInception;
  metadata: SubLoanMetadata;
  state: SubLoanState;
}

interface Loan {
  subLoans: SubLoan[];
  totalBorrowedAmount: bigint;
  totalAddonAmount: bigint;
}

interface SubLoanPreview {
  day: number;
  id: bigint;
  firstSubLoanId: bigint;
  subLoanCount: number;
  operationCount: number;
  earliestOperationId: number;
  recentOperationId: number;
  latestOperationId: number;
  status: SubLoanStatus;
  gracePeriodStatus: GracePeriodStatus;
  programId: number;
  borrower: string;
  borrowedAmount: bigint;
  addonAmount: bigint;
  startTimestamp: number;
  freezeTimestamp: number;
  trackedTimestamp: number;
  pendingTimestamp: number;
  duration: number;
  remuneratoryRate: number;
  moratoryRate: number;
  lateFeeRate: number;
  graceDiscountRate: number;
  trackedPrincipal: bigint;
  trackedRemuneratoryInterest: bigint;
  trackedMoratoryInterest: bigint;
  trackedLateFee: bigint;
  outstandingBalance: bigint;
  repaidPrincipal: bigint;
  repaidRemuneratoryInterest: bigint;
  repaidMoratoryInterest: bigint;
  repaidLateFee: bigint;
  discountPrincipal: bigint;
  discountRemuneratoryInterest: bigint;
  discountMoratoryInterest: bigint;
  discountLateFee: bigint;

  [key: string]: bigint | number | string;
}

interface LoanPreview {
  day: number;
  firstSubLoanId: bigint;
  subLoanCount: number;
  ongoingSubLoanCount: number;
  repaidSubLoanCount: number;
  revokedSubLoanCount: number;
  programId: number;
  borrower: string;
  totalBorrowedAmount: bigint;
  totalAddonAmount: bigint;
  totalTrackedPrincipal: bigint;
  totalTrackedRemuneratoryInterest: bigint;
  totalTrackedMoratoryInterest: bigint;
  totalTrackedLateFee: bigint;
  totalOutstandingBalance: bigint;
  totalRepaidPrincipal: bigint;
  totalRepaidRemuneratoryInterest: bigint;
  totalRepaidMoratoryInterest: bigint;
  totalRepaidLateFee: bigint;
  totalDiscountPrincipal: bigint;
  totalDiscountRemuneratoryInterest: bigint;
  totalDiscountMoratoryInterest: bigint;
  totalDiscountLateFee: bigint;

  [key: string]: bigint | number | string;
}

interface Operation {
  subLoanId: bigint;
  id: number;
  status: OperationStatus;
  kind: OperationKind;
  nextOperationId: number;
  prevOperationId: number;
  timestamp: number;
  value: bigint;
  account: string;

  [key: string]: bigint | number | string; // Index signature
}

interface OperationView {
  status: OperationStatus;
  kind: OperationKind;
  nextOperationId: number;
  prevOperationId: number;
  timestamp: number;
  value: bigint;
  account: string;

  [key: string]: bigint | number | string; // Index signature
}

interface OperationRequest {
  subLoanId: bigint;
  kind: OperationKind;
  timestamp: number;
  value: bigint;
  account: string;

  [key: string]: bigint | number | string; // Index signature
}

interface OperationVoidingRequest {
  subLoanId: bigint;
  operationId: number;
  counterparty: string;

  [key: string]: bigint | number | string; // Index signature
}

const ADDRESS_ZERO = ethers.ZeroAddress;
const INTEREST_RATE_FACTOR = 10 ** 9;
const ACCURACY_FACTOR = 10_000n;
const SUB_LOAN_COUNT_MAX = 180;
const OPERATION_COUNT_MAX = 10_000;
const DAY_BOUNDARY_OFFSET = -3 * 3600;
const SUB_LOAN_AUTO_ID_START = 10_000_000n;
const TOKEN_DECIMALS = 6n;
const INITIAL_BALANCE = 1_000_000n * 10n ** TOKEN_DECIMALS;
const REMUNERATORY_RATE = INTEREST_RATE_FACTOR / 100; // 1%
const MORATORY_RATE = INTEREST_RATE_FACTOR / 50; // 2%
const LATE_FEE_RATE = INTEREST_RATE_FACTOR / 20; // 5%
const GRACE_DISCOUNT_RATE = INTEREST_RATE_FACTOR / 2; // 50%
const MASK_UINT8 = maxUintForBits(8);
const MASK_UINT16 = maxUintForBits(16);
const MASK_UINT32 = maxUintForBits(32);
const MASK_UINT64 = maxUintForBits(64);
const TIMESTAMP_SPECIAL_VALUE_TRACKED = 1n;
const VIEW_FLAGS_DEFAULT = 0n;
// const ACCOUNT_ID_BORROWER = maxUintForBits(16);

const MARKET_DEPLOYMENT_OPTIONS: DeployProxyOptions = { kind: "uups", unsafeAllow: ["delegatecall"] };

const OWNER_ROLE = ethers.id("OWNER_ROLE");
const GRANTOR_ROLE = ethers.id("GRANTOR_ROLE");
const ADMIN_ROLE = ethers.id("ADMIN_ROLE");
const PAUSER_ROLE = ethers.id("PAUSER_ROLE");

// Events of the library contracts and mock contracts
const EVENT_NAME_MOCK_LOAN_CLOSED = "MockLoanClosed";
const EVENT_NAME_MOCK_LOAN_OPENED = "MockLoanOpened";
const EVENT_NAME_MOCK_LIQUIDITY_IN = "MockLiquidityIn";
const EVENT_NAME_MOCK_LIQUIDITY_OUT = "MockLiquidityOut";

// Events of the contracts under test
const EVENT_NAME_PROGRAM_OPENED = "ProgramOpened";
const EVENT_NAME_PROGRAM_CLOSED = "ProgramClosed";
const EVENT_NAME_LOAN_TAKEN = "LoanTaken";
const EVENT_NAME_LOAN_REVOKED = "LoanRevoked";
const EVENT_NAME_SUB_LOAN_TAKEN = "SubLoanTaken";
const EVENT_NAME_SUB_LOAN_UPDATED = "SubLoanUpdated";
const EVENT_NAME_OPERATION_APPLIED = "OperationApplied";
const EVENT_NAME_OPERATION_PENDED = "OperationPended";
const EVENT_NAME_OPERATION_REVOKED = "OperationRevoked";
const EVENT_NAME_OPERATION_DISMISSED = "OperationDismissed";

// Errors of the library contracts
const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";
const ERROR_NAME_ENFORCED_PAUSED = "EnforcedPause";
const ERROR_NAME_INVALID_INITIALIZATION = "InvalidInitialization";

// Errors of the contracts under test
const ERROR_NAME_BLOCK_TIMESTAMP_EXCESS = "LendingMarketV2_BlockTimestampExcess";
const ERROR_NAME_BORROWER_ADDRESS_ZERO = "LendingMarketV2_BorrowerAddressZero";
const ERROR_NAME_CREDIT_LINE_ADDRESS_INVALID = "LendingMarketV2_CreditLineAddressInvalid";
const ERROR_NAME_CREDIT_LINE_ADDRESS_ZERO = "LendingMarketV2_CreditLineAddressZero";
const ERROR_NAME_ENGINE_ADDRESS_ZERO = "LendingMarketV2_EngineAddressZero";
const ERROR_NAME_UNAUTHORIZED_CALL_CONTEXT = "LendingMarketV2_UnauthorizedCallContext";
const ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID = "LendingMarketV2_ImplementationAddressInvalid";
const ERROR_NAME_LIQUIDITY_POOL_ADDRESS_INVALID = "LendingMarketV2_LiquidityPoolAddressInvalid";
const ERROR_NAME_LIQUIDITY_POOL_ADDRESS_ZERO = "LendingMarketV2_LiquidityPoolAddressZero";
const ERROR_NAME_LOAN_BORROWED_AMOUNT_INVALID = "LendingMarketV2_LoanBorrowedAmountInvalid";
const ERROR_NAME_LOAN_DURATIONS_INVALID = "LendingMarketV2_LoanDurationsInvalid";
const ERROR_NAME_OPERATION_APPLYING_TIMESTAMP_TOO_EARLY = "LendingMarketV2_OperationApplyingTimestampTooEarly";
const ERROR_NAME_OPERATION_DISMISSED_ALREADY = "LendingMarketV2_OperationDismissedAlready";
const ERROR_NAME_OPERATION_KIND_INVALID = "LendingMarketV2_OperationKindInvalid";
const ERROR_NAME_OPERATION_KIND_UNACCEPTABLE = "LendingMarketV2_OperationKindUnacceptable";
const ERROR_NAME_OPERATION_NONEXISTENT = "LendingMarketV2_OperationNonexistent";
const ERROR_NAME_OPERATION_REVOKED_ALREADY = "LendingMarketV2_OperationRevokedAlready";
const ERROR_NAME_OPERATION_TIMESTAMP_EXCESS = "LendingMarketV2_OperationTimestampExcess";
const ERROR_NAME_OPERATION_TIMESTAMP_TOO_EARLY = "LendingMarketV2_OperationTimestampTooEarly";
const ERROR_NAME_OPERATION_REQUEST_COUNT_ZERO = "LendingMarketV2_OperationRequestCountZero";
const ERROR_NAME_PROGRAM_STATUS_INCOMPATIBLE = "LendingMarketV2_ProgramStatusIncompatible";
const ERROR_NAME_SUB_LOAN_BORROWED_AMOUNT_INVALID = "LendingMarketV2_SubLoanBorrowedAmountInvalid";
const ERROR_NAME_SUB_LOAN_COUNT_ZERO = "LendingMarketV2_SubLoanCountZero";
const ERROR_NAME_SUB_LOAN_DURATION_EXCESS = "LendingMarketV2_SubLoanDurationExcess";
const ERROR_NAME_SUB_LOAN_EXISTENT_ALREADY = "LendingMarketV2_SubLoanExistentAlready";
const ERROR_NAME_SUB_LOAN_NONEXISTENT = "LendingMarketV2_SubLoanNonexistent";
const ERROR_NAME_SUB_LOAN_REVOKED = "LendingMarketV2_SubLoanRevoked";
const ERROR_NAME_SUB_LOAN_RATE_VALUE_INVALID = "LendingMarketV2_SubLoanRateValueInvalid";
const ERROR_NAME_SUB_LOAN_START_TIMESTAMP_INVALID = "LendingMarketV2_SubLoanStartTimestampInvalid";
const ERROR_NAME_UNDERLYING_TOKEN_ADDRESS_ZERO = "LendingMarketV2_UnderlyingTokenAddressZero";

// Errors of the mock contracts
const ERROR_NAME_CREDIT_LINE_ON_AFTER_LOAN_CLOSED_REVERTED = "CreditLineV2Mock_onAfterLoanClosedReverted";
const ERROR_NAME_CREDIT_LINE_ON_BEFORE_LOAN_OPENED_REVERTED = "CreditLineV2Mock_OnBeforeLoanOpenedReverted";
const ERROR_NAME_LIQUIDITY_POOL_ON_BEFORE_LIQUIDITY_IN_REVERTED = "LiquidityPoolMock_OnBeforeLiquidityInReverted";
const ERROR_NAME_LIQUIDITY_POOL_ON_BEFORE_LIQUIDITY_OUT_REVERTED = "LiquidityPoolMock_OnBeforeLiquidityOutReverted";

const EXPECTED_VERSION = {
  major: 2,
  minor: 0,
  patch: 0,
};

const defaultOperationRequest: OperationRequest = {
  subLoanId: 0n,
  kind: OperationKind.Revocation,
  timestamp: 0,
  value: 0n,
  account: ADDRESS_ZERO,
};

let lendingMarketFactory: Contracts.LendingMarketV2Testable__factory;
let lendingEngineFactory: Contracts.LendingEngineV2__factory;
let tokenMockFactory: Contracts.ERC20TokenMock__factory;
let CreditLineV2MockFactory: Contracts.CreditLineV2Mock__factory;
let liquidityPoolMockFactory: Contracts.LiquidityPoolMock__factory;

let deployer: HardhatEthersSigner;
let pauser: HardhatEthersSigner;
let addonTreasury: HardhatEthersSigner;
let admin: HardhatEthersSigner;
let borrower: HardhatEthersSigner;
let repayer: HardhatEthersSigner;
let counterparty: HardhatEthersSigner;
let stranger: HardhatEthersSigner;

async function deployCreditLineV2Mock(): Promise<Contracts.CreditLineV2Mock> {
  const CreditLineV2MockDeployment = await CreditLineV2MockFactory.deploy();
  await CreditLineV2MockDeployment.waitForDeployment();
  return CreditLineV2MockDeployment.connect(deployer);
}

async function deployLiquidityPoolMock(): Promise<Contracts.LiquidityPoolMock> {
  const liquidityPoolMockDeployment = await liquidityPoolMockFactory.deploy();
  await liquidityPoolMockDeployment.waitForDeployment();
  return liquidityPoolMockDeployment.connect(deployer);
}

async function deployContracts(): Promise<Fixture> {
  const tokenMockDeployment = (await tokenMockFactory.deploy());
  await tokenMockDeployment.waitForDeployment();
  const tokenMock = tokenMockDeployment.connect(deployer);

  const lendingEngineDeployment = await upgrades.deployProxy(
    lendingEngineFactory,
    [],
    { kind: "uups" },
  );
  await lendingEngineDeployment.waitForDeployment();
  const engine = lendingEngineDeployment.connect(deployer);

  const lendingMarketDeployment = await upgrades.deployProxy(
    lendingMarketFactory,
    [getAddress(tokenMock), getAddress(engine)],
    MARKET_DEPLOYMENT_OPTIONS,
  );
  await lendingMarketDeployment.waitForDeployment();
  const market = lendingMarketDeployment.connect(deployer);

  const CreditLineV2Mock = await deployCreditLineV2Mock();
  const liquidityPoolMock = await deployLiquidityPoolMock();

  return { market, engine, tokenMock, CreditLineV2Mock, liquidityPoolMock, programId: 0 };
}

async function configureLendingMarket(market: Contracts.LendingMarketV2Testable) {
  await proveTx(market.grantRole(GRANTOR_ROLE, deployer.address));
  await proveTx(market.grantRole(ADMIN_ROLE, admin.address));
  await proveTx(market.grantRole(PAUSER_ROLE, pauser.address));
}

async function deployAndConfigureContracts(): Promise<Fixture> {
  const fixture = await deployContracts();
  await configureLendingMarket(fixture.market);
  return fixture;
}

async function configureLoanTaking(fixture: Fixture) {
  const { market, tokenMock, CreditLineV2Mock, liquidityPoolMock } = fixture;
  await proveTx(market.openProgram(CreditLineV2Mock, liquidityPoolMock));
  fixture.programId = Number(await market.programCounter());
  await proveTx(liquidityPoolMock.setAddonTreasury(addonTreasury.address));
  await proveTx(tokenMock.mint(getAddress(liquidityPoolMock), INITIAL_BALANCE));
  await proveTx(tokenMock.mint(borrower.address, INITIAL_BALANCE));
  await proveTx(tokenMock.mint(repayer.address, INITIAL_BALANCE));
  await proveTx(tokenMock.mint(counterparty.address, INITIAL_BALANCE));
  await proveTx(tokenMock.mint(stranger.address, INITIAL_BALANCE));
  await proveTx(liquidityPoolMock.approveToken(getAddress(tokenMock), getAddress(market), ethers.MaxUint256));

  // For possible revocation and repayments
  await proveTx(tokenMock.connect(borrower).approve(getAddress(market), ethers.MaxUint256));
  await proveTx(tokenMock.connect(repayer).approve(getAddress(market), ethers.MaxUint256));
  await proveTx(tokenMock.connect(addonTreasury).approve(getAddress(market), ethers.MaxUint256));
}

async function deployAndConfigureContractsForLoanTaking(): Promise<Fixture> {
  const fixture = await deployAndConfigureContracts();
  await configureLoanTaking(fixture);
  return fixture;
}

function packAmountParts(part1: bigint, part2: bigint, part3: bigint, part4: bigint): bigint {
  return (
    (part1 & MASK_UINT64) +
    ((part2 & MASK_UINT64) << 64n) +
    ((part3 & MASK_UINT64) << 128n) +
    ((part4 & MASK_UINT64) << 192n)
  );
}

function packRates(subLoan: SubLoan): bigint {
  return packAmountParts(
    BigInt(subLoan.state.remuneratoryRate),
    BigInt(subLoan.state.moratoryRate),
    BigInt(subLoan.state.lateFeeRate),
    BigInt(subLoan.state.graceDiscountRate),
  );
}

function packSubLoanParameters(subLoan: SubLoan): bigint {
  return (
    ((BigInt(subLoan.state.status) & MASK_UINT8) << 0n) +
    ((0n & MASK_UINT8) << 8n) +
    ((BigInt(subLoan.state.duration) & MASK_UINT16) << 16n) +
    ((BigInt(subLoan.state.remuneratoryRate) & MASK_UINT32) << 32n) +
    ((BigInt(subLoan.state.moratoryRate) & MASK_UINT32) << 64n) +
    ((BigInt(subLoan.state.lateFeeRate) & MASK_UINT32) << 96n) +
    ((BigInt(subLoan.state.graceDiscountRate) & MASK_UINT32) << 128n) +
    ((BigInt(subLoan.state.trackedTimestamp) & MASK_UINT32) << 160n) +
    ((BigInt(subLoan.state.freezeTimestamp) & MASK_UINT32) << 192n) +
    ((BigInt(subLoan.metadata.pendingTimestamp ?? 0) & MASK_UINT32) << 224n)
  );
}

function packSubLoanRepaidParts(subLoan: SubLoan): bigint {
  return packAmountParts(
    subLoan.state.repaidPrincipal,
    subLoan.state.repaidRemuneratoryInterest,
    subLoan.state.repaidMoratoryInterest,
    subLoan.state.repaidLateFee,
  );
}

function packSubLoanDiscountParts(subLoan: SubLoan): bigint {
  return packAmountParts(
    subLoan.state.discountPrincipal,
    subLoan.state.discountRemuneratoryInterest,
    subLoan.state.discountMoratoryInterest,
    subLoan.state.discountLateFee,
  );
}

function packSubLoanTrackedParts(subLoan: SubLoan): bigint {
  return packAmountParts(
    subLoan.state.trackedPrincipal,
    subLoan.state.trackedRemuneratoryInterest,
    subLoan.state.trackedMoratoryInterest,
    subLoan.state.trackedLateFee,
  );
}

function toBytes32(value: bigint): string {
  return ethers.toBeHex(value, 32);
}

function defineInitialSubLoan(
  firstSubLoanId: bigint,
  loanTakingRequest: LoanTakingRequest,
  subLoanTakingRequests: SubLoanTakingRequest[],
  subLoanIndex: number,
  startTimestamp: number,
): SubLoan {
  const id = firstSubLoanId + BigInt(subLoanIndex);
  const subLoanTakingRequest = subLoanTakingRequests[subLoanIndex];
  const inception: SubLoanInception = {
    borrowedAmount: subLoanTakingRequest.borrowedAmount,
    addonAmount: subLoanTakingRequest.addonAmount,
    initialRemuneratoryRate: subLoanTakingRequest.remuneratoryRate,
    initialMoratoryRate: subLoanTakingRequest.moratoryRate,
    initialLateFeeRate: subLoanTakingRequest.lateFeeRate,
    initialGraceDiscountRate: subLoanTakingRequest.graceDiscountRate,

    initialDuration: subLoanTakingRequest.duration,
    startTimestamp: startTimestamp,
    programId: loanTakingRequest.programId,
    borrower: loanTakingRequest.borrower,
  };
  const metadata: SubLoanMetadata = {
    subLoanIndex: subLoanIndex,
    subLoanCount: subLoanTakingRequests.length,
    updateIndex: 0,
    pendingTimestamp: 0,
    operationCount: 0,
    earliestOperationId: 0,
    recentOperationId: 0,
    latestOperationId: 0,
  };
  const state: SubLoanState = {
    status: SubLoanStatus.Ongoing,
    gracePeriodStatus: subLoanTakingRequest.graceDiscountRate > 0 ? GracePeriodStatus.Active : GracePeriodStatus.None,
    duration: subLoanTakingRequest.duration,
    freezeTimestamp: 0,
    trackedTimestamp: startTimestamp,
    remuneratoryRate: inception.initialRemuneratoryRate,
    moratoryRate: inception.initialMoratoryRate,
    lateFeeRate: inception.initialLateFeeRate,
    graceDiscountRate: inception.initialGraceDiscountRate,

    trackedPrincipal: inception.borrowedAmount + inception.addonAmount,
    trackedRemuneratoryInterest: 0n,
    trackedMoratoryInterest: 0n,
    trackedLateFee: 0n,

    repaidPrincipal: 0n,
    repaidRemuneratoryInterest: 0n,
    repaidMoratoryInterest: 0n,
    repaidLateFee: 0n,

    discountPrincipal: 0n,
    discountRemuneratoryInterest: 0n,
    discountMoratoryInterest: 0n,
    discountLateFee: 0n,
  };

  return { id, indexInLoan: subLoanIndex, inception, metadata, state };
}

function defineInitialLoan(
  loanTakingRequest: LoanTakingRequest,
  subLoanTakingRequests: SubLoanTakingRequest[],
  txTimestamp: number,
  firstSubLoanId: bigint,
): Loan {
  const loan: Loan = { subLoans: [], totalBorrowedAmount: 0n, totalAddonAmount: 0n };
  const startTimestamp = loanTakingRequest.startTimestamp === 0
    ? txTimestamp
    : loanTakingRequest.startTimestamp;
  for (let i = 0; i < subLoanTakingRequests.length; ++i) {
    loan.subLoans.push(
      defineInitialSubLoan(firstSubLoanId, loanTakingRequest, subLoanTakingRequests, i, startTimestamp),
    );
  }
  loan.totalBorrowedAmount = loan.subLoans.reduce(
    (sum, subLoan) => sum + subLoan.inception.borrowedAmount,
    0n,
  );
  loan.totalAddonAmount = loan.subLoans.reduce(
    (sum, subLoan) => sum + subLoan.inception.addonAmount,
    0n,
  );
  return loan;
}

function calculateOutstandingBalance(subLoan: SubLoan): bigint {
  return (
    roundToAccuracyFactor(subLoan.state.trackedPrincipal) +
    roundToAccuracyFactor(subLoan.state.trackedRemuneratoryInterest) +
    roundToAccuracyFactor(subLoan.state.trackedMoratoryInterest) +
    roundToAccuracyFactor(subLoan.state.trackedLateFee)
  );
}

function defineExpectedSubLoanPreview(subLoan: SubLoan): SubLoanPreview {
  const firstSubLoanId = subLoan.id - BigInt(subLoan.metadata.subLoanIndex);
  const outstandingBalance = calculateOutstandingBalance(subLoan);

  return {
    day: dayIndex(subLoan.state.trackedTimestamp),
    id: subLoan.id,
    firstSubLoanId,
    subLoanCount: subLoan.metadata.subLoanCount,
    operationCount: subLoan.metadata.operationCount,
    earliestOperationId: subLoan.metadata.earliestOperationId,
    recentOperationId: subLoan.metadata.recentOperationId,
    latestOperationId: subLoan.metadata.latestOperationId,
    status: subLoan.state.status,
    gracePeriodStatus: subLoan.state.gracePeriodStatus,
    programId: subLoan.inception.programId,
    borrower: subLoan.inception.borrower,
    borrowedAmount: subLoan.inception.borrowedAmount,
    addonAmount: subLoan.inception.addonAmount,
    startTimestamp: subLoan.inception.startTimestamp,
    freezeTimestamp: subLoan.state.freezeTimestamp,
    trackedTimestamp: subLoan.state.trackedTimestamp,
    pendingTimestamp: subLoan.metadata.pendingTimestamp,
    duration: subLoan.state.duration,
    remuneratoryRate: subLoan.state.remuneratoryRate,
    moratoryRate: subLoan.state.moratoryRate,
    lateFeeRate: subLoan.state.lateFeeRate,
    graceDiscountRate: subLoan.state.graceDiscountRate,
    trackedPrincipal: subLoan.state.trackedPrincipal,
    trackedRemuneratoryInterest: subLoan.state.trackedRemuneratoryInterest,
    trackedMoratoryInterest: subLoan.state.trackedMoratoryInterest,
    trackedLateFee: subLoan.state.trackedLateFee,
    outstandingBalance,
    repaidPrincipal: subLoan.state.repaidPrincipal,
    repaidRemuneratoryInterest: subLoan.state.repaidRemuneratoryInterest,
    repaidMoratoryInterest: subLoan.state.repaidMoratoryInterest,
    repaidLateFee: subLoan.state.repaidLateFee,
    discountPrincipal: subLoan.state.discountPrincipal,
    discountRemuneratoryInterest: subLoan.state.discountRemuneratoryInterest,
    discountMoratoryInterest: subLoan.state.discountMoratoryInterest,
    discountLateFee: subLoan.state.discountLateFee,
  };
}

function defineExpectedLoanPreview(loan: Loan): LoanPreview {
  const firstSubLoan = loan.subLoans[0];
  const firstSubLoanId = firstSubLoan.id - BigInt(firstSubLoan.metadata.subLoanIndex);
  const subLoanCount = firstSubLoan.metadata.subLoanCount;
  const subLoanPreviews = loan.subLoans.map(defineExpectedSubLoanPreview);

  let ongoingSubLoanCount = 0;
  let repaidSubLoanCount = 0;
  let revokedSubLoanCount = 0;

  let totalBorrowedAmount = 0n;
  let totalAddonAmount = 0n;
  let totalTrackedPrincipal = 0n;
  let totalTrackedRemuneratoryInterest = 0n;
  let totalTrackedMoratoryInterest = 0n;
  let totalTrackedLateFee = 0n;
  let totalOutstandingBalance = 0n;
  let totalRepaidPrincipal = 0n;
  let totalRepaidRemuneratoryInterest = 0n;
  let totalRepaidMoratoryInterest = 0n;
  let totalRepaidLateFee = 0n;
  let totalDiscountPrincipal = 0n;
  let totalDiscountRemuneratoryInterest = 0n;
  let totalDiscountMoratoryInterest = 0n;
  let totalDiscountLateFee = 0n;

  for (const preview of subLoanPreviews) {
    if (preview.status === SubLoanStatus.Ongoing) {
      ongoingSubLoanCount += 1;
    } else if (preview.status === SubLoanStatus.Repaid) {
      repaidSubLoanCount += 1;
    } else if (preview.status === SubLoanStatus.Revoked) {
      revokedSubLoanCount += 1;
    }

    totalBorrowedAmount += preview.borrowedAmount;
    totalAddonAmount += preview.addonAmount;
    totalTrackedPrincipal += preview.trackedPrincipal;
    totalTrackedRemuneratoryInterest += preview.trackedRemuneratoryInterest;
    totalTrackedMoratoryInterest += preview.trackedMoratoryInterest;
    totalTrackedLateFee += preview.trackedLateFee;
    totalOutstandingBalance += preview.outstandingBalance;
    totalRepaidPrincipal += preview.repaidPrincipal;
    totalRepaidRemuneratoryInterest += preview.repaidRemuneratoryInterest;
    totalRepaidMoratoryInterest += preview.repaidMoratoryInterest;
    totalRepaidLateFee += preview.repaidLateFee;
    totalDiscountPrincipal += preview.discountPrincipal;
    totalDiscountRemuneratoryInterest += preview.discountRemuneratoryInterest;
    totalDiscountMoratoryInterest += preview.discountMoratoryInterest;
    totalDiscountLateFee += preview.discountLateFee;
  }

  const lastPreview = subLoanPreviews[subLoanPreviews.length - 1];

  return {
    day: lastPreview.day,
    firstSubLoanId,
    subLoanCount,
    ongoingSubLoanCount,
    repaidSubLoanCount,
    revokedSubLoanCount,
    programId: lastPreview.programId,
    borrower: lastPreview.borrower,
    totalBorrowedAmount,
    totalAddonAmount,
    totalTrackedPrincipal,
    totalTrackedRemuneratoryInterest,
    totalTrackedMoratoryInterest,
    totalTrackedLateFee,
    totalOutstandingBalance,
    totalRepaidPrincipal,
    totalRepaidRemuneratoryInterest,
    totalRepaidMoratoryInterest,
    totalRepaidLateFee,
    totalDiscountPrincipal,
    totalDiscountRemuneratoryInterest,
    totalDiscountMoratoryInterest,
    totalDiscountLateFee,
  };
}

async function checkSubLoanInContract(
  market: Contracts.LendingMarketV2Testable,
  expectedSubLoan: SubLoan,
) {
  const subLoanId = expectedSubLoan.id;
  const inception = await market.getSubLoanInception(subLoanId);
  const metadata = await market.getSubLoanMetadata(subLoanId);
  const state = await market.getSubLoanState(subLoanId);
  const preview = await market.getSubLoanPreview(subLoanId, TIMESTAMP_SPECIAL_VALUE_TRACKED, VIEW_FLAGS_DEFAULT);
  checkEquality(resultToObject(inception), expectedSubLoan.inception, expectedSubLoan.indexInLoan);
  checkEquality(resultToObject(metadata), expectedSubLoan.metadata, expectedSubLoan.indexInLoan);
  checkEquality(resultToObject(state), expectedSubLoan.state, expectedSubLoan.indexInLoan);
  checkEquality(
    resultToObject(preview),
    defineExpectedSubLoanPreview(expectedSubLoan),
    expectedSubLoan.indexInLoan,
  );
}

async function checkLoanInContract(market: Contracts.LendingMarketV2Testable, expectedLoan: Loan) {
  const subLoanCount = expectedLoan.subLoans.length;
  for (let i = 0; i < subLoanCount; ++i) {
    await checkSubLoanInContract(market, expectedLoan.subLoans[i]);
  }

  const firstSubLoan = expectedLoan.subLoans[0];
  const loanPreview = await market.getLoanPreview(firstSubLoan.id, TIMESTAMP_SPECIAL_VALUE_TRACKED, VIEW_FLAGS_DEFAULT);
  checkEquality(resultToObject(loanPreview), defineExpectedLoanPreview(expectedLoan));
}

function applySubLoanRevocation(subLoan: SubLoan, txTimestamp: number) {
  ++subLoan.metadata.updateIndex;
  ++subLoan.metadata.operationCount;
  ++subLoan.metadata.earliestOperationId;
  ++subLoan.metadata.recentOperationId;
  ++subLoan.metadata.latestOperationId;

  subLoan.state.status = SubLoanStatus.Revoked;
  subLoan.state.trackedPrincipal = 0n;
  subLoan.state.trackedRemuneratoryInterest = 0n;
  subLoan.state.trackedMoratoryInterest = 0n;
  subLoan.state.trackedLateFee = 0n;
  subLoan.state.trackedTimestamp = txTimestamp;
}

// TODO: Rewrite this function using the operation logic
function applyLoanRevocation(loan: Loan, txTimestamp: number) {
  for (const subLoan of loan.subLoans) {
    applySubLoanRevocation(subLoan, txTimestamp);
  }
}

function createTypicalLoanTakingRequest(fixture: Fixture): LoanTakingRequest {
  return {
    borrower: borrower.address,
    programId: fixture.programId,
    startTimestamp: 0,
  };
}

function createTypicalSubLoanTakingRequests(subLoanCount: number): SubLoanTakingRequest[] {
  const onePercentRate = INTEREST_RATE_FACTOR / 100;
  return Array.from(
    { length: subLoanCount },
    (_, i) => ({
      borrowedAmount: 1000n * BigInt(i + 1) * 10n ** TOKEN_DECIMALS,
      addonAmount: 100n * BigInt(i + 1) * 10n ** TOKEN_DECIMALS,
      duration: 30 * (i + 1),
      remuneratoryRate: REMUNERATORY_RATE + onePercentRate * (i + 1),
      moratoryRate: MORATORY_RATE + onePercentRate * (i + 1),
      lateFeeRate: LATE_FEE_RATE + onePercentRate * (i + 1),
      graceDiscountRate: GRACE_DISCOUNT_RATE + onePercentRate * (i + 1),
    }),
  );
}

async function takeTypicalLoan(
  fixture: Fixture,
  props: { subLoanCount?: number; zeroAddonAmount?: boolean } = {},
): Promise<Loan> {
  const { subLoanCount = 3, zeroAddonAmount = false } = props;
  const loanTakingRequest = createTypicalLoanTakingRequest(fixture);
  loanTakingRequest.startTimestamp = await getBlockTimestamp("latest") - 3 * 24 * 3600; // 3 days ago
  const subLoanRequests = createTypicalSubLoanTakingRequests(subLoanCount);
  if (zeroAddonAmount) {
    for (const subLoanRequest of subLoanRequests) {
      subLoanRequest.addonAmount = 0n;
    }
  }
  const firstSubLoanId = await fixture.market.connect(admin).takeLoan.staticCall(loanTakingRequest, subLoanRequests);
  const takingTx = fixture.market.connect(admin).takeLoan(loanTakingRequest, subLoanRequests);
  const takingTxTimestamp = await getTxTimestamp(takingTx);
  return defineInitialLoan(loanTakingRequest, subLoanRequests, takingTxTimestamp, firstSubLoanId);
}

function createOperation(operationRequest: OperationRequest, operationId: number, txTimestamp: number): Operation {
  return {
    subLoanId: operationRequest.subLoanId,
    id: operationId,
    status: OperationStatus.Nonexistent,
    kind: operationRequest.kind,
    nextOperationId: 0,
    prevOperationId: 0,
    timestamp: operationRequest.timestamp === 0 ? txTimestamp : operationRequest.timestamp,
    value: operationRequest.value,
    account: operationRequest.account,
  };
}

function orderOperations(operations: Operation[]): Operation[] {
  const orderedOperations = [...operations].sort((a, b) => {
    if (a.timestamp === b.timestamp) {
      return a.id - b.id;
    }
    return a.timestamp - b.timestamp;
  });
  for (let i = 0; i < orderedOperations.length; ++i) {
    if (i < orderedOperations.length - 1) {
      orderedOperations[i].nextOperationId = orderedOperations[i + 1].id;
    } else {
      orderedOperations[i].nextOperationId = 0;
    }
    if (i > 0) {
      orderedOperations[i].prevOperationId = orderedOperations[i - 1].id;
    } else {
      orderedOperations[i].prevOperationId = 0;
    }
  }
  return orderedOperations;
}

function getOperationView(operation: Operation): OperationView {
  return {
    status: operation.status,
    kind: operation.kind,
    nextOperationId: operation.nextOperationId,
    prevOperationId: operation.prevOperationId,
    timestamp: operation.timestamp,
    value: operation.value,
    account: operation.account,
  };
}

function dayIndex(timestamp: number): number {
  return Math.floor((timestamp - 3 * 3600) / 86400);
}

function accrueRemuneratoryInterest(subLoan: SubLoan, timestamp: number) {
  const oldTrackedBalance = subLoan.state.trackedPrincipal + subLoan.state.trackedRemuneratoryInterest;
  let interestRate = subLoan.state.remuneratoryRate;
  if (subLoan.state.gracePeriodStatus === GracePeriodStatus.Active) {
    interestRate = interestRate * (INTEREST_RATE_FACTOR - subLoan.state.graceDiscountRate) / INTEREST_RATE_FACTOR;
  }
  const days = dayIndex(timestamp) - dayIndex(subLoan.state.trackedTimestamp);
  const newTrackedBalance = BigInt(
    Math.round(Number(oldTrackedBalance) * ((1 + interestRate / INTEREST_RATE_FACTOR) ** days)),
  );
  subLoan.state.trackedRemuneratoryInterest += newTrackedBalance - oldTrackedBalance;
}

function roundToAccuracyFactor(amount: bigint) {
  return ((amount + ACCURACY_FACTOR / 2n) / ACCURACY_FACTOR) * ACCURACY_FACTOR;
}

function registerSingleOperationInMetadata(subLoan: SubLoan, operationId: number) {
  ++subLoan.metadata.updateIndex;
  ++subLoan.metadata.operationCount;
  // TODO: improve this logic
  subLoan.metadata.earliestOperationId = operationId;
  subLoan.metadata.recentOperationId = operationId;
  subLoan.metadata.latestOperationId = operationId;
}

function applySubLoanRepayment(subLoan: SubLoan, timestamp: number, amount: bigint, operationId: number) {
  accrueRemuneratoryInterest(subLoan, timestamp);
  const roundedRemuneratoryInterest = roundToAccuracyFactor(subLoan.state.trackedRemuneratoryInterest);
  if (roundedRemuneratoryInterest > amount) {
    subLoan.state.trackedRemuneratoryInterest -= amount;
    subLoan.state.repaidRemuneratoryInterest += amount;
    amount = 0n;
  } else {
    subLoan.state.trackedRemuneratoryInterest = 0n;
    subLoan.state.repaidRemuneratoryInterest += roundedRemuneratoryInterest;
    amount -= roundedRemuneratoryInterest;
  }

  if (subLoan.state.trackedPrincipal >= amount) {
    subLoan.state.trackedPrincipal -= amount;
    subLoan.state.repaidPrincipal += amount;
  } else {
    throw new Error(
      `The remaining repayment amount is greater than the tracked principal of the sub-loan.` +
      `Sub-loan ID: ${subLoan.id}. Amount: ${amount}. Tracked principal: ${subLoan.state.trackedPrincipal}`,
    );
  }

  subLoan.state.trackedTimestamp = timestamp;

  registerSingleOperationInMetadata(subLoan, operationId);
}

function applySubLoanDiscount(subLoan: SubLoan, timestamp: number, amount: bigint, operationId: number) {
  accrueRemuneratoryInterest(subLoan, timestamp);
  const roundedRemuneratoryInterest = roundToAccuracyFactor(subLoan.state.trackedRemuneratoryInterest);
  if (roundedRemuneratoryInterest > amount) {
    subLoan.state.trackedRemuneratoryInterest -= amount;
    subLoan.state.discountRemuneratoryInterest += amount;
    amount = 0n;
  } else {
    subLoan.state.trackedRemuneratoryInterest = 0n;
    subLoan.state.discountRemuneratoryInterest += roundedRemuneratoryInterest;
    amount -= roundedRemuneratoryInterest;
  }

  if (subLoan.state.trackedPrincipal >= amount) {
    subLoan.state.trackedPrincipal -= amount;
    subLoan.state.discountPrincipal += amount;
  } else {
    throw new Error(
      `The remaining discount amount is greater than the tracked principal of the sub-loan.` +
      `Sub-loan ID: ${subLoan.id}. Amount: ${amount}. Tracked principal: ${subLoan.state.trackedPrincipal}`,
    );
  }

  subLoan.state.trackedTimestamp = timestamp;

  registerSingleOperationInMetadata(subLoan, operationId);
}

function applySubLoanDurationSetting(subLoan: SubLoan, timestamp: number, value: bigint, operationId: number) {
  accrueRemuneratoryInterest(subLoan, timestamp);

  subLoan.state.duration = Number(value);
  subLoan.state.trackedTimestamp = timestamp;

  registerSingleOperationInMetadata(subLoan, operationId);
}

function applySubLoanFreezing(subLoan: SubLoan, timestamp: number, operationId: number) {
  accrueRemuneratoryInterest(subLoan, timestamp);

  subLoan.state.freezeTimestamp = timestamp;
  subLoan.state.trackedTimestamp = timestamp;

  registerSingleOperationInMetadata(subLoan, operationId);
}

function applySubLoanRemuneratoryRateSetting(
  subLoan: SubLoan,
  timestamp: number,
  value: bigint,
  operationId: number,
) {
  accrueRemuneratoryInterest(subLoan, timestamp);

  subLoan.state.remuneratoryRate = Number(value);
  subLoan.state.trackedTimestamp = timestamp;

  registerSingleOperationInMetadata(subLoan, operationId);
}

function applySubLoanMoratoryRateSetting(
  subLoan: SubLoan,
  timestamp: number,
  value: bigint,
  operationId: number,
) {
  accrueRemuneratoryInterest(subLoan, timestamp);

  subLoan.state.moratoryRate = Number(value);
  subLoan.state.trackedTimestamp = timestamp;

  registerSingleOperationInMetadata(subLoan, operationId);
}

function applySubLoanLateFeeRateSetting(
  subLoan: SubLoan,
  timestamp: number,
  value: bigint,
  operationId: number,
) {
  accrueRemuneratoryInterest(subLoan, timestamp);

  subLoan.state.lateFeeRate = Number(value);
  subLoan.state.trackedTimestamp = timestamp;

  registerSingleOperationInMetadata(subLoan, operationId);
}

function applySubLoanGraceDiscountRateSetting(
  subLoan: SubLoan,
  timestamp: number,
  value: bigint,
  operationId: number,
) {
  accrueRemuneratoryInterest(subLoan, timestamp);

  subLoan.state.graceDiscountRate = Number(value);
  subLoan.state.trackedTimestamp = timestamp;

  registerSingleOperationInMetadata(subLoan, operationId);
}

function voidSubLoanSingleRepaymentOperation(subLoan: SubLoan) {
  subLoan.state.repaidPrincipal = 0n;
  subLoan.state.repaidRemuneratoryInterest = 0n;
  subLoan.state.repaidMoratoryInterest = 0n;
  subLoan.state.repaidLateFee = 0n;

  subLoan.state.trackedTimestamp = subLoan.inception.startTimestamp;
  subLoan.state.trackedPrincipal = subLoan.inception.borrowedAmount + subLoan.inception.addonAmount;
  subLoan.state.trackedRemuneratoryInterest = 0n;
  subLoan.state.trackedMoratoryInterest = 0n;
  subLoan.state.trackedLateFee = 0n;

  ++subLoan.metadata.updateIndex;
}

describe("Contract 'LendingMarket'", () => {
  // TODO: Shift the blockchain timestamp to the start of a Brazilian day to avoid day borders
  before(async () => {
    [deployer, addonTreasury, pauser, admin, borrower, repayer, counterparty, stranger] = await ethers.getSigners();

    lendingMarketFactory = (await ethers.getContractFactory("LendingMarketV2Testable")).connect(deployer);
    lendingEngineFactory = (await ethers.getContractFactory("LendingEngineV2")).connect(deployer);
    tokenMockFactory = (await ethers.getContractFactory("ERC20TokenMock")).connect(deployer);
    CreditLineV2MockFactory = (await ethers.getContractFactory("CreditLineV2Mock")).connect(deployer);
    liquidityPoolMockFactory = (await ethers.getContractFactory("LiquidityPoolMock")).connect(deployer);
  });

  describe("Function 'initialize()'", () => {
    let market: Contracts.LendingMarketV2Testable;
    let engine: Contracts.LendingEngineV2;
    let tokenMock: Contracts.ERC20TokenMock;

    beforeEach(async () => {
      ({ market, engine, tokenMock } = await setUpFixture(deployContracts));
    });

    describe("Executes as expected when called properly and", () => {
      it("exposes correct role hashes", async () => {
        expect(await market.OWNER_ROLE()).to.equal(OWNER_ROLE);
        expect(await market.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
        expect(await market.ADMIN_ROLE()).to.equal(ADMIN_ROLE);
        expect(await market.PAUSER_ROLE()).to.equal(PAUSER_ROLE);
      });

      it("sets correct role admins", async () => {
        expect(await market.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
        expect(await market.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
        expect(await market.getRoleAdmin(ADMIN_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await market.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
      });

      it("sets correct roles for the deployer", async () => {
        expect(await market.hasRole(OWNER_ROLE, deployer)).to.equal(true);
        expect(await market.hasRole(GRANTOR_ROLE, deployer)).to.equal(false);
        expect(await market.hasRole(ADMIN_ROLE, deployer)).to.equal(false);
        expect(await market.hasRole(PAUSER_ROLE, deployer)).to.equal(false);
      });

      it("does not pause the contract", async () => {
        expect(await market.paused()).to.equal(false);
      });

      it("sets correct underlying token address", async () => {
        expect(await market.underlyingToken()).to.equal(tokenMock);
      });

      it("sets correct engine address", async () => {
        expect(await market.engine()).to.equal(engine);
      });

      it("provides correct constants and initial storage variables", async () => {
        expect(await market.interestRateFactor()).to.equal(INTEREST_RATE_FACTOR);
        expect(await market.accuracyFactor()).to.equal(ACCURACY_FACTOR);
        expect(await market.subLoanCountMax()).to.equal(SUB_LOAN_COUNT_MAX);
        expect(await market.operationCountMax()).to.equal(OPERATION_COUNT_MAX);
        expect(await market.dayBoundaryOffset()).to.equal(DAY_BOUNDARY_OFFSET);
        expect(await market.subLoanAutoIdStart()).to.equal(SUB_LOAN_AUTO_ID_START);
        expect(await market.subLoanCounter()).to.equal(0);
        expect(await market.programCounter()).to.equal(0);
        expect(await market.getAccountAddressBookRecordCount()).to.equal(0);
      });
    });

    describe("Is reverted if", () => {
      it("called a second time", async () => {
        await expect(market.initialize(engine, tokenMock))
          .to.be.revertedWithCustomError(market, ERROR_NAME_INVALID_INITIALIZATION);
      });

      it("the provided token address is zero", async () => {
        const wrongTokenAddress = (ADDRESS_ZERO);
        await expect(
          upgrades.deployProxy(
            lendingMarketFactory,
            [wrongTokenAddress, getAddress(engine)],
            MARKET_DEPLOYMENT_OPTIONS,
          ),
        ).to.be.revertedWithCustomError(market, ERROR_NAME_UNDERLYING_TOKEN_ADDRESS_ZERO);
      });

      it("the provided engine address is zero", async () => {
        const wrongEngineAddress = (ADDRESS_ZERO);
        await expect(
          upgrades.deployProxy(
            lendingMarketFactory,
            [getAddress(tokenMock), wrongEngineAddress],
            MARKET_DEPLOYMENT_OPTIONS,
          ),
        ).to.be.revertedWithCustomError(market, ERROR_NAME_ENGINE_ADDRESS_ZERO);
      });
    });
  });

  describe("Function '$__VERSION()'", () => {
    it("returns the expected version", async () => {
      const { market } = await setUpFixture(deployContracts);
      expect(await market.$__VERSION()).to.deep.equal([
        EXPECTED_VERSION.major,
        EXPECTED_VERSION.minor,
        EXPECTED_VERSION.patch,
      ]);
    });
  });

  describe("Function 'upgradeToAndCall()'", () => {
    it("executes as expected", async () => {
      const { market } = await setUpFixture(deployContracts);
      await checkContractUupsUpgrading(market, lendingMarketFactory);
    });

    it("is reverted if the caller does not have the owner role", async () => {
      const { market } = await setUpFixture(deployContracts);

      await expect(market.connect(admin).upgradeToAndCall(market, "0x"))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(admin.address, OWNER_ROLE);
      await expect(market.connect(stranger).upgradeToAndCall(market, "0x"))
        .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(stranger.address, OWNER_ROLE);
    });

    it("is reverted if the provided implementation address is not a lending market V2 contract", async () => {
      const { market } = await setUpFixture(deployContracts);
      const mockContractFactory = await ethers.getContractFactory("UUPSExtUpgradeableMock");
      const mockContract = await mockContractFactory.deploy();
      await mockContract.waitForDeployment();

      await expect(market.upgradeToAndCall(mockContract, "0x"))
        .to.be.revertedWithCustomError(market, ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID);
    });
  });

  describe("Function 'openProgram()'", () => {
    let market: Contracts.LendingMarketV2Testable;
    let CreditLineV2Mock: Contracts.CreditLineV2Mock;
    let liquidityPoolMock: Contracts.LiquidityPoolMock;

    beforeEach(async () => {
      ({ market, CreditLineV2Mock, liquidityPoolMock } = await setUpFixture(deployAndConfigureContracts));
    });

    describe("Executes as expected in a typical case when called properly for the first time and", () => {
      let tx: Promise<ContractTransactionResponse>;

      // TODO: Consider replacement with `before()` here an in similar places
      beforeEach(async () => {
        tx = market.openProgram(CreditLineV2Mock, liquidityPoolMock);
        await proveTx(tx);
      });

      it("opens a program with the correct parameters", async () => {
        const program = await market.getProgram(1);
        expect(program.status).to.equal(LendingProgramStatus.Active);
        expect(program.creditLine).to.equal(getAddress(CreditLineV2Mock));
        expect(program.liquidityPool).to.equal(getAddress(liquidityPoolMock));
      });

      it("emits the expected event", async () => {
        await expect(tx)
          .to.emit(market, EVENT_NAME_PROGRAM_OPENED)
          .withArgs(1, getAddress(CreditLineV2Mock), getAddress(liquidityPoolMock));
      });

      it("increments the program counter", async () => {
        expect(await market.programCounter()).to.equal(1);
      });
    });

    describe("Executes as expected when", () => {
      async function checkProgramOpening(
        props: {
          programId: number;
          tx: Promise<ContractTransactionResponse>;
          creditLineAddress: string;
          liquidityPoolAddress: string;
        },
      ) {
        const { programId, tx, creditLineAddress, liquidityPoolAddress } = props;
        const program = await market.getProgram(programId);
        expect(program.status).to.equal(LendingProgramStatus.Active);
        expect(program.creditLine).to.equal(creditLineAddress);
        expect(program.liquidityPool).to.equal(liquidityPoolAddress);

        await expect(tx)
          .to.emit(market, EVENT_NAME_PROGRAM_OPENED)
          .withArgs(programId, creditLineAddress, liquidityPoolAddress);
      }

      it("called several times for different credit lines and liquidity pools", async () => {
        const CreditLineV2Mock2 = await deployCreditLineV2Mock();
        const liquidityPoolMock2 = await deployLiquidityPoolMock();
        const pairs: { creditLine: Contracts.CreditLineV2Mock; liquidityPool: Contracts.LiquidityPoolMock }[] = [
          { creditLine: CreditLineV2Mock, liquidityPool: liquidityPoolMock },
          { creditLine: CreditLineV2Mock, liquidityPool: liquidityPoolMock }, // Two times the same pair
          { creditLine: CreditLineV2Mock2, liquidityPool: liquidityPoolMock2 },
          { creditLine: CreditLineV2Mock, liquidityPool: liquidityPoolMock2 },
          { creditLine: CreditLineV2Mock2, liquidityPool: liquidityPoolMock },
        ];

        for (let i = 0; i < pairs.length; ++i) {
          const programId = i + 1;
          const { creditLine, liquidityPool } = pairs[i];
          const tx = market.openProgram(creditLine, liquidityPool);
          const creditLineAddress = getAddress(creditLine);
          const liquidityPoolAddress = getAddress(liquidityPool);
          await proveTx(tx);
          expect(await market.programCounter()).to.equal(programId);
          await checkProgramOpening({ programId, tx, creditLineAddress, liquidityPoolAddress });
        }
      });
    });

    describe("Is reverted if", () => {
      it("the caller does not have the owner role", async () => {
        await expect(market.connect(admin).openProgram(CreditLineV2Mock, liquidityPoolMock))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(admin.address, OWNER_ROLE);
        await expect(market.connect(stranger).openProgram(CreditLineV2Mock, liquidityPoolMock))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, OWNER_ROLE);
      });

      it("the contract is paused", async () => {
        await proveTx(market.connect(pauser).pause());
        await expect(market.openProgram(CreditLineV2Mock, liquidityPoolMock))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("the credit line address is zero", async () => {
        const wrongCreditLineAddress = (ADDRESS_ZERO);

        await expect(market.openProgram(wrongCreditLineAddress, liquidityPoolMock))
          .to.be.revertedWithCustomError(market, ERROR_NAME_CREDIT_LINE_ADDRESS_ZERO);
      });

      it("the credit line address is not a contract", async () => {
        const wrongCreditLineAddress = stranger.address;

        await expect(market.openProgram(wrongCreditLineAddress, liquidityPoolMock))
          .to.be.revertedWithCustomError(market, ERROR_NAME_CREDIT_LINE_ADDRESS_INVALID);
      });

      it("the credit line address does not implement the expected proof function", async () => {
        const wrongCreditLine = (liquidityPoolMock);

        await expect(market.openProgram(wrongCreditLine, liquidityPoolMock))
          .to.be.revertedWithCustomError(market, ERROR_NAME_CREDIT_LINE_ADDRESS_INVALID);
      });

      it("the liquidity pool address is zero", async () => {
        const wrongLiquidityPoolAddress = (ADDRESS_ZERO);

        await expect(market.openProgram(CreditLineV2Mock, wrongLiquidityPoolAddress))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LIQUIDITY_POOL_ADDRESS_ZERO);
      });

      it("the liquidity pool address is not a contract", async () => {
        const wrongLiquidityPoolAddress = stranger.address;

        await expect(market.openProgram(CreditLineV2Mock, wrongLiquidityPoolAddress))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LIQUIDITY_POOL_ADDRESS_INVALID);
      });

      it("the liquidity pool address does not implement the expected proof function", async () => {
        const wrongLiquidityPool = (CreditLineV2Mock);

        await expect(market.openProgram(CreditLineV2Mock, wrongLiquidityPool))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LIQUIDITY_POOL_ADDRESS_INVALID);
      });
    });
  });

  describe("Function 'closeProgram()'", () => {
    let market: Contracts.LendingMarketV2Testable;
    let CreditLineV2Mock: Contracts.CreditLineV2Mock;
    let liquidityPoolMock: Contracts.LiquidityPoolMock;

    beforeEach(async () => {
      ({ market, CreditLineV2Mock, liquidityPoolMock } = await setUpFixture(deployAndConfigureContracts));
    });

    describe("Executes as expected in a typical case when called properly for the first time and", () => {
      let tx: Promise<ContractTransactionResponse>;
      beforeEach(async () => {
        await proveTx(market.openProgram(CreditLineV2Mock, liquidityPoolMock));
        tx = market.closeProgram(1);
        await proveTx(tx);
      });

      it("closes a program with the correct parameters", async () => {
        const program = await market.getProgram(1);
        expect(program.status).to.equal(LendingProgramStatus.Closed);
        expect(program.creditLine).to.equal(getAddress(CreditLineV2Mock));
        expect(program.liquidityPool).to.equal(getAddress(liquidityPoolMock));
      });

      it("emits the expected event", async () => {
        await expect(tx)
          .to.emit(market, EVENT_NAME_PROGRAM_CLOSED)
          .withArgs(1);
      });

      it("does not change the program counter", async () => {
        expect(await market.programCounter()).to.equal(1);
      });
    });

    describe("Executes as expected when", () => {
      async function checkProgramClosing(
        props: {
          programId: number;
          tx: Promise<ContractTransactionResponse>;
          // TODO: Consider replacing with Addressable. The same for checkProgramOpening
          creditLineAddress: string;
          liquidityPoolAddress: string;
        },
      ) {
        const { programId, tx, creditLineAddress, liquidityPoolAddress } = props;
        const program = await market.getProgram(programId);
        expect(program.status).to.equal(LendingProgramStatus.Closed);
        expect(program.creditLine).to.equal(creditLineAddress);
        expect(program.liquidityPool).to.equal(liquidityPoolAddress);

        await expect(tx)
          .to.emit(market, EVENT_NAME_PROGRAM_CLOSED)
          .withArgs(programId);
      }

      it("called several times for different programs", async () => {
        const CreditLineV2Mock2 = await deployCreditLineV2Mock();
        const liquidityPoolMock2 = await deployLiquidityPoolMock();
        const pairs: { creditLine: Contracts.CreditLineV2Mock; liquidityPool: Contracts.LiquidityPoolMock }[] = [
          { creditLine: CreditLineV2Mock, liquidityPool: liquidityPoolMock },
          { creditLine: CreditLineV2Mock2, liquidityPool: liquidityPoolMock2 },
          { creditLine: CreditLineV2Mock, liquidityPool: liquidityPoolMock2 },
        ];

        // Open all programs first
        for (const { creditLine, liquidityPool } of pairs) {
          await proveTx(market.openProgram(creditLine, liquidityPool));
        }

        // Close all programs
        for (let i = pairs.length - 1; i >= 0; --i) {
          const programId = i + 1;
          const { creditLine, liquidityPool } = pairs[i];
          const creditLineAddress = getAddress(creditLine);
          const liquidityPoolAddress = getAddress(liquidityPool);
          const tx = market.closeProgram(programId);
          await proveTx(tx);
          await checkProgramClosing({ programId, tx, creditLineAddress, liquidityPoolAddress });
        }
      });
    });

    describe("Is reverted if", () => {
      it("the caller does not have the owner role", async () => {
        await expect(market.connect(admin).closeProgram(1))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(admin.address, OWNER_ROLE);
        await expect(market.connect(stranger).closeProgram(1))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, OWNER_ROLE);
      });

      it("the contract is paused", async () => {
        await proveTx(market.connect(pauser).pause());
        await expect(market.closeProgram(1))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("the program does not exist", async () => {
        await expect(market.closeProgram(1))
          .to.be.revertedWithCustomError(market, ERROR_NAME_PROGRAM_STATUS_INCOMPATIBLE)
          .withArgs(LendingProgramStatus.Nonexistent);
      });

      it("the program is already closed", async () => {
        await proveTx(market.openProgram(CreditLineV2Mock, liquidityPoolMock));
        await proveTx(market.closeProgram(1));

        await expect(market.closeProgram(1))
          .to.be.revertedWithCustomError(market, ERROR_NAME_PROGRAM_STATUS_INCOMPATIBLE)
          .withArgs(LendingProgramStatus.Closed);
      });
    });
  });

  describe("Function 'takeLoan()'", () => {
    const firstSubLoanId = (SUB_LOAN_AUTO_ID_START);

    let market: Contracts.LendingMarketV2Testable;
    let tokenMock: Contracts.ERC20TokenMock;
    let CreditLineV2Mock: Contracts.CreditLineV2Mock;
    let liquidityPoolMock: Contracts.LiquidityPoolMock;
    let programId: number;

    let loanTakingRequest: LoanTakingRequest;
    let subLoanTakingRequests: SubLoanTakingRequest[];

    beforeEach(async () => {
      const fixture = await setUpFixture(deployAndConfigureContractsForLoanTaking);
      ({ market, tokenMock, CreditLineV2Mock, liquidityPoolMock, programId } = fixture);

      loanTakingRequest = createTypicalLoanTakingRequest(fixture);
      subLoanTakingRequests = createTypicalSubLoanTakingRequests(3);
    });

    describe("Executes as expected when called properly with typical parameters for a loan of 3 sub-loans and", () => {
      let tx: Promise<ContractTransactionResponse>;
      let txTimestamp: number;
      let loan: Loan;

      beforeEach(async () => {
        tx = market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests);
        txTimestamp = await getTxTimestamp(tx);
        loan = defineInitialLoan(loanTakingRequest, subLoanTakingRequests, txTimestamp, firstSubLoanId);
      });

      it("creates a loan and sub-loans with the correct parameters", async () => {
        const expectedLoan = defineInitialLoan(loanTakingRequest, subLoanTakingRequests, txTimestamp, firstSubLoanId);
        await checkLoanInContract(market, expectedLoan);
      });

      it("emits the expected events", async () => {
        const numberOfSubLoanEvents = await getNumberOfEvents(tx, market, EVENT_NAME_SUB_LOAN_TAKEN);
        const numberOfLoanEvents = await getNumberOfEvents(tx, market, EVENT_NAME_LOAN_TAKEN);

        expect(numberOfSubLoanEvents).to.equal(subLoanTakingRequests.length);
        expect(numberOfLoanEvents).to.equal(1);

        for (const subLoan of loan.subLoans) {
          await expect(tx)
            .to.emit(market, EVENT_NAME_SUB_LOAN_TAKEN)
            .withArgs(
              subLoan.id,
              subLoan.inception.borrowedAmount,
              subLoan.inception.addonAmount,
              subLoan.inception.startTimestamp,
              subLoan.state.duration,
              toBytes32(packRates(subLoan)),
            );
        }

        await expect(tx)
          .to.emit(market, EVENT_NAME_LOAN_TAKEN)
          .withArgs(
            loan.subLoans[0].id,
            loan.subLoans[0].inception.borrower,
            programId,
            loan.totalBorrowedAmount,
            loan.totalAddonAmount,
            subLoanTakingRequests.length,
            getAddress(CreditLineV2Mock),
            getAddress(liquidityPoolMock),
          );
      });

      it("changes the sub-loan auto ID counter as expected", async () => {
        expect(await market.subLoanAutoIdCounter()).to.equal(subLoanTakingRequests.length);
      });

      it("transfers tokens as expected", async () => {
        expect(tx).to.changeTokenBalances(
          tokenMock,
          [market, liquidityPoolMock, borrower, addonTreasury],
          [0, loan.totalBorrowedAmount + loan.totalBorrowedAmount, loan.totalBorrowedAmount, loan.totalAddonAmount],
        );
        await checkTokenPath(tx, tokenMock, [liquidityPoolMock, market, borrower], loan.totalBorrowedAmount);
        await checkTokenPath(tx, tokenMock, [liquidityPoolMock, market, addonTreasury], loan.totalAddonAmount);
      });

      it("calls the expected credit line function properly", async () => {
        expect(await getNumberOfEvents(tx, CreditLineV2Mock, EVENT_NAME_MOCK_LOAN_OPENED)).to.equal(1);

        // TODO: Check it happen before the token transfers
        await expect(tx)
          .to.emit(CreditLineV2Mock, EVENT_NAME_MOCK_LOAN_OPENED)
          .withArgs(
            loan.subLoans[0].id,
            loan.subLoans[0].inception.borrower,
            loan.totalBorrowedAmount,
          );
      });

      it("calls the expected liquidity pool function properly", async () => {
        expect(await getNumberOfEvents(tx, liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT)).to.equal(2);
        // TODO: Check it happen before the token transfers
        await expect(tx)
          .to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT)
          .withArgs(loan.totalBorrowedAmount);
        await expect(tx)
          .to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT)
          .withArgs(loan.totalAddonAmount);
      });
    });

    describe("Executes as expected when", () => {
      async function checkNewlyTakenLoan(
        tx: Promise<ContractTransactionResponse>,
        loanTakingRequest: LoanTakingRequest,
        subLoanTakingRequests: SubLoanTakingRequest[],
      ) {
        const txTimestamp = await getTxTimestamp(tx);
        const expectedLoan = defineInitialLoan(loanTakingRequest, subLoanTakingRequests, txTimestamp, firstSubLoanId);
        await checkLoanInContract(market, expectedLoan);
      }

      it("the start timestamp is in the past for a loan with 3 sub-loans", async () => {
        const latestBlockTimestamp = await getBlockTimestamp("latest");
        loanTakingRequest.startTimestamp = latestBlockTimestamp - 1000;
        const tx = market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests);
        await checkNewlyTakenLoan(tx, loanTakingRequest, subLoanTakingRequests);
      });

      it("the duration is for the first sub-loan in a loan with 3 sub-loans", async () => {
        subLoanTakingRequests[0].duration = 0;
        const tx = market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests);
        await checkNewlyTakenLoan(tx, loanTakingRequest, subLoanTakingRequests);
      });

      it("the duration is zero for the first sub-loan in a loan with 1 sub-loan", async () => {
        subLoanTakingRequests[0].duration = 0;
        const subLoanRequests = [subLoanTakingRequests[0]];
        const tx = market.connect(admin).takeLoan(loanTakingRequest, subLoanRequests);
        await checkNewlyTakenLoan(tx, loanTakingRequest, subLoanRequests);
      });

      it("the addon amount is zero for the second sub-loan in a loan with 3 sub-loans", async () => {
        subLoanTakingRequests[1].addonAmount = 0n;
        const tx = market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests);
        await checkNewlyTakenLoan(tx, loanTakingRequest, subLoanTakingRequests);
        const totalBorrowedAmount = subLoanTakingRequests.reduce(
          (sum, req) => sum + req.borrowedAmount,
          0n,
        );
        const totalAddonAmount = subLoanTakingRequests.reduce(
          (sum, req) => sum + req.addonAmount,
          0n,
        );
        expect(tx).to.changeTokenBalances(
          tokenMock,
          [market, liquidityPoolMock, borrower, addonTreasury],
          [0, totalBorrowedAmount + totalAddonAmount, totalBorrowedAmount, totalAddonAmount],
        );
      });

      it("the addon amount is zero for all sub-loans in a loan with 3 sub-loans", async () => {
        for (const subLoanTakingRequest of subLoanTakingRequests) {
          subLoanTakingRequest.addonAmount = 0n;
        }
        const tx = market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests);
        await checkNewlyTakenLoan(tx, loanTakingRequest, subLoanTakingRequests);
        const totalBorrowedAmount = subLoanTakingRequests.reduce(
          (sum, req) => sum + req.borrowedAmount,
          0n,
        );
        expect(tx).to.changeTokenBalances(
          tokenMock,
          [market, liquidityPoolMock, borrower, addonTreasury],
          [0, totalBorrowedAmount, totalBorrowedAmount, 0],
        );
      });

      it("the grace discount rate is zero for the second sub-loan in a loan with 3 sub-loans", async () => {
        subLoanTakingRequests[1].graceDiscountRate = 0;
        const tx = market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests);
        await checkNewlyTakenLoan(tx, loanTakingRequest, subLoanTakingRequests);
      });

      it("the grace discount rate is zero for all sub-loans in a loan with 3 sub-loans", async () => {
        for (const subLoanTakingRequest of subLoanTakingRequests) {
          subLoanTakingRequest.graceDiscountRate = 0;
        }
        const tx = market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests);
        await checkNewlyTakenLoan(tx, loanTakingRequest, subLoanTakingRequests);
      });
    });

    describe("Is reverted if", () => {
      it("the caller does not have the admin role", async () => {
        await expect(market.connect(deployer).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(deployer.address, ADMIN_ROLE);
        await expect(market.connect(stranger).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, ADMIN_ROLE);
      });

      it("the contract is paused", async () => {
        await proveTx(market.connect(pauser).pause());

        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("the block timestamp is greater than the maximum allowed value", async () => {
        await increaseBlockTimestampTo(Number(maxUintForBits(32)) + 1);

        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_BLOCK_TIMESTAMP_EXCESS);
      });

      it("the sub-loan array is empty", async () => {
        await expect(market.connect(admin).takeLoan(loanTakingRequest, []))
          .to.be.revertedWithCustomError(market, ERROR_NAME_SUB_LOAN_COUNT_ZERO);
      });

      it("the borrower address is zero", async () => {
        loanTakingRequest.borrower = (ADDRESS_ZERO);
        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_BORROWER_ADDRESS_ZERO);
      });

      it("the start timestamp is in the future", async () => {
        const latestBlockTimestamp = await getBlockTimestamp("latest");
        loanTakingRequest.startTimestamp = latestBlockTimestamp + 10000;

        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_SUB_LOAN_START_TIMESTAMP_INVALID);
      });

      it("the start timestamp is 1 (reserved special value)", async () => {
        loanTakingRequest.startTimestamp = 1;

        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_SUB_LOAN_START_TIMESTAMP_INVALID);
      });

      it("the total borrowed amount is zero", async () => {
        for (const subLoanTakingRequest of subLoanTakingRequests) {
          subLoanTakingRequest.borrowedAmount = 0n;
        }

        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_BORROWED_AMOUNT_INVALID);
      });

      it("one of the sub-loans has the zero borrowed amount", async () => {
        subLoanTakingRequests[1].borrowedAmount = 0n;
        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_SUB_LOAN_BORROWED_AMOUNT_INVALID);
      });

      it("one of the sub-loans has the duration greater than the maximum allowed value", async () => {
        subLoanTakingRequests[1].duration = Number(maxUintForBits(16)) + 1;
        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_SUB_LOAN_DURATION_EXCESS);
      });

      it("one of the sub-loans has the remuneratoryRate greater than the maximum allowed value", async () => {
        subLoanTakingRequests[1].remuneratoryRate = INTEREST_RATE_FACTOR + 1;
        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_SUB_LOAN_RATE_VALUE_INVALID);
      });

      it("one of the sub-loans has the moratoryRate greater than the maximum allowed value", async () => {
        subLoanTakingRequests[1].moratoryRate = INTEREST_RATE_FACTOR + 1;
        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_SUB_LOAN_RATE_VALUE_INVALID);
      });

      it("one of the sub-loans has the lateFeeRate greater than the maximum allowed value", async () => {
        subLoanTakingRequests[1].lateFeeRate = INTEREST_RATE_FACTOR + 1;
        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_SUB_LOAN_RATE_VALUE_INVALID);
      });

      it("one of the sub-loans has the graceDiscountRate greater than the maximum allowed value", async () => {
        subLoanTakingRequests[1].graceDiscountRate = INTEREST_RATE_FACTOR + 1;
        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_SUB_LOAN_RATE_VALUE_INVALID);
      });

      it("the sub-loan durations are not in ascending order", async () => {
        subLoanTakingRequests[subLoanTakingRequests.length - 1].duration = subLoanTakingRequests[0].duration;

        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_LOAN_DURATIONS_INVALID);
      });

      it("one of the sub-loans has the status 'Ongoing'", async () => {
        const subLoanId = firstSubLoanId + BigInt(subLoanTakingRequests.length - 1);
        await proveTx(market.mockSubLoanStatus(subLoanId, SubLoanStatus.Ongoing));

        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_SUB_LOAN_EXISTENT_ALREADY);
      });

      it("one of the sub-loans has the status 'Revoked'", async () => {
        const subLoanId = firstSubLoanId + BigInt(subLoanTakingRequests.length - 1);
        await proveTx(market.mockSubLoanStatus(subLoanId, SubLoanStatus.Revoked));

        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_SUB_LOAN_EXISTENT_ALREADY);
      });

      it("the credit line hook call is reverted", async () => {
        await proveTx(CreditLineV2Mock.setRevertOnBeforeLoanOpened(true));

        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(CreditLineV2Mock, ERROR_NAME_CREDIT_LINE_ON_BEFORE_LOAN_OPENED_REVERTED);
      });

      it("the liquidity pool hook call is reverted", async () => {
        await proveTx(liquidityPoolMock.setRevertOnBeforeLiquidityOut(true));

        await expect(market.connect(admin).takeLoan(loanTakingRequest, subLoanTakingRequests))
          .to.be.revertedWithCustomError(liquidityPoolMock, ERROR_NAME_LIQUIDITY_POOL_ON_BEFORE_LIQUIDITY_OUT_REVERTED);
      });
    });
  });

  describe("Function 'revokeLoan()'", () => {
    let fixture: Fixture;
    let market: Contracts.LendingMarketV2Testable;
    let tokenMock: Contracts.ERC20TokenMock;
    let CreditLineV2Mock: Contracts.CreditLineV2Mock;
    let liquidityPoolMock: Contracts.LiquidityPoolMock;

    beforeEach(async () => {
      fixture = await setUpFixture(deployAndConfigureContractsForLoanTaking);
      ({ market, tokenMock, CreditLineV2Mock, liquidityPoolMock } = fixture);
    });

    describe("Executes as expected when called properly for a loan of 3 sub-loans just after it is taken and", () => {
      let loan: Loan;
      let tx: Promise<ContractTransactionResponse>;
      let txTimestamp: number;

      beforeEach(async () => {
        loan = await takeTypicalLoan(fixture, { subLoanCount: 3, zeroAddonAmount: false });
        tx = market.connect(admin).revokeLoan(loan.subLoans[0].id);
        txTimestamp = await getTxTimestamp(tx);
      });

      it("revokes all sub-loans with the correct status", async () => {
        applyLoanRevocation(loan, txTimestamp);
        await checkLoanInContract(market, loan);
      });

      it("registers the expected operations", async () => {
        const operationId = 1;

        for (const subLoan of loan.subLoans) {
          const actualOperationIds = await market.getSubLoanOperationIds(subLoan.id);
          expect(actualOperationIds).to.deep.equal([operationId]);

          const operationRequest: OperationRequest = {
            ...defaultOperationRequest,
            subLoanId: subLoan.id,
            kind: OperationKind.Revocation,
          };

          const expectedOperation = createOperation(operationRequest, operationId, txTimestamp);
          expectedOperation.status = OperationStatus.Applied;

          const actualOperationView = await market.getSubLoanOperation(subLoan.id, operationId);
          checkEquality(resultToObject(actualOperationView), getOperationView(expectedOperation));
        }
      });

      it("emits the expected events", async () => {
        expect(await getNumberOfEvents(tx, market, EVENT_NAME_LOAN_REVOKED)).to.equal(1);
        expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_APPLIED)).to.equal(loan.subLoans.length);
        expect(await getNumberOfEvents(tx, market, EVENT_NAME_SUB_LOAN_UPDATED)).to.equal(loan.subLoans.length);

        for (const subLoan of loan.subLoans) {
          const expectedOperationId = 1;

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_APPLIED)
            .withArgs(
              subLoan.id,
              expectedOperationId,
              OperationKind.Revocation,
              txTimestamp,
              0, // value
              ADDRESS_ZERO, // account
            );

          const updateIndex = subLoan.metadata.updateIndex;
          applySubLoanRevocation(subLoan, txTimestamp);

          await expect(tx)
            .to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED)
            .withArgs(
              subLoan.id,
              updateIndex,
              toBytes32(packSubLoanParameters(subLoan)),
              toBytes32(packSubLoanRepaidParts(subLoan)),
              toBytes32(packSubLoanDiscountParts(subLoan)),
              toBytes32(packSubLoanTrackedParts(subLoan)), // storedPackedTrackedParts
              toBytes32(packSubLoanTrackedParts(subLoan)), // currentPackedTrackedParts
            );
        }

        await expect(tx)
          .to.emit(market, EVENT_NAME_LOAN_REVOKED)
          .withArgs(
            loan.subLoans[0].id, // firstSubLoanId
            loan.subLoans.length, // subLoanCount
            loan.totalBorrowedAmount, // revokedBorrowedAmount (positive: borrower owes pool)
            loan.totalAddonAmount, // revokedAddonAmount
          );
      });

      it("transfers tokens as expected", async () => {
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [market, liquidityPoolMock, borrower, addonTreasury],
          [0, loan.totalBorrowedAmount + loan.totalAddonAmount, -loan.totalBorrowedAmount, -loan.totalAddonAmount],
        );
        await checkTokenPath(tx, tokenMock, [borrower, market, liquidityPoolMock], loan.totalBorrowedAmount);
        await checkTokenPath(tx, tokenMock, [addonTreasury, market, liquidityPoolMock], loan.totalAddonAmount);
      });

      it("calls the expected credit line function properly", async () => {
        expect(await getNumberOfEvents(tx, CreditLineV2Mock, EVENT_NAME_MOCK_LOAN_CLOSED)).to.equal(1);

        // TODO: Check it happen before the token transfers
        await expect(tx)
          .to.emit(CreditLineV2Mock, EVENT_NAME_MOCK_LOAN_CLOSED)
          .withArgs(
            loan.subLoans[0].id,
            loan.subLoans[0].inception.borrower,
            loan.totalBorrowedAmount,
          );
      });

      it("calls the expected liquidity pool function properly", async () => {
        expect(await getNumberOfEvents(tx, liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN)).to.equal(2);
        // TODO: Check it happen before the token transfers
        await expect(tx)
          .to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN)
          .withArgs(loan.totalBorrowedAmount);
        await expect(tx)
          .to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN)
          .withArgs(loan.totalAddonAmount);
      });
    });

    describe("Executes as expected when", () => {
      it("called for the second sub-loan ID within the loan", async () => {
        const loan = await takeTypicalLoan(fixture, { subLoanCount: 3, zeroAddonAmount: false });
        const subLoanId = loan.subLoans[1].id;
        const tx = market.connect(admin).revokeLoan(subLoanId);
        applyLoanRevocation(loan, await getTxTimestamp(tx));
        await checkLoanInContract(market, loan);
      });

      it("called for the last sub-loan ID within the loan", async () => {
        const loan = await takeTypicalLoan(fixture, { subLoanCount: 3, zeroAddonAmount: false });
        const subLoanId = loan.subLoans[loan.subLoans.length - 1].id;
        const tx = market.connect(admin).revokeLoan(subLoanId);
        applyLoanRevocation(loan, await getTxTimestamp(tx));
        await checkLoanInContract(market, loan);
      });

      it("called for a loan with a single sub-loan", async () => {
        const loan = await takeTypicalLoan(fixture, { subLoanCount: 1, zeroAddonAmount: false });
        const revocationTx = market.connect(admin).revokeLoan(loan.subLoans[0].id);
        applyLoanRevocation(loan, await getTxTimestamp(revocationTx));
        await checkLoanInContract(market, loan);
        // TODO: check the number of events emitted
      });

      it("called for a loan with the zero addon amount for all sub-loans", async () => {
        const loan = await takeTypicalLoan(fixture, { subLoanCount: 3, zeroAddonAmount: true });
        const revocationTx = market.connect(admin).revokeLoan(loan.subLoans[0].id);
        applyLoanRevocation(loan, await getTxTimestamp(revocationTx));
        await checkLoanInContract(market, loan);

        await expect(revocationTx).to.changeTokenBalances(
          tokenMock,
          [market, liquidityPoolMock, borrower, addonTreasury],
          [0, loan.totalBorrowedAmount, -loan.totalBorrowedAmount, 0],
        );
      });
    });

    describe("Is reverted if", () => {
      let loan: Loan;
      let firstSubLoanId: bigint;

      beforeEach(async () => {
        loan = await takeTypicalLoan(fixture, { subLoanCount: 3, zeroAddonAmount: false });
        firstSubLoanId = loan.subLoans[0].id;
      });

      it("the caller does not have the admin role", async () => {
        await expect(market.connect(deployer).revokeLoan(firstSubLoanId))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(deployer.address, ADMIN_ROLE);
        await expect(market.connect(stranger).revokeLoan(firstSubLoanId))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, ADMIN_ROLE);
      });

      it("the contract is paused", async () => {
        await proveTx(market.connect(pauser).pause());

        await expect(market.connect(admin).revokeLoan(firstSubLoanId))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("the block timestamp is greater than the maximum allowed value", async () => {
        await increaseBlockTimestampTo(Number(maxUintForBits(32)) + 1);

        await expect(market.connect(admin).revokeLoan(firstSubLoanId))
          .to.be.revertedWithCustomError(market, ERROR_NAME_BLOCK_TIMESTAMP_EXCESS);
      });

      it("the sub-loan does not exist", async () => {
        const nonexistentSubLoanId = firstSubLoanId + BigInt(loan.subLoans.length);

        await expect(market.connect(admin).revokeLoan(nonexistentSubLoanId))
          .to.be.revertedWithCustomError(market, ERROR_NAME_SUB_LOAN_NONEXISTENT);
      });

      it("the loan is already revoked", async () => {
        await proveTx(market.connect(admin).revokeLoan(firstSubLoanId));

        await expect(market.connect(admin).revokeLoan(firstSubLoanId))
          .to.be.revertedWithCustomError(market, ERROR_NAME_SUB_LOAN_REVOKED);
      });

      it("the credit line hook call is reverted", async () => {
        await proveTx(CreditLineV2Mock.setRevertOnAfterLoanClosed(true));

        await expect(market.connect(admin).revokeLoan(firstSubLoanId))
          .to.be.revertedWithCustomError(CreditLineV2Mock, ERROR_NAME_CREDIT_LINE_ON_AFTER_LOAN_CLOSED_REVERTED);
      });

      it("the liquidity pool hook call is reverted", async () => {
        await proveTx(liquidityPoolMock.setRevertOnBeforeLiquidityIn(true));

        await expect(market.connect(admin).revokeLoan(firstSubLoanId))
          .to.be.revertedWithCustomError(liquidityPoolMock, ERROR_NAME_LIQUIDITY_POOL_ON_BEFORE_LIQUIDITY_IN_REVERTED);
      });
    });
  });

  describe("Function 'submitOperationBatch()'", () => {
    let fixture: Fixture;
    let market: Contracts.LendingMarketV2Testable;
    let tokenMock: Contracts.ERC20TokenMock;
    let liquidityPoolMock: Contracts.LiquidityPoolMock;
    let loan: Loan;
    let subLoan: SubLoan;

    beforeEach(async () => {
      fixture = await setUpFixture(deployAndConfigureContractsForLoanTaking);
      ({ market, tokenMock, liquidityPoolMock } = fixture);
      loan = await takeTypicalLoan(fixture, { subLoanCount: 3, zeroAddonAmount: false });
      subLoan = loan.subLoans[1];
    });

    // TODO: Cover submission to different sub-loans at once

    describe("Executes as expected when called properly just after the sub-loan creation for", () => {
      async function prepareOperation(operationRequest: OperationRequest): Promise<{
        tx: Promise<ContractTransactionResponse>;
        txTimestamp: number;
        operation: Operation;
      }> {
        const currentBlockTimestamp = await getBlockTimestamp("latest");
        const tx = market.connect(admin).submitOperationBatch([operationRequest]);
        const txTimestamp = await getTxTimestamp(tx);

        const operationId = 1;
        const operation = createOperation(operationRequest, operationId, txTimestamp);

        if (operationRequest.timestamp == 0 || operationRequest.timestamp <= currentBlockTimestamp) {
          operation.status = OperationStatus.Applied;
        } else {
          operation.status = OperationStatus.Pending;
        }

        return { tx, txTimestamp, operation };
      }

      describe("A single repayment operation from the repayer at the current block, and does the following:", () => {
        let operation: Operation;
        let tx: Promise<ContractTransactionResponse>;
        let txTimestamp: number;

        beforeEach(async () => {
          const operationRequest: OperationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.Repayment,
            timestamp: 0,
            value: (subLoan.inception.borrowedAmount / 10n),
            account: repayer.address,
          };
          ({ tx, txTimestamp, operation } = await prepareOperation(operationRequest));
        });

        it("registers the expected operation", async () => {
          const actualOperationIds = await market.getSubLoanOperationIds(operation.subLoanId);
          expect(actualOperationIds).to.deep.equal([operation.id]);

          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("changes the sub-loan as expected", async () => {
          applySubLoanRepayment(subLoan, txTimestamp, operation.value, operation.id);
          await checkSubLoanInContract(market, subLoan);
        });

        it("registers a new address in the address book as expected", async () => {
          const accountId = (1);
          expect(await market.getAccountAddressBookRecordCount()).to.equal(1);
          expect(await market.getAccountInAddressBook(accountId)).to.equal(repayer.address);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_APPLIED)).to.equal(1);
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_SUB_LOAN_UPDATED)).to.equal(1);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_APPLIED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              repayer.address,
            );

          const updateIndex = subLoan.metadata.updateIndex;
          applySubLoanRepayment(subLoan, txTimestamp, operation.value, operation.id);

          await expect(tx)
            .to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED)
            .withArgs(
              subLoan.id,
              updateIndex,
              toBytes32(packSubLoanParameters(subLoan)),
              toBytes32(packSubLoanRepaidParts(subLoan)),
              toBytes32(packSubLoanDiscountParts(subLoan)),
              toBytes32(packSubLoanTrackedParts(subLoan)), // storedPackedTrackedParts
              toBytes32(packSubLoanTrackedParts(subLoan)), // currentPackedTrackedParts
            );
        });

        it("transfers tokens as expected", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, addonTreasury],
            [0, operation.value, 0, -operation.value, 0],
          );
          await checkTokenPath(tx, tokenMock, [repayer, market, liquidityPoolMock], operation.value);
        });

        it("calls the expected liquidity pool function properly", async () => {
          expect(await getNumberOfEvents(tx, liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN)).to.equal(1);
          // TODO: Check it happen before the token transfers
          await expect(tx)
            .to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN)
            .withArgs(operation.value);
        });

        // TODO: Check if needed that no credit line functions are called. Similarly in other places.
      });

      describe("A single repayment operation from the borrower in the past, and does the following:", () => {
        let operation: Operation;
        let tx: Promise<ContractTransactionResponse>;
        let txTimestamp: number;

        beforeEach(async () => {
          const operationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.Repayment,
            timestamp: subLoan.inception.startTimestamp + 24 * 3600, // One day after the sub-loan start
            value: (subLoan.inception.borrowedAmount / 10n),
            account: borrower.address,
          };
          ({ tx, txTimestamp, operation } = await prepareOperation(operationRequest));
        });

        it("registers the expected operation", async () => {
          const actualOperationIds = await market.getSubLoanOperationIds(operation.subLoanId);
          expect(actualOperationIds).to.deep.equal([operation.id]);

          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("does not register a new address in the address book", async () => {
          expect(await market.getAccountAddressBookRecordCount()).to.equal(0);
        });

        it("changes the sub-loan as expected", async () => {
          applySubLoanRepayment(
            subLoan,
            operation.timestamp,
            operation.value,
            operation.id,
          );
          await checkSubLoanInContract(market, subLoan);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_APPLIED)).to.equal(1);
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_SUB_LOAN_UPDATED)).to.equal(1);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_APPLIED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              borrower.address,
            );

          const updateIndex = subLoan.metadata.updateIndex;

          // Calculate the expected state at the operation timestamp
          applySubLoanRepayment(
            subLoan,
            operation.timestamp,
            operation.value,
            operation.id,
          );
          const storedPackedTrackedParts = packSubLoanTrackedParts(subLoan);

          // Calculate the expected state at the transaction timestamp
          accrueRemuneratoryInterest(subLoan, txTimestamp);

          await expect(tx)
            .to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED)
            .withArgs(
              subLoan.id,
              updateIndex,
              toBytes32(packSubLoanParameters(subLoan)),
              toBytes32(packSubLoanRepaidParts(subLoan)),
              toBytes32(packSubLoanDiscountParts(subLoan)),
              toBytes32(storedPackedTrackedParts),
              toBytes32(packSubLoanTrackedParts(subLoan)), // currentPackedTrackedParts
            );
        });

        it("transfers tokens as expected", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, addonTreasury],
            [0, operation.value, -operation.value, 0, 0],
          );
          await checkTokenPath(tx, tokenMock, [borrower, market, liquidityPoolMock], operation.value);
        });

        it("calls the expected liquidity pool function properly", async () => {
          expect(await getNumberOfEvents(tx, liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN)).to.equal(1);
          // TODO: Check it happen before the token transfers
          await expect(tx)
            .to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN)
            .withArgs(operation.value);
        });
      });

      describe("A single discount operation at the current block, and does the following:", () => {
        let operation: Operation;
        let tx: Promise<ContractTransactionResponse>;
        let txTimestamp: number;

        beforeEach(async () => {
          const operationRequest: OperationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.Discount,
            timestamp: 0,
            value: (subLoan.inception.borrowedAmount / 10n),
            account: ADDRESS_ZERO,
          };
          ({ tx, txTimestamp, operation } = await prepareOperation(operationRequest));
        });

        it("registers the expected operation", async () => {
          const actualOperationIds = await market.getSubLoanOperationIds(operation.subLoanId);
          expect(actualOperationIds).to.deep.equal([operation.id]);

          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("changes the sub-loan as expected", async () => {
          applySubLoanDiscount(subLoan, txTimestamp, operation.value, operation.id);
          await checkSubLoanInContract(market, subLoan);
        });

        it("does not register a new address in the address book", async () => {
          expect(await market.getAccountAddressBookRecordCount()).to.equal(0);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_APPLIED)).to.equal(1);
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_SUB_LOAN_UPDATED)).to.equal(1);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_APPLIED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              ADDRESS_ZERO,
            );

          const updateIndex = subLoan.metadata.updateIndex;
          applySubLoanDiscount(subLoan, txTimestamp, operation.value, operation.id);

          await expect(tx)
            .to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED)
            .withArgs(
              subLoan.id,
              updateIndex,
              toBytes32(packSubLoanParameters(subLoan)),
              toBytes32(packSubLoanRepaidParts(subLoan)),
              toBytes32(packSubLoanDiscountParts(subLoan)),
              toBytes32(packSubLoanTrackedParts(subLoan)), // storedPackedTrackedParts
              toBytes32(packSubLoanTrackedParts(subLoan)), // currentPackedTrackedParts
            );
        });

        it("does not transfer tokens", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, addonTreasury],
            [0, 0, 0, 0, 0],
          );
        });

        it("does not call the liquidity pool functions", async () => {
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN);
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT);
        });
      });

      describe("A single freezing operation at the current block, and does the following:", () => {
        let operation: Operation;
        let tx: Promise<ContractTransactionResponse>;
        let txTimestamp: number;

        beforeEach(async () => {
          const operationRequest: OperationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.Freezing,
            timestamp: 0,
            value: 0n,
            account: ADDRESS_ZERO,
          };
          ({ tx, txTimestamp, operation } = await prepareOperation(operationRequest));
        });

        it("registers the expected operation", async () => {
          const actualOperationIds = await market.getSubLoanOperationIds(operation.subLoanId);
          expect(actualOperationIds).to.deep.equal([operation.id]);

          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("changes the sub-loan as expected", async () => {
          applySubLoanFreezing(subLoan, txTimestamp, operation.id);
          await checkSubLoanInContract(market, subLoan);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_APPLIED)).to.equal(1);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_APPLIED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              operation.account,
            );

          const updateIndex = subLoan.metadata.updateIndex;
          applySubLoanFreezing(subLoan, txTimestamp, operation.id);

          await expect(tx)
            .to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED)
            .withArgs(
              subLoan.id,
              updateIndex,
              toBytes32(packSubLoanParameters(subLoan)),
              toBytes32(packSubLoanRepaidParts(subLoan)),
              toBytes32(packSubLoanDiscountParts(subLoan)),
              toBytes32(packSubLoanTrackedParts(subLoan)), // storedPackedTrackedParts
              toBytes32(packSubLoanTrackedParts(subLoan)), // currentPackedTrackedParts
            );
        });

        it("does not transfer tokens", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, addonTreasury],
            [0, 0, 0, 0, 0],
          );
        });

        it("does not call the liquidity pool functions", async () => {
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN);
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT);
        });
      });

      describe("A single freezing operation in the future, and does the following:", () => {
        let operation: Operation;
        let tx: Promise<ContractTransactionResponse>;

        beforeEach(async () => {
          const currentBlockTimestamp = await getBlockTimestamp("latest");
          const operationRequest: OperationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.Freezing,
            timestamp: currentBlockTimestamp + 24 * 3600, // Tomorrow
            value: 0n,
            account: ADDRESS_ZERO,
          };
          ({ tx, operation } = await prepareOperation(operationRequest));
        });

        it("registers the expected operation", async () => {
          const actualOperationIds = await market.getSubLoanOperationIds(operation.subLoanId);
          expect(actualOperationIds).to.deep.equal([operation.id]);

          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("changes the sub-loan as expected", async () => {
          subLoan.metadata.pendingTimestamp = operation.timestamp;
          subLoan.metadata.operationCount += 1;
          subLoan.metadata.earliestOperationId = operation.id;
          subLoan.metadata.latestOperationId = operation.id;

          await checkSubLoanInContract(market, subLoan);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_PENDED)).to.equal(1);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_PENDED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              operation.account,
            );

          await expect(tx).not.to.emit(market, EVENT_NAME_OPERATION_APPLIED);
          await expect(tx).not.to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED);
        });

        it("does not transfers tokens", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, addonTreasury],
            [0, 0, 0, 0, 0],
          );
        });

        it("does not call the liquidity pool functions", async () => {
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN);
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT);
        });
      });

      describe("A single remuneratory rate setting operation at the current block, and does the following:", () => {
        let operation: Operation;
        let tx: Promise<ContractTransactionResponse>;
        let txTimestamp: number;

        beforeEach(async () => {
          const operationRequest: OperationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.RemuneratoryRateSetting,
            timestamp: 0,
            value: BigInt(subLoan.state.remuneratoryRate + INTEREST_RATE_FACTOR / 100),
            account: ADDRESS_ZERO,
          };
          ({ tx, txTimestamp, operation } = await prepareOperation(operationRequest));
        });

        it("registers the expected operation", async () => {
          const actualOperationIds = await market.getSubLoanOperationIds(operation.subLoanId);
          expect(actualOperationIds).to.deep.equal([operation.id]);

          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("changes the sub-loan as expected", async () => {
          applySubLoanRemuneratoryRateSetting(subLoan, txTimestamp, operation.value, operation.id);
          await checkSubLoanInContract(market, subLoan);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_APPLIED)).to.equal(1);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_APPLIED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              operation.account,
            );

          const updateIndex = subLoan.metadata.updateIndex;
          applySubLoanRemuneratoryRateSetting(subLoan, txTimestamp, operation.value, operation.id);

          await expect(tx)
            .to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED)
            .withArgs(
              subLoan.id,
              updateIndex,
              toBytes32(packSubLoanParameters(subLoan)),
              toBytes32(packSubLoanRepaidParts(subLoan)),
              toBytes32(packSubLoanDiscountParts(subLoan)),
              toBytes32(packSubLoanTrackedParts(subLoan)), // storedPackedTrackedParts
              toBytes32(packSubLoanTrackedParts(subLoan)), // currentPackedTrackedParts
            );
        });

        it("does not transfer tokens", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, addonTreasury],
            [0, 0, 0, 0, 0],
          );
        });

        it("does not call the liquidity pool functions", async () => {
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN);
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT);
        });
      });

      describe("A single remuneratory rate setting operation in the future, and does the following:", () => {
        let operation: Operation;
        let tx: Promise<ContractTransactionResponse>;

        beforeEach(async () => {
          const currentBlockTimestamp = await getBlockTimestamp("latest");
          const operationRequest: OperationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.RemuneratoryRateSetting,
            timestamp: currentBlockTimestamp + 24 * 3600, // Tomorrow
            value: BigInt(subLoan.state.remuneratoryRate + INTEREST_RATE_FACTOR / 100),
            account: ADDRESS_ZERO,
          };
          ({ tx, operation } = await prepareOperation(operationRequest));
        });

        it("registers the expected operation", async () => {
          const actualOperationIds = await market.getSubLoanOperationIds(operation.subLoanId);
          expect(actualOperationIds).to.deep.equal([operation.id]);

          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("changes the sub-loan as expected", async () => {
          subLoan.metadata.pendingTimestamp = operation.timestamp;
          subLoan.metadata.operationCount += 1;
          subLoan.metadata.earliestOperationId = operation.id;
          subLoan.metadata.latestOperationId = operation.id;

          await checkSubLoanInContract(market, subLoan);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_PENDED)).to.equal(1);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_PENDED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              operation.account,
            );

          await expect(tx).not.to.emit(market, EVENT_NAME_OPERATION_APPLIED);
          await expect(tx).not.to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED);
        });

        it("does not transfers tokens", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, addonTreasury],
            [0, 0, 0, 0, 0],
          );
        });

        it("does not call the liquidity pool functions", async () => {
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN);
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT);
        });
      });

      describe("A single moratory rate setting operation at the current block, and does the following:", () => {
        let operation: Operation;
        let tx: Promise<ContractTransactionResponse>;
        let txTimestamp: number;

        beforeEach(async () => {
          const operationRequest: OperationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.MoratoryRateSetting,
            timestamp: 0,
            value: BigInt(subLoan.state.moratoryRate + INTEREST_RATE_FACTOR / 100),
            account: ADDRESS_ZERO,
          };
          ({ tx, txTimestamp, operation } = await prepareOperation(operationRequest));
        });

        it("registers the expected operation", async () => {
          const actualOperationIds = await market.getSubLoanOperationIds(operation.subLoanId);
          expect(actualOperationIds).to.deep.equal([operation.id]);

          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("changes the sub-loan as expected", async () => {
          applySubLoanMoratoryRateSetting(subLoan, txTimestamp, operation.value, operation.id);
          await checkSubLoanInContract(market, subLoan);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_APPLIED)).to.equal(1);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_APPLIED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              operation.account,
            );

          const updateIndex = subLoan.metadata.updateIndex;
          applySubLoanMoratoryRateSetting(subLoan, txTimestamp, operation.value, operation.id);

          await expect(tx)
            .to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED)
            .withArgs(
              subLoan.id,
              updateIndex,
              toBytes32(packSubLoanParameters(subLoan)),
              toBytes32(packSubLoanRepaidParts(subLoan)),
              toBytes32(packSubLoanDiscountParts(subLoan)),
              toBytes32(packSubLoanTrackedParts(subLoan)), // storedPackedTrackedParts
              toBytes32(packSubLoanTrackedParts(subLoan)), // currentPackedTrackedParts
            );
        });

        it("does not transfer tokens", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, addonTreasury],
            [0, 0, 0, 0, 0],
          );
        });

        it("does not call the liquidity pool functions", async () => {
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN);
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT);
        });
      });

      describe("A single moratory rate setting operation in the future, and does the following:", () => {
        let operation: Operation;
        let tx: Promise<ContractTransactionResponse>;

        beforeEach(async () => {
          const currentBlockTimestamp = await getBlockTimestamp("latest");
          const operationRequest: OperationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.MoratoryRateSetting,
            timestamp: currentBlockTimestamp + 24 * 3600, // Tomorrow
            value: BigInt(subLoan.state.moratoryRate + INTEREST_RATE_FACTOR / 100),
            account: ADDRESS_ZERO,
          };
          ({ tx, operation } = await prepareOperation(operationRequest));
        });

        it("registers the expected operation", async () => {
          const actualOperationIds = await market.getSubLoanOperationIds(operation.subLoanId);
          expect(actualOperationIds).to.deep.equal([operation.id]);

          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("changes the sub-loan as expected", async () => {
          subLoan.metadata.pendingTimestamp = operation.timestamp;
          subLoan.metadata.operationCount += 1;
          subLoan.metadata.earliestOperationId = operation.id;
          subLoan.metadata.latestOperationId = operation.id;

          await checkSubLoanInContract(market, subLoan);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_PENDED)).to.equal(1);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_PENDED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              operation.account,
            );

          await expect(tx).not.to.emit(market, EVENT_NAME_OPERATION_APPLIED);
          await expect(tx).not.to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED);
        });

        it("does not transfers tokens", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, addonTreasury],
            [0, 0, 0, 0, 0],
          );
        });

        it("does not call the liquidity pool functions", async () => {
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN);
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT);
        });
      });

      describe("A single late fee rate setting operation at the current block, and does the following:", () => {
        let operation: Operation;
        let tx: Promise<ContractTransactionResponse>;
        let txTimestamp: number;

        beforeEach(async () => {
          const operationRequest: OperationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.LateFeeRateSetting,
            timestamp: 0,
            value: BigInt(subLoan.state.lateFeeRate + INTEREST_RATE_FACTOR / 100),
            account: ADDRESS_ZERO,
          };
          ({ tx, txTimestamp, operation } = await prepareOperation(operationRequest));
        });

        it("registers the expected operation", async () => {
          const actualOperationIds = await market.getSubLoanOperationIds(operation.subLoanId);
          expect(actualOperationIds).to.deep.equal([operation.id]);

          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("changes the sub-loan as expected", async () => {
          applySubLoanLateFeeRateSetting(subLoan, txTimestamp, operation.value, operation.id);
          await checkSubLoanInContract(market, subLoan);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_APPLIED)).to.equal(1);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_APPLIED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              operation.account,
            );

          const updateIndex = subLoan.metadata.updateIndex;
          applySubLoanLateFeeRateSetting(subLoan, txTimestamp, operation.value, operation.id);

          await expect(tx)
            .to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED)
            .withArgs(
              subLoan.id,
              updateIndex,
              toBytes32(packSubLoanParameters(subLoan)),
              toBytes32(packSubLoanRepaidParts(subLoan)),
              toBytes32(packSubLoanDiscountParts(subLoan)),
              toBytes32(packSubLoanTrackedParts(subLoan)), // storedPackedTrackedParts
              toBytes32(packSubLoanTrackedParts(subLoan)), // currentPackedTrackedParts
            );
        });

        it("does not transfer tokens", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, addonTreasury],
            [0, 0, 0, 0, 0],
          );
        });

        it("does not call the liquidity pool functions", async () => {
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN);
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT);
        });
      });

      describe("A single late fee rate setting operation in the future, and does the following:", () => {
        let operation: Operation;
        let tx: Promise<ContractTransactionResponse>;

        beforeEach(async () => {
          const currentBlockTimestamp = await getBlockTimestamp("latest");
          const operationRequest: OperationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.LateFeeRateSetting,
            timestamp: currentBlockTimestamp + 24 * 3600, // Tomorrow
            value: BigInt(subLoan.state.lateFeeRate + INTEREST_RATE_FACTOR / 100),
            account: ADDRESS_ZERO,
          };
          ({ tx, operation } = await prepareOperation(operationRequest));
        });

        it("registers the expected operation", async () => {
          const actualOperationIds = await market.getSubLoanOperationIds(operation.subLoanId);
          expect(actualOperationIds).to.deep.equal([operation.id]);

          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("changes the sub-loan as expected", async () => {
          subLoan.metadata.pendingTimestamp = operation.timestamp;
          subLoan.metadata.operationCount += 1;
          subLoan.metadata.earliestOperationId = operation.id;
          subLoan.metadata.latestOperationId = operation.id;

          await checkSubLoanInContract(market, subLoan);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_PENDED)).to.equal(1);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_PENDED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              operation.account,
            );

          await expect(tx).not.to.emit(market, EVENT_NAME_OPERATION_APPLIED);
          await expect(tx).not.to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED);
        });

        it("does not transfers tokens", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, addonTreasury],
            [0, 0, 0, 0, 0],
          );
        });

        it("does not call the liquidity pool functions", async () => {
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN);
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT);
        });
      });

      describe("A single grace discount rate setting operation at the current block, and does the following:", () => {
        let operation: Operation;
        let tx: Promise<ContractTransactionResponse>;
        let txTimestamp: number;

        beforeEach(async () => {
          const operationRequest: OperationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.GraceDiscountRateSetting,
            timestamp: 0,
            value: BigInt(subLoan.state.graceDiscountRate + INTEREST_RATE_FACTOR / 100),
            account: ADDRESS_ZERO,
          };
          ({ tx, txTimestamp, operation } = await prepareOperation(operationRequest));
        });

        it("registers the expected operation", async () => {
          const actualOperationIds = await market.getSubLoanOperationIds(operation.subLoanId);
          expect(actualOperationIds).to.deep.equal([operation.id]);

          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("changes the sub-loan as expected", async () => {
          applySubLoanGraceDiscountRateSetting(subLoan, txTimestamp, operation.value, operation.id);
          await checkSubLoanInContract(market, subLoan);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_APPLIED)).to.equal(1);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_APPLIED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              operation.account,
            );

          const updateIndex = subLoan.metadata.updateIndex;
          applySubLoanGraceDiscountRateSetting(subLoan, txTimestamp, operation.value, operation.id);

          await expect(tx)
            .to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED)
            .withArgs(
              subLoan.id,
              updateIndex,
              toBytes32(packSubLoanParameters(subLoan)),
              toBytes32(packSubLoanRepaidParts(subLoan)),
              toBytes32(packSubLoanDiscountParts(subLoan)),
              toBytes32(packSubLoanTrackedParts(subLoan)), // storedPackedTrackedParts
              toBytes32(packSubLoanTrackedParts(subLoan)), // currentPackedTrackedParts
            );
        });

        it("does not transfer tokens", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, addonTreasury],
            [0, 0, 0, 0, 0],
          );
        });

        it("does not call the liquidity pool functions", async () => {
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN);
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT);
        });
      });

      describe("A single grace discount rate setting operation in the future, and does the following:", () => {
        let operation: Operation;
        let tx: Promise<ContractTransactionResponse>;

        beforeEach(async () => {
          const currentBlockTimestamp = await getBlockTimestamp("latest");
          const operationRequest: OperationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.GraceDiscountRateSetting,
            timestamp: currentBlockTimestamp + 24 * 3600, // Tomorrow
            value: BigInt(subLoan.state.graceDiscountRate + INTEREST_RATE_FACTOR / 100),
            account: ADDRESS_ZERO,
          };
          ({ tx, operation } = await prepareOperation(operationRequest));
        });

        it("registers the expected operation", async () => {
          const actualOperationIds = await market.getSubLoanOperationIds(operation.subLoanId);
          expect(actualOperationIds).to.deep.equal([operation.id]);

          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("changes the sub-loan as expected", async () => {
          subLoan.metadata.pendingTimestamp = operation.timestamp;
          subLoan.metadata.operationCount += 1;
          subLoan.metadata.earliestOperationId = operation.id;
          subLoan.metadata.latestOperationId = operation.id;

          await checkSubLoanInContract(market, subLoan);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_PENDED)).to.equal(1);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_PENDED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              operation.account,
            );

          await expect(tx).not.to.emit(market, EVENT_NAME_OPERATION_APPLIED);
          await expect(tx).not.to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED);
        });

        it("does not transfers tokens", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, addonTreasury],
            [0, 0, 0, 0, 0],
          );
        });

        it("does not call the liquidity pool functions", async () => {
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN);
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT);
        });
      });

      describe("A single duration setting operation at the current block, and does the following:", () => {
        let operation: Operation;
        let tx: Promise<ContractTransactionResponse>;
        let txTimestamp: number;

        beforeEach(async () => {
          const operationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.DurationSetting,
            timestamp: 0,
            value: BigInt(subLoan.inception.initialDuration + 10),
            account: ADDRESS_ZERO,
          };
          ({ tx, txTimestamp, operation } = await prepareOperation(operationRequest));
        });

        it("registers the expected operation", async () => {
          const actualOperationIds = await market.getSubLoanOperationIds(operation.subLoanId);
          expect(actualOperationIds).to.deep.equal([operation.id]);

          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("changes the sub-loan as expected", async () => {
          applySubLoanDurationSetting(subLoan, txTimestamp, operation.value, operation.id);
          await checkSubLoanInContract(market, subLoan);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_APPLIED)).to.equal(1);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_APPLIED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              operation.account,
            );

          const updateIndex = subLoan.metadata.updateIndex;
          applySubLoanDurationSetting(subLoan, txTimestamp, operation.value, operation.id);

          await expect(tx)
            .to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED)
            .withArgs(
              subLoan.id,
              updateIndex,
              toBytes32(packSubLoanParameters(subLoan)),
              toBytes32(packSubLoanRepaidParts(subLoan)),
              toBytes32(packSubLoanDiscountParts(subLoan)),
              toBytes32(packSubLoanTrackedParts(subLoan)), // storedPackedTrackedParts
              toBytes32(packSubLoanTrackedParts(subLoan)), // currentPackedTrackedParts
            );

          await expect(tx).not.to.emit(market, EVENT_NAME_OPERATION_PENDED);
        });

        it("does not transfer tokens", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, addonTreasury],
            [0, 0, 0, 0, 0],
          );
        });

        it("does not call the liquidity pool functions", async () => {
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN);
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT);
        });
      });

      describe("A single duration setting operation in the future, and does the following:", () => {
        let operation: Operation;
        let tx: Promise<ContractTransactionResponse>;

        beforeEach(async () => {
          const currentBlockTimestamp = await getBlockTimestamp("latest");
          const operationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.DurationSetting,
            timestamp: currentBlockTimestamp + 24 * 3600, // Tomorrow
            value: BigInt(subLoan.inception.initialDuration + 10),
            account: ADDRESS_ZERO,
          };
          ({ tx, operation } = await prepareOperation(operationRequest));
        });

        it("registers the expected operation", async () => {
          const actualOperationIds = await market.getSubLoanOperationIds(operation.subLoanId);
          expect(actualOperationIds).to.deep.equal([operation.id]);

          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("changes the sub-loan as expected", async () => {
          subLoan.metadata.pendingTimestamp = operation.timestamp;
          subLoan.metadata.operationCount += 1;
          subLoan.metadata.earliestOperationId = operation.id;
          subLoan.metadata.latestOperationId = operation.id;

          await checkSubLoanInContract(market, subLoan);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_PENDED)).to.equal(1);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_PENDED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              operation.account,
            );

          await expect(tx).not.to.emit(market, EVENT_NAME_OPERATION_APPLIED);
          await expect(tx).not.to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED);
        });

        it("does not transfers tokens", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, addonTreasury],
            [0, 0, 0, 0, 0],
          );
        });

        it("does not call the liquidity pool functions", async () => {
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN);
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT);
        });
      });

      describe("Three duration setting operations with different timestamps, and does the following:", () => {
        let operations: Operation[];
        let orderedOperations: Operation[];
        let tx: Promise<ContractTransactionResponse>;
        let txTimestamp: number;
        let lastAppliedOperation: Operation;

        beforeEach(async () => {
          const currentBlockTimestamp = await getBlockTimestamp("latest");
          const operationRequests = Array.from({ length: 3 }, (_, index) => ({
            subLoanId: subLoan.id,
            kind: OperationKind.DurationSetting,
            timestamp: 0,
            value: BigInt(subLoan.inception.initialDuration - index),
            account: ADDRESS_ZERO,
          }));
          operationRequests[0].timestamp = currentBlockTimestamp + 24 * 3600; // Tomorrow
          operationRequests[1].timestamp = subLoan.inception.startTimestamp + 24 * 3600; // In the past
          operationRequests[2].timestamp = 0; // Current timestamp

          tx = market.connect(admin).submitOperationBatch(operationRequests);
          txTimestamp = await getTxTimestamp(tx);

          operations = operationRequests.map((req, index) => createOperation(req, index + 1, txTimestamp));
          orderedOperations = orderOperations(operations);
          operations[0].status = OperationStatus.Pending;
          operations[1].status = OperationStatus.Applied;
          operations[2].status = OperationStatus.Applied;

          lastAppliedOperation = operations[2];
        });

        it("registers the expected operations", async () => {
          const actualOperationIds = await market.getSubLoanOperationIds(subLoan.id);
          expect(actualOperationIds).to.deep.equal(orderedOperations.map(op => op.id));

          for (let i = 0; i < operations.length; i++) {
            const operation = operations[i];

            const actualOperationView = await market.getSubLoanOperation(
              operation.subLoanId,
              operation.id,
            );
            const expectedOperationView = getOperationView(operation);
            checkEquality(resultToObject(actualOperationView), expectedOperationView, i);
          }
        });

        it("changes the sub-loan as expected", async () => {
          subLoan.metadata.updateIndex += 1;
          subLoan.metadata.pendingTimestamp = orderedOperations[orderedOperations.length - 1].timestamp;
          subLoan.metadata.operationCount += operations.length;
          subLoan.metadata.earliestOperationId = orderedOperations[0].id;
          subLoan.metadata.recentOperationId = lastAppliedOperation.id;
          subLoan.metadata.latestOperationId = orderedOperations[orderedOperations.length - 1].id;

          accrueRemuneratoryInterest(subLoan, txTimestamp);
          subLoan.state.trackedTimestamp = txTimestamp;
          subLoan.state.duration = Number(lastAppliedOperation.value);

          await checkSubLoanInContract(market, subLoan);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_APPLIED)).to.equal(2);
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_PENDED)).to.equal(1);
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_SUB_LOAN_UPDATED)).to.equal(1);

          for (const operation of operations) {
            if (operation.timestamp === 0 || operation.timestamp <= txTimestamp) {
              await expect(tx)
                .to.emit(market, EVENT_NAME_OPERATION_APPLIED)
                .withArgs(
                  operation.subLoanId,
                  operation.id,
                  operation.kind,
                  operation.timestamp,
                  operation.value,
                  operation.account,
                );
            } else {
              await expect(tx)
                .to.emit(market, EVENT_NAME_OPERATION_PENDED)
                .withArgs(
                  operation.subLoanId,
                  operation.id,
                  operation.kind,
                  operation.timestamp,
                  operation.value,
                  operation.account,
                );
            }
          }

          accrueRemuneratoryInterest(subLoan, txTimestamp);
          subLoan.state.trackedTimestamp = txTimestamp;
          subLoan.state.duration = Number(lastAppliedOperation.value);
          subLoan.metadata.pendingTimestamp = orderedOperations[orderedOperations.length - 1].timestamp;

          await expect(tx)
            .to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED)
            .withArgs(
              subLoan.id,
              subLoan.metadata.updateIndex,
              toBytes32(packSubLoanParameters(subLoan)),
              toBytes32(packSubLoanRepaidParts(subLoan)),
              toBytes32(packSubLoanDiscountParts(subLoan)),
              toBytes32(packSubLoanTrackedParts(subLoan)), // storedPackedTrackedParts
              toBytes32(packSubLoanTrackedParts(subLoan)), // currentPackedTrackedParts
            );
        });

        it("does not transfers tokens ", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, addonTreasury],
            [0, 0, 0, 0, 0],
          );
        });

        it("does not call the liquidity pool functions", async () => {
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN);
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT);
        });
      });
    });

    describe("Is reverted if", () => {
      let operationRequests: OperationRequest[];

      beforeEach(async () => {
        operationRequests = loan.subLoans.map(subLoan => ({
          subLoanId: subLoan.id,
          kind: OperationKind.Repayment,
          timestamp: 0,
          value: (subLoan.inception.borrowedAmount / 10n),
          account: repayer.address,
        }));
      });

      it("the caller does not have the admin role", async () => {
        await expect(market.connect(deployer).submitOperationBatch(operationRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(deployer.address, ADMIN_ROLE);
        await expect(market.connect(stranger).submitOperationBatch(operationRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, ADMIN_ROLE);
      });

      it("the contract is paused", async () => {
        await proveTx(market.connect(pauser).pause());

        await expect(market.connect(admin).submitOperationBatch(operationRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("the block timestamp is greater than the maximum allowed value", async () => {
        await increaseBlockTimestampTo(Number(maxUintForBits(32)) + 1);

        await expect(market.connect(admin).submitOperationBatch(operationRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_BLOCK_TIMESTAMP_EXCESS);
      });

      it("the input array of operation requests is empty", async () => {
        await expect(market.connect(admin).submitOperationBatch([]))
          .to.be.revertedWithCustomError(market, ERROR_NAME_OPERATION_REQUEST_COUNT_ZERO);
      });

      it("one of sub-loans does not exist", async () => {
        const nonexistentSubLoanId = loan.subLoans[loan.subLoans.length - 1].id + 1n;
        operationRequests[operationRequests.length - 1].subLoanId = (nonexistentSubLoanId);

        await expect(market.connect(admin).submitOperationBatch(operationRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_SUB_LOAN_NONEXISTENT);
      });

      it("one of the operation kinds is zero", async () => {
        const operationRequest = operationRequests[operationRequests.length - 1];
        operationRequest.kind = OperationKind.Nonexistent;
        operationRequest.value = 0n;
        operationRequest.account = ADDRESS_ZERO;

        await expect(market.connect(admin).submitOperationBatch(operationRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_OPERATION_KIND_INVALID);
      });

      it("one of the operation kinds is greater than allowed", async () => {
        const operationRequest = operationRequests[operationRequests.length - 1];
        operationRequest.kind = OperationKind.DurationSetting + 1;
        operationRequest.value = 0n;
        operationRequest.account = ADDRESS_ZERO;

        await expect(market.connect(admin).submitOperationBatch(operationRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_OPERATION_KIND_INVALID);
      });

      it("one of the operations is revocation", async () => {
        const operationRequest = operationRequests[operationRequests.length - 1];
        operationRequest.kind = OperationKind.Revocation;
        operationRequest.value = 0n;
        operationRequest.account = ADDRESS_ZERO;

        await expect(market.connect(admin).submitOperationBatch(operationRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_OPERATION_KIND_UNACCEPTABLE);
      });

      it("one of the operation timestamps is earlier than the sub-loan start timestamp", async () => {
        const operationRequest = operationRequests[operationRequests.length - 1];
        operationRequest.timestamp = subLoan.inception.startTimestamp - 1;

        await expect(market.connect(admin).submitOperationBatch(operationRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_OPERATION_TIMESTAMP_TOO_EARLY);
      });

      it("one of the operation timestamps is greater than uint32 max value", async () => {
        const operationRequest = operationRequests[operationRequests.length - 1];
        operationRequest.timestamp = Number(maxUintForBits(32) + 1n);

        await expect(market.connect(admin).submitOperationBatch(operationRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_OPERATION_TIMESTAMP_EXCESS);
      });

      // TODO: Check if an operation ID is already existed and add more checks

      // TODO: Check for two loans: one is revoked, another is not
      it("the loan is revoked", async () => {
        await proveTx(market.connect(admin).revokeLoan(loan.subLoans[0].id));

        await expect(market.connect(admin).submitOperationBatch(operationRequests))
          .to.be.revertedWithCustomError(market, ERROR_NAME_SUB_LOAN_REVOKED);
      });

      it("the liquidity pool hook call is reverted", async () => {
        await proveTx(liquidityPoolMock.setRevertOnBeforeLiquidityIn(true));

        await expect(market.connect(admin).submitOperationBatch(operationRequests))
          .to.be.revertedWithCustomError(liquidityPoolMock, ERROR_NAME_LIQUIDITY_POOL_ON_BEFORE_LIQUIDITY_IN_REVERTED);
      });
    });
  });

  describe("Function 'voidOperationBatch()'", () => {
    const operationId = 1;

    let fixture: Fixture;
    let market: Contracts.LendingMarketV2Testable;
    let tokenMock: Contracts.ERC20TokenMock;
    let liquidityPoolMock: Contracts.LiquidityPoolMock;
    let loan: Loan;

    beforeEach(async () => {
      fixture = await setUpFixture(deployAndConfigureContractsForLoanTaking);
      ({ market, tokenMock, liquidityPoolMock } = fixture);
      loan = await takeTypicalLoan(fixture, { subLoanCount: 3 });
    });

    describe("Executes as expected when called properly for", () => {
      describe("A single repayment operation in the past, and does the following", () => {
        let operation: Operation;
        let subLoan: SubLoan;
        let tx: Promise<ContractTransactionResponse>;
        let txTimestamp: number;

        beforeEach(async () => {
          subLoan = loan.subLoans[1];
          const operationRequest: OperationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.Repayment,
            timestamp: 0,
            value: loan.subLoans[1].inception.borrowedAmount / 10n,
            account: repayer.address,
          };
          const operationVoidingRequest: OperationVoidingRequest = {
            subLoanId: operationRequest.subLoanId,
            operationId,
            counterparty: counterparty.address,
          };
          const submissionTx = market.connect(admin).submitOperationBatch([operationRequest]);
          const submissionTxTimestamp = await getTxTimestamp(submissionTx);

          operation = createOperation(operationRequest, operationId, submissionTxTimestamp);

          tx = market.connect(admin).voidOperationBatch([operationVoidingRequest]);
          txTimestamp = await getTxTimestamp(tx);
        });

        it("changes the operation status as expected", async () => {
          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          operation.status = OperationStatus.Revoked;
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("changes the sub-loan as expected", async () => {
          applySubLoanRepayment(subLoan, operation.timestamp, operation.value, operation.id);
          voidSubLoanSingleRepaymentOperation(subLoan);
          await checkSubLoanInContract(market, subLoan);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_REVOKED)).to.equal(1);
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_SUB_LOAN_UPDATED)).to.equal(1);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_REVOKED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              repayer.address,
              counterparty.address,
            );

          applySubLoanRepayment(subLoan, txTimestamp, operation.value, operation.id);
          const updateIndex = subLoan.metadata.updateIndex;
          voidSubLoanSingleRepaymentOperation(subLoan);

          const storedPackedTrackedParts = packSubLoanTrackedParts(subLoan);

          // Calculate the expected state at the transaction timestamp
          accrueRemuneratoryInterest(subLoan, txTimestamp);

          await expect(tx)
            .to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED)
            .withArgs(
              subLoan.id,
              updateIndex,
              toBytes32(packSubLoanParameters(subLoan)),
              toBytes32(packSubLoanRepaidParts(subLoan)),
              toBytes32(packSubLoanDiscountParts(subLoan)),
              toBytes32(storedPackedTrackedParts), // storedPackedTrackedParts
              toBytes32(packSubLoanTrackedParts(subLoan)), // currentPackedTrackedParts
            );
        });

        it("transfers tokens as expected", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, counterparty, addonTreasury],
            [0, -operation.value, 0, 0, operation.value, 0],
          );
          await checkTokenPath(tx, tokenMock, [liquidityPoolMock, market, counterparty], operation.value);
        });

        it("calls the expected liquidity pool function properly", async () => {
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN);
          expect(await getNumberOfEvents(tx, liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT)).to.equal(1);
          // TODO: Check it happen before the token transfers
          await expect(tx)
            .to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT)
            .withArgs(operation.value);
        });
      });

      describe("A single duration setting operation in the future, and does the following", () => {
        let operation: Operation;
        let subLoan: SubLoan;
        let tx: Promise<ContractTransactionResponse>;

        beforeEach(async () => {
          subLoan = loan.subLoans[1];
          const currentBlockTimestamp = await getBlockTimestamp("latest");
          const operationRequest: OperationRequest = {
            subLoanId: subLoan.id,
            kind: OperationKind.DurationSetting,
            timestamp: currentBlockTimestamp + 24 * 3600, // Tomorrow
            value: BigInt(subLoan.inception.initialDuration + 10),
            account: ADDRESS_ZERO,
          };
          const operationVoidingRequest: OperationVoidingRequest = {
            subLoanId: operationRequest.subLoanId,
            operationId,
            counterparty: counterparty.address,
          };
          const submissionTx = market.connect(admin).submitOperationBatch([operationRequest]);
          const submissionTxTimestamp = await getTxTimestamp(submissionTx);

          operation = createOperation(operationRequest, operationId, submissionTxTimestamp);

          tx = market.connect(admin).voidOperationBatch([operationVoidingRequest]);
          await getTxTimestamp(tx);
        });

        it("changes the operation status as expected", async () => {
          const actualOperationView = await market.getSubLoanOperation(operation.subLoanId, operation.id);
          operation.status = OperationStatus.Dismissed;
          checkEquality(resultToObject(actualOperationView), getOperationView(operation));
        });

        it("changes the sub-loan as expected", async () => {
          ++subLoan.metadata.operationCount;
          subLoan.metadata.earliestOperationId = operationId;
          subLoan.metadata.latestOperationId = operationId;
          await checkSubLoanInContract(market, subLoan);
        });

        it("emits the expected events", async () => {
          expect(await getNumberOfEvents(tx, market, EVENT_NAME_OPERATION_DISMISSED)).to.equal(1);
          await expect(tx).not.to.emit(market, EVENT_NAME_SUB_LOAN_UPDATED);

          await expect(tx)
            .to.emit(market, EVENT_NAME_OPERATION_DISMISSED)
            .withArgs(
              operation.subLoanId,
              operation.id,
              operation.kind,
              operation.timestamp,
              operation.value,
              operation.account,
            );
        });

        it("does not transfer tokens", async () => {
          await expect(tx).to.changeTokenBalances(
            tokenMock,
            [market, liquidityPoolMock, borrower, repayer, counterparty, addonTreasury],
            [0, 0, 0, 0, 0, 0],
          );
        });

        it("does not call any liquidity pool function", async () => {
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_IN);
          await expect(tx).not.to.emit(liquidityPoolMock, EVENT_NAME_MOCK_LIQUIDITY_OUT);
        });
      });
    });

    describe("Is reverted if", () => {
      let operationVoidingRequest: OperationVoidingRequest;

      beforeEach(async () => {
        const subLoan = loan.subLoans[1];
        const operationRequest: OperationRequest = {
          subLoanId: subLoan.id,
          kind: OperationKind.Repayment,
          timestamp: 0,
          value: loan.subLoans[1].inception.borrowedAmount / 10n,
          account: repayer.address,
        };
        operationVoidingRequest = {
          subLoanId: operationRequest.subLoanId,
          operationId,
          counterparty: counterparty.address,
        };
      });

      it("the caller does not have the admin role", async () => {
        await expect(market.connect(deployer).voidOperationBatch([operationVoidingRequest]))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(deployer.address, ADMIN_ROLE);
        await expect(market.connect(stranger).voidOperationBatch([operationVoidingRequest]))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, ADMIN_ROLE);
      });

      it("the contract is paused", async () => {
        await proveTx(market.connect(pauser).pause());

        await expect(market.connect(admin).voidOperationBatch([operationVoidingRequest]))
          .to.be.revertedWithCustomError(market, ERROR_NAME_ENFORCED_PAUSED);
      });

      it("the block timestamp is greater than the maximum allowed value", async () => {
        await increaseBlockTimestampTo(Number(maxUintForBits(32)) + 1);

        await expect(market.connect(admin).voidOperationBatch([operationVoidingRequest]))
          .to.be.revertedWithCustomError(market, ERROR_NAME_BLOCK_TIMESTAMP_EXCESS);
      });

      it("the input array of operation requests is empty", async () => {
        await expect(market.connect(admin).voidOperationBatch([]))
          .to.be.revertedWithCustomError(market, ERROR_NAME_OPERATION_REQUEST_COUNT_ZERO);
      });

      it("the sub-loan provided in the request does not exist", async () => {
        operationVoidingRequest.subLoanId = loan.subLoans[loan.subLoans.length - 1].id + 1n;

        await expect(market.connect(admin).voidOperationBatch([operationVoidingRequest]))
          .to.be.revertedWithCustomError(market, ERROR_NAME_SUB_LOAN_NONEXISTENT);
      });

      it("the operation ID in the request is zero", async () => {
        operationVoidingRequest.operationId = 0;

        await expect(market.connect(admin).voidOperationBatch([operationVoidingRequest]))
          .to.be.revertedWithCustomError(market, ERROR_NAME_OPERATION_NONEXISTENT)
          .withArgs(operationVoidingRequest.subLoanId, operationVoidingRequest.operationId);
      });

      it("the operation ID in the request corresponds to a nonexistent operation", async () => {
        operationVoidingRequest.operationId = operationId + 1;

        await expect(market.connect(admin).voidOperationBatch([operationVoidingRequest]))
          .to.be.revertedWithCustomError(market, ERROR_NAME_OPERATION_NONEXISTENT)
          .withArgs(operationVoidingRequest.subLoanId, operationVoidingRequest.operationId);
      });

      it("the operation is already revoked", async () => {
        const subLoan = loan.subLoans[1];
        const operationRequest: OperationRequest = {
          subLoanId: subLoan.id,
          kind: OperationKind.Repayment,
          timestamp: 0,
          value: loan.subLoans[1].inception.borrowedAmount / 10n,
          account: repayer.address,
        };
        const operationVoidingRequest: OperationVoidingRequest = {
          subLoanId: operationRequest.subLoanId,
          operationId,
          counterparty: counterparty.address,
        };
        await proveTx(market.connect(admin).submitOperationBatch([operationRequest]));
        await proveTx(market.connect(admin).voidOperationBatch([operationVoidingRequest]));

        await expect(market.connect(admin).voidOperationBatch([operationVoidingRequest]))
          .to.be.revertedWithCustomError(market, ERROR_NAME_OPERATION_REVOKED_ALREADY)
          .withArgs(operationVoidingRequest.subLoanId, operationVoidingRequest.operationId);
      });

      it("the operation is already dismissed", async () => {
        const subLoan = loan.subLoans[1];
        const currentBlockTimestamp = await getBlockTimestamp("latest");
        const operationRequest: OperationRequest = {
          subLoanId: subLoan.id,
          kind: OperationKind.DurationSetting,
          timestamp: currentBlockTimestamp + 24 * 3600, // Tomorrow
          value: BigInt(subLoan.inception.initialDuration + 10),
          account: ADDRESS_ZERO,
        };
        const operationVoidingRequest: OperationVoidingRequest = {
          subLoanId: operationRequest.subLoanId,
          operationId,
          counterparty: counterparty.address,
        };
        await proveTx(market.connect(admin).submitOperationBatch([operationRequest]));
        await proveTx(market.connect(admin).voidOperationBatch([operationVoidingRequest]));

        await expect(market.connect(admin).voidOperationBatch([operationVoidingRequest]))
          .to.be.revertedWithCustomError(market, ERROR_NAME_OPERATION_DISMISSED_ALREADY)
          .withArgs(operationVoidingRequest.subLoanId, operationVoidingRequest.operationId);
      });
    });
  });

  describe("Function 'delegateToEngine()'", () => {
    it("cannot be called from an external account", async () => {
      const { market } = await setUpFixture(deployContracts);

      await expect(market.connect(deployer).delegateToEngine("0x"))
        .to.be.revertedWithCustomError(market, ERROR_NAME_UNAUTHORIZED_CALL_CONTEXT);
    });
  });

  describe("Function 'getSubLoanPreview()'", () => {
    let fixture: Fixture;
    let market: Contracts.LendingMarketV2Testable;
    let subLoan: SubLoan;

    beforeEach(async () => {
      fixture = await setUpFixture(deployAndConfigureContractsForLoanTaking);
      ({ market } = fixture);
      const loan = await takeTypicalLoan(fixture, { subLoanCount: 3 });
      subLoan = loan.subLoans[2];
    });

    describe("Is reverted if", () => {
      it("the requested timestamp is earlier than the sub-loan start timestamp", async () => {
        const wrongTimestamp = subLoan.inception.startTimestamp - 1;
        await expect(market.getSubLoanPreview(subLoan.id, wrongTimestamp, VIEW_FLAGS_DEFAULT))
          .to.be.revertedWithCustomError(market, ERROR_NAME_OPERATION_APPLYING_TIMESTAMP_TOO_EARLY);
      });
    });
  });
});
