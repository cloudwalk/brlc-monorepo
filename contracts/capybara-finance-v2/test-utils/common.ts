import { expect } from "chai";
import { network, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { BaseContract, Contract, ContractFactory, Result } from "ethers";
import { proveTx } from "./eth";

/**
 * @dev helper function to convert wrongly typed typechain Result to a plain object
 */
// TODO: Consider simplifying or replacing this function
export function resultToObject<T extends Record<string, unknown> = Record<string, unknown>>(result: unknown): T {
  return (result as Result).toObject(true) as T;
}

export function checkEquality<T extends Record<string, unknown>>(
  actualObject: T,
  expectedObject: T,
  index?: number,
  options: { ignoreObjects?: boolean } = {},
) {
  const { ignoreObjects = false } = options;
  const indexString = index == null ? "" : ` with index: ${index}`;
  for (const property of Object.keys(expectedObject)) {
    const value = actualObject[property];
    if (!(property in actualObject) || typeof value === "function") {
      throw new Error(`Property "${property}" is not found in the actual object` + indexString);
    }
    if (typeof expectedObject[property] === "object" && ignoreObjects) {
      return;
    }
    expect(value).to.eq(
      expectedObject[property],
      `Mismatch in the "${property}" property between the actual object and expected one` + indexString,
    );
  }
}

export async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

export function maxUintForBits(numberOfBits: number): bigint {
  return 2n ** BigInt(numberOfBits) - 1n;
}

export async function checkContractUupsUpgrading(
  contract: BaseContract,
  contractFactory: ContractFactory,
) {
  const contractAddress = await contract.getAddress();
  const oldImplementationAddress = await upgrades.erc1967.getImplementationAddress(contractAddress);
  const newImplementation = await contractFactory.deploy();
  await newImplementation.waitForDeployment();
  const expectedNewImplementationAddress = await newImplementation.getAddress();

  await proveTx((contract as Contract).upgradeToAndCall(expectedNewImplementationAddress, "0x"));

  const actualNewImplementationAddress = await upgrades.erc1967.getImplementationAddress(contractAddress);
  expect(actualNewImplementationAddress).to.eq(expectedNewImplementationAddress);
  expect(actualNewImplementationAddress).not.to.eq(oldImplementationAddress);
}
