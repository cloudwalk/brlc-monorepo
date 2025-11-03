import { ethers } from "hardhat";
import fs from "fs/promises";
import path from "path";
import { Contract, TransactionResponse } from "ethers";

import { getChainId } from "@openzeppelin/upgrades-core";

interface BeaconManifest {
  version: string;
  beacons: {
    address: string;
    txHash: string;
  }[];
}

const BEACON_MANIFEST_VERSION = "1.0.0";

function getBeaconManifestFileName(chainId: number): string {
  return path.resolve(process.env.MANIFEST_DEFAULT_DIR || ".openzeppelin", `beacon-manifest-${chainId}.json`);
}
async function getCurrentBeaconManifest(): Promise<BeaconManifest> {
  const chainId = await getChainId(ethers.provider);
  try {
    return JSON.parse(await fs.readFile(getBeaconManifestFileName(chainId), "utf8"));
  } catch {
    return {
      version: BEACON_MANIFEST_VERSION,
      beacons: [],
    };
  }
}

async function saveBeaconManifest(manifest: BeaconManifest) {
  const chainId = await getChainId(ethers.provider);
  await fs.writeFile(getBeaconManifestFileName(chainId), JSON.stringify(manifest, null, 2) + "\n");
}

export async function addBeaconToManifest(beacon: Contract) {
  const manifest = await getCurrentBeaconManifest();

  manifest.beacons.push({
    address: await beacon.getAddress(),
    txHash: (beacon as unknown as { deployTransaction: TransactionResponse }).deployTransaction.hash,
  });

  await saveBeaconManifest(manifest);
}
