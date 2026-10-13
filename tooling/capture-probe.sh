#!/usr/bin/env bash
# capture-probe.sh — write this edition's capture-window fingerprints for the REG-G2 per-tap
# case, to capture-probe-web.json in the repo root (or to the path given).
#
#   ./tooling/capture-probe.sh [out.json]
#
# Compare the file with the other editions' using the hub's tooling/compare-capture-probes.py.
# See tooling/capture-probe.test.ts.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${1:-}" ]]; then
  export CAPTURE_PROBE_OUT="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
fi
cd "$REPO_ROOT"

# The tool lives outside the suite's include glob, so it needs its own config to run at all.
npx vitest run --config tooling/vitest.probe.config.ts
