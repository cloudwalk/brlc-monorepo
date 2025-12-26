#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(pwd)"
SIGNATURES_DIR="${ROOT_DIR}/signatures"

mkdir -p -- "$SIGNATURES_DIR"

export MISE_BACKENDS_SOLIDITY=asdf:diegodorado/asdf-solidity


for dir in "$ROOT_DIR"/contracts/*; do
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

  for src_file in contracts/*.sol; do
    base_name=$(basename "$src_file" .sol)

    if grep -Eq '^[[:space:]]*abstract[[:space:]]+contract[[:space:]]' "$src_file"; then
      echo "Skipping $src_file (abstract contract)"
      continue
    fi

    sig_path="artifacts/signatures/${base_name}.signatures"
    if [[ -f "$sig_path" ]]; then
      echo "Copying $sig_path to $SIGNATURES_DIR"
      cp -- "$sig_path" "${SIGNATURES_DIR}/${project_name}.${base_name}.signatures"
    fi
  done
done