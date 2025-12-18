import { expect } from "chai";
import { network } from "hardhat";
import { Result } from "ethers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

/**
 * @dev helper function to convert wrongly typed typechain Result to a plain object
 */
export function resultToObject<T extends Record<string, unknown> = Record<string, unknown>>(result: unknown): T {
  return (result as Result).toObject(true) as T;
}

export function checkEquality<T extends Record<string, unknown>>(
  actualObject: T,
  expectedObject: T,
  index?: number,
  props: {
    ignoreObjects: boolean;
  } = { ignoreObjects: false },
) {
  const indexString = index == null ? "" : ` with index: ${index}`;
  Object.keys(expectedObject).forEach((property) => {
    const value = actualObject[property];
    if (typeof value === "undefined" || typeof value === "function") {
      throw Error(`Property "${property}" is not found in the actual object` + indexString);
    }
    if (typeof expectedObject[property] === "object" && props.ignoreObjects) {
      return;
    }
    expect(value).to.eq(
      expectedObject[property],
      `Mismatch in the "${property}" property between the actual object and expected one` + indexString,
    );
  });
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
