#!/bin/bash
# Run the export tests (e2e/export.spec.ts), which drive the built app through Import and both export paths,
# and check the exports against Swift's expected values (tooling/export-check/; its requirements.txt lists the
# Python packages it needs; PYTHON picks the interpreter).
#
# Usage: tooling/run-export-check.sh [out-dir]   (default: test-results/export-check)

set -euo pipefail
cd "$(dirname "$0")/.."

out="${1:-test-results/export-check}"
rm -rf "$out"
npm run -s build
GT_EXPORT_DIR="$out" npx playwright test e2e/export.spec.ts
"${PYTHON:-python3}" tooling/export-check/check_exports.py check "$out"
