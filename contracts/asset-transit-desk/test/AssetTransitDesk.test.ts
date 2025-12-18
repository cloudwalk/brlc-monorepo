/* eslint @typescript-eslint/no-unused-expressions: "off" */
import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { setUpFixture, checkEquality, resultToObject } from "../test-utils/common";
import * as Contracts from "../typechain-types";
import { checkTokenPath } from "../test-utils/eth";

const ADDRESS_ZERO = ethers.ZeroAddress;
const SOME_ADDRESS = "0x1234567890123456789012345678901234567890";
const BALANCE_INITIAL = 10000n;

const OWNER_ROLE = ethers.id("OWNER_ROLE");
const GRANTOR_ROLE = ethers.id("GRANTOR_ROLE");
const MANAGER_ROLE = ethers.id("MANAGER_ROLE");
const CASHBACK_OPERATOR_ROLE = ethers.id("CASHBACK_OPERATOR_ROLE");
const PAUSER_ROLE = ethers.id("PAUSER_ROLE");
const RESCUER_ROLE = ethers.id("RESCUER_ROLE");

let assetTransitDeskFactory: Contracts.AssetTransitDesk__factory;
let tokenMockFactory: Contracts.ERC20TokenMock__factory;
let treasuryFactory: Contracts.TreasuryMock__factory;

let deployer: HardhatEthersSigner; // has GRANTOR_ROLE AND OWNER_ROLE
let manager: HardhatEthersSigner; // has MANAGER_ROLE
let account: HardhatEthersSigner; // has no roles
let pauser: HardhatEthersSigner; // has PAUSER_ROLE
let stranger: HardhatEthersSigner; // has no roles

const EXPECTED_VERSION = {
  major: 1,
  minor: 2,
  patch: 0,
};

enum OperationStatus {
  Nonexistent = 0,
  Successful = 1,
}

async function deployContracts() {
  const name = "ERC20 Test";
  const symbol = "TEST";

  const tokenMockDeployment = await tokenMockFactory.deploy(name, symbol);
  await tokenMockDeployment.waitForDeployment();

  const tokenMock = tokenMockDeployment.connect(deployer);
  const tokenAddress = await tokenMock.getAddress();

  const assetTransitDesk = await upgrades.deployProxy(assetTransitDeskFactory, [tokenAddress]);
  await assetTransitDesk.waitForDeployment();

  const treasury = await treasuryFactory.deploy(tokenAddress);
  await treasury.waitForDeployment();

  return { assetTransitDesk, tokenMock, treasury };
}

async function configureContracts(
  assetTransitDesk: Contracts.AssetTransitDesk,
  tokenMock: Contracts.ERC20TokenMock,
  treasury: Contracts.TreasuryMock,
) {
  await assetTransitDesk.grantRole(GRANTOR_ROLE, deployer.address);
  await assetTransitDesk.grantRole(MANAGER_ROLE, manager.address);
  await assetTransitDesk.grantRole(PAUSER_ROLE, pauser.address);

  await tokenMock.mint(account, BALANCE_INITIAL);
  await tokenMock.mint(treasury, BALANCE_INITIAL);

  await tokenMock.connect(account).approve(assetTransitDesk, BALANCE_INITIAL);

  await assetTransitDesk.setTreasury(treasury);
}

async function deployAndConfigureContracts() {
  const contracts = await deployContracts();

  await configureContracts(contracts.assetTransitDesk, contracts.tokenMock, contracts.treasury);
  return contracts;
}

describe("Contract 'AssetTransitDesk'", () => {
  before(async () => {
    [deployer, manager, account, pauser, stranger] = await ethers.getSigners();

    assetTransitDeskFactory = await ethers.getContractFactory("AssetTransitDesk");
    assetTransitDeskFactory = assetTransitDeskFactory.connect(deployer);
    tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenMockFactory = tokenMockFactory.connect(deployer);
    treasuryFactory = await ethers.getContractFactory("TreasuryMock");
    treasuryFactory = treasuryFactory.connect(deployer);
  });

  let assetTransitDesk: Contracts.AssetTransitDesk;
  let tokenMock: Contracts.ERC20TokenMock;
  let treasury: Contracts.TreasuryMock;

  beforeEach(async () => {
    ({ assetTransitDesk, tokenMock, treasury } = await setUpFixture(deployAndConfigureContracts));
  });

  describe("Method 'initialize()'", () => {
    let deployedContract: Contracts.AssetTransitDesk;

    beforeEach(async () => {
      // deploying contract without configuration to test the default state
      const contracts = await setUpFixture(deployContracts);
      deployedContract = contracts.assetTransitDesk;
    });

    describe("Should execute as expected when called properly and", () => {
      it("should expose correct role hashes", async () => {
        expect(await deployedContract.OWNER_ROLE()).to.equal(OWNER_ROLE);
        expect(await deployedContract.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.PAUSER_ROLE()).to.equal(PAUSER_ROLE);
        expect(await deployedContract.RESCUER_ROLE()).to.equal(RESCUER_ROLE);
        expect(await deployedContract.MANAGER_ROLE()).to.equal(MANAGER_ROLE);
      });

      it("should set correct role admins", async () => {
        expect(await deployedContract.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
        expect(await deployedContract.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
        expect(await deployedContract.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.getRoleAdmin(RESCUER_ROLE)).to.equal(GRANTOR_ROLE);
        expect(await deployedContract.getRoleAdmin(MANAGER_ROLE)).to.equal(GRANTOR_ROLE);
      });

      it("should set correct roles for the deployer", async () => {
        expect(await deployedContract.hasRole(OWNER_ROLE, deployer)).to.be.true;
        expect(await deployedContract.hasRole(GRANTOR_ROLE, deployer)).to.be.false;
        expect(await deployedContract.hasRole(PAUSER_ROLE, deployer)).to.be.false;
        expect(await deployedContract.hasRole(RESCUER_ROLE, deployer)).to.be.false;
        expect(await deployedContract.hasRole(MANAGER_ROLE, deployer)).to.be.false;
        expect(await deployedContract.hasRole(CASHBACK_OPERATOR_ROLE, deployer)).to.be.false;
      });

      it("should not pause the contract", async () => {
        expect(await deployedContract.paused()).to.equal(false);
      });

      it("should set correct underlying token address", async () => {
        expect(await assetTransitDesk.underlyingToken()).to.equal(tokenMock);
      });
    });

    describe("Should revert if", () => {
      it("called a second time", async () => {
        await expect(deployedContract.initialize(tokenMock))
          .to.be.revertedWithCustomError(deployedContract, "InvalidInitialization");
      });

      it("the provided token address is zero", async () => {
        const tx = upgrades.deployProxy(assetTransitDeskFactory, [ADDRESS_ZERO]);
        await expect(tx)
          .to.be.revertedWithCustomError(assetTransitDeskFactory, "AssetTransitDesk_TokenAddressZero");
      });
    });
  });

  describe("Method 'upgradeToAndCall()'", () => {
    describe("Should execute as expected when called properly and", () => {
      it("should upgrade the contract to a new implementation", async () => {
        const newImplementation = await assetTransitDeskFactory.deploy();
        await newImplementation.waitForDeployment();

        const tx = assetTransitDesk.upgradeToAndCall(await newImplementation.getAddress(), "0x");
        await expect(tx).to.emit(assetTransitDesk, "Upgraded").withArgs(await newImplementation.getAddress());
      });
    });

    describe("Should revert if", () => {
      it("called with the address of an incompatible implementation", async () => {
        const tx = assetTransitDesk.upgradeToAndCall(await tokenMock.getAddress(), "0x");
        await expect(tx)
          .to.be.revertedWithCustomError(assetTransitDesk, "AssetTransitDesk_ImplementationAddressInvalid");
      });

      it("called by a non-owner", async () => {
        const tx = assetTransitDesk.connect(stranger).upgradeToAndCall(tokenMock.getAddress(), "0x");
        await expect(tx)
          .to.be.revertedWithCustomError(assetTransitDesk, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, OWNER_ROLE);
      });
    });
  });

  describe("Method '$__VERSION()'", () => {
    it("should return the expected version", async () => {
      expect(await assetTransitDesk.$__VERSION()).to.deep.equal([
        EXPECTED_VERSION.major,
        EXPECTED_VERSION.minor,
        EXPECTED_VERSION.patch,
      ]);
    });
  });

  describe("Method 'issueAsset()'", () => {
    describe("Should execute as expected when called properly and", () => {
      let tx: TransactionResponse;
      const principalAmount = 100n;
      const assetIssuanceId = ethers.encodeBytes32String("assetIssuanceId");

      beforeEach(async () => {
        tx = await assetTransitDesk.connect(manager).issueAsset(
          assetIssuanceId,
          account.address,
          principalAmount,
        );
      });

      it("should emit the required event", async () => {
        await expect(tx).to.emit(assetTransitDesk, "AssetIssued").withArgs(
          assetIssuanceId,
          account.address,
          principalAmount,
        );
      });

      it("should update token balances correctly", async () => {
        await expect(tx).to.changeTokenBalances(tokenMock,
          [treasury, account, assetTransitDesk],
          [principalAmount, -principalAmount, 0],
        );
      });

      it("should transfer tokens correctly", async () => {
        await checkTokenPath(tx,
          tokenMock,
          [account, assetTransitDesk, treasury],
          principalAmount,
        );
      });

      it("should store the issuance operation correctly", async () => {
        checkEquality(
          resultToObject(await assetTransitDesk.getIssuanceOperation(assetIssuanceId)),
          {
            status: OperationStatus.Successful,
            buyer: account.address,
            principalAmount: principalAmount,
          });
      });
    });

    describe("Should revert if", () => {
      const assetIssuanceId = ethers.encodeBytes32String("assetIssuanceId");
      it("called by a non-manager", async () => {
        await expect(
          assetTransitDesk.connect(stranger).issueAsset(assetIssuanceId, account.address, 10n),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, MANAGER_ROLE);
      });

      it("the principal amount is zero", async () => {
        await expect(
          assetTransitDesk.connect(manager).issueAsset(assetIssuanceId, account.address, 0n),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "AssetTransitDesk_PrincipalAmountZero");
      });

      it("the asset issuance ID is zero", async () => {
        await expect(
          assetTransitDesk.connect(manager).issueAsset(ethers.ZeroHash, account.address, 10n),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "AssetTransitDesk_OperationIdZero");
      });

      it("the buyer address is zero", async () => {
        await expect(
          assetTransitDesk.connect(manager).issueAsset(assetIssuanceId, ADDRESS_ZERO, 10n),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "AssetTransitDesk_BuyerAddressZero");
      });

      it("the contract is paused", async () => {
        await assetTransitDesk.connect(pauser).pause();
        await expect(
          assetTransitDesk.connect(manager).issueAsset(assetIssuanceId, account.address, 10n),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "EnforcedPause");
      });

      it("the operation already exists", async () => {
        const someAmount = 10n;
        await assetTransitDesk.connect(manager).issueAsset(assetIssuanceId, account.address, someAmount);

        await expect(
          assetTransitDesk.connect(manager).issueAsset(assetIssuanceId, account.address, someAmount),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "AssetTransitDesk_OperationAlreadyExists");
      });

      it("the treasury is not configured", async () => {
        const { assetTransitDesk: freshDesk, tokenMock: freshToken } = await deployContracts();
        await freshDesk.grantRole(GRANTOR_ROLE, deployer.address);
        await freshDesk.grantRole(MANAGER_ROLE, manager.address);
        await freshToken.mint(account, BALANCE_INITIAL);
        await freshToken.connect(account).approve(freshDesk, BALANCE_INITIAL);

        await expect(
          freshDesk.connect(manager).issueAsset(assetIssuanceId, account.address, 10n),
        )
          .to.be.revertedWithCustomError(freshDesk, "AssetTransitDesk_TreasuryAddressZero");
      });
    });
  });

  describe("Method 'redeemAsset()'", () => {
    for (const netYieldAmount of [0n, 10n]) {
      describe(`Should execute as expected when called properly with ${
        netYieldAmount === 0n ? "zero" : "non-zero"
      } net yield amount and`, () => {
        let tx: TransactionResponse;
        const principalAmount = 100n;
        const assetRedemptionId = ethers.encodeBytes32String("assetRedemptionId");

        beforeEach(async () => {
          tx = await assetTransitDesk.connect(manager).redeemAsset(
            assetRedemptionId,
            account.address,
            principalAmount,
            netYieldAmount,
          );
        });

        it("should emit the required event", async () => {
          await expect(tx).to.emit(assetTransitDesk, "AssetRedeemed")
            .withArgs(assetRedemptionId, account.address, principalAmount, netYieldAmount);
        });

        it("should update token balances correctly", async () => {
          await expect(tx).to.changeTokenBalances(tokenMock,
            [treasury, account, assetTransitDesk],
            [-(principalAmount + netYieldAmount), principalAmount + netYieldAmount, 0],
          );
        });

        it("should transfer tokens correctly", async () => {
          await checkTokenPath(tx,
            tokenMock,
            [treasury, assetTransitDesk],
            principalAmount + netYieldAmount,
          );
          await checkTokenPath(tx,
            tokenMock,
            [assetTransitDesk, account],
            principalAmount + netYieldAmount,
          );
        });

        it("should store the redemption operation correctly", async () => {
          checkEquality(
            resultToObject(await assetTransitDesk.getRedemptionOperation(assetRedemptionId)),
            {
              status: OperationStatus.Successful,
              buyer: account.address,
              principalAmount: principalAmount,
              netYieldAmount: netYieldAmount,
            });
        });
      });
    }

    describe("Should revert if", () => {
      const assetRedemptionId = ethers.encodeBytes32String("assetRedemptionId");
      it("called by a non-manager", async () => {
        await expect(
          assetTransitDesk.connect(stranger).redeemAsset(assetRedemptionId, account.address, 10n, 10n),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, MANAGER_ROLE);
      });

      it("the principal amount is zero", async () => {
        await expect(
          assetTransitDesk.connect(manager).redeemAsset(assetRedemptionId, account.address, 0n, 10n),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "AssetTransitDesk_PrincipalAmountZero");
      });

      it("the asset redemption ID is zero", async () => {
        await expect(
          assetTransitDesk.connect(manager).redeemAsset(ethers.ZeroHash, account.address, 10n, 10n),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "AssetTransitDesk_OperationIdZero");
      });

      it("the buyer address is zero", async () => {
        await expect(
          assetTransitDesk.connect(manager).redeemAsset(assetRedemptionId, ADDRESS_ZERO, 10n, 10n),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "AssetTransitDesk_BuyerAddressZero");
      });

      it("the contract is paused", async () => {
        await assetTransitDesk.connect(pauser).pause();
        await expect(
          assetTransitDesk.connect(manager).redeemAsset(assetRedemptionId, account.address, 10n, 10n),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "EnforcedPause");
      });

      it("the operation already exists", async () => {
        const someAmount = 10n;
        const someNetYieldAmount = 10n;
        await assetTransitDesk.connect(manager).redeemAsset(
          assetRedemptionId,
          account.address,
          someAmount,
          someNetYieldAmount,
        );

        await expect(
          assetTransitDesk.connect(manager).redeemAsset(
            assetRedemptionId,
            account.address,
            someAmount,
            someNetYieldAmount,
          ),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "AssetTransitDesk_OperationAlreadyExists");
      });

      it("the treasury is not configured", async () => {
        const { assetTransitDesk: freshDesk } = await deployContracts();
        await freshDesk.grantRole(GRANTOR_ROLE, deployer.address);
        await freshDesk.grantRole(MANAGER_ROLE, manager.address);

        await expect(
          freshDesk.connect(manager).redeemAsset(assetRedemptionId, account.address, 10n, 10n),
        )
          .to.be.revertedWithCustomError(freshDesk, "AssetTransitDesk_TreasuryAddressZero");
      });
    });
  });

  describe("Method 'setTreasury()'", () => {
    let newTreasury: Contracts.TreasuryMock;

    async function getNewValidTreasury() {
      const tokenAddress = await tokenMock.getAddress();
      const treasury = await treasuryFactory.deploy(tokenAddress);
      await treasury.waitForDeployment();
      return treasury;
    }

    beforeEach(async () => {
      newTreasury = await setUpFixture(getNewValidTreasury);
    });

    describe("Should execute as expected when called properly and", () => {
      let tx: TransactionResponse;

      beforeEach(async () => {
        tx = await assetTransitDesk.setTreasury(newTreasury);
      });

      it("should emit the required event", async () => {
        await expect(tx).to.emit(assetTransitDesk, "TreasuryChanged").withArgs(newTreasury, treasury);
      });

      it("should update the treasury address", async () => {
        expect(await assetTransitDesk.getTreasury()).to.equal(newTreasury);
      });
    });

    describe("Should revert if", () => {
      it("called by a non-owner", async () => {
        await expect(
          assetTransitDesk.connect(stranger).setTreasury(newTreasury),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, OWNER_ROLE);
      });

      it("the new treasury address is zero", async () => {
        await expect(
          assetTransitDesk.setTreasury(ADDRESS_ZERO),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "AssetTransitDesk_TreasuryAddressZero");
      });

      it("the new treasury address is the same as the current treasury address", async () => {
        await expect(
          assetTransitDesk.setTreasury(treasury),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "AssetTransitDesk_TreasuryAlreadyConfigured");
      });

      it("the new treasury address is not a smart contract", async () => {
        await expect(
          assetTransitDesk.setTreasury(stranger),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "AssetTransitDesk_TreasuryAddressInvalid");
      });

      it("the new treasury address is not implementing the required interface", async () => {
        await expect(
          assetTransitDesk.setTreasury(tokenMock),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "AssetTransitDesk_TreasuryAddressInvalid");
      });

      it("the new treasury token does not match the underlying token", async () => {
        await newTreasury.setToken(SOME_ADDRESS);

        await expect(
          assetTransitDesk.setTreasury(newTreasury),
        )
          .to.be.revertedWithCustomError(assetTransitDesk, "AssetTransitDesk_TreasuryTokenMismatch");
      });
    });
  });

  describe("Method 'getTreasury()'", () => {
    it("should return the correct treasury address", async () => {
      expect(await assetTransitDesk.getTreasury()).to.equal(treasury);
    });
  });

  describe("Method 'approve()'", () => {
    describe("Should execute as expected when called properly and", () => {
      let tx: TransactionResponse;

      beforeEach(async () => {
        tx = await assetTransitDesk.approve(treasury, BALANCE_INITIAL);
      });

      it("should emit the required event", async () => {
        await expect(tx).to.emit(tokenMock, "Approval").withArgs(assetTransitDesk, treasury, BALANCE_INITIAL);
      });

      it("should update the allowance", async () => {
        expect(await tokenMock.allowance(assetTransitDesk, treasury)).to.equal(BALANCE_INITIAL);
      });
    });

    describe("Should revert if", () => {
      it("called by a non-owner", async () => {
        await expect(assetTransitDesk.connect(stranger).approve(treasury, BALANCE_INITIAL))
          .to.be.revertedWithCustomError(assetTransitDesk, "AccessControlUnauthorizedAccount")
          .withArgs(stranger.address, OWNER_ROLE);
      });
    });
  });

  describe("Snapshot scenarios", () => {
    it("Simple usage scenario", async () => {
      const issuanceId = ethers.encodeBytes32String("issuance-id");
      const redemptionId = ethers.encodeBytes32String("redemption-id");

      await expect.startChainshot({
        name: "Usage example",
        accounts: { deployer, manager, account, pauser, stranger },
        contracts: { assetTransitDesk, treasury },
        tokens: { BRLC: tokenMock },
        customState: {
          issuanceOperation() {
            return assetTransitDesk.getIssuanceOperation(issuanceId);
          },
          redemptionOperation() {
            return assetTransitDesk.getRedemptionOperation(redemptionId);
          },
        },
      });

      await assetTransitDesk.connect(manager).issueAsset(
        issuanceId,
        account.address,
        100n,
      );
      await assetTransitDesk.connect(manager).redeemAsset(
        redemptionId,
        account.address,
        100n,
        10n,
      );

      await expect.stopChainshot();
    });

    it("Configuration scenario", async () => {
      const { assetTransitDesk, tokenMock, treasury } = await deployContracts();

      await expect.startChainshot({
        name: "Configuration",
        accounts: { deployer, manager, account, pauser },
        contracts: { assetTransitDesk, treasury },
        tokens: { BRLC: tokenMock },
        customState: {
          treasury() {
            return assetTransitDesk.getTreasury();
          },
        },
      });

      await assetTransitDesk.setTreasury(treasury);

      await expect.stopChainshot();
    });
  });
});
