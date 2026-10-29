#!/usr/bin/env bash
# Starts a local anvil chain (chain id 31337, port 8545). Requires Foundry.
set -euo pipefail
exec anvil --chain-id 31337 --port 8545
