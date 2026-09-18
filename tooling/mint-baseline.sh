#!/usr/bin/env bash
# mint-baseline.sh — mint this configuration's self-baseline (the zero-tolerance
# regression reference), by running the gated test that computes every oracle case.
#
#   ./tooling/mint-baseline.sh          # mint; refuses to overwrite without --yes
#   ./tooling/mint-baseline.sh --yes    # adopt a diff against an existing baseline
#
# Separate from `npm test` on purpose: a suite that minted its own expectations could
# never fail. See test/mint-baseline.test.ts for what it enforces.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export MINT_BASELINE=1
if [[ "${1:-}" == "--yes" ]]; then
  export MINT_BASELINE_YES=1
fi

npx vitest run test/mint-baseline.test.ts
