#!/usr/bin/env bash
# Deploys contracts to the chain in .env, then syncs addresses. Requires Foundry.
# Loads the root .env (forge only reads .env from its own cwd), dropping empty values so
# forge's envOr defaults apply.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$root/.env" ] || { echo "no .env; run: pnpm env:local (local) or copy .env.example" >&2; exit 1; }
while IFS='=' read -r key value; do
  [[ "$key" =~ ^[A-Z0-9_]+$ ]] || continue
  value="${value%%#*}"; value="${value%"${value##*[![:space:]]}"}"
  [ -n "$value" ] && export "$key=$value"
done < "$root/.env"
rpc="${RPC_URL:-http://127.0.0.1:8545}"
# A TOKEN_ADDRESS left in .env from an earlier chain makes the deploy skip MockUSDC and point the
# escrow at nothing. Refuse when the configured token has no code on this chain.
if [ -n "${TOKEN_ADDRESS:-}" ]; then
  code="$(cast code "$TOKEN_ADDRESS" --rpc-url "$rpc" 2>/dev/null || echo "?")"
  if [ "$code" = "0x" ] || [ "$code" = "?" ]; then
    echo "TOKEN_ADDRESS=$TOKEN_ADDRESS has no contract on $rpc (or the RPC is unreachable)." >&2
    echo "On a fresh local chain clear TOKEN_ADDRESS and ESCROW_ADDRESS in .env and run again." >&2
    exit 1
  fi
fi
cd "$root/contracts"
forge script script/Deploy.s.sol --rpc-url "$rpc" --broadcast
cd "$root"
pnpm sync:deployment
