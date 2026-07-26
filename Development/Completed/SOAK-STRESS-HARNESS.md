# Soak / stress harness — a cross-platform dev tool (all three editions)

A dev tool (NOT CI) to surface *nondeterministic* failures — teardown/GC races and hangs — that a
single test run hides. Agreed with the user 2026-07-22; split out of the peak-lifecycle plan
2026-07-25 (it is its own concern, not part of that rework).

✅ **DONE 2026-07-25.** Scripts written + committed all 3 (`Tooling/soak.sh` web + Python, portable bash
for macOS/Linux/Cygwin; `Tooling/deinit-soak.sh` Swift with a live per-run tally). **Run-reviewed:** web
200/200 clean; Python **1000 on Windows** clean (the platform where the reported QObject-GC crash lived)
+ an overnight live run; Swift's ASan soak reproduced and then **root-caused + fixed** the motivating
`TapToneAnalyzer.deinit` teardown crash — see [DEINIT-CRASH-INVESTIGATION.md](DEINIT-CRASH-INVESTIGATION.md)
(off-main teardown of a `@MainActor` object; fix = default the test target to `MainActor`).

**Motivating cases** (the "teardown-race family" this exists to catch):
- Swift **Combine `deinit` race** in `TapToneAnalyzer` — see
  [DEINIT-CRASH-INVESTIGATION.md](DEINIT-CRASH-INVESTIGATION.md). A Swift-only harness already exists,
  `GuitarTap/Tooling/deinit-soak.sh`; this doc generalises it to all three platforms.
- Python playback **QObject GC race** (memory `project_python_playback_gc_race`). The user has a
  reported Python crash they believe is in this same family and may already be fixed, and wants the soak
  harness there to gain confidence the fix holds and nothing else lurks.

Both were invisible in a normal single run and only showed under repetition.

## What it is

Build once, then loop the **fast** unit suite (skip the slow playback tests) many times, watching for
crashes and hangs. Optional/on-demand.

- **Swift** — `xcodebuild build-for-testing` once, then loop
  `xcodebuild test-without-building … -skip-testing:GuitarTapTests/FilePlaybackRegressionTests`
  (~4 s/run, 440 tests; the analyzer-churning suites stay, the slow WAV playback is skipped).
  **Harness gotcha, learned the hard way:** `test-without-building` does **not** print
  `** TEST SUCCEEDED **`; detect success from the swift-testing line `Test run with N tests … passed
  after …`, and detect failure from `SIGSEGV`/`EXC_BAD`/`deinit`/`Segmentation`/`failed after`/
  `recorded an issue`. (A first cut grepped the wrong marker and mislabelled every green run.)
- **Python** — `pytest` with `pytest-repeat` (`--count=N`) or a shell loop, **plus `pytest-timeout`**
  to catch *hangs* (not just crashes). Skip the slow playback tests.
- **Web** — `vitest` repeat (`--repeat=N` or a loop) with a per-test timeout for hangs. Analog bug =
  React effect-cleanup / async teardown.

## Three caveats to bake in

1. **Optional/on-demand, not CI** — it is N× slower and probabilistic.
2. **A green soak is *confidence, not proof*** — you cannot prove the absence of a race, only make it
   unlikely.
3. **Faithfulness matters** — the loop must exercise the *real* teardown conditions (the real test
   runner tearing objects down off-main / under GC). A synthetic same-thread create/destroy loop would
   NOT reproduce the Swift async-deinit race and would give false confidence — verified reasoning, not
   speculation.

## Deliverable — ✅ scripts written (2026-07-25; smoke-tested, awaiting a real soak run-review)

A small documented `soak`/`stress` script per repo, run on demand (e.g. `Tooling/soak.sh 200`):

- **Swift** — `Tooling/deinit-soak.sh` (the original seed; builds once, loops the fast suite, scans for
  new `.ips` crash reports — the deinit race crashes a worker out-of-band, so stdout is not the signal).
- **Web** — `Tooling/soak.sh` (loops `vitest run` N× with `--testTimeout` for per-test hangs + a portable
  per-run wall-clock cap; playback excluded).
- **Python** — `Tooling/soak.sh` (loops `pytest` N× with a portable per-run cap; `--ignore` playback; no
  plugin dependency — add `pytest-timeout --timeout=` for finer per-test hang detection if wanted).

Each exits non-zero on any failure or hang. Green = **confidence, not proof**.

## How to run

From a terminal — on Windows use a **Cygwin / Git-Bash** shell (not cmd/PowerShell). The web + Python
scripts are portable bash (macOS, Linux, Cygwin); Swift is macOS-only (xcodebuild). Each `cd`s to its own
repo root. The argument is the run count `N` (default 100); use a few hundred to ~1000 for a real soak.

```
# Web  (needs node/npx on PATH)
cd <GuitarTapWeb>;  ./Tooling/soak.sh 200            # 200 runs
                    ./Tooling/soak.sh 200 15000      # + 15 s per-test timeout (default 10 s)

# Python  (needs the venv, or python on PATH)
cd <guitar_tap>;    ./Tooling/soak.sh 200

# Swift  (macOS)
cd <GuitarTap>;     ./Tooling/deinit-soak.sh 300
```

- Prints a running `pass=… fail=… hang=…` tally; **exits 0 only if every run passed** (usable in a script).
  Ctrl-C stops early.
- Env knobs: `SOAK_RUN_TIMEOUT=<seconds>` caps one wedged run (default 180); web takes a 2nd arg for the
  per-test timeout; Python takes `PYTEST="…"` to point at a specific interpreter (it auto-detects
  `.venv/bin` vs Windows `.venv/Scripts` otherwise).
- If a fresh checkout marks a script non-executable (common on Windows), run `bash Tooling/soak.sh 200`.
