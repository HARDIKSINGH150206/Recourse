#!/usr/bin/env bash
# Installs pinned Solidity dependencies into contracts/lib (gitignored). Requires Foundry.
set -euo pipefail
cd "$(dirname "$0")/../contracts"
forge install --no-git OpenZeppelin/openzeppelin-contracts@v5.1.0 foundry-rs/forge-std@v1.9.4
