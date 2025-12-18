import { ethers, upgrades } from "hardhat";
async function main() {
  const CONTRACT_NAME = ""; // TBD: Enter contract name
  const TOKEN_ADDRESS = ""; // TBD: Enter contract initialization arguments
  const BEACON_ADDRESS = ""; // TBD: Enter beacon contract address

  const factory = await ethers.getContractFactory(CONTRACT_NAME);
  const proxy = await upgrades.deployBeaconProxy(BEACON_ADDRESS, factory, [TOKEN_ADDRESS]);
  await proxy.waitForDeployment();
  console.log("Proxy deployed to:", await proxy.getAddress());
}

main();
