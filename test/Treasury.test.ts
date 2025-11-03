/* eslint @typescript-eslint/no-unused-expressions: "off" */

import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { setUpFixture } from "../test-utils/common";
import * as Contracts from "../typechain-types";

const ADDRESS_ZERO = ethers.ZeroAddress;
const BALANCE_INITIAL = 10000n;

const OWNER_ROLE = ethers.id("OWNER_ROLE");
const GRANTOR_ROLE = ethers.id("GRANTOR_ROLE");
const WITHDRAWER_ROLE = ethers.id("WITHDRAWER_ROLE");
const MANAGER_ROLE = ethers.id("MANAGER_ROLE");
const PAUSER_ROLE = ethers.id("PAUSER_ROLE");
const RESCUER_ROLE = ethers.id("RESCUER_ROLE");

let treasuryFactory: Contracts.Treasury__factory;
let tokenMockFactory: Contracts.ERC20TokenMock__factory;

let deployer: HardhatEthersSigner; // has OWNER_ROLE
let withdrawer: HardhatEthersSigner; // has WITHDRAWER_ROLE
let manager: HardhatEthersSigner; // has MANAGER_ROLE
let account: HardhatEthersSigner; // has no roles
let pauser: HardhatEthersSigner; // has PAUSER_ROLE
let rescuer: HardhatEthersSigner; // has RESCUER_ROLE
let stranger: HardhatEthersSigner; // has no roles

let ROLES: Record<string, HardhatEthersSigner> = {};
const EXPECTED_VERSION = {
  major: 1,
  minor: 0,
  patch: 0,
};

async function deployContracts() {
  const name = "ERC20 Test";
  const symbol = "TEST";

  const tokenMockDeployment = await tokenMockFactory.deploy(name, symbol);
  await tokenMockDeployment.waitForDeployment();

  const tokenMock = tokenMockDeployment.connect(deployer);
  const beacon = await upgrades.deployBeacon(treasuryFactory);
  await beacon.waitForDeployment();

  const treasury = await upgrades.deployBeaconProxy(beacon, treasuryFactory, [await tokenMock.getAddress()]);
  await treasury.waitForDeployment();

  return { treasury, tokenMock };
}

async function configureContracts(
  treasury: Contracts.Treasury,
  tokenMock: Contracts.ERC20TokenMock,
) {
  await treasury.grantRole(GRANTOR_ROLE, deployer.address);
  await treasury.grantRole(WITHDRAWER_ROLE, withdrawer.address);
  await treasury.grantRole(MANAGER_ROLE, manager.address);
  await treasury.grantRole(PAUSER_ROLE, pauser.address);
  await treasury.grantRole(RESCUER_ROLE, rescuer.address);

  await tokenMock.mint(treasury, BALANCE_INITIAL);
  await tokenMock.mint(account, BALANCE_INITIAL);
  await tokenMock.mint(withdrawer, BALANCE_INITIAL);
  await tokenMock.mint(manager, BALANCE_INITIAL);
}

async function deployAndConfigureContracts() {
  const contracts = await deployContracts();
  await configureContracts(contracts.treasury, contracts.tokenMock);
  return contracts;
}

describe("Contract 'Treasury'", () => {
  before(async () => {
    [deployer, withdrawer, manager, account, pauser, rescuer, stranger] = await ethers.getSigners();
    ROLES = { owner: deployer, withdrawer, manager, account, pauser, rescuer, stranger };
    treasuryFactory = await ethers.getContractFactory("Treasury");
    treasuryFactory = treasuryFactory.connect(deployer);
    tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenMockFactory = tokenMockFactory.connect(deployer);
  });

  let treasury: Contracts.Treasury;
  let tokenMock: Contracts.ERC20TokenMock;

  beforeEach(async () => {
    ({ treasury, tokenMock } = await setUpFixture(deployAndConfigureContracts));
  });

  describe("Method 'initialize()'", () => {
    let deployedContract: Contracts.Treasury;
    let tokenMock: Contracts.ERC20TokenMock;

    beforeEach(async () => {
      // deploying contract without configuration to test the default state
      const contracts = await setUpFixture(deployContracts);
      deployedContract = contracts.treasury;
      tokenMock = contracts.tokenMock;
    });

    describe("Should execute as expected when called properly and", () => {
      it("should expose correct role hashes", async () => {
        expect(await deployedContract.OWNER_ROLE()).to.equal(OWNER_ROLE);
        expect(await deployedContract.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.WITHDRAWER_ROLE()).to.equal(WITHDRAWER_ROLE);
        expect(await deployedContract.MANAGER_ROLE()).to.equal(MANAGER_ROLE);
        expect(await deployedContract.PAUSER_ROLE()).to.equal(PAUSER_ROLE);
        expect(await deployedContract.RESCUER_ROLE()).to.equal(RESCUER_ROLE);
      });

      it("should set correct role admins", async () => {
        expect(await deployedContract.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
        expect(await deployedContract.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
        expect(await deployedContract.getRoleAdmin(WITHDRAWER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.getRoleAdmin(MANAGER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.getRoleAdmin(RESCUER_ROLE)).to.equal(GRANTOR_ROLE);
      });

      it("should set correct roles for the deployer", async () => {
        expect(await deployedContract.hasRole(OWNER_ROLE, deployer)).to.be.true;
        expect(await deployedContract.hasRole(GRANTOR_ROLE, deployer)).to.be.false;
        expect(await deployedContract.hasRole(WITHDRAWER_ROLE, deployer)).to.be.false;
        expect(await deployedContract.hasRole(MANAGER_ROLE, deployer)).to.be.false;
        expect(await deployedContract.hasRole(PAUSER_ROLE, deployer)).to.be.false;
        expect(await deployedContract.hasRole(RESCUER_ROLE, deployer)).to.be.false;
      });

      it("should not pause the contract", async () => {
        expect(await deployedContract.paused()).to.equal(false);
      });

      it("should set correct underlying token address", async () => {
        expect(await deployedContract.underlyingToken()).to.equal(tokenMock);
      });

      it("should have empty approved accounts list", async () => {
        expect(await deployedContract.approvedSpenders()).to.deep.equal([]);
      });
    });

    describe("Should revert if", () => {
      it("called a second time", async () => {
        await expect(deployedContract.initialize(tokenMock))
          .to.be.revertedWithCustomError(deployedContract, "InvalidInitialization");
      });

      it("the provided token address is zero", async () => {
        const tx = upgrades.deployProxy(treasuryFactory, [ADDRESS_ZERO]);
        await expect(tx)
          .to.be.revertedWithCustomError(treasuryFactory, "Treasury_TokenAddressZero");
      });
    });
  });

  describe("Method '$__VERSION()'", () => {
    it("should return the expected version", async () => {
      expect(await treasury.$__VERSION()).to.deep.equal([
        EXPECTED_VERSION.major,
        EXPECTED_VERSION.minor,
        EXPECTED_VERSION.patch,
      ]);
    });
  });

  describe("Method 'withdraw()'", () => {
    describe("Should execute as expected when called properly and", () => {
      let tx: TransactionResponse;
      const withdrawAmount = 100n;

      beforeEach(async () => {
        tx = await treasury.connect(withdrawer).withdraw(withdrawAmount);
      });

      it("should emit the required event", async () => {
        await expect(tx).to.emit(treasury, "Withdrawal").withArgs(
          withdrawer.address,
          withdrawer.address,
          withdrawAmount,
        );
      });

      it("should update token balances correctly", async () => {
        await expect(tx).to.changeTokenBalances(tokenMock,
          [treasury, withdrawer],
          [-withdrawAmount, withdrawAmount],
        );
      });
    });

    describe("Should revert if", () => {
      describe("called by non-withdrawer, even if it is a ", () => {
        for (const roleName of ["owner", "pauser", "rescuer", "manager", "stranger"]) {
          it(roleName, async () => {
            await expect(
              treasury.connect(ROLES[roleName]).withdraw(100n),
            )
              .to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount")
              .withArgs(ROLES[roleName].address, WITHDRAWER_ROLE);
          });
        }
      });

      it("the contract is paused", async () => {
        await treasury.connect(pauser).pause();
        await expect(
          treasury.connect(withdrawer).withdraw(100n),
        )
          .to.be.revertedWithCustomError(treasury, "EnforcedPause");
      });

      it("the withdrawal amount exceeds the treasury balance", async () => {
        const excessiveAmount = BALANCE_INITIAL + 1n;
        await expect(
          treasury.connect(withdrawer).withdraw(excessiveAmount),
        )
          .to.be.revertedWithCustomError(tokenMock, "ERC20InsufficientBalance");
      });
    });
  });

  describe("Method 'withdrawTo()'", () => {
    describe("Should execute as expected when called properly and", () => {
      let tx: TransactionResponse;
      const withdrawAmount = 100n;

      beforeEach(async () => {
        tx = await treasury.connect(manager).withdrawTo(account.address, withdrawAmount);
      });

      it("should emit the required event", async () => {
        await expect(tx).to.emit(treasury, "Withdrawal").withArgs(
          account.address,
          manager.address,
          withdrawAmount,
        );
      });

      it("should update token balances correctly", async () => {
        await expect(tx).to.changeTokenBalances(tokenMock,
          [treasury, account],
          [-withdrawAmount, withdrawAmount],
        );
      });
    });

    describe("Should revert if", () => {
      describe("called by non-manager, even if it is a ", () => {
        for (const roleName of ["owner", "pauser", "rescuer", "withdrawer", "stranger"]) {
          it(roleName, async () => {
            await expect(
              treasury.connect(ROLES[roleName]).withdrawTo(account.address, 100n),
            )
              .to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount")
              .withArgs(ROLES[roleName].address, MANAGER_ROLE);
          });
        }
      });

      it("the contract is paused", async () => {
        await treasury.connect(pauser).pause();
        await expect(
          treasury.connect(manager).withdrawTo(account.address, 100n),
        )
          .to.be.revertedWithCustomError(treasury, "EnforcedPause");
      });

      it("the withdrawal amount exceeds the treasury balance", async () => {
        const excessiveAmount = BALANCE_INITIAL + 1n;
        await expect(
          treasury.connect(manager).withdrawTo(account.address, excessiveAmount),
        )
          .to.be.revertedWithCustomError(tokenMock, "ERC20InsufficientBalance");
      });
    });
  });

  describe("Method 'approve()'", () => {
    for (const approvalAmount in [0n, 100n]) {
      describe(`Should execute as expected when called properly with amount ${approvalAmount} and`, () => {
        let tx: TransactionResponse;

        beforeEach(async () => {
          tx = await treasury.approve(withdrawer.address, approvalAmount);
        });

        it("should emit the required event", async () => {
          await expect(tx).to.emit(tokenMock, "Approval").withArgs(treasury, withdrawer.address, approvalAmount);
        });

        it("should update the allowance", async () => {
          expect(await tokenMock.allowance(treasury, withdrawer.address)).to.equal(approvalAmount);
        });

        it("should add the spender to approved accounts", async () => {
          const approvedSpenders = await treasury.approvedSpenders();
          expect(approvedSpenders).to.include(withdrawer.address);
        });

        it("should handle multiple approvals to the same spender", async () => {
          const newApprovalAmount = 1000n;
          await treasury.approve(withdrawer.address, newApprovalAmount);

          expect(await tokenMock.allowance(treasury, withdrawer.address)).to.equal(newApprovalAmount);
          const approvedSpenders = await treasury.approvedSpenders();
          expect(approvedSpenders.filter(addr => addr === withdrawer.address)).to.have.length(1);
        });
      });
    }

    describe("Should revert if", () => {
      describe("called by non-owner, even if it is a ", () => {
        for (const roleName of ["pauser", "rescuer", "withdrawer", "manager", "stranger"]) {
          it(roleName, async () => {
            await expect(
              treasury.connect(ROLES[roleName]).approve(withdrawer.address, 100n),
            )
              .to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount")
              .withArgs(ROLES[roleName].address, OWNER_ROLE);
          });
        }
      });

      it("the spender address is zero", async () => {
        await expect(
          treasury.approve(ADDRESS_ZERO, 100n),
        )
          .to.be.revertedWithCustomError(treasury, "Treasury_SpenderAddressZero");
      });
    });
  });

  describe("Method 'approvedSpenders()'", () => {
    it("should return empty array initially", async () => {
      expect(await treasury.approvedSpenders()).to.deep.equal([]);
    });

    it("should return approved accounts after approvals", async () => {
      await treasury.approve(withdrawer.address, 100n);
      await treasury.approve(manager.address, 200n);

      const approvedSpenders = await treasury.approvedSpenders();
      expect(approvedSpenders).to.include(withdrawer.address);
      expect(approvedSpenders).to.include(manager.address);
      expect(approvedSpenders).to.have.length(2);
    });
  });

  describe("Method 'underlyingToken()'", () => {
    it("should return the correct token address", async () => {
      expect(await treasury.underlyingToken()).to.equal(await tokenMock.getAddress());
    });
  });

  describe("Method 'clearAllApprovals()'", () => {
    describe("Should execute as expected when called properly and", () => {
      let tx: TransactionResponse;

      beforeEach(async () => {
        // Set up some approvals first
        await treasury.approve(withdrawer.address, 100n);
        await treasury.approve(manager.address, 200n);
        await treasury.approve(account.address, 300n);

        tx = await treasury.clearAllApprovals();
      });

      it("should emit the required events", async () => {
        await expect(tx).to.emit(tokenMock, "Approval").withArgs(treasury, withdrawer.address, 0n);
        await expect(tx).to.emit(tokenMock, "Approval").withArgs(treasury, manager.address, 0n);
        await expect(tx).to.emit(tokenMock, "Approval").withArgs(treasury, account.address, 0n);
      });

      it("should clear all allowances", async () => {
        expect(await tokenMock.allowance(treasury, withdrawer.address)).to.equal(0n);
        expect(await tokenMock.allowance(treasury, manager.address)).to.equal(0n);
        expect(await tokenMock.allowance(treasury, account.address)).to.equal(0n);
      });

      it("should clear the approved accounts list", async () => {
        expect(await treasury.approvedSpenders()).to.deep.equal([]);
      });

      it("should handle empty approvals list", async () => {
        // Clear again when already empty
        const tx2 = await treasury.clearAllApprovals();
        await expect(tx2).to.not.be.reverted;
        expect(await treasury.approvedSpenders()).to.deep.equal([]);
      });

      it("should allow new approvals after clearing", async () => {
        await treasury.approve(withdrawer.address, 500n);
        expect(await tokenMock.allowance(treasury, withdrawer.address)).to.equal(500n);
        expect(await treasury.approvedSpenders()).to.deep.equal([withdrawer.address]);
      });
    });

    describe("Should revert if", () => {
      describe("called by non-owner, even if it is a ", () => {
        for (const roleName of ["pauser", "rescuer", "withdrawer", "manager", "stranger"]) {
          it(roleName, async () => {
            await expect(
              treasury.connect(ROLES[roleName]).clearAllApprovals(),
            )
              .to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount")
              .withArgs(ROLES[roleName].address, OWNER_ROLE);
          });
        }
      });
    });
  });

  describe("Method 'proveTreasury()'", () => {
    it("should execute without reverting", async () => {
      await expect(treasury.proveTreasury()).to.not.be.reverted;
    });
  });
});
