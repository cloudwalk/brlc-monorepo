import { ethers } from "hardhat";
import { expect } from "chai";
import * as Contracts from "../../typechain-types";
import { setUpFixture } from "../../test-utils/common";
import { proveTx } from "../../test-utils/eth";
import { ContractTransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// Events of the contracts under test
const EVENT_NAME_ACCOUNT_ADDED = "AddressBookAccountAdded";

describe("Library 'AddressBook'", async () => {
  const expectedIdForAccount1 = 1;
  const expectedIdForAccount2 = 2;

  let addressBookFactory: Contracts.AddressBookMock__factory;

  let account1: HardhatEthersSigner;
  let account2: HardhatEthersSigner;

  before(async () => {
    addressBookFactory = (await ethers.getContractFactory("AddressBookMock")) as Contracts.AddressBookMock__factory;
    [account1, account2] = await ethers.getSigners();
  });

  async function deployContract(): Promise<{ addressBook: Contracts.AddressBookMock }> {
    const addressBook = await addressBookFactory.deploy();
    await addressBook.waitForDeployment();

    return { addressBook };
  }

  async function deployContractAndAddOneAccount(): Promise<{ addressBook: Contracts.AddressBookMock }> {
    const { addressBook } = await deployContract();
    await addressBook.addAccount(account1.address);

    return { addressBook };
  }

  async function deployContractAndAddTwoAccounts(): Promise<{ addressBook: Contracts.AddressBookMock }> {
    const { addressBook } = await deployContract();
    await addressBook.addAccount(account1.address);
    await addressBook.addAccount(account2.address);

    return { addressBook };
  }

  describe("Function 'addAccount()'", async () => {
    let addressBook: Contracts.AddressBookMock;

    describe("Executes as expected when a non-zero address is passed for the first time and", () => {
      const expectedRecordCount = 1;
      let tx: Promise<ContractTransactionResponse>;
      let returnId: bigint;

      beforeEach(async () => {
        ({ addressBook } = await setUpFixture(deployContract));

        returnId = await addressBook.addAccount.staticCall(account1.address);
        tx = addressBook.addAccount(account1.address);
        await proveTx(tx);
      });

      it("returns the expected ID for the account", () => {
        expect(returnId).to.eq(expectedIdForAccount1);
      });

      it("modifies the address book state as expected", async () => {
        expect(await addressBook.getRecordCount()).to.eq(expectedRecordCount);
        expect(await addressBook.getAccount(expectedIdForAccount1)).to.eq(account1.address);
        expect(await addressBook.getId(account1.address)).to.eq(expectedIdForAccount1);
      });

      it("emits the expected event", async () => {
        expect(tx).to.emit(addressBook, EVENT_NAME_ACCOUNT_ADDED).withArgs(account1.address, expectedIdForAccount1);
      });
    });

    describe("Executes as expected when the same non-zero address is passed for the second time and", () => {
      const expectedRecordCount = 1;
      let tx: Promise<ContractTransactionResponse>;
      let returnId: bigint;

      beforeEach(async () => {
        ({ addressBook } = await setUpFixture(deployContractAndAddOneAccount));
        returnId = await addressBook.addAccount.staticCall(account1.address);
        tx = addressBook.addAccount(account1.address);
        await proveTx(tx);
      });

      it("returns the expected ID for the account", () => {
        expect(returnId).to.eq(expectedIdForAccount1);
      });

      it("does not modify the address book state", async () => {
        expect(await addressBook.getRecordCount()).to.eq(expectedRecordCount);
        expect(await addressBook.getAccount(expectedIdForAccount1)).to.eq(account1.address);
        expect(await addressBook.getId(account1.address)).to.eq(expectedIdForAccount1);
      });

      it("does not emit an event", async () => {
        expect(tx).not.to.emit(addressBook, EVENT_NAME_ACCOUNT_ADDED);
      });
    });

    describe("Executes as expected when another non-zero address is passed after the first time and", () => {
      const expectedRecordCount = 2;
      let tx: Promise<ContractTransactionResponse>;
      let returnId: bigint;

      beforeEach(async () => {
        ({ addressBook } = await setUpFixture(deployContractAndAddOneAccount));
        returnId = await addressBook.addAccount.staticCall(account2.address);
        tx = addressBook.addAccount(account2.address);
        await proveTx(tx);
      });

      it("returns the expected ID for the account", () => {
        expect(returnId).to.eq(expectedIdForAccount2);
      });

      it("does not modify the address book state", async () => {
        expect(await addressBook.getRecordCount()).to.eq(expectedRecordCount);
        expect(await addressBook.getAccount(expectedIdForAccount1)).to.eq(account1.address);
        expect(await addressBook.getAccount(expectedIdForAccount2)).to.eq(account2.address);
        expect(await addressBook.getId(account1.address)).to.eq(expectedIdForAccount1);
        expect(await addressBook.getId(account2.address)).to.eq(expectedIdForAccount2);
      });

      it("emits the expected event", async () => {
        expect(tx).to.emit(addressBook, EVENT_NAME_ACCOUNT_ADDED).withArgs(account2.address, expectedIdForAccount2);
      });
    });

    describe("Executes as expected when the zero address is passed after non-zero accounts and", () => {
      const expectedRecordCount = 2;
      let tx: Promise<ContractTransactionResponse>;
      let returnId: bigint;

      beforeEach(async () => {
        ({ addressBook } = await setUpFixture(deployContractAndAddTwoAccounts));
        returnId = await addressBook.addAccount.staticCall(ethers.ZeroAddress);
        tx = addressBook.addAccount(ethers.ZeroAddress);
        await proveTx(tx);
      });

      it("returns zero", () => {
        expect(returnId).to.eq(0);
      });

      it("does not modify the address book state", async () => {
        expect(await addressBook.getRecordCount()).to.eq(expectedRecordCount);
      });

      it("does not emit an event", async () => {
        expect(tx).not.to.emit(addressBook, EVENT_NAME_ACCOUNT_ADDED);
      });
    });
  });

  describe("Function 'getAccount()'", async () => {
    let addressBook: Contracts.AddressBookMock;

    beforeEach(async () => {
      ({ addressBook } = await setUpFixture(deployContractAndAddTwoAccounts));
    });

    it("returns the zero address for id = 0", async () => {
      expect(await addressBook.getAccount(0)).to.eq(ethers.ZeroAddress);
    });

    it("returns the expected account for the existing IDs", async () => {
      expect(await addressBook.getAccount(expectedIdForAccount1)).to.eq(account1.address);
      expect(await addressBook.getAccount(expectedIdForAccount2)).to.eq(account2.address);
    });

    it("returns zero address for non-existent ID", async () => {
      expect(await addressBook.getAccount(3n)).to.eq(ethers.ZeroAddress);
    });
  });
});
