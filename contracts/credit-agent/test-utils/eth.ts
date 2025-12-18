import { upgrades, ethers } from "hardhat";

import { BaseContract, Contract, ContractFactory, TransactionReceipt, TransactionResponse } from "ethers";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export async function checkContractUupsUpgrading(
  contract: Contract,
  contractFactory: ContractFactory,
  upgradeFunctionSignature = "upgradeToAndCall(address,bytes)",
) {
  const contractAddress = await contract.getAddress();
  const oldImplementationAddress = await upgrades.erc1967.getImplementationAddress(contractAddress);
  const newImplementation = await contractFactory.deploy();
  await newImplementation.waitForDeployment();
  const expectedNewImplementationAddress = await newImplementation.getAddress();

  if (upgradeFunctionSignature === "upgradeToAndCall(address,bytes)") {
    await proveTx(contract[upgradeFunctionSignature](expectedNewImplementationAddress, "0x"));
  } else {
    await proveTx(contract[upgradeFunctionSignature](expectedNewImplementationAddress));
  }

  const actualNewImplementationAddress = await upgrades.erc1967.getImplementationAddress(contractAddress);
  expect(actualNewImplementationAddress).to.eq(expectedNewImplementationAddress);
  expect(actualNewImplementationAddress).not.to.eq(oldImplementationAddress);
}

export function connect(contract: BaseContract, signer: HardhatEthersSigner): Contract {
  return contract.connect(signer) as Contract;
}

export function getAddress(contract: Contract): string {
  const address = contract.target;
  if (typeof address !== "string" || address.length != 42 || !address.startsWith("0x")) {
    throw new Error("The '.target' field of the contract is not an address string");
  }
  return address;
}

export async function proveTx(txResponsePromise: Promise<TransactionResponse>): Promise<TransactionReceipt> {
  const txResponse = await txResponsePromise;
  const txReceipt = await txResponse.wait();
  if (!txReceipt) {
    throw new Error("The transaction receipt is empty");
  }
  return txReceipt as TransactionReceipt;
}

export function checkEquality<T extends object>(actualObject: T, expectedObject: T) {
  Object.keys(expectedObject).forEach((property) => {
    const actualValue = actualObject[property as keyof T];
    const expectedValue = expectedObject[property as keyof T];

    // Ensure the property is not missing or a function
    if (typeof actualValue === "undefined" || typeof actualValue === "function") {
      throw Error(`Property "${property}" is not found`);
    }

    if (Array.isArray(expectedValue)) {
      // If the expected property is an array, compare arrays deeply
      expect(Array.isArray(actualValue), `Property "${property}" is expected to be an array`).to.equal(true);
      expect(actualValue).to.deep.equal(
        expectedValue,
        `Mismatch in the "${property}" array property`,
      );
    } else if (typeof expectedValue === "object" && expectedValue !== null) {
      // If the expected property is an object (and not an array), handle nested object comparison
      expect(actualValue).to.deep.equal(
        expectedValue,
        `Mismatch in the "${property}" object property`,
      );
    } else {
      // Otherwise compare as primitive values
      expect(actualValue).to.eq(
        expectedValue,
        `Mismatch in the "${property}" property`,
      );
    }
  });
}

export async function getBlockTimestamp(txResponse: TransactionResponse | TransactionReceipt): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return (await ethers.provider.getBlock(txResponse.blockHash!))!.timestamp;
}
