import { upgrades } from "hardhat";
import {
  AddressLike,
  BaseContract,
  BigNumberish,
  Contract,
  ContractFactory,
  TransactionReceipt,
  TransactionResponse,
} from "ethers";
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
