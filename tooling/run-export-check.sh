#!/bin/bash
# Run the export tests (e2e/export.spec.ts), which drive the built app through Import and both export paths,
# and check the exports against Swift's expected values (tooling/export-check/), with this repo's .venv.
#
# Usage: tooling/run-export-check.sh [out-dir]   (default: test-results/export-check)

set -euo pipefail
cd "$(dirname "$0")/.."

out="${1:-test-results/export-check}"
# Python: this repo's own .venv (.venv/bin on macOS and Linux, .venv/Scripts on Windows); PYTHON names another.
if [ -z "${PYTHON:-}" ]; then
    for candidate in .venv/bin/python .venv/Scripts/python.exe .venv/Scripts/python; do
        if [ -x "$candidate" ]; then PYTHON="$candidate"; break; fi
    done
fi
if [ -z "${PYTHON:-}" ]; then
    echo "No .venv: set it up as the README's \"Setting up on a new machine\" says." >&2
    exit 1
fi
rm -rf "$out"
npm run -s build
GT_EXPORT_DIR="$out" npx playwright test e2e/export.spec.ts
"$PYTHON" tooling/export-check/check_exports.py check "$out"
