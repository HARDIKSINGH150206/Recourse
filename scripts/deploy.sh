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
cd "$root/contracts"
forge script script/Deploy.s.sol --rpc-url "${RPC_URL:-http://127.0.0.1:8545}" --broadcast
cd "$root"
pnpm sync:deployment
