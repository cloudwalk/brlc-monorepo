#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 3 ]]; then
  echo "usage: $0 <project> <contractName> <outputFile>" >&2
  exit 2
fi

project="$1"
contractName="$2"
outputFile="$3"

rootCwd="$(pwd)"

if [[ "${outputFile}" == -* ]]; then
  echo "error: outputFile must not start with '-' (got: ${outputFile})" >&2
  exit 2
fi

# Resolve outputFile relative to the working dir where the root pnpm script was invoked.
if [[ "${outputFile}" != /* ]]; then
  outputFile="${rootCwd}/${outputFile}"
fi

mkdir -p "$(dirname "${outputFile}")"

pnpm -C "contracts/${project}" exec hardhat flatten "contracts/${contractName}" --output "${outputFile}"


