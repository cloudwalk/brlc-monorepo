import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { checkContractUupsUpgrading, setUpFixture } from "../test-utils/common";
import * as Contracts from "../typechain-types";
import { proveTx } from "../test-utils/eth";

const OWNER_ROLE = ethers.id("OWNER_ROLE");

// Errors of the library contracts
const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";
const ERROR_NAME_INVALID_INITIALIZATION = "InvalidInitialization";

// Errors of the contracts under test
const ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID = "LendingEngineV2_ImplementationAddressInvalid";
const ERROR_NAME_UNAUTHORIZED_CALL_CONTEXT = "LendingEngineV2_UnauthorizedCallContext";

const EXPECTED_VERSION = {
  major: 2,
  minor: 0,
  patch: 0,
};

const STORAGE_KIND_MARKET = 0xA5;

let lendingEngineFactory: Contracts.LendingEngineV2Testable__factory;

let deployer: HardhatEthersSigner;
let stranger: HardhatEthersSigner;

async function deployContracts(): Promise<Contracts.LendingEngineV2Testable> {
  const lendingEngineDeployment = await upgrades.deployProxy(
    lendingEngineFactory,
    [],
    { kind: "uups" },
  );
  await lendingEngineDeployment.waitForDeployment();
  return lendingEngineDeployment.connect(deployer);
}

describe("Contract 'LendingEngine'", () => {
  before(async () => {
    [deployer, stranger] = await ethers.getSigners();

    lendingEngineFactory = (await ethers.getContractFactory("LendingEngineV2Testable")).connect(deployer);
  });

  describe("Function 'initialize()'", () => {
    let engine: Contracts.LendingEngineV2Testable;

    beforeEach(async () => {
      engine = await setUpFixture(deployContracts);
    });

    describe("Executes as expected when called properly and", () => {
      it("exposes correct role hashes", async () => {
        expect(await engine.OWNER_ROLE()).to.equal(OWNER_ROLE);
      });

      it("sets correct role admins", async () => {
        expect(await engine.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      });

      it("sets correct roles for the deployer", async () => {
        expect(await engine.hasRole(OWNER_ROLE, deployer)).to.equal(true);
      });
    });

    describe("Is reverted if", () => {
      it("called a second time", async () => {
        await expect(engine.initialize())
          .to.be.revertedWithCustomError(engine, ERROR_NAME_INVALID_INITIALIZATION);
      });
    });
  });

  describe("Function '$__VERSION()'", () => {
    it("returns the expected version", async () => {
      const engine = await setUpFixture(deployContracts);
      expect(await engine.$__VERSION()).to.deep.equal([
        EXPECTED_VERSION.major,
        EXPECTED_VERSION.minor,
        EXPECTED_VERSION.patch,
      ]);
    });
  });

  describe("Function 'upgradeToAndCall()'", () => {
    it("executes as expected", async () => {
      const engine = await setUpFixture(deployContracts);
      await checkContractUupsUpgrading(engine, lendingEngineFactory);
    });

    it("is reverted if the caller does not have the owner role", async () => {
      const engine = await setUpFixture(deployContracts);

      await expect(engine.connect(stranger).upgradeToAndCall(engine, "0x"))
        .to.be.revertedWithCustomError(engine, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(stranger.address, OWNER_ROLE);
    });

    it("is reverted if the provided implementation address is not a lending engine V2 contract", async () => {
      const engine = await setUpFixture(deployContracts);
      const mockContractFactory = await ethers.getContractFactory("UUPSExtUpgradeableMock");
      const mockContract = await mockContractFactory.deploy();
      await mockContract.waitForDeployment();

      await expect(engine.upgradeToAndCall(mockContract, "0x"))
        .to.be.revertedWithCustomError(engine, ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID);
    });
  });

  describe("Function 'previewSubLoan()'", () => {
    it("executes without reverting if called from the lending market contract storage context", async () => {
      const engine = await setUpFixture(deployContracts);
      const subLoanId = 1;
      const timestamp = 0;
      const flags = 0;

      await proveTx(engine.setStorageKind(STORAGE_KIND_MARKET));
      await expect(engine.previewSubLoan(subLoanId, timestamp, flags)).not.to.be.reverted;
    });

    it("is reverted if called not from the lending market contract storage context", async () => {
      const engine = await setUpFixture(deployContracts);
      const subLoanId = 1;
      const timestamp = 0;
      const flags = 0;

      await expect(
        engine.previewSubLoan(subLoanId, timestamp, flags),
      ).to.be.revertedWithCustomError(engine, ERROR_NAME_UNAUTHORIZED_CALL_CONTEXT);
    });
  });
});
