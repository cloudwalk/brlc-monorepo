import { ethers, upgrades } from "hardhat";
import { addBeaconToManifest } from "./beaconManifest";

async function main() {
  // 🚨✨ IMPORTANT ✨🚨
  // For each contract family/type, you only need to deploy ONE beacon! 🛡️
  // All your proxies for this contract can share that same beacon 🔄
  const CONTRACT_NAME = ""; // TBD: Enter contract name
  const factory = await ethers.getContractFactory(CONTRACT_NAME);
  const beacon = await upgrades.deployBeacon(factory);

  await beacon.waitForDeployment();
  await addBeaconToManifest(beacon);

  console.log("Beacon deployed to:", await beacon.getAddress());
  console.log("Beacon implementation address:", await beacon.implementation());
}

main();
