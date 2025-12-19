import { ethers, network } from "hardhat";
import { AddressLike, BaseContract, BigNumberish, BlockTag, TransactionReceipt, TransactionResponse } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";

export async function proveTx(tx: Promise<TransactionResponse> | TransactionResponse): Promise<TransactionReceipt> {
  const txResponse = await tx;
  const txReceipt = await txResponse.wait();
  if (!txReceipt) {
    throw new Error("The transaction receipt is empty");
  }
  return txReceipt;
}

export function getAddress(contract: BaseContract): string {
  const address = contract.target;
  if (typeof address !== "string" || address.length != 42 || !address.startsWith("0x")) {
    throw new Error("The '.target' field of the contract is not an address string");
  }
  return address;
}

export async function getTxTimestamp(tx: Promise<TransactionResponse> | TransactionResponse): Promise<number> {
  const receipt = await proveTx(tx);
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  return Number(block?.timestamp ?? 0);
}

export async function getBlockTimestamp(blockTag: BlockTag): Promise<number> {
  const block = await ethers.provider.getBlock(blockTag);
  return block?.timestamp ?? 0;
}

export async function getLatestBlockTimestamp(): Promise<number> {
  return getBlockTimestamp("latest");
}

export async function increaseBlockTimestampTo(target: number) {
  if (network.name === "hardhat") {
    await time.increaseTo(target);
  } else if (network.name === "stratus") {
    await ethers.provider.send("evm_setNextBlockTimestamp", [target]);
    await ethers.provider.send("evm_mine", []);
  } else {
    throw new Error(`Setting block timestamp for the current blockchain is not supported: ${network.name}`);
  }
}

export async function getNumberOfEvents(
  tx: TransactionResponse | Promise<TransactionResponse>,
  contract: BaseContract,
  eventName: string,
): Promise<number> {
  const topic = contract.filters[eventName].fragment.topicHash;
  return (await proveTx(tx)).logs.filter(log => log.topics[0] == topic).length;
}

export async function checkTokenPath(
  tx: TransactionResponse | Promise<TransactionResponse>,
  token: BaseContract,
  chain: AddressLike[],
  amount: BigNumberish,
) {
  // TODO: Elso check the sequence of the events (logIndex1 < logIndex2 < ... < logIndexN-1>)
  for (let i = 0; i < chain.length - 1; i++) {
    await expect(tx).to.emit(token, "Transfer")
      .withArgs(chain[i], chain[i + 1], amount);
  }
}
