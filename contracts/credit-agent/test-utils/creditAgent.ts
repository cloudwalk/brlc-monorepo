import { ethers } from "hardhat";
import { Contract, ContractFactory } from "ethers";
import { connect, getAddress, proveTx } from "./eth";

export interface CashOut {
  account: string;
  amount: bigint;
  status: number;
  flags: number;
}

export const initialCashOut: CashOut = {
  account: ethers.ZeroAddress,
  amount: 0n,
  status: 0,
  flags: 0,
};

export enum CreditRequestStatus {
  Nonexistent = 0,
  Initiated = 1,
  Pending = 2,
  Confirmed = 3,
  Reversed = 4,
  Expired = 5,
}

export enum HookIndex {
  Unused = 1,
  CashOutRequestBefore = 6,
  CashOutConfirmationAfter = 9,
  CashOutReversalAfter = 11,
}

export interface AgentState {
  configured: boolean;
  initiatedRequestCounter: bigint;
  pendingRequestCounter: bigint;
}

export const initialAgentState: AgentState = {
  configured: false,
  initiatedRequestCounter: 0n,
  pendingRequestCounter: 0n,
};

export interface Fixture {
  creditAgent: Contract;
  cashierMock: Contract;
  lendingMarketMock: Contract;
  loanIdStub: bigint;
}

export async function deployCashierMock(): Promise<Contract> {
  const [deployer] = await ethers.getSigners();
  const cashierMockFactory: ContractFactory = await ethers.getContractFactory("CashierMock");
  const cashierMock = (await cashierMockFactory.connect(deployer).deploy()) as Contract;
  await cashierMock.waitForDeployment();
  return connect(cashierMock, deployer); // Explicitly specifying the initial account
}

export async function deployLendingMarketMock(): Promise<Contract> {
  const [deployer] = await ethers.getSigners();
  const lendingMarketMockFactory: ContractFactory = await ethers.getContractFactory("LendingMarketMock");
  const lendingMarketMock = (await lendingMarketMockFactory.connect(deployer).deploy()) as Contract;
  await lendingMarketMock.waitForDeployment();
  return connect(lendingMarketMock, deployer); // Explicitly specifying the initial account
}

export async function deployAndConfigureContracts(
  deployAndConfigureCreditAgent: () => Promise<Contract>,
): Promise<Fixture> {
  const cashierMock = await deployCashierMock();
  const lendingMarketMock = await deployLendingMarketMock();
  const creditAgent = await deployAndConfigureCreditAgent();

  await proveTx(creditAgent.setCashier(getAddress(cashierMock)));
  await proveTx(creditAgent.setLendingMarket(getAddress(lendingMarketMock)));
  const loanIdStub = await lendingMarketMock.LOAN_ID_STAB();

  return { creditAgent, cashierMock, lendingMarketMock, loanIdStub };
}
