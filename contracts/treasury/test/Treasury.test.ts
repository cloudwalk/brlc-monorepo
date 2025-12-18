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
const PAUSER_ROLE = ethers.id("PAUSER_ROLE");
const RESCUER_ROLE = ethers.id("RESCUER_ROLE");
const MINTER_ROLE = ethers.id("MINTER_ROLE");
const BURNER_ROLE = ethers.id("BURNER_ROLE");
const RESERVE_MINTER_ROLE = ethers.id("RESERVE_MINTER_ROLE");
const RESERVE_BURNER_ROLE = ethers.id("RESERVE_BURNER_ROLE");

// RecipientLimitPolicy enum values
enum RecipientLimitPolicy {
  Disabled = 0,
  EnforceAll = 1,
}

let treasuryFactory: Contracts.Treasury__factory;
let tokenMockFactory: Contracts.ERC20TokenMock__factory;

let deployer: HardhatEthersSigner; // has OWNER_ROLE
let withdrawer: HardhatEthersSigner; // has WITHDRAWER_ROLE
let account: HardhatEthersSigner; // has no roles
let pauser: HardhatEthersSigner; // has PAUSER_ROLE
let rescuer: HardhatEthersSigner; // has RESCUER_ROLE
let minter: HardhatEthersSigner; // has MINTER_ROLE
let burner: HardhatEthersSigner; // has BURNER_ROLE
let reserveMinter: HardhatEthersSigner; // has RESERVE_MINTER_ROLE
let reserveBurner: HardhatEthersSigner; // has RESERVE_BURNER_ROLE
let stranger: HardhatEthersSigner; // has no roles

let ROLES: Record<string, HardhatEthersSigner> = {};
const EXPECTED_VERSION = {
  major: 1,
  minor: 1,
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
  await treasury.grantRole(PAUSER_ROLE, pauser.address);
  await treasury.grantRole(RESCUER_ROLE, rescuer.address);
  await treasury.grantRole(MINTER_ROLE, minter.address);
  await treasury.grantRole(BURNER_ROLE, burner.address);
  await treasury.grantRole(RESERVE_MINTER_ROLE, reserveMinter.address);
  await treasury.grantRole(RESERVE_BURNER_ROLE, reserveBurner.address);

  await tokenMock.mint(treasury, BALANCE_INITIAL);
  await tokenMock.mint(account, BALANCE_INITIAL);
  await tokenMock.mint(withdrawer, BALANCE_INITIAL);
}

async function deployAndConfigureContracts() {
  const contracts = await deployContracts();
  await configureContracts(contracts.treasury, contracts.tokenMock);
  return contracts;
}

describe("Contract 'Treasury'", () => {
  before(async () => {
    [
      deployer,
      withdrawer,
      account,
      pauser,
      rescuer,
      minter,
      burner,
      reserveMinter,
      reserveBurner,
      stranger,
    ] = await ethers.getSigners();
    ROLES = {
      owner: deployer,
      withdrawer,
      account,
      pauser,
      rescuer,
      minter,
      burner,
      reserveMinter,
      reserveBurner,
      stranger,
    };
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
        expect(await deployedContract.PAUSER_ROLE()).to.equal(PAUSER_ROLE);
        expect(await deployedContract.RESCUER_ROLE()).to.equal(RESCUER_ROLE);
        expect(await deployedContract.MINTER_ROLE()).to.equal(MINTER_ROLE);
        expect(await deployedContract.BURNER_ROLE()).to.equal(BURNER_ROLE);
        expect(await deployedContract.RESERVE_MINTER_ROLE()).to.equal(RESERVE_MINTER_ROLE);
        expect(await deployedContract.RESERVE_BURNER_ROLE()).to.equal(RESERVE_BURNER_ROLE);
      });

      it("should set correct role admins", async () => {
        expect(await deployedContract.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
        expect(await deployedContract.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
        expect(await deployedContract.getRoleAdmin(WITHDRAWER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.getRoleAdmin(RESCUER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.getRoleAdmin(MINTER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.getRoleAdmin(BURNER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.getRoleAdmin(RESERVE_MINTER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.getRoleAdmin(RESERVE_BURNER_ROLE)).to.equal(GRANTOR_ROLE);
      });

      it("should set correct roles for the deployer", async () => {
        expect(await deployedContract.hasRole(OWNER_ROLE, deployer)).to.be.true;
        expect(await deployedContract.hasRole(GRANTOR_ROLE, deployer)).to.be.false;
        expect(await deployedContract.hasRole(WITHDRAWER_ROLE, deployer)).to.be.false;
        expect(await deployedContract.hasRole(PAUSER_ROLE, deployer)).to.be.false;
        expect(await deployedContract.hasRole(RESCUER_ROLE, deployer)).to.be.false;
        expect(await deployedContract.hasRole(MINTER_ROLE, deployer)).to.be.false;
        expect(await deployedContract.hasRole(BURNER_ROLE, deployer)).to.be.false;
        expect(await deployedContract.hasRole(RESERVE_MINTER_ROLE, deployer)).to.be.false;
        expect(await deployedContract.hasRole(RESERVE_BURNER_ROLE, deployer)).to.be.false;
      });

      it("should not pause the contract", async () => {
        expect(await deployedContract.paused()).to.equal(false);
      });

      it("should set correct underlying token address", async () => {
        expect(await deployedContract.underlyingToken()).to.equal(tokenMock);
      });

      it("should emit the required event", async () => {
        // Deploy a new instance to capture the initialization event
        const tokenMock2Deployment = await tokenMockFactory.deploy("Test2", "T2");
        await tokenMock2Deployment.waitForDeployment();
        const tokenMock2 = tokenMock2Deployment.connect(deployer);

        const beacon = await upgrades.deployBeacon(treasuryFactory);
        await beacon.waitForDeployment();

        // Deploy proxy and get contract instance
        const treasury2 = await upgrades.deployBeaconProxy(beacon, treasuryFactory, [await tokenMock2.getAddress()]);
        await treasury2.waitForDeployment();

        // Check event in deployment transaction
        await expect(treasury2.deploymentTransaction())
          .to.emit(treasury2, "UnderlyingTokenSet")
          .withArgs(await tokenMock2.getAddress());
      });

      it("should emit the required event with correct policy", async () => {
        // Deploy a new instance to capture the initialization event
        const tokenMock2Deployment = await tokenMockFactory.deploy("Test2", "T2");
        await tokenMock2Deployment.waitForDeployment();
        const tokenMock2 = tokenMock2Deployment.connect(deployer);

        const beacon = await upgrades.deployBeacon(treasuryFactory);
        await beacon.waitForDeployment();

        // Deploy proxy and get contract instance
        const treasury2 = await upgrades.deployBeaconProxy(beacon, treasuryFactory, [await tokenMock2.getAddress()]);
        await treasury2.waitForDeployment();

        // Check event in deployment transaction
        await expect(treasury2.deploymentTransaction())
          .to.emit(treasury2, "RecipientLimitPolicyUpdated")
          .withArgs(RecipientLimitPolicy.EnforceAll);
      });

      it("should have empty allowed recipients list", async () => {
        const recipientLimits = await deployedContract.getRecipientLimits();
        expect(recipientLimits).to.deep.equal([]);
      });

      it("should set recipient limit policy to EnforceAll by default", async () => {
        expect(await deployedContract.recipientLimitPolicy()).to.equal(RecipientLimitPolicy.EnforceAll);
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
        // Set limit for withdrawer to allow withdrawal to themselves
        await treasury.setRecipientLimit(withdrawer.address, 1000n);
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

      it("should decrement the recipient limit", async () => {
        const recipientLimits = await treasury.getRecipientLimits();
        const withdrawerLimit = recipientLimits.find(rl => rl.recipient === withdrawer.address);
        expect(withdrawerLimit?.limit).to.equal(900n); // 1000n - 100n
      });
    });

    describe("Should revert if", () => {
      beforeEach(async () => {
        // Set limit for withdrawer for tests that need it
        await treasury.setRecipientLimit(withdrawer.address, 1000n);
      });

      describe("called by non-withdrawer, even if it is a ", () => {
        for (const roleName of ["owner", "pauser", "rescuer", "stranger"]) {
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
        // Set a limit higher than the balance to test the balance check
        await treasury.setRecipientLimit(withdrawer.address, excessiveAmount);
        await expect(
          treasury.connect(withdrawer).withdraw(excessiveAmount),
        )
          .to.be.revertedWithCustomError(tokenMock, "ERC20InsufficientBalance");
      });

      it("the withdrawer does not have sufficient limit", async () => {
        await treasury.setRecipientLimit(withdrawer.address, 50n);
        await expect(
          treasury.connect(withdrawer).withdraw(100n),
        )
          .to.be.revertedWithCustomError(treasury, "Treasury_InsufficientRecipientLimit")
          .withArgs(withdrawer.address, 100n, 50n);
      });

      it("the withdrawer is not in the allowed list", async () => {
        // Create a new withdrawer without a limit
        const newWithdrawer = stranger;
        await treasury.grantRole(WITHDRAWER_ROLE, newWithdrawer.address);
        await expect(
          treasury.connect(newWithdrawer).withdraw(100n),
        )
          .to.be.revertedWithCustomError(treasury, "Treasury_InsufficientRecipientLimit")
          .withArgs(newWithdrawer.address, 100n, 0n);
      });
    });

    describe("Should work with type(uint256).max limit and", () => {
      it("should keep limit unchanged when withdrawing with unlimited limit", async () => {
        const maxLimit = ethers.MaxUint256;
        await treasury.setRecipientLimit(withdrawer.address, maxLimit);

        await treasury.connect(withdrawer).withdraw(1000n);

        const recipientLimits = await treasury.getRecipientLimits();
        const withdrawerLimit = recipientLimits.find(rl => rl.recipient === withdrawer.address);
        expect(withdrawerLimit?.limit).to.equal(maxLimit); // Should remain unchanged
      });

      it("should keep limit unchanged after multiple withdrawals", async () => {
        const maxLimit = ethers.MaxUint256;
        await treasury.setRecipientLimit(withdrawer.address, maxLimit);

        // Make multiple withdrawals
        await treasury.connect(withdrawer).withdraw(1000n);
        await treasury.connect(withdrawer).withdraw(2000n);
        await treasury.connect(withdrawer).withdraw(500n);

        const recipientLimits = await treasury.getRecipientLimits();
        const withdrawerLimit = recipientLimits.find(rl => rl.recipient === withdrawer.address);
        expect(withdrawerLimit?.limit).to.equal(maxLimit); // Should still be max
      });
    });
  });

  describe("Method 'withdrawTo()'", () => {
    describe("Should execute as expected when called properly and", () => {
      let tx: TransactionResponse;
      const withdrawAmount = 100n;

      beforeEach(async () => {
        // Set limit for account to allow withdrawal
        await treasury.setRecipientLimit(account.address, 1000n);
        tx = await treasury.connect(withdrawer).withdrawTo(account.address, withdrawAmount);
      });

      it("should emit the required event", async () => {
        await expect(tx).to.emit(treasury, "Withdrawal").withArgs(
          account.address,
          withdrawer.address,
          withdrawAmount,
        );
      });

      it("should update token balances correctly", async () => {
        await expect(tx).to.changeTokenBalances(tokenMock,
          [treasury, account],
          [-withdrawAmount, withdrawAmount],
        );
      });

      it("should decrement the recipient limit", async () => {
        const recipientLimits = await treasury.getRecipientLimits();
        const accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit?.limit).to.equal(900n); // 1000n - 100n
      });
    });

    describe("Should revert if", () => {
      beforeEach(async () => {
        // Set limit for account to allow withdrawal in tests
        await treasury.setRecipientLimit(account.address, 1000n);
      });

      describe("called by non-withdrawer, even if it is a ", () => {
        for (const roleName of ["owner", "pauser", "rescuer", "stranger"]) {
          it(roleName, async () => {
            await expect(
              treasury.connect(ROLES[roleName]).withdrawTo(account.address, 100n),
            )
              .to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount")
              .withArgs(ROLES[roleName].address, WITHDRAWER_ROLE);
          });
        }
      });

      it("the contract is paused", async () => {
        await treasury.connect(pauser).pause();
        await expect(
          treasury.connect(withdrawer).withdrawTo(account.address, 100n),
        )
          .to.be.revertedWithCustomError(treasury, "EnforcedPause");
      });

      it("the withdrawal amount exceeds the treasury balance", async () => {
        const excessiveAmount = BALANCE_INITIAL + 1n;
        // Set a limit higher than the balance to test the balance check
        await treasury.setRecipientLimit(account.address, excessiveAmount);
        await expect(
          treasury.connect(withdrawer).withdrawTo(account.address, excessiveAmount),
        )
          .to.be.revertedWithCustomError(tokenMock, "ERC20InsufficientBalance");
      });

      it("the recipient address is zero", async () => {
        await expect(
          treasury.connect(withdrawer).withdrawTo(ADDRESS_ZERO, 100n),
        )
          .to.be.revertedWithCustomError(treasury, "Treasury_RecipientAddressZero");
      });

      it("the recipient has insufficient limit", async () => {
        await treasury.setRecipientLimit(account.address, 50n);
        await expect(
          treasury.connect(withdrawer).withdrawTo(account.address, 100n),
        )
          .to.be.revertedWithCustomError(treasury, "Treasury_InsufficientRecipientLimit")
          .withArgs(account.address, 100n, 50n);
      });

      it("the recipient is not in the allowed list", async () => {
        await expect(
          treasury.connect(withdrawer).withdrawTo(stranger.address, 100n),
        )
          .to.be.revertedWithCustomError(treasury, "Treasury_InsufficientRecipientLimit")
          .withArgs(stranger.address, 100n, 0n);
      });
    });
  });

  describe("Method 'mint()'", () => {
    describe("Should execute as expected when called properly and", () => {
      const mintAmount = 500n;

      it("should increase treasury balance correctly", async () => {
        const balanceBefore = await tokenMock.balanceOf(treasury);
        await treasury.connect(minter).mint(mintAmount);
        const balanceAfter = await tokenMock.balanceOf(treasury);
        expect(balanceAfter - balanceBefore).to.equal(mintAmount);
      });

      it("should emit the required event from token", async () => {
        const tx = await treasury.connect(minter).mint(mintAmount);
        await expect(tx).to.emit(tokenMock, "Minted")
          .withArgs(await treasury.getAddress(), mintAmount);
      });
    });

    describe("Should revert if", () => {
      describe("called by non-minter, even if it is a ", () => {
        const roleNames = [
          "owner",
          "withdrawer",
          "pauser",
          "rescuer",
          "burner",
          "reserveMinter",
          "reserveBurner",
          "stranger",
        ];
        for (const roleName of roleNames) {
          it(roleName, async () => {
            await expect(
              treasury.connect(ROLES[roleName]).mint(100n),
            )
              .to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount")
              .withArgs(ROLES[roleName].address, MINTER_ROLE);
          });
        }
      });

      it("the contract is paused", async () => {
        await treasury.connect(pauser).pause();
        await expect(
          treasury.connect(minter).mint(100n),
        )
          .to.be.revertedWithCustomError(treasury, "EnforcedPause");
      });
    });
  });

  describe("Method 'mintFromReserve()'", () => {
    describe("Should execute as expected when called properly and", () => {
      const mintAmount = 500n;

      it("should increase treasury balance correctly", async () => {
        const balanceBefore = await tokenMock.balanceOf(treasury);
        await treasury.connect(reserveMinter).mintFromReserve(mintAmount);
        const balanceAfter = await tokenMock.balanceOf(treasury);
        expect(balanceAfter - balanceBefore).to.equal(mintAmount);
      });

      it("should emit the required event from token", async () => {
        const tx = await treasury.connect(reserveMinter).mintFromReserve(mintAmount);
        await expect(tx).to.emit(tokenMock, "MintedFromReserve")
          .withArgs(await treasury.getAddress(), mintAmount);
      });
    });

    describe("Should revert if", () => {
      describe("called by non-reserve-minter, even if it is a ", () => {
        const roleNames = [
          "owner",
          "withdrawer",
          "pauser",
          "rescuer",
          "minter",
          "burner",
          "reserveBurner",
          "stranger",
        ];
        for (const roleName of roleNames) {
          it(roleName, async () => {
            await expect(
              treasury.connect(ROLES[roleName]).mintFromReserve(100n),
            )
              .to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount")
              .withArgs(ROLES[roleName].address, RESERVE_MINTER_ROLE);
          });
        }
      });

      it("the contract is paused", async () => {
        await treasury.connect(pauser).pause();
        await expect(
          treasury.connect(reserveMinter).mintFromReserve(100n),
        )
          .to.be.revertedWithCustomError(treasury, "EnforcedPause");
      });
    });
  });

  describe("Method 'burn()'", () => {
    describe("Should execute as expected when called properly and", () => {
      const burnAmount = 500n;

      it("should decrease treasury balance correctly", async () => {
        const balanceBefore = await tokenMock.balanceOf(treasury);
        await treasury.connect(burner).burn(burnAmount);
        const balanceAfter = await tokenMock.balanceOf(treasury);
        expect(balanceBefore - balanceAfter).to.equal(burnAmount);
      });

      it("should emit the required event from token", async () => {
        const tx = await treasury.connect(burner).burn(burnAmount);
        await expect(tx).to.emit(tokenMock, "Burned").withArgs(burnAmount);
      });
    });

    describe("Should revert if", () => {
      describe("called by non-burner, even if it is a ", () => {
        const roleNames = [
          "owner",
          "withdrawer",
          "pauser",
          "rescuer",
          "minter",
          "reserveMinter",
          "reserveBurner",
          "stranger",
        ];
        for (const roleName of roleNames) {
          it(roleName, async () => {
            await expect(
              treasury.connect(ROLES[roleName]).burn(100n),
            )
              .to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount")
              .withArgs(ROLES[roleName].address, BURNER_ROLE);
          });
        }
      });

      it("the contract is paused", async () => {
        await treasury.connect(pauser).pause();
        await expect(
          treasury.connect(burner).burn(100n),
        )
          .to.be.revertedWithCustomError(treasury, "EnforcedPause");
      });

      it("burn amount exceeds treasury balance", async () => {
        const excessiveAmount = BALANCE_INITIAL + 1n;
        await expect(
          treasury.connect(burner).burn(excessiveAmount),
        )
          .to.be.revertedWithCustomError(tokenMock, "ERC20InsufficientBalance");
      });
    });
  });

  describe("Method 'burnToReserve()'", () => {
    describe("Should execute as expected when called properly and", () => {
      const burnAmount = 500n;

      it("should decrease treasury balance correctly", async () => {
        const balanceBefore = await tokenMock.balanceOf(treasury);
        await treasury.connect(reserveBurner).burnToReserve(burnAmount);
        const balanceAfter = await tokenMock.balanceOf(treasury);
        expect(balanceBefore - balanceAfter).to.equal(burnAmount);
      });

      it("should emit the required event from token", async () => {
        const tx = await treasury.connect(reserveBurner).burnToReserve(burnAmount);
        await expect(tx).to.emit(tokenMock, "BurnedToReserve").withArgs(burnAmount);
      });
    });

    describe("Should revert if", () => {
      describe("called by non-reserve-burner, even if it is a ", () => {
        const roleNames = [
          "owner",
          "withdrawer",
          "pauser",
          "rescuer",
          "minter",
          "burner",
          "reserveMinter",
          "stranger",
        ];
        for (const roleName of roleNames) {
          it(roleName, async () => {
            await expect(
              treasury.connect(ROLES[roleName]).burnToReserve(100n),
            )
              .to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount")
              .withArgs(ROLES[roleName].address, RESERVE_BURNER_ROLE);
          });
        }
      });

      it("the contract is paused", async () => {
        await treasury.connect(pauser).pause();
        await expect(
          treasury.connect(reserveBurner).burnToReserve(100n),
        )
          .to.be.revertedWithCustomError(treasury, "EnforcedPause");
      });

      it("burn amount exceeds treasury balance", async () => {
        const excessiveAmount = BALANCE_INITIAL + 1n;
        await expect(
          treasury.connect(reserveBurner).burnToReserve(excessiveAmount),
        )
          .to.be.revertedWithCustomError(tokenMock, "ERC20InsufficientBalance");
      });
    });
  });

  describe("Method 'setRecipientLimit()'", () => {
    describe("Should execute as expected when called properly and", () => {
      it("should emit the required event with correct params", async () => {
        const tx = await treasury.setRecipientLimit(account.address, 500n);
        await expect(tx).to.emit(treasury, "RecipientLimitUpdated")
          .withArgs(account.address, 0n, 500n);
      });

      it("should set new limit for recipient", async () => {
        await treasury.setRecipientLimit(account.address, 500n);
        const recipientLimits = await treasury.getRecipientLimits();
        const accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit).to.not.be.undefined;
        expect(accountLimit?.limit).to.equal(500n);
      });

      it("should update existing limit for recipient", async () => {
        await treasury.setRecipientLimit(account.address, 500n);
        const tx = await treasury.setRecipientLimit(account.address, 1000n);

        await expect(tx).to.emit(treasury, "RecipientLimitUpdated")
          .withArgs(account.address, 500n, 1000n);

        const recipientLimits = await treasury.getRecipientLimits();
        const accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit?.limit).to.equal(1000n);
      });

      it("should remove recipient when limit set to 0", async () => {
        await treasury.setRecipientLimit(account.address, 500n);
        const tx = await treasury.setRecipientLimit(account.address, 0n);

        await expect(tx).to.emit(treasury, "RecipientLimitUpdated")
          .withArgs(account.address, 500n, 0n);

        const recipientLimits = await treasury.getRecipientLimits();
        expect(recipientLimits.find(rl => rl.recipient === account.address)).to.be.undefined;
      });

      it("should allow type(uint256).max for unlimited withdrawals", async () => {
        const maxLimit = ethers.MaxUint256;
        await treasury.setRecipientLimit(account.address, maxLimit);

        const recipientLimits = await treasury.getRecipientLimits();
        const accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit?.limit).to.equal(maxLimit);
      });

      it("should handle multiple recipients", async () => {
        await treasury.setRecipientLimit(account.address, 500n);
        await treasury.setRecipientLimit(withdrawer.address, 1000n);
        await treasury.setRecipientLimit(pauser.address, 1500n);

        const recipientLimits = await treasury.getRecipientLimits();
        expect(recipientLimits).to.have.length(3);
        expect(recipientLimits.map(rl => rl.recipient)).to.include(account.address);
        expect(recipientLimits.map(rl => rl.recipient)).to.include(withdrawer.address);
        expect(recipientLimits.map(rl => rl.recipient)).to.include(pauser.address);
      });
    });

    describe("Should revert if", () => {
      it("the recipient address is zero", async () => {
        await expect(
          treasury.setRecipientLimit(ADDRESS_ZERO, 100n),
        )
          .to.be.revertedWithCustomError(treasury, "Treasury_RecipientAddressZero");
      });

      describe("called by non-owner, even if it is a ", () => {
        for (const roleName of ["pauser", "rescuer", "withdrawer", "stranger"]) {
          it(roleName, async () => {
            await expect(
              treasury.connect(ROLES[roleName]).setRecipientLimit(account.address, 100n),
            )
              .to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount")
              .withArgs(ROLES[roleName].address, OWNER_ROLE);
          });
        }
      });
    });
  });

  describe("Method 'setRecipientLimitPolicy()'", () => {
    describe("Should execute as expected when called properly and", () => {
      it("should emit the required event", async () => {
        const tx = await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.Disabled);
        await expect(tx).to.emit(treasury, "RecipientLimitPolicyUpdated")
          .withArgs(RecipientLimitPolicy.Disabled);
      });

      it("should set policy to EnforceAll", async () => {
        await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.Disabled);
        await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.EnforceAll);
        expect(await treasury.recipientLimitPolicy()).to.equal(RecipientLimitPolicy.EnforceAll);
      });

      it("should set policy to Disabled", async () => {
        const tx = await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.Disabled);
        await expect(tx).to.emit(treasury, "RecipientLimitPolicyUpdated")
          .withArgs(RecipientLimitPolicy.Disabled);
        expect(await treasury.recipientLimitPolicy()).to.equal(RecipientLimitPolicy.Disabled);
      });

      it("should change policies multiple times", async () => {
        await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.Disabled);
        expect(await treasury.recipientLimitPolicy()).to.equal(RecipientLimitPolicy.Disabled);

        await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.EnforceAll);
        expect(await treasury.recipientLimitPolicy()).to.equal(RecipientLimitPolicy.EnforceAll);

        await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.Disabled);
        expect(await treasury.recipientLimitPolicy()).to.equal(RecipientLimitPolicy.Disabled);
      });
    });

    describe("Should revert if", () => {
      it("the policy is already set to EnforceAll", async () => {
        // Contract is initialized with EnforceAll policy by default
        await expect(
          treasury.setRecipientLimitPolicy(RecipientLimitPolicy.EnforceAll),
        )
          .to.be.revertedWithCustomError(treasury, "Treasury_RecipientLimitPolicyAlreadySet");
      });

      it("the policy is already set to Disabled", async () => {
        await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.Disabled);
        await expect(
          treasury.setRecipientLimitPolicy(RecipientLimitPolicy.Disabled),
        )
          .to.be.revertedWithCustomError(treasury, "Treasury_RecipientLimitPolicyAlreadySet");
      });

      describe("called by non-owner, even if it is a ", () => {
        for (const roleName of ["pauser", "rescuer", "withdrawer", "stranger"]) {
          it(roleName, async () => {
            await expect(
              treasury.connect(ROLES[roleName]).setRecipientLimitPolicy(RecipientLimitPolicy.Disabled),
            )
              .to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount")
              .withArgs(ROLES[roleName].address, OWNER_ROLE);
          });
        }
      });
    });
  });

  describe("Method 'getRecipientLimits()'", () => {
    it("should return empty arrays initially", async () => {
      const recipientLimits = await treasury.getRecipientLimits();
      expect(recipientLimits).to.deep.equal([]);
    });

    it("should return single recipient with limit", async () => {
      await treasury.setRecipientLimit(account.address, 500n);
      const recipientLimits = await treasury.getRecipientLimits();
      expect(recipientLimits).to.have.length(1);
      expect(recipientLimits[0].recipient).to.equal(account.address);
      expect(recipientLimits[0].limit).to.equal(500n);
    });

    it("should return multiple recipients with limits", async () => {
      await treasury.setRecipientLimit(account.address, 500n);
      await treasury.setRecipientLimit(withdrawer.address, 1000n);
      await treasury.setRecipientLimit(pauser.address, 1500n);

      const recipientLimits = await treasury.getRecipientLimits();
      expect(recipientLimits).to.have.length(3);

      const accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
      expect(accountLimit?.limit).to.equal(500n);

      const withdrawerLimit = recipientLimits.find(rl => rl.recipient === withdrawer.address);
      expect(withdrawerLimit?.limit).to.equal(1000n);

      const pauserLimit = recipientLimits.find(rl => rl.recipient === pauser.address);
      expect(pauserLimit?.limit).to.equal(1500n);
    });

    it("should return updated array after limit changes", async () => {
      await treasury.setRecipientLimit(account.address, 500n);
      await treasury.setRecipientLimit(account.address, 1000n);

      const recipientLimits = await treasury.getRecipientLimits();
      const accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
      expect(accountLimit?.limit).to.equal(1000n);
    });

    it("should return updated array after recipient removal", async () => {
      await treasury.setRecipientLimit(account.address, 500n);
      await treasury.setRecipientLimit(withdrawer.address, 1000n);
      await treasury.setRecipientLimit(account.address, 0n); // Remove

      const recipientLimits = await treasury.getRecipientLimits();
      expect(recipientLimits.find(rl => rl.recipient === account.address)).to.be.undefined;
      expect(recipientLimits.find(rl => rl.recipient === withdrawer.address)).to.not.be.undefined;
      expect(recipientLimits).to.have.length(1);
    });
  });

  describe("Method 'recipientLimitPolicy()'", () => {
    it("should return EnforceAll by default after initialization", async () => {
      expect(await treasury.recipientLimitPolicy()).to.equal(RecipientLimitPolicy.EnforceAll);
    });

    it("should return Disabled after setting to Disabled", async () => {
      await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.Disabled);
      expect(await treasury.recipientLimitPolicy()).to.equal(RecipientLimitPolicy.Disabled);
    });

    it("should return correct value after changing policies", async () => {
      await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.Disabled);
      expect(await treasury.recipientLimitPolicy()).to.equal(RecipientLimitPolicy.Disabled);

      await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.EnforceAll);
      expect(await treasury.recipientLimitPolicy()).to.equal(RecipientLimitPolicy.EnforceAll);
    });
  });

  describe("Method 'underlyingToken()'", () => {
    it("should return the correct token address", async () => {
      expect(await treasury.underlyingToken()).to.equal(await tokenMock.getAddress());
    });
  });

  describe("Edge cases", () => {
    describe("Setting recipient limit when policy is Disabled", () => {
      it("should allow setting limit when enforcement is disabled", async () => {
        await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.Disabled);
        const tx = await treasury.setRecipientLimit(account.address, 500n);

        await expect(tx).to.emit(treasury, "RecipientLimitUpdated")
          .withArgs(account.address, 0n, 500n);

        const recipientLimits = await treasury.getRecipientLimits();
        const accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit?.limit).to.equal(500n);
      });

      it("should enforce the stored limit when policy is changed to EnforceAll", async () => {
        // Disable limits and set a limit
        await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.Disabled);
        await treasury.setRecipientLimit(account.address, 200n);

        // Re-enable limits
        await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.EnforceAll);

        // Should enforce the limit
        await expect(
          treasury.connect(withdrawer).withdrawTo(account.address, 300n),
        )
          .to.be.revertedWithCustomError(treasury, "Treasury_InsufficientRecipientLimit")
          .withArgs(account.address, 300n, 200n);

        // Should allow withdrawal within limit
        await expect(
          treasury.connect(withdrawer).withdrawTo(account.address, 200n),
        ).to.not.be.reverted;
      });
    });

    describe("Removing non-existent recipient", () => {
      it("should emit the required event when removing non-existent recipient", async () => {
        const tx = await treasury.setRecipientLimit(stranger.address, 0n);

        await expect(tx).to.emit(treasury, "RecipientLimitUpdated")
          .withArgs(stranger.address, 0n, 0n);

        const recipientLimits = await treasury.getRecipientLimits();
        expect(recipientLimits.find(rl => rl.recipient === stranger.address)).to.be.undefined;
      });
    });

    describe("Re-adding recipient after removal", () => {
      it("should allow re-adding recipient with new limit after removal", async () => {
        // Add recipient with initial limit
        await treasury.setRecipientLimit(account.address, 500n);

        // Remove recipient
        await treasury.setRecipientLimit(account.address, 0n);
        let recipientLimits = await treasury.getRecipientLimits();
        expect(recipientLimits.find(rl => rl.recipient === account.address)).to.be.undefined;

        // Re-add with different limit
        const tx = await treasury.setRecipientLimit(account.address, 1000n);
        await expect(tx).to.emit(treasury, "RecipientLimitUpdated")
          .withArgs(account.address, 0n, 1000n);

        recipientLimits = await treasury.getRecipientLimits();
        const accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit).to.not.be.undefined;
        expect(accountLimit?.limit).to.equal(1000n);
      });
    });

    describe("Zero amount withdrawal", () => {
      beforeEach(async () => {
        await treasury.setRecipientLimit(account.address, 1000n);
      });

      it("should allow zero amount withdrawal with limits enabled", async () => {
        await expect(
          treasury.connect(withdrawer).withdrawTo(account.address, 0n),
        ).to.not.be.reverted;
      });

      it("should not decrement limit for zero amount withdrawal", async () => {
        await treasury.connect(withdrawer).withdrawTo(account.address, 0n);

        const recipientLimits = await treasury.getRecipientLimits();
        const accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit?.limit).to.equal(1000n);
      });

      it("should allow zero amount withdrawal with policy Disabled", async () => {
        await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.Disabled);
        await expect(
          treasury.connect(withdrawer).withdrawTo(account.address, 0n),
        ).to.not.be.reverted;
      });
    });

    describe("Cross-method limit pool sharing", () => {
      it("should share same limit pool between withdraw() and withdrawTo()", async () => {
        await treasury.setRecipientLimit(withdrawer.address, 500n);

        // Use withdraw() first - withdraws to self
        await treasury.connect(withdrawer).withdraw(200n);

        let recipientLimits = await treasury.getRecipientLimits();
        let withdrawerLimit = recipientLimits.find(rl => rl.recipient === withdrawer.address);
        expect(withdrawerLimit?.limit).to.equal(300n);

        // Use withdrawTo() to same address
        await treasury.connect(withdrawer).withdrawTo(withdrawer.address, 100n);

        recipientLimits = await treasury.getRecipientLimits();
        withdrawerLimit = recipientLimits.find(rl => rl.recipient === withdrawer.address);
        expect(withdrawerLimit?.limit).to.equal(200n);
      });

      it("should fail when combined withdrawals exceed limit", async () => {
        await treasury.setRecipientLimit(withdrawer.address, 300n);

        // Use withdraw() for part of the limit
        await treasury.connect(withdrawer).withdraw(200n);

        // Try to use withdrawTo() for more than remaining limit
        await expect(
          treasury.connect(withdrawer).withdrawTo(withdrawer.address, 150n),
        )
          .to.be.revertedWithCustomError(treasury, "Treasury_InsufficientRecipientLimit")
          .withArgs(withdrawer.address, 150n, 100n);
      });
    });
  });

  describe("Recipient limit policy integration tests", () => {
    describe("With policy EnforceAll (default)", () => {
      it("should enforce allowlist - only configured recipients can receive funds", async () => {
        await treasury.setRecipientLimit(account.address, 500n);

        // Should succeed for configured recipient
        await expect(
          treasury.connect(withdrawer).withdrawTo(account.address, 100n),
        ).to.not.be.reverted;

        // Should fail for non-configured recipient
        await expect(
          treasury.connect(withdrawer).withdrawTo(stranger.address, 100n),
        )
          .to.be.revertedWithCustomError(treasury, "Treasury_InsufficientRecipientLimit");
      });

      it("should allow unlimited withdrawals for type(uint256).max recipients", async () => {
        const maxLimit = ethers.MaxUint256;
        await treasury.setRecipientLimit(account.address, maxLimit);

        // Make multiple withdrawals
        await treasury.connect(withdrawer).withdrawTo(account.address, 2000n);
        await treasury.connect(withdrawer).withdrawTo(account.address, 3000n);
        await treasury.connect(withdrawer).withdrawTo(account.address, 1000n);

        const recipientLimits = await treasury.getRecipientLimits();
        const accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit?.limit).to.equal(maxLimit); // Should still be max
      });

      it("should handle multiple withdrawals until limit exhausted", async () => {
        await treasury.setRecipientLimit(account.address, 300n);

        await treasury.connect(withdrawer).withdrawTo(account.address, 100n);
        await treasury.connect(withdrawer).withdrawTo(account.address, 100n);
        await treasury.connect(withdrawer).withdrawTo(account.address, 100n);

        const recipientLimits = await treasury.getRecipientLimits();
        const accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit?.limit).to.equal(0n);

        // Next withdrawal should fail
        await expect(
          treasury.connect(withdrawer).withdrawTo(account.address, 1n),
        )
          .to.be.revertedWithCustomError(treasury, "Treasury_InsufficientRecipientLimit");
      });

      it("should keep recipient in map when limit reaches 0 after withdrawals", async () => {
        await treasury.setRecipientLimit(account.address, 100n);
        await treasury.connect(withdrawer).withdrawTo(account.address, 100n);

        const recipientLimits = await treasury.getRecipientLimits();
        const accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit).to.not.be.undefined;
        expect(accountLimit?.limit).to.equal(0n);
      });
    });

    describe("With policy Disabled", () => {
      beforeEach(async () => {
        await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.Disabled);
      });

      it("should allow withdrawals to any address without checks", async () => {
        // No limit set for stranger
        await expect(
          treasury.connect(withdrawer).withdrawTo(stranger.address, 100n),
        ).to.not.be.reverted;
      });

      it("should not decrement recipient limits", async () => {
        await treasury.setRecipientLimit(account.address, 500n);

        await treasury.connect(withdrawer).withdrawTo(account.address, 100n);

        const recipientLimits = await treasury.getRecipientLimits();
        const accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit?.limit).to.equal(500n); // Should remain unchanged
      });

      it("should allow withdrawal even if limit would be insufficient", async () => {
        await treasury.setRecipientLimit(account.address, 50n);

        await expect(
          treasury.connect(withdrawer).withdrawTo(account.address, 100n),
        ).to.not.be.reverted;

        const recipientLimits = await treasury.getRecipientLimits();
        const accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit?.limit).to.equal(50n); // Should remain unchanged
      });
    });

    describe("Switching between policies", () => {
      it("should resume enforcement from last recorded values when switching from Disabled to EnforceAll", async () => {
        await treasury.setRecipientLimit(account.address, 500n);

        // Make withdrawal with EnforceAll policy
        await treasury.connect(withdrawer).withdrawTo(account.address, 100n);

        // Change to Disabled and make more withdrawals
        await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.Disabled);
        await treasury.connect(withdrawer).withdrawTo(account.address, 200n);

        // Change back to EnforceAll
        await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.EnforceAll);

        // Check that limit is still 400n (500n - 100n from first withdrawal)
        const recipientLimits = await treasury.getRecipientLimits();
        const accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit?.limit).to.equal(400n);

        // Should only allow withdrawal up to remaining limit
        await expect(
          treasury.connect(withdrawer).withdrawTo(account.address, 500n),
        )
          .to.be.revertedWithCustomError(treasury, "Treasury_InsufficientRecipientLimit");

        await expect(
          treasury.connect(withdrawer).withdrawTo(account.address, 400n),
        ).to.not.be.reverted;
      });

      it("should allow withdrawals without decrement when switching to Disabled", async () => {
        await treasury.setRecipientLimit(account.address, 500n);

        // Make withdrawal with EnforceAll policy (should decrement)
        await treasury.connect(withdrawer).withdrawTo(account.address, 100n);

        let recipientLimits = await treasury.getRecipientLimits();
        let accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit?.limit).to.equal(400n);

        // Change to Disabled
        await treasury.setRecipientLimitPolicy(RecipientLimitPolicy.Disabled);

        // Make more withdrawals (should not decrement)
        await treasury.connect(withdrawer).withdrawTo(account.address, 500n);

        recipientLimits = await treasury.getRecipientLimits();
        accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit?.limit).to.equal(400n); // Should remain 400n (not decremented)
      });
    });
  });

  describe("Method 'proveTreasury()'", () => {
    it("should execute without reverting", async () => {
      await expect(treasury.proveTreasury()).to.not.be.reverted;
    });
  });

  describe("Pause/Unpause functionality", () => {
    beforeEach(async () => {
      // Set up recipient limit for testing withdrawals
      await treasury.setRecipientLimit(account.address, 1000n);
    });

    describe("Method 'pause()'", () => {
      it("should pause the contract", async () => {
        await treasury.connect(pauser).pause();
        expect(await treasury.paused()).to.equal(true);
      });

      it("should emit the required event", async () => {
        const tx = await treasury.connect(pauser).pause();
        await expect(tx).to.emit(treasury, "Paused").withArgs(pauser.address);
      });

      describe("Should revert if", () => {
        describe("called by non-pauser, even if it is a ", () => {
          for (const roleName of ["owner", "withdrawer", "rescuer", "stranger"]) {
            it(roleName, async () => {
              await expect(
                treasury.connect(ROLES[roleName]).pause(),
              )
                .to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount")
                .withArgs(ROLES[roleName].address, PAUSER_ROLE);
            });
          }
        });

        it("the contract is already paused", async () => {
          await treasury.connect(pauser).pause();
          await expect(
            treasury.connect(pauser).pause(),
          )
            .to.be.revertedWithCustomError(treasury, "EnforcedPause");
        });
      });
    });

    describe("Method 'unpause()'", () => {
      beforeEach(async () => {
        // Pause the contract first
        await treasury.connect(pauser).pause();
      });

      it("should unpause the contract", async () => {
        await treasury.connect(pauser).unpause();
        expect(await treasury.paused()).to.equal(false);
      });

      it("should emit the required event", async () => {
        const tx = await treasury.connect(pauser).unpause();
        await expect(tx).to.emit(treasury, "Unpaused").withArgs(pauser.address);
      });

      describe("Should revert if", () => {
        describe("called by non-pauser, even if it is a ", () => {
          for (const roleName of ["owner", "withdrawer", "rescuer", "stranger"]) {
            it(roleName, async () => {
              await expect(
                treasury.connect(ROLES[roleName]).unpause(),
              )
                .to.be.revertedWithCustomError(treasury, "AccessControlUnauthorizedAccount")
                .withArgs(ROLES[roleName].address, PAUSER_ROLE);
            });
          }
        });

        it("the contract is not paused", async () => {
          await treasury.connect(pauser).unpause();
          await expect(
            treasury.connect(pauser).unpause(),
          )
            .to.be.revertedWithCustomError(treasury, "ExpectedPause");
        });
      });
    });

    describe("Pause/unpause cycle", () => {
      it("should allow withdrawals after unpausing", async () => {
        // Initial withdrawal should work
        await expect(
          treasury.connect(withdrawer).withdrawTo(account.address, 100n),
        ).to.not.be.reverted;

        // Pause the contract
        await treasury.connect(pauser).pause();

        // Withdrawal should fail when paused
        await expect(
          treasury.connect(withdrawer).withdrawTo(account.address, 100n),
        )
          .to.be.revertedWithCustomError(treasury, "EnforcedPause");

        // Unpause the contract
        await treasury.connect(pauser).unpause();

        // Withdrawal should work again after unpause
        await expect(
          treasury.connect(withdrawer).withdrawTo(account.address, 100n),
        ).to.not.be.reverted;
      });

      it("should preserve recipient limits through pause/unpause cycle", async () => {
        // Make a withdrawal
        await treasury.connect(withdrawer).withdrawTo(account.address, 300n);

        let recipientLimits = await treasury.getRecipientLimits();
        let accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit?.limit).to.equal(700n);

        // Pause and unpause
        await treasury.connect(pauser).pause();
        await treasury.connect(pauser).unpause();

        // Limit should remain unchanged
        recipientLimits = await treasury.getRecipientLimits();
        accountLimit = recipientLimits.find(rl => rl.recipient === account.address);
        expect(accountLimit?.limit).to.equal(700n);

        // Should allow withdrawal up to remaining limit
        await expect(
          treasury.connect(withdrawer).withdrawTo(account.address, 700n),
        ).to.not.be.reverted;
      });

      it("should allow multiple pause/unpause cycles", async () => {
        for (let i = 0; i < 3; i++) {
          // Pause
          await treasury.connect(pauser).pause();
          expect(await treasury.paused()).to.equal(true);

          // Verify withdrawal fails
          await expect(
            treasury.connect(withdrawer).withdrawTo(account.address, 10n),
          )
            .to.be.revertedWithCustomError(treasury, "EnforcedPause");

          // Unpause
          await treasury.connect(pauser).unpause();
          expect(await treasury.paused()).to.equal(false);

          // Verify withdrawal works
          await expect(
            treasury.connect(withdrawer).withdrawTo(account.address, 10n),
          ).to.not.be.reverted;
        }
      });

      it("should allow admin functions while paused", async () => {
        await treasury.connect(pauser).pause();

        // Owner functions should work while paused
        await expect(
          treasury.setRecipientLimit(stranger.address, 500n),
        ).to.not.be.reverted;

        await expect(
          treasury.setRecipientLimitPolicy(RecipientLimitPolicy.Disabled),
        ).to.not.be.reverted;

        // View functions should work while paused
        expect(await treasury.underlyingToken()).to.equal(await tokenMock.getAddress());
        expect(await treasury.recipientLimitPolicy()).to.equal(RecipientLimitPolicy.Disabled);

        const recipientLimits = await treasury.getRecipientLimits();
        expect(recipientLimits.length).to.be.greaterThan(0);
      });
    });
  });
});
