import { ethers, upgrades } from "hardhat";

async function main() {
  const CONTRACT_NAME = ""; // TBD: Enter contract name
  const BEACON_ADDRESS = ""; // TBD: Enter beacon contract address

  const factory = await ethers.getContractFactory(CONTRACT_NAME);

  const beacon = await upgrades.upgradeBeacon(BEACON_ADDRESS, factory, {
    redeployImplementation: "onchange",
  });
  await beacon.waitForDeployment();
  console.log("New implementation address:", await beacon.implementation());
}

main();
