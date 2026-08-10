#!/usr/bin/env bash
# Restores vera-contracts/ dependencies. Run once after cloning.
#
# lib/ is gitignored: forge-std is not our code to redistribute, and vendoring
# it would bloat the diff. This script puts it back.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v forge >/dev/null 2>&1; then
  echo "Foundry not found. Install it first:"
  echo "  curl -L https://foundry.paradigm.xyz | bash && foundryup"
  exit 1
fi

if [ ! -f lib/forge-std/src/Test.sol ]; then
  echo "Fetching forge-std..."
  rm -rf lib/forge-std
  git clone --depth 1 --quiet https://github.com/foundry-rs/forge-std lib/forge-std
fi

forge build
echo "Ready. Run 'forge test' to verify."
