#!/usr/bin/env bash
# Web soak / stress harness — a DEV TOOL, not a CI test.
# Portable bash: macOS, Linux, and Windows under Cygwin/Git-Bash (needs node + npx on PATH).
#
# Loops the FAST vitest suite (playback excluded) N times with a per-test timeout, hunting
# nondeterministic FAILURES and HANGS that a single run hides. This is the web analog of the Swift
# Combine-`deinit` race (Tooling/deinit-soak.sh) and the Python QObject-GC race — here the class is
# React effect-cleanup / async-teardown. See Development/SOAK-STRESS-HARNESS.md.
#
# Three caveats (baked into the design):
#   1. Optional/on-demand, NOT CI — it is N× slower and probabilistic.
#   2. A green soak is CONFIDENCE, NOT PROOF — you cannot prove a race is absent, only make it unlikely.
#   3. Faithfulness: each run does a REAL full-suite setup/teardown (that is the signal). A synthetic
#      same-thread create/destroy loop would not reproduce a teardown race and would mislead.
#
# Detection:
#   - FAIL  — vitest exits non-zero (a failed test, an unhandled rejection, a worker crash). The tail of
#             the failing run's output is printed.
#   - HANG  — `--testTimeout` fails a single stuck test; and a fully-wedged run is killed by the
#             per-run wall-clock cap (macOS has no `timeout`, so the cap is done with a background killer).
#
# Usage:  Tooling/soak.sh [N] [per-test-timeout-ms]      (defaults: N=100, per-test 10000ms)
#         SOAK_RUN_TIMEOUT=<seconds>  caps one fully-wedged run (default 180).
#
# Exits 0 only if every run passed with no failures and no hangs.
set -u
cd "$(dirname "$0")/.." || exit 1

N="${1:-100}"
TEST_TIMEOUT_MS="${2:-10000}"
RUN_TIMEOUT="${SOAK_RUN_TIMEOUT:-180}"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

# Portable per-run wall-clock cap: run in the background, kill it if it overruns (kill -9 → exit 137).
run_capped() {
  "$@" >"$LOG" 2>&1 &
  local pid=$!
  ( sleep "$RUN_TIMEOUT"; kill -9 "$pid" 2>/dev/null ) &
  local watcher=$!
  wait "$pid" 2>/dev/null; local rc=$?
  kill "$watcher" 2>/dev/null; wait "$watcher" 2>/dev/null
  return $rc
}

echo "web soak: $N runs · per-test timeout ${TEST_TIMEOUT_MS}ms · per-run cap ${RUN_TIMEOUT}s"
PASS=0; FAIL=0; HANG=0
for i in $(seq 1 "$N"); do
  run_capped npx vitest run --exclude '**/file-playback.test.ts' --testTimeout="$TEST_TIMEOUT_MS"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    PASS=$((PASS + 1))
  elif [ "$rc" -eq 137 ]; then
    HANG=$((HANG + 1)); echo; echo "!!! RUN $i: HANG (killed after ${RUN_TIMEOUT}s)"
  else
    FAIL=$((FAIL + 1)); echo; echo "!!! RUN $i: FAIL (exit $rc)"; tail -25 "$LOG"
  fi
  printf "\r%d/%d  pass=%d fail=%d hang=%d " "$i" "$N" "$PASS" "$FAIL" "$HANG"
done
echo
echo "done: $PASS passed · $FAIL failed · $HANG hung  (of $N)"
[ "$FAIL" -eq 0 ] && [ "$HANG" -eq 0 ]
