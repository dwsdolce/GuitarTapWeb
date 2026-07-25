# Soak / stress harness — a cross-platform dev tool (all three editions)

A dev tool (NOT CI) to surface *nondeterministic* failures — teardown/GC races and hangs — that a
single test run hides. Agreed with the user 2026-07-22; split out of the peak-lifecycle plan
2026-07-25 (it is its own concern, not part of that rework). ⬜ NOT STARTED.

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

## Deliverable

A small documented `soak`/`stress` script per repo (the Swift `deinit-soak.sh` is the existing seed).
