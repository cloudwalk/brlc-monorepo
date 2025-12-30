#!/usr/bin/env node

/* eslint @typescript-eslint/no-require-imports: "off" */

const fs = require("fs");
const path = require("path");

function main() {
  const contractsDir = path.join(__dirname, "../contracts");
  const contracts = [];

  try {
    // Read all directories in contracts/
    const contractDirs = fs
      .readdirSync(contractsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    // Check each package.json for test:stratus script
    for (const contractDir of contractDirs) {
      const packagePath = path.join(contractsDir, contractDir, "package.json");

      if (fs.existsSync(packagePath)) {
        try {
          const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

          // Check if test:stratus script exists
          if (packageJson.scripts && packageJson.scripts["test:stratus"]) {
            contracts.push(contractDir);
          }
        } catch {
          // Skip malformed package.json files
          continue;
        }
      }
    }
  } catch (error) {
    console.error("Error reading contracts directory:", error.message);
    process.exit(1);
  }
  console.log(JSON.stringify(contracts));
}

main();
