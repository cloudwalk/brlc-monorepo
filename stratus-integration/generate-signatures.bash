#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(pwd)"
SIGNATURES_DIR="${ROOT_DIR}/signatures"




rm -rf $SIGNATURES_DIR
mkdir -p $SIGNATURES_DIR

export MISE_BACKENDS_SOLIDITY=asdf:diegodorado/asdf-solidity

# eval "$(mise activate bash)"

for dir in $ROOT_DIR/contracts/*; do
  cd "$dir"
  project_name=$(basename "$dir")
  mkdir -p artifacts
  mise exec solidity -- \
    solc \
    --hashes \
    --allow-paths "../.."  \
    --include-path=./node_modules \
    --base-path=. \
    -o artifacts/signatures  \
    --overwrite contracts/*.sol

  for sig_file in contracts/*.sol; do
    base_name=$(basename "$sig_file" .sol)
    sig_file="artifacts/signatures/${base_name}.signatures"
    if [[ -f "$sig_file" ]]; then
      echo "Copying $sig_file to $SIGNATURES_DIR"
      cp -- "$sig_file" "${SIGNATURES_DIR}/${project_name}.${base_name}.signatures"
    fi
  done
done