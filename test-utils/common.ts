import { expect } from "chai";
import { network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

// Define base types for our objects
type BaseObject = Record<string, unknown>;

function arrayToObject(arr: unknown[], format: BaseObject): BaseObject {
  const keys = Object.keys(format);
  return keys.reduce((obj, key, index) => {
    const value = arr[index];
    // Handle status fields - convert bigint to number
    if (key.endsWith("Status") && typeof value === "bigint") {
      obj[key] = Number(value);
    } else {
      obj[key] = value;
    }
    return obj;
  }, {} as BaseObject);
}

export function checkEquality<T extends Record<string, unknown>>(
  actualObject: T | unknown[],
  expectedObject: T,
  index?: number,
  props: { ignoreObjects: boolean } = { ignoreObjects: false },
): void {
  const indexString = index == null ? "" : ` with index: ${index}`;

  // Convert array to object if needed
  const actualObj = Array.isArray(actualObject) ? arrayToObject(actualObject, expectedObject) : actualObject;

  // Handle nested arrays
  const processedObj = { ...actualObj };
  for (const [property, expectedValue] of Object.entries(expectedObject)) {
    const actualValue = actualObj[property];

    if (Array.isArray(actualValue) && Array.isArray(expectedValue) && expectedValue.length > 0) {
      if (typeof expectedValue[0] === "object" && !Array.isArray(expectedValue[0])) {
        processedObj[property] = actualValue.map(arr =>
          Array.isArray(arr) ? arrayToObject(arr, expectedValue[0] as BaseObject) : arr,
        );
      }
    }
  }

  // Compare properties
  for (const property of Object.keys(expectedObject)) {
    const value = processedObj[property];

    if (value === undefined) {
      throw new Error(`Property "${property}" is not found in the actual object${indexString}`);
    }

    if (typeof expectedObject[property] === "object" && props.ignoreObjects) {
      continue;
    }

    expect(value).to.deep.equal(
      expectedObject[property],
      `Mismatch in the "${property}" property between the actual object and expected one${indexString}`,
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
