#!/usr/bin/env bash
# sync-oracle.sh — vendor the canonical parity oracle into this repo.
#
# The oracle (expected peak/GFFT values + tolerances + settings) is GENERATED in
# the canonical Swift repo and PUBLISHED at a single fetchable URL. Each repo
# (Swift, Python, Web) keeps a committed local copy and pulls from that one URL —
# no repo ever needs a sibling repo on disk.
#
#   ./tooling/sync-oracle.sh           # update the local copy from the published source
#   ./tooling/sync-oracle.sh --check   # CI mode: exit non-zero if local != published
#
# Override the source with ORACLE_URL=... (e.g. a GitHub Release asset or data repo).

set -euo pipefail

# Published canonical home: the public Python repo (always on GitHub, kept in
# lockstep with Swift on algorithm changes). Swap for a release asset / data repo
# if you prefer a neutral home — the pull model is identical.
ORACLE_URL="${ORACLE_URL:-https://raw.githubusercontent.com/dwsdolce/guitar_tap/main/tests/parity-oracle.json}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL="$REPO_ROOT/test/fixtures/parity-oracle.json"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if ! curl -fsSL "$ORACLE_URL" -o "$tmp"; then
  echo "ERROR: could not fetch canonical oracle from $ORACLE_URL" >&2
  exit 2
fi

if [[ "${1:-}" == "--check" ]]; then
  if diff -q "$tmp" "$LOCAL" >/dev/null 2>&1; then
    echo "✅ parity-oracle.json is in sync with canonical ($ORACLE_URL)"
  else
    echo "❌ DRIFT: local parity-oracle.json differs from canonical." >&2
    echo "   Canonical: $ORACLE_URL" >&2
    echo "   Local:     $LOCAL" >&2
    echo "   The Swift algorithm/oracle changed without re-syncing this repo." >&2
    echo "   Run: ./tooling/sync-oracle.sh" >&2
    diff -u "$LOCAL" "$tmp" >&2 || true
    exit 1
  fi
else
  cp "$tmp" "$LOCAL"
  echo "✅ Updated $LOCAL from $ORACLE_URL"
fi
