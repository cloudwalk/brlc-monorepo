import { ethers, upgrades, network } from "hardhat";
import {
  AddressLike,
  BaseContract,
  BigNumberish,
  BlockTag,
  Contract,
  ContractFactory,
  TransactionReceipt,
  TransactionResponse,
} from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";

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

export function connect<T extends BaseContract = BaseContract>(contract: T, signer: HardhatEthersSigner): T {
  return contract.connect(signer) as T;
}

export function getAddress(contract: Contract | BaseContract): string {
  const address = contract.target;
  if (typeof address !== "string" || address.length != 42 || !address.startsWith("0x")) {
    throw new Error("The '.target' field of the contract is not an address string");
  }
  return address;
}

export async function getBlockTimestamp(blockTag: BlockTag): Promise<number> {
  const block = await ethers.provider.getBlock(blockTag);
  return block?.timestamp ?? 0;
}

export async function getLatestBlockTimestamp(): Promise<number> {
  return getBlockTimestamp("latest");
}

export async function getTxTimestamp(tx: Promise<TransactionResponse> | TransactionResponse): Promise<number> {
  const receipt = await proveTx(Promise.resolve(tx));
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  return Number(block?.timestamp ?? 0);
}

export async function increaseBlockTimestampTo(targetTimestamp: number) {
  if (network.name === "hardhat") {
    await time.increaseTo(targetTimestamp);
  } else if (network.name === "stratus") {
    await ethers.provider.send("evm_setNextBlockTimestamp", [targetTimestamp]);
    await ethers.provider.send("evm_mine", []);
  } else {
    throw new Error(`Setting block timestamp for the current blockchain is not supported: ${network.name}`);
  }
}

export async function increaseBlockTimestamp(increaseInSeconds: number) {
  if (increaseInSeconds <= 0) {
    throw new Error(`The block timestamp increase must be greater than zero, but it equals: ${increaseInSeconds}`);
  }
  const currentTimestamp = await getLatestBlockTimestamp();
  await increaseBlockTimestampTo(currentTimestamp + increaseInSeconds);
}

export async function proveTx(txResponsePromise: Promise<TransactionResponse>): Promise<TransactionReceipt> {
  const txResponse = await txResponsePromise;
  const txReceipt = await txResponse.wait();
  if (!txReceipt) {
    throw new Error("The transaction receipt is empty");
  }
  return txReceipt as TransactionReceipt;
}

// Now it checks only existence of transfers in the chain and does not check the order
export async function checkTokenPath(
  tx: TransactionResponse | Promise<TransactionResponse>,
  token: Contract | BaseContract,
  chain: AddressLike[],
  amount: BigNumberish,
) {
  for (let i = 0; i < chain.length - 1; i++) {
    await expect(tx).to.emit(token, "Transfer")
      .withArgs(chain[i], chain[i + 1], amount);
  }
}
