import { upgrades } from "hardhat";
import { BaseContract, ContractFactory, TransactionReceipt, TransactionResponse } from "ethers";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import * as Contracts from "../typechain-types";

export async function checkContractUupsUpgrading(
  contract: Contracts.UUPSUpgradeable,
  contractFactory: ContractFactory,
  upgradeFunction: (expectedNewImplementationAddress: string) => Promise<TransactionResponse> =
    (expectedNewImplementationAddress: string) => contract.upgradeToAndCall(expectedNewImplementationAddress, "0x"),
) {
  const contractAddress = await contract.getAddress();
  const oldImplementationAddress = await upgrades.erc1967.getImplementationAddress(contractAddress);
  const newImplementation = await contractFactory.deploy();
  await newImplementation.waitForDeployment();
  const expectedNewImplementationAddress = await newImplementation.getAddress();

  await proveTx(upgradeFunction(expectedNewImplementationAddress));

  const actualNewImplementationAddress = await upgrades.erc1967.getImplementationAddress(contractAddress);
  expect(actualNewImplementationAddress).to.eq(expectedNewImplementationAddress);
  expect(actualNewImplementationAddress).not.to.eq(oldImplementationAddress);
}

export function connect<T extends BaseContract>(contract: T, signer: HardhatEthersSigner) {
  return contract.connect(signer) as T;
}

export function getAddress(contract: BaseContract): string {
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
