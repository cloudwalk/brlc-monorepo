import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { checkContractUupsUpgrading, connect, getAddress, proveTx } from "../test-utils/eth";
import { checkEquality, maxUintForBits, setUpFixture } from "../test-utils/common";

const EXPECTED_VERSION: Version = {
  major: 1,
  minor: 2,
  patch: 0,
};

// Events of the contract under test
const EVENT_NAME_ADVANCED_NET_YIELD_REDUCED = "AdvancedNetYieldReduced";
const EVENT_NAME_ASSET_YIELD_BURNED = "AssetYieldBurned";
const EVENT_NAME_ASSET_YIELD_MINTED = "AssetYieldMinted";
const EVENT_NAME_NET_YIELD_ADVANCED = "NetYieldAdvanced";
const EVENT_NAME_OPERATIONAL_TREASURY_UPDATED = "OperationalTreasuryUpdated";

// Errors of the library contracts
const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";
const ERROR_NAME_ENFORCED_PAUSE = "EnforcedPause";
const ERROR_NAME_INVALID_INITIALIZATION = "InvalidInitialization";

// Errors of the contract under test
const ERROR_NAME_ACCOUNT_ADDRESS_ZERO = "NetYieldDistributor_AccountAddressZero";
const ERROR_NAME_ACCOUNTS_AND_AMOUNTS_LENGTH_MISMATCH = "NetYieldDistributor_AccountsAndAmountsLengthMismatch";
const ERROR_NAME_ACCOUNTS_ARRAY_EMPTY = "NetYieldDistributor_AccountsArrayEmpty";
const ERROR_NAME_ADVANCED_NET_YIELD_INSUFFICIENT_BALANCE = "NetYieldDistributor_AdvancedNetYieldInsufficientBalance";
const ERROR_NAME_AMOUNT_ZERO = "NetYieldDistributor_AmountZero";
const ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID = "NetYieldDistributor_ImplementationAddressInvalid";
const ERROR_NAME_TOTAL_ADVANCED_NET_YIELD_EXCESS = "NetYieldDistributor_TotalAdvancedNetYieldExcess";
const ERROR_NAME_TREASURY_ADDRESS_ALREADY_SET = "NetYieldDistributor_TreasuryAddressAlreadySet";
const ERROR_NAME_TREASURY_UNDERLYING_TOKEN_MISMATCH = "NetYieldDistributor_TreasuryUnderlyingTokenMismatch";
const ERROR_NAME_UNDERLYING_TOKEN_ADDRESS_ZERO = "NetYieldDistributor_UnderlyingTokenAddressZero";

const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
const PAUSER_ROLE: string = ethers.id("PAUSER_ROLE");
const RESCUER_ROLE: string = ethers.id("RESCUER_ROLE");
const MINTER_ROLE: string = ethers.id("MINTER_ROLE");
const MANAGER_ROLE: string = ethers.id("MANAGER_ROLE");

const ADDRESS_ZERO = ethers.ZeroAddress;

const YIELD_AMOUNT_BASE = 12_345_678n;
const YIELD_AMOUNT_VARIANTS: bigint[] = [
  YIELD_AMOUNT_BASE,
  YIELD_AMOUNT_BASE * 2n,
  YIELD_AMOUNT_BASE * 3n,
  YIELD_AMOUNT_BASE * 4n,
];

const YIELD_AMOUNT = 1_000_000_000n;

interface Version {
  major: number;
  minor: number;
  patch: number;

  [key: string]: number; // Indexing signature to ensure that fields are iterated over in a key-value style
}

interface Fixture {
  netYieldDistributor: Contract;
  tokenMock: Contract;
  treasuryMock: Contract;
}

describe("Contract 'NetYieldDistributor'", async () => {
  let netYieldDistributorFactory: ContractFactory;

  let deployer: HardhatEthersSigner;
  let minter: HardhatEthersSigner;
  let manager: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let users: HardhatEthersSigner[];

  before(async () => {
    let moreUsers: HardhatEthersSigner[];
    [deployer, minter, manager, stranger, user, ...moreUsers] = await ethers.getSigners();
    users = [user, ...moreUsers];

    netYieldDistributorFactory = await ethers.getContractFactory("NetYieldDistributor");
    netYieldDistributorFactory = netYieldDistributorFactory.connect(deployer);
  });

  async function deployTokenMock(): Promise<Contract> {
    const name = "ERC20 Test";
    const symbol = "TEST";

    let tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenMockFactory = tokenMockFactory.connect(deployer);

    let tokenMock = await tokenMockFactory.deploy(name, symbol) as Contract;
    await tokenMock.waitForDeployment();
    tokenMock = connect(tokenMock, deployer);

    return tokenMock;
  }

  async function deployTreasuryMock(tokenAddress: string): Promise<Contract> {
    let treasuryMockFactory = await ethers.getContractFactory("TreasuryMock");
    treasuryMockFactory = treasuryMockFactory.connect(deployer);

    let treasuryMock = await treasuryMockFactory.deploy(tokenAddress) as Contract;
    await treasuryMock.waitForDeployment();
    treasuryMock = connect(treasuryMock, deployer);

    return treasuryMock;
  }

  async function deployContracts(): Promise<Fixture> {
    const tokenMock = await deployTokenMock();
    const treasuryMock = await deployTreasuryMock(getAddress(tokenMock));

    let netYieldDistributor = await upgrades.deployProxy(
      netYieldDistributorFactory,
      [getAddress(tokenMock)],
    ) as Contract;
    await netYieldDistributor.waitForDeployment();
    netYieldDistributor = connect(netYieldDistributor, deployer);

    return {
      netYieldDistributor,
      tokenMock,
      treasuryMock,
    };
  }

  async function deployAndConfigureContracts(): Promise<Fixture> {
    const fixture = await deployContracts();
    const { netYieldDistributor, tokenMock, treasuryMock } = fixture;

    await proveTx(netYieldDistributor.grantRole(GRANTOR_ROLE, deployer.address));
    await proveTx(netYieldDistributor.grantRole(MINTER_ROLE, minter.address));
    await proveTx(netYieldDistributor.grantRole(MANAGER_ROLE, manager.address));
    await proveTx(netYieldDistributor.setOperationalTreasury(getAddress(treasuryMock)));

    await proveTx(tokenMock.mint(getAddress(treasuryMock), YIELD_AMOUNT));

    return fixture;
  }

  async function pauseContract(contract: Contract) {
    await proveTx(contract.grantRole(GRANTOR_ROLE, deployer.address));
    await proveTx(contract.grantRole(PAUSER_ROLE, deployer.address));
    await proveTx(contract.pause());
  }

  describe("Function 'initialize()'", async () => {
    it("Initializes the contract with correct configuration", async () => {
      const { netYieldDistributor, tokenMock } = await setUpFixture(deployContracts);

      expect(await netYieldDistributor.OWNER_ROLE()).to.equal(OWNER_ROLE);
      expect(await netYieldDistributor.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
      expect(await netYieldDistributor.MANAGER_ROLE()).to.equal(MANAGER_ROLE);
      expect(await netYieldDistributor.MINTER_ROLE()).to.equal(MINTER_ROLE);
      expect(await netYieldDistributor.PAUSER_ROLE()).to.equal(PAUSER_ROLE);
      expect(await netYieldDistributor.RESCUER_ROLE()).to.equal(RESCUER_ROLE);

      expect(await netYieldDistributor.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await netYieldDistributor.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
      expect(await netYieldDistributor.getRoleAdmin(MANAGER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await netYieldDistributor.getRoleAdmin(MINTER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await netYieldDistributor.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await netYieldDistributor.getRoleAdmin(RESCUER_ROLE)).to.equal(GRANTOR_ROLE);

      expect(await netYieldDistributor.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
      expect(await netYieldDistributor.hasRole(GRANTOR_ROLE, deployer.address)).to.equal(false);
      expect(await netYieldDistributor.hasRole(MANAGER_ROLE, deployer.address)).to.equal(false);
      expect(await netYieldDistributor.hasRole(MINTER_ROLE, deployer.address)).to.equal(false);
      expect(await netYieldDistributor.hasRole(PAUSER_ROLE, deployer.address)).to.equal(false);
      expect(await netYieldDistributor.hasRole(RESCUER_ROLE, deployer.address)).to.equal(false);

      expect(await netYieldDistributor.underlyingToken()).to.equal(getAddress(tokenMock));
      expect(await netYieldDistributor.operationalTreasury()).to.equal(ADDRESS_ZERO);
      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(0);
      expect(await netYieldDistributor.totalAdvancedNetYield()).to.equal(0);
      expect(await netYieldDistributor.cumulativeReducedNetYield()).to.equal(0);
    });

    describe("Is reverted if", async () => {
      it("Called a second time", async () => {
        const { netYieldDistributor, tokenMock } = await setUpFixture(deployContracts);

        await expect(netYieldDistributor.initialize(getAddress(tokenMock)))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_INVALID_INITIALIZATION);
      });

      it("Passed token address is zero", async () => {
        const anotherNetYieldDistributorContract = await upgrades.deployProxy(
          netYieldDistributorFactory,
          [],
          { initializer: false },
        ) as Contract;

        await expect(anotherNetYieldDistributorContract.initialize(ADDRESS_ZERO))
          .to.be.revertedWithCustomError(anotherNetYieldDistributorContract, ERROR_NAME_UNDERLYING_TOKEN_ADDRESS_ZERO);
      });

      it("Called for the contract implementation even for the first time", async () => {
        const tokenAddress = user.address;
        const cashierImplementation = await netYieldDistributorFactory.deploy() as Contract;
        await cashierImplementation.waitForDeployment();

        await expect(cashierImplementation.initialize(tokenAddress))
          .to.be.revertedWithCustomError(cashierImplementation, ERROR_NAME_INVALID_INITIALIZATION);
      });
    });
  });

  describe("Function 'upgradeToAndCall()'", async () => {
    it("Executes the upgrade correctly", async () => {
      const { netYieldDistributor } = await setUpFixture(deployContracts);

      await checkContractUupsUpgrading(netYieldDistributor, netYieldDistributorFactory);
    });

    describe("Is reverted if", async () => {
      it("Caller lacks `OWNER_ROLE`", async () => {
        const { netYieldDistributor } = await setUpFixture(deployContracts);

        await expect(connect(netYieldDistributor, stranger).upgradeToAndCall(getAddress(netYieldDistributor), "0x"))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, OWNER_ROLE);
      });

      it("Implementation address is invalid", async () => {
        const { netYieldDistributor, tokenMock } = await setUpFixture(deployContracts);

        await expect(netYieldDistributor.upgradeToAndCall(getAddress(tokenMock), "0x"))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID);
      });
    });
  });

  describe("Function 'proveNetYieldDistributor()'", async () => {
    it("Executes without reverting", async () => {
      const { netYieldDistributor } = await setUpFixture(deployContracts);

      await expect(netYieldDistributor.proveNetYieldDistributor()).not.to.be.reverted;
    });
  });

  describe("Function 'setOperationalTreasury()'", async () => {
    it("Updates treasury address to valid treasury contract and emits the correct event", async () => {
      const { netYieldDistributor, treasuryMock } = await setUpFixture(deployContracts);

      await expect(netYieldDistributor.setOperationalTreasury(getAddress(treasuryMock)))
        .to.emit(netYieldDistributor, EVENT_NAME_OPERATIONAL_TREASURY_UPDATED)
        .withArgs(getAddress(treasuryMock), ADDRESS_ZERO);
      expect(await netYieldDistributor.operationalTreasury()).to.eq(getAddress(treasuryMock));
    });

    it("Updates treasury address to zero and emits the correct event", async () => {
      const { netYieldDistributor, treasuryMock } = await setUpFixture(deployContracts);

      await proveTx(netYieldDistributor.setOperationalTreasury(getAddress(treasuryMock)));

      await expect(netYieldDistributor.setOperationalTreasury(ADDRESS_ZERO))
        .to.emit(netYieldDistributor, EVENT_NAME_OPERATIONAL_TREASURY_UPDATED)
        .withArgs(ADDRESS_ZERO, getAddress(treasuryMock));
      expect(await netYieldDistributor.operationalTreasury()).to.eq(ADDRESS_ZERO);
    });

    describe("Is reverted if", async () => {
      it("Caller lacks `OWNER_ROLE`", async () => {
        const { netYieldDistributor, treasuryMock } = await setUpFixture(deployContracts);

        await expect(connect(netYieldDistributor, stranger).setOperationalTreasury(getAddress(treasuryMock)))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, OWNER_ROLE);

        await proveTx(netYieldDistributor.grantRole(GRANTOR_ROLE, deployer.address));
        await proveTx(netYieldDistributor.grantRole(MANAGER_ROLE, stranger.address));
        await proveTx(netYieldDistributor.grantRole(MINTER_ROLE, stranger.address));
        await expect(connect(netYieldDistributor, stranger).setOperationalTreasury(getAddress(treasuryMock)))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, OWNER_ROLE);
      });

      it("New treasury address is the same as the previous one", async () => {
        const { netYieldDistributor, treasuryMock } = await setUpFixture(deployContracts);

        await expect(netYieldDistributor.setOperationalTreasury(ADDRESS_ZERO))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_TREASURY_ADDRESS_ALREADY_SET);

        await proveTx(netYieldDistributor.setOperationalTreasury(getAddress(treasuryMock)));

        await expect(netYieldDistributor.setOperationalTreasury(getAddress(treasuryMock)))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_TREASURY_ADDRESS_ALREADY_SET);
      });

      it("Treasury address is not a valid ITreasury contract", async () => {
        const { netYieldDistributor, tokenMock } = await setUpFixture(deployContracts);

        // Test with a contract that doesn't implement ITreasury
        await expect(netYieldDistributor.setOperationalTreasury(getAddress(tokenMock)))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID);

        // Test with an EOA (no code, fails the code length check)
        await expect(netYieldDistributor.setOperationalTreasury(stranger.address))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID);
      });

      it("Treasury underlying token does not match distributor's underlying token", async () => {
        const { netYieldDistributor } = await setUpFixture(deployContracts);

        // Deploy a treasury mock with a different token
        const differentToken = await deployTokenMock();
        const invalidTreasuryMock = await deployTreasuryMock(getAddress(differentToken));

        await expect(netYieldDistributor.setOperationalTreasury(getAddress(invalidTreasuryMock)))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_TREASURY_UNDERLYING_TOKEN_MISMATCH);
      });
    });
  });

  describe("Function 'mintAssetYield()'", async () => {
    it("Mints tokens and emits the correct event", async () => {
      const { netYieldDistributor, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const amount = YIELD_AMOUNT;

      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(0);
      expect(await tokenMock.balanceOf(getAddress(netYieldDistributor))).to.equal(0);

      await expect(connect(netYieldDistributor, minter).mintAssetYield(amount))
        .to.emit(netYieldDistributor, EVENT_NAME_ASSET_YIELD_MINTED)
        .withArgs(amount);

      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(amount);
      expect(await tokenMock.balanceOf(getAddress(netYieldDistributor))).to.equal(amount);
    });

    it("Executes multiple mint operations correctly", async () => {
      const { netYieldDistributor, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const amount1 = YIELD_AMOUNT;
      const amount2 = YIELD_AMOUNT * 2n;
      const totalAmount = amount1 + amount2;

      await proveTx(connect(netYieldDistributor, minter).mintAssetYield(amount1));
      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(amount1);
      expect(await tokenMock.balanceOf(getAddress(netYieldDistributor))).to.equal(amount1);

      await expect(connect(netYieldDistributor, minter).mintAssetYield(amount2))
        .to.emit(netYieldDistributor, EVENT_NAME_ASSET_YIELD_MINTED)
        .withArgs(amount2);

      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(totalAmount);
      expect(await tokenMock.balanceOf(getAddress(netYieldDistributor))).to.equal(totalAmount);
    });

    describe("Is reverted if", async () => {
      it("Contract is paused", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);
        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(YIELD_AMOUNT));
        await pauseContract(netYieldDistributor);

        await expect(connect(netYieldDistributor, minter).mintAssetYield(YIELD_AMOUNT))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ENFORCED_PAUSE);
      });

      it("Caller lacks `MINTER_ROLE`", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);
        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(YIELD_AMOUNT));

        await expect(connect(netYieldDistributor, stranger).mintAssetYield(YIELD_AMOUNT))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, MINTER_ROLE);

        await expect(connect(netYieldDistributor, manager).mintAssetYield(YIELD_AMOUNT))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(manager.address, MINTER_ROLE);

        await expect(connect(netYieldDistributor, deployer).mintAssetYield(YIELD_AMOUNT))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(deployer.address, MINTER_ROLE);
      });
    });
  });

  describe("Function 'burnAssetYield()'", async () => {
    it("Burns tokens and emits the correct event", async () => {
      const { netYieldDistributor, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const mintAmount = YIELD_AMOUNT * 2n;
      const burnAmount = YIELD_AMOUNT;
      const remainingAmount = mintAmount - burnAmount;
      await proveTx(connect(netYieldDistributor, minter).mintAssetYield(mintAmount));
      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(mintAmount);

      await expect(connect(netYieldDistributor, minter).burnAssetYield(burnAmount))
        .to.emit(netYieldDistributor, EVENT_NAME_ASSET_YIELD_BURNED)
        .withArgs(burnAmount);

      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(remainingAmount);
      expect(await tokenMock.balanceOf(getAddress(netYieldDistributor))).to.equal(remainingAmount);
    });

    it("Executes multiple burn operations correctly", async () => {
      const { netYieldDistributor, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const mintAmount = YIELD_AMOUNT * 4n;
      const burn1 = YIELD_AMOUNT;
      const burn2 = YIELD_AMOUNT * 2n;
      const remainingAmount = mintAmount - burn1 - burn2;
      await proveTx(connect(netYieldDistributor, minter).mintAssetYield(mintAmount));

      await proveTx(connect(netYieldDistributor, minter).burnAssetYield(burn1));
      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(mintAmount - burn1);

      await proveTx(connect(netYieldDistributor, minter).burnAssetYield(burn2));
      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(remainingAmount);
      expect(await tokenMock.balanceOf(getAddress(netYieldDistributor))).to.equal(remainingAmount);
    });

    it("Burns the entire yield balance correctly", async () => {
      const { netYieldDistributor, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const amount = YIELD_AMOUNT;
      await proveTx(connect(netYieldDistributor, minter).mintAssetYield(amount));
      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(amount);
      expect(await tokenMock.balanceOf(getAddress(netYieldDistributor))).to.equal(amount);

      await proveTx(connect(netYieldDistributor, minter).burnAssetYield(amount));
      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(0);
      expect(await tokenMock.balanceOf(getAddress(netYieldDistributor))).to.equal(0);
    });

    describe("Is reverted if", async () => {
      it("Contract is paused", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);
        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(YIELD_AMOUNT));
        await pauseContract(netYieldDistributor);

        await expect(connect(netYieldDistributor, minter).burnAssetYield(YIELD_AMOUNT))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ENFORCED_PAUSE);
      });

      it("Caller lacks `MINTER_ROLE`", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);
        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(YIELD_AMOUNT));

        await expect(connect(netYieldDistributor, stranger).burnAssetYield(YIELD_AMOUNT))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, MINTER_ROLE);

        await expect(connect(netYieldDistributor, manager).burnAssetYield(YIELD_AMOUNT))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(manager.address, MINTER_ROLE);

        await expect(connect(netYieldDistributor, deployer).burnAssetYield(YIELD_AMOUNT))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(deployer.address, MINTER_ROLE);
      });

      it("Amount exceeds contract token balance", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);
        const mintAmount = YIELD_AMOUNT;
        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(mintAmount));

        const burnAmount = mintAmount * 2n;
        await expect(connect(netYieldDistributor, minter).burnAssetYield(burnAmount))
          .to.be.reverted;
      });

      it("The total advanced net yield exceeds the total asset yield supply", async () => {
        const { netYieldDistributor, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(YIELD_AMOUNT));
        await proveTx(connect(netYieldDistributor, manager).advanceNetYield([user.address], [YIELD_AMOUNT / 2n]));

        // netYieldDistributor receives more tokens than holds in totalAssetYieldSupply somehow
        await proveTx(tokenMock.mint(getAddress(netYieldDistributor), YIELD_AMOUNT));

        await expect(connect(netYieldDistributor, minter).burnAssetYield(YIELD_AMOUNT))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_TOTAL_ADVANCED_NET_YIELD_EXCESS);
      });
    });
  });

  describe("Function 'advanceNetYield()'", async () => {
    describe("Successfully executes when", async () => {
      it("Advances yield to a single account correctly", async () => {
        const { netYieldDistributor, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const amount = YIELD_AMOUNT_BASE;
        const account = user.address;

        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(amount * 2n));

        const tx = connect(netYieldDistributor, manager).advanceNetYield([account], [amount]);

        await expect(tx)
          .to.emit(netYieldDistributor, EVENT_NAME_NET_YIELD_ADVANCED)
          .withArgs(account, amount);

        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [getAddress(netYieldDistributor), account],
          [-amount, amount],
        );

        expect(await netYieldDistributor.advancedNetYieldOf(account)).to.equal(amount);
        expect(await netYieldDistributor.cumulativeReducedNetYieldOf(account)).to.equal(0);

        expect(await netYieldDistributor.advancedNetYieldOf(account)).to.equal(amount);
        expect(await netYieldDistributor.cumulativeReducedNetYieldOf(account)).to.equal(0);
      });

      it("Advances yield to multiple accounts, including duplicates", async () => {
        const { netYieldDistributor, tokenMock } = await setUpFixture(deployAndConfigureContracts);
        const transferCount = 4;
        // Setup 3 distinct accounts initially
        const accounts = users.slice(0, transferCount - 1).map(user => user.address);
        // Add a duplicate entry of the first account to test account balance aggregation
        accounts.push(users[0].address);
        const amounts = YIELD_AMOUNT_VARIANTS.slice(0, transferCount - 1);
        amounts.push(YIELD_AMOUNT_VARIANTS[transferCount - 1]);
        const totalAmount = amounts.reduce((acc, val) => acc + val, 0n);

        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(totalAmount * 2n));

        const tx = await connect(netYieldDistributor, manager).advanceNetYield(accounts, amounts);

        // Verify events for all accounts, including the duplicate
        for (let i = 0; i < accounts.length - 1; ++i) {
          await expect(tx)
            .to.emit(netYieldDistributor, EVENT_NAME_NET_YIELD_ADVANCED)
            .withArgs(accounts[i], amounts[i]);
        }
        await expect(tx)
          .to.emit(netYieldDistributor, EVENT_NAME_NET_YIELD_ADVANCED)
          .withArgs(accounts[transferCount - 1], amounts[transferCount - 1]);

        // Account[0] balance should equal the sum of its two transfers
        expect(
          await netYieldDistributor.advancedNetYieldOf(accounts[0]),
        ).to.equal(amounts[0] + amounts[transferCount - 1]);
        expect(await netYieldDistributor.cumulativeReducedNetYieldOf(accounts[0])).to.equal(0);
        expect(await netYieldDistributor.advancedNetYieldOf(accounts[1])).to.equal(amounts[1]);
        expect(await netYieldDistributor.cumulativeReducedNetYieldOf(accounts[1])).to.equal(0);
        expect(await netYieldDistributor.advancedNetYieldOf(accounts[2])).to.equal(amounts[2]);
        expect(await netYieldDistributor.cumulativeReducedNetYieldOf(accounts[2])).to.equal(0);

        // Verify token transfers affected accounts correctly
        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [getAddress(netYieldDistributor), accounts[0], accounts[1], accounts[2]],
          [-totalAmount, (amounts[0] + amounts[transferCount - 1]), amounts[1], amounts[2]],
        );

        expect(
          await netYieldDistributor.advancedNetYieldOf(accounts[0]),
        ).to.equal(amounts[0] + amounts[transferCount - 1]);
        expect(await netYieldDistributor.cumulativeReducedNetYieldOf(accounts[0])).to.equal(0);
        expect(await netYieldDistributor.advancedNetYieldOf(accounts[1])).to.equal(amounts[1]);
        expect(await netYieldDistributor.cumulativeReducedNetYieldOf(accounts[1])).to.equal(0);
        expect(await netYieldDistributor.advancedNetYieldOf(accounts[2])).to.equal(amounts[2]);
        expect(await netYieldDistributor.cumulativeReducedNetYieldOf(accounts[2])).to.equal(0);
      });
    });

    describe("Is reverted if", async () => {
      it("Contract is paused", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);

        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(YIELD_AMOUNT_BASE * 2n));
        await pauseContract(netYieldDistributor);

        await expect(connect(netYieldDistributor, manager).advanceNetYield([user.address], [YIELD_AMOUNT_BASE]))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ENFORCED_PAUSE);
      });

      it("Caller lacks `MANAGER_ROLE`", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);

        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(YIELD_AMOUNT_BASE * 2n));

        await expect(connect(netYieldDistributor, stranger).advanceNetYield([user.address], [YIELD_AMOUNT_BASE]))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, MANAGER_ROLE);

        await expect(connect(netYieldDistributor, minter).advanceNetYield([user.address], [YIELD_AMOUNT_BASE]))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(minter.address, MANAGER_ROLE);

        await expect(connect(netYieldDistributor, deployer).advanceNetYield([user.address], [YIELD_AMOUNT_BASE]))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(deployer.address, MANAGER_ROLE);
      });

      it("Arrays length mismatch", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);

        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(YIELD_AMOUNT_BASE * 2n));

        const accounts = [user.address, users[1].address];
        const amounts = [YIELD_AMOUNT_BASE];

        await expect(connect(netYieldDistributor, manager).advanceNetYield(accounts, amounts))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCOUNTS_AND_AMOUNTS_LENGTH_MISMATCH);

        await expect(connect(netYieldDistributor, manager).advanceNetYield([], amounts))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCOUNTS_AND_AMOUNTS_LENGTH_MISMATCH);
      });

      it("Accounts array is empty", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);

        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(YIELD_AMOUNT_BASE));

        await expect(connect(netYieldDistributor, manager).advanceNetYield([], []))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCOUNTS_ARRAY_EMPTY);
      });

      it("Account address is zero", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);

        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(YIELD_AMOUNT_BASE * 2n));
        const accounts = [user.address, ADDRESS_ZERO];
        const amounts = [YIELD_AMOUNT_BASE, YIELD_AMOUNT_BASE];

        await expect(connect(netYieldDistributor, manager).advanceNetYield(accounts, amounts))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCOUNT_ADDRESS_ZERO);
      });

      it("Amount is zero", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);

        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(YIELD_AMOUNT_BASE * 2n));
        const accounts = [users[0].address, users[1].address];
        const amounts = [YIELD_AMOUNT_BASE, 0n];

        await expect(connect(netYieldDistributor, manager).advanceNetYield(accounts, amounts))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_AMOUNT_ZERO);
      });

      it("The total advanced net yield exceeds the total asset yield supply during a single distribution", async () => {
        const { netYieldDistributor, tokenMock } = await setUpFixture(deployAndConfigureContracts);

        // Mint tokens through proper accounting
        const mintAmount = YIELD_AMOUNT_BASE;
        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(mintAmount));

        // Transfer additional tokens that aren't accounted in totalAssetYieldSupply
        await proveTx(tokenMock.mint(getAddress(netYieldDistributor), YIELD_AMOUNT_BASE));

        // Try to advance more than accounted for
        const excessAmount = mintAmount + 1n;

        // Should revert when exceeding total supply
        await expect(connect(netYieldDistributor, manager).advanceNetYield([user.address], [excessAmount]))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_TOTAL_ADVANCED_NET_YIELD_EXCESS);

        // Should succeed up to the accounted amount
        await expect(connect(netYieldDistributor, manager).advanceNetYield([user.address], [mintAmount]))
          .not.to.be.reverted;
      });

      it("The total advanced net yield exceeds the total asset yield supply during batch distributions", async () => {
        const { netYieldDistributor, tokenMock } = await setUpFixture(deployAndConfigureContracts);

        // Mint tokens through proper accounting
        const mintAmount = YIELD_AMOUNT_BASE;
        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(mintAmount));

        // Transfer additional tokens that aren't accounted
        await proveTx(tokenMock.mint(getAddress(netYieldDistributor), YIELD_AMOUNT_BASE));

        // First distribute half the accounted supply
        const firstAdvanceAmount = mintAmount / 2n;
        await proveTx(
          connect(netYieldDistributor, manager).advanceNetYield([users[0].address], [firstAdvanceAmount]),
        );

        // Verify current state
        expect(await netYieldDistributor.totalAdvancedNetYield()).to.equal(firstAdvanceAmount);
        expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(mintAmount);

        // Try to distribute more than remaining accounted supply to multiple accounts
        // Sum of 3/4 of mintAmount exceeds the remaining 1/2
        const secondAdvanceAmounts = [mintAmount / 4n, mintAmount / 2n];
        const accounts = [users[1].address, users[2].address];

        // Should revert when combined distributions exceed the total supply
        await expect(connect(netYieldDistributor, manager).advanceNetYield(accounts, secondAdvanceAmounts))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_TOTAL_ADVANCED_NET_YIELD_EXCESS);

        // Should succeed with exactly the remaining amount
        const validAdvanceAmounts = [mintAmount - firstAdvanceAmount - 1n, 1n];
        await expect(connect(netYieldDistributor, manager).advanceNetYield(accounts, validAdvanceAmounts))
          .not.to.be.reverted;

        // All accounted yield now distributed
        expect(await netYieldDistributor.totalAdvancedNetYield()).to.equal(mintAmount);
        expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(mintAmount);
      });

      it("Contract has insufficient balance", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);

        const smallAmount = YIELD_AMOUNT_BASE / 2n;
        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(smallAmount));

        await expect(connect(netYieldDistributor, manager).advanceNetYield([user.address], [YIELD_AMOUNT_BASE]))
          .to.be.reverted;
      });
    });
  });

  describe("Function 'reduceAdvancedNetYield()'", async () => {
    describe("Successfully executes when", async () => {
      it("Reduces a single account's full yield balance", async () => {
        const { netYieldDistributor, tokenMock, treasuryMock } = await setUpFixture(deployAndConfigureContracts);
        const amount = YIELD_AMOUNT_BASE;
        const account = user.address;

        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(amount * 2n));
        await proveTx(connect(netYieldDistributor, manager).advanceNetYield([account], [amount]));

        expect(await netYieldDistributor.advancedNetYieldOf(account)).to.equal(amount);
        expect(await netYieldDistributor.cumulativeReducedNetYieldOf(account)).to.equal(0);

        const tx = connect(netYieldDistributor, manager).reduceAdvancedNetYield([account], [amount]);
        await expect(tx)
          .to.emit(netYieldDistributor, EVENT_NAME_ADVANCED_NET_YIELD_REDUCED)
          .withArgs(account, amount);

        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [getAddress(treasuryMock), getAddress(netYieldDistributor)],
          [-amount, 0],
        );

        expect(await netYieldDistributor.advancedNetYieldOf(account)).to.equal(0);
        expect(await netYieldDistributor.cumulativeReducedNetYieldOf(account)).to.equal(amount);

        expect(await netYieldDistributor.advancedNetYieldOf(account)).to.equal(0);
        expect(await netYieldDistributor.cumulativeReducedNetYieldOf(account)).to.equal(amount);
      });

      it("Reduces yield balance for multiple accounts", async () => {
        const { netYieldDistributor, tokenMock, treasuryMock } = await setUpFixture(deployAndConfigureContracts);
        const accounts = users.slice(0, 3).map(user => user.address);
        const amounts = YIELD_AMOUNT_VARIANTS.slice(0, 3);
        const totalAmount = amounts.reduce((acc, val) => acc + val, 0n);

        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(totalAmount * 2n));
        await proveTx(connect(netYieldDistributor, manager).advanceNetYield(accounts, amounts));

        const initialTotals = [];
        for (let i = 0; i < accounts.length; i++) {
          expect(await netYieldDistributor.advancedNetYieldOf(accounts[i])).to.equal(amounts[i]);
          const total = await netYieldDistributor.cumulativeReducedNetYieldOf(accounts[i]);
          initialTotals.push(total);
          expect(total).to.equal(0);
        }

        const tx = connect(netYieldDistributor, manager).reduceAdvancedNetYield(accounts, amounts);
        await expect(tx)
          .to.emit(netYieldDistributor, EVENT_NAME_ADVANCED_NET_YIELD_REDUCED)
          .withArgs(accounts[0], amounts[0])
          .to.emit(netYieldDistributor, EVENT_NAME_ADVANCED_NET_YIELD_REDUCED)
          .withArgs(accounts[1], amounts[1])
          .to.emit(netYieldDistributor, EVENT_NAME_ADVANCED_NET_YIELD_REDUCED)
          .withArgs(accounts[2], amounts[2]);

        await expect(tx).to.changeTokenBalances(
          tokenMock,
          [getAddress(treasuryMock), getAddress(netYieldDistributor)],
          [-totalAmount, 0],
        );

        expect(await netYieldDistributor.advancedNetYieldOf(accounts[0])).to.equal(0);
        expect(await netYieldDistributor.cumulativeReducedNetYieldOf(accounts[0])).to.equal(amounts[0]);
        expect(await netYieldDistributor.advancedNetYieldOf(accounts[1])).to.equal(0);
        expect(await netYieldDistributor.cumulativeReducedNetYieldOf(accounts[1])).to.equal(amounts[1]);
        expect(await netYieldDistributor.advancedNetYieldOf(accounts[2])).to.equal(0);
        expect(await netYieldDistributor.cumulativeReducedNetYieldOf(accounts[2])).to.equal(amounts[2]);
      });
    });

    describe("Updates total net yield supply correctly", async () => {
      it("When processing accounts sequentially", async () => {
        const { netYieldDistributor, tokenMock, treasuryMock } = await setUpFixture(deployAndConfigureContracts);

        const initialAmount = YIELD_AMOUNT_BASE * 2n;
        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(initialAmount));

        const accounts = [users[0].address, users[1].address];
        const amounts = [YIELD_AMOUNT_BASE, YIELD_AMOUNT_BASE / 2n];
        const totalAdvancedNetYieldAmount = amounts[0] + amounts[1];

        await proveTx(connect(netYieldDistributor, manager).advanceNetYield(accounts, amounts));

        expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(initialAmount);
        expect(await netYieldDistributor.totalAdvancedNetYield()).to.equal(totalAdvancedNetYieldAmount);
        expect(
          await tokenMock.balanceOf(getAddress(netYieldDistributor)),
        ).to.equal(initialAmount - totalAdvancedNetYieldAmount);

        await proveTx(connect(netYieldDistributor, manager).reduceAdvancedNetYield([accounts[0]], [amounts[0]]));

        expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(initialAmount - amounts[0]);
        expect(await netYieldDistributor.totalAdvancedNetYield()).to.equal(amounts[1]);
        expect(await tokenMock.balanceOf(getAddress(treasuryMock))).to.equal(YIELD_AMOUNT - amounts[0]);

        await proveTx(connect(netYieldDistributor, manager).reduceAdvancedNetYield([accounts[1]], [amounts[1]]));

        expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(initialAmount - totalAdvancedNetYieldAmount);
        expect(await netYieldDistributor.totalAdvancedNetYield()).to.equal(0);
        expect(
          await tokenMock.balanceOf(getAddress(treasuryMock)),
        ).to.equal(YIELD_AMOUNT - totalAdvancedNetYieldAmount);
      });

      it("When processing multiple accounts in batch", async () => {
        const { netYieldDistributor, tokenMock, treasuryMock } = await setUpFixture(deployAndConfigureContracts);

        const initialAmount = YIELD_AMOUNT_BASE * 6n;
        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(initialAmount));

        const accounts = users.slice(0, 3).map(user => user.address);
        const amounts = YIELD_AMOUNT_VARIANTS.slice(0, 3);
        const totalAmount = amounts.reduce((acc, val) => acc + val, 0n);

        await proveTx(connect(netYieldDistributor, manager).advanceNetYield(accounts, amounts));

        expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(initialAmount);
        expect(await netYieldDistributor.totalAdvancedNetYield()).to.equal(totalAmount);
        const initialTreasuryBalance = await tokenMock.balanceOf(getAddress(treasuryMock));

        await proveTx(connect(netYieldDistributor, manager).reduceAdvancedNetYield(accounts, amounts));

        expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(initialAmount - totalAmount);
        expect(await netYieldDistributor.totalAdvancedNetYield()).to.equal(0);

        expect(await tokenMock.balanceOf(getAddress(treasuryMock))).to.equal(initialTreasuryBalance - totalAmount);
      });
    });

    describe("Is reverted if", async () => {
      it("Contract is paused", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);
        const amount = YIELD_AMOUNT_BASE;
        const account = user.address;

        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(amount * 2n));
        await proveTx(connect(netYieldDistributor, manager).advanceNetYield([account], [amount]));
        await pauseContract(netYieldDistributor);

        await expect(connect(netYieldDistributor, manager).reduceAdvancedNetYield([account], [amount]))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ENFORCED_PAUSE);
      });

      it("Caller lacks `MANAGER_ROLE`", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);

        await expect(connect(netYieldDistributor, stranger).reduceAdvancedNetYield([user.address], [YIELD_AMOUNT_BASE]))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(stranger.address, MANAGER_ROLE);

        await expect(connect(netYieldDistributor, minter).reduceAdvancedNetYield([user.address], [YIELD_AMOUNT_BASE]))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(minter.address, MANAGER_ROLE);

        await expect(connect(netYieldDistributor, deployer).reduceAdvancedNetYield([user.address], [YIELD_AMOUNT_BASE]))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
          .withArgs(deployer.address, MANAGER_ROLE);
      });

      it("Accounts and amounts arrays have different lengths", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);
        const accounts = [user.address, users[1].address];
        const amounts = [YIELD_AMOUNT_BASE];

        await expect(connect(netYieldDistributor, manager).reduceAdvancedNetYield(accounts, amounts))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCOUNTS_AND_AMOUNTS_LENGTH_MISMATCH);
      });

      it("Accounts array is empty", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);

        await expect(connect(netYieldDistributor, manager).reduceAdvancedNetYield([], []))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCOUNTS_ARRAY_EMPTY);
      });

      it("Account address is zero", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);

        await expect(connect(netYieldDistributor, manager).reduceAdvancedNetYield([ADDRESS_ZERO], [YIELD_AMOUNT_BASE]))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ACCOUNT_ADDRESS_ZERO);
      });

      it("Amount is zero", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);

        await expect(connect(netYieldDistributor, manager).reduceAdvancedNetYield([user.address], [0]))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_AMOUNT_ZERO);
      });

      it("Decrease amount exceeds current yield balance", async () => {
        const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);
        const initialAmount = YIELD_AMOUNT_BASE;
        const excessAmount = initialAmount + 1n;
        const account = user.address;

        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(initialAmount * 2n));

        await proveTx(connect(netYieldDistributor, manager).advanceNetYield([account], [initialAmount]));

        await expect(connect(netYieldDistributor, manager).reduceAdvancedNetYield([account], [excessAmount]))
          .to.be.revertedWithCustomError(netYieldDistributor, ERROR_NAME_ADVANCED_NET_YIELD_INSUFFICIENT_BALANCE);
      });

      it("Treasury has insufficient balance to cover the reduction", async () => {
        const { netYieldDistributor, tokenMock, treasuryMock } = await setUpFixture(deployContracts);
        const amount = YIELD_AMOUNT_BASE;
        const account = user.address;

        await proveTx(netYieldDistributor.grantRole(GRANTOR_ROLE, deployer.address));
        await proveTx(netYieldDistributor.grantRole(MINTER_ROLE, minter.address));
        await proveTx(netYieldDistributor.grantRole(MANAGER_ROLE, manager.address));
        await proveTx(netYieldDistributor.setOperationalTreasury(getAddress(treasuryMock)));

        await proveTx(tokenMock.mint(getAddress(treasuryMock), amount / 2n));

        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(amount * 2n));
        await proveTx(connect(netYieldDistributor, manager).advanceNetYield([account], [amount]));

        await expect(connect(netYieldDistributor, manager).reduceAdvancedNetYield([account], [amount]))
          .to.be.reverted;
      });

      it("Operational treasury is not set", async () => {
        const { netYieldDistributor } = await setUpFixture(deployContracts);
        const amount = YIELD_AMOUNT_BASE;
        const account = user.address;

        await proveTx(netYieldDistributor.grantRole(GRANTOR_ROLE, deployer.address));
        await proveTx(netYieldDistributor.grantRole(MINTER_ROLE, minter.address));
        await proveTx(netYieldDistributor.grantRole(MANAGER_ROLE, manager.address));

        await proveTx(connect(netYieldDistributor, minter).mintAssetYield(amount * 2n));
        await proveTx(connect(netYieldDistributor, manager).advanceNetYield([account], [amount]));

        await expect(connect(netYieldDistributor, manager).reduceAdvancedNetYield([account], [amount]))
          .to.be.reverted;
      });
    });
  });

  describe("Edge cases", async () => {
    it("Handles maximum uint64 values correctly", async () => {
      // This test verifies the contract can handle the maximum allowed uint64 value
      // without overflows or unexpected behavior
      const { netYieldDistributor, tokenMock, treasuryMock } = await setUpFixture(deployAndConfigureContracts);
      const maxUint64 = maxUintForBits(64);
      await proveTx(tokenMock.mint(getAddress(treasuryMock), maxUint64));

      await proveTx(connect(netYieldDistributor, minter).mintAssetYield(maxUint64));

      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(maxUint64);

      await proveTx(connect(netYieldDistributor, manager).advanceNetYield([user.address], [maxUint64]));

      expect(await netYieldDistributor.advancedNetYieldOf(user.address)).to.equal(maxUint64);
      expect(await netYieldDistributor.cumulativeReducedNetYieldOf(user.address)).to.equal(0);
      expect(await netYieldDistributor.totalAdvancedNetYield()).to.equal(maxUint64);

      await proveTx(connect(netYieldDistributor, manager).reduceAdvancedNetYield([user.address], [maxUint64]));

      expect(await netYieldDistributor.advancedNetYieldOf(user.address)).to.equal(0);
      expect(await netYieldDistributor.cumulativeReducedNetYieldOf(user.address)).to.equal(maxUint64);
      expect(await netYieldDistributor.totalAdvancedNetYield()).to.equal(0);
      expect(await netYieldDistributor.cumulativeReducedNetYield()).to.equal(maxUint64);
    });

    it("Tracks state correctly for sequential operations on a single account", async () => {
      const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);
      const initialAmount = YIELD_AMOUNT_BASE * 5n;
      const advanceAmount1 = YIELD_AMOUNT_BASE;
      const advanceAmount2 = YIELD_AMOUNT_BASE * 2n;
      const reduceAmount1 = YIELD_AMOUNT_BASE / 4n;
      const reduceAmount2 = YIELD_AMOUNT_BASE / 2n;

      await proveTx(connect(netYieldDistributor, minter).mintAssetYield(initialAmount));
      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(initialAmount);

      await proveTx(connect(netYieldDistributor, manager).advanceNetYield([user.address], [advanceAmount1]));

      expect(await netYieldDistributor.advancedNetYieldOf(user.address)).to.equal(advanceAmount1);
      expect(await netYieldDistributor.cumulativeReducedNetYieldOf(user.address)).to.equal(0);
      expect(await netYieldDistributor.totalAdvancedNetYield()).to.equal(advanceAmount1);

      await proveTx(connect(netYieldDistributor, manager).reduceAdvancedNetYield([user.address], [reduceAmount1]));

      expect(await netYieldDistributor.advancedNetYieldOf(user.address)).to.equal(advanceAmount1 - reduceAmount1);
      expect(await netYieldDistributor.cumulativeReducedNetYieldOf(user.address)).to.equal(reduceAmount1);
      expect(await netYieldDistributor.cumulativeReducedNetYield()).to.equal(reduceAmount1);
      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(initialAmount - reduceAmount1);

      await proveTx(connect(netYieldDistributor, manager).advanceNetYield([user.address], [advanceAmount2]));

      const expectedCurrentAfterSecondAdvance = advanceAmount1 - reduceAmount1 + advanceAmount2;

      expect(await netYieldDistributor.advancedNetYieldOf(user.address)).to.equal(expectedCurrentAfterSecondAdvance);
      expect(await netYieldDistributor.cumulativeReducedNetYieldOf(user.address)).to.equal(reduceAmount1);
      expect(await netYieldDistributor.totalAdvancedNetYield()).to.equal(expectedCurrentAfterSecondAdvance);

      await proveTx(connect(netYieldDistributor, manager).reduceAdvancedNetYield([user.address], [reduceAmount2]));

      const expectedFinalCurrent = expectedCurrentAfterSecondAdvance - reduceAmount2;
      const expectedFinalTotal = reduceAmount1 + reduceAmount2;
      const expectedTotalReduced = reduceAmount1 + reduceAmount2;
      const expectedNetYieldSupply = initialAmount - expectedTotalReduced;

      expect(await netYieldDistributor.advancedNetYieldOf(user.address)).to.equal(expectedFinalCurrent);
      expect(await netYieldDistributor.cumulativeReducedNetYieldOf(user.address)).to.equal(expectedFinalTotal);
      expect(await netYieldDistributor.totalAdvancedNetYield()).to.equal(expectedFinalCurrent);
      expect(await netYieldDistributor.cumulativeReducedNetYield()).to.equal(expectedTotalReduced);
      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(expectedNetYieldSupply);
    });

    it("Tracks state correctly for concurrent operations across multiple accounts", async () => {
      const { netYieldDistributor, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const initialAmount = YIELD_AMOUNT_BASE * 10n;
      const accounts = users.slice(0, 3).map(user => user.address);

      // Step 1: Initial minting
      await proveTx(connect(netYieldDistributor, minter).mintAssetYield(initialAmount));
      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(initialAmount);

      // Step 2: Advance different amounts to different accounts
      const advanceAmounts = [YIELD_AMOUNT_BASE, YIELD_AMOUNT_BASE * 2n, YIELD_AMOUNT_BASE * 3n];
      const totalAdvanced = advanceAmounts.reduce((acc, val) => acc + val, 0n);
      await proveTx(connect(netYieldDistributor, manager).advanceNetYield(accounts, advanceAmounts));

      // Verify all accounts received their correct amounts
      for (let i = 0; i < accounts.length; i++) {
        expect(await netYieldDistributor.advancedNetYieldOf(accounts[i])).to.equal(advanceAmounts[i]);
        expect(await netYieldDistributor.cumulativeReducedNetYieldOf(accounts[i])).to.equal(0);
      }

      expect(await netYieldDistributor.totalAdvancedNetYield()).to.equal(totalAdvanced);

      // Step 3: Reduce some amounts from the first two accounts only
      const reduceAmounts = [advanceAmounts[0] / 2n, advanceAmounts[1] / 2n];
      const totalReduced = reduceAmounts.reduce((acc, val) => acc + val, 0n);
      await proveTx(connect(netYieldDistributor, manager).reduceAdvancedNetYield(
        [accounts[0], accounts[1]],
        [reduceAmounts[0], reduceAmounts[1]],
      ));

      // Verify first two accounts have reduced balances
      expect(await netYieldDistributor.advancedNetYieldOf(accounts[0])).to.equal(advanceAmounts[0] - reduceAmounts[0]);
      expect(await netYieldDistributor.cumulativeReducedNetYieldOf(accounts[0])).to.equal(reduceAmounts[0]);
      expect(await netYieldDistributor.advancedNetYieldOf(accounts[1])).to.equal(advanceAmounts[1] - reduceAmounts[1]);
      expect(await netYieldDistributor.cumulativeReducedNetYieldOf(accounts[1])).to.equal(reduceAmounts[1]);

      // Third account should be unchanged by the reduction
      expect(await netYieldDistributor.advancedNetYieldOf(accounts[2])).to.equal(advanceAmounts[2]);
      expect(await netYieldDistributor.cumulativeReducedNetYieldOf(accounts[2])).to.equal(0);

      // Global state checks
      expect(await netYieldDistributor.totalAdvancedNetYield()).to.equal(totalAdvanced - totalReduced);
      expect(await netYieldDistributor.cumulativeReducedNetYield()).to.equal(totalReduced);
      expect(await netYieldDistributor.totalAssetYieldSupply()).to.equal(initialAmount - totalReduced);

      // Step 4: Add more yield to the third account only
      const additionalYield = YIELD_AMOUNT_BASE / 2n;
      await proveTx(connect(netYieldDistributor, manager).advanceNetYield([accounts[2]], [additionalYield]));

      // Verify third account balance increased but others remain unchanged
      expect(await netYieldDistributor.advancedNetYieldOf(accounts[2])).to.equal(advanceAmounts[2] + additionalYield);
      const expectedTotalAdvancedNetYield = totalAdvanced - totalReduced + additionalYield;
      expect(await netYieldDistributor.totalAdvancedNetYield()).to.equal(expectedTotalAdvancedNetYield);

      // Verify final token balances match expected state
      const expectedBalances = [
        advanceAmounts[0],
        advanceAmounts[1],
        advanceAmounts[2] + additionalYield,
      ];

      for (let i = 0; i < accounts.length; i++) {
        const actualBalance = await tokenMock.balanceOf(accounts[i]);
        expect(actualBalance).to.equal(expectedBalances[i]);
      }
    });
  });

  describe("Function '$__VERSION()'", async () => {
    it("Returns the correct version", async () => {
      const { netYieldDistributor } = await setUpFixture(deployAndConfigureContracts);

      const netYieldDistributorVersion = await netYieldDistributor.$__VERSION();
      checkEquality(netYieldDistributorVersion, EXPECTED_VERSION);
    });
  });
});
