#!/usr/bin/env bash
# Deploys everything to an already-running local anvil (port 8545) for web development.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")/.."
K=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
for i in $(seq 1 20); do cast block-number --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1 && break; sleep 0.5; done
(cd contracts && OPERATOR_PRIVATE_KEY=$K forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --slow >/dev/null)
eval "$(cd relayer && npx tsx src/cli/live-seed.ts)"
(cd contracts && OPERATOR_PRIVATE_KEY=$K forge script script/DeployLive.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --slow >/dev/null)
cd relayer
npx tsx src/cli/replay.ts local 2026-07-28_000660 | tail -1
npx tsx src/cli/replay.ts local 2026-08-06_000660 | tail -1
npx tsx src/cli/sandbox.ts local 20
(cd ../web && node scripts/gen-config.mjs)
