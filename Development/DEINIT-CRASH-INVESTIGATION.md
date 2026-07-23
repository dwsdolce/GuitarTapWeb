# Swift `TapToneAnalyzer.deinit` crash — investigation (PARKED 2026-07-23)

Intermittent `EXC_BAD_ACCESS` in `TapToneAnalyzer.deinit` under swift-testing's parallel test run.
**Parked** to finish the Python peak-lifecycle port; this doc is the resume point. Related family:
[PEAK-SELECTION… no] → see memory `project_python_playback_gc_race` (the Python QObject GC race, same
"teardown-race family"; the user has a reported Python crash they suspect is related).

## Crash signature
- `EXC_BAD_ACCESS (SIGSEGV)`, on a swift-testing **parallel cooperative worker**
  (`com.apple.root.user-initiated-qos.cooperative`), during a test's `TapToneAnalyzer` teardown.
- Faulting frame: **`TapToneAnalyzer.deinit`** at the CLOSING BRACE (the compiler-synthesized
  stored-property release epilogue), via `swift_cvw_destroyImpl` → `multiPayloadEnumGeneric` →
  a refcount release on a **freed/garbage pointer** (PAC auth failure, e.g. `0x…`), i.e. a
  **multi-payload enum stored property with a refcounted payload being destroyed against freed memory**.
- Build 418 (uncommitted 1.0.2). Rate ≈ **5 / 1000** runs.

## NOT user-facing (why we can park it)
Production holds **exactly one** `TapToneAnalyzer`, created at launch, deinit'd only at app quit —
**no concurrent teardown**. The crash requires MANY analyzers created/destroyed in parallel, which only
happens under swift-testing. So it is (almost certainly) a **test-infrastructure** artifact, not a user bug.

## What we tried — ALL insufficient
1. **`deinit { cancellables.forEach { $0.cancel() } }`** (Phase 7 fix). Reproduced anyway (build 418,
   ~1/300). Cancelling stops delivery but leaves the `Set<AnyCancellable>` populated for the epilogue.
2. **`+ cancellables.removeAll()`** in deinit. Still crashed (`QFactorTests`, build 418). This RULED OUT
   the cancellables: with the set emptied in the deinit body, the epilogue crash is a **different** stored
   property — most likely a self-owned `@Published` subject (its `Published<T>.Storage` is the canonical
   multi-payload enum), destroyed via the layout-string value-witness.
3. **`.serialized` on the two crashing suites** (`QFactorCalculation`, `FindPeaks fixture regression`).
   N=1000 soak: **still 5 crashes**, in FIVE DIFFERENT suites — `FindPeaksDuplicateTests`,
   `RecalculateFrozenPeaksIntegrationTests` (×2), `VisiblePeaksTests`, `QFactorTests` (the serialized one).
   → `.serialized` only orders tests WITHIN a suite; it does not stop OTHER suites running in parallel.

## Conclusion
A **cross-suite concurrent-teardown race**: any suite that creates+destroys a `TapToneAnalyzer` while
other suites run in parallel can crash in `deinit`. Per-suite `.serialized` is whack-a-mole.

## Two ways to resume
1. **Globally serialize the swift-testing run** (disable in-process parallelism) — confirms it's a
   parallelism artifact and gives a clean test signal. swift-testing has **no single flag** under
   `xcodebuild`; needs every suite `.serialized`, or a test-plan / `.swift-testing` config, or a
   `Test.Trait` applied suite-wide. Cost: slower tests.
2. **Root-cause the teardown race** — debugger-level: pin WHICH stored property dangles during concurrent
   `deinit` (cancellables already excluded). Candidates: a self-owned `@Published` subject; or a
   **Swift-runtime layout-string-destroy concurrency bug** (`swift_cvw_destroyImpl` is the newer bytecode
   value-witness path and has had concurrency issues). This is the one that would also inform the Python
   parallel.

## The harness — `GuitarTap/Tooling/deinit-soak.sh`
Build once, loop `test-without-building` N times (skip slow playback), detect crashes by scanning
`~/Library/Logs/DiagnosticReports` for NEW `GuitarTap*.ips`. **Detection gotchas we learned:**
- **Do NOT grep stdout for pass/fail.** `test-without-building` never prints `** TEST SUCCEEDED **`, and a
  teardown crash on a parallel worker still prints `Test run with N tests … passed`. Scan crash reports.
- **Crashes are SILENT** — macOS writes the `.ips` with no dialog for a repeated background test-host crash.
  The file is the ground truth (this is why the first "300/300 passed" runs were false-green).
- **Never edit source while the soak runs** — it invalidates the baked build; `test-without-building` then
  silently no-ops (prints no "passed", generates no crash). (Cost us one wasted run: green 1–45, then all
  "no pass" the moment a source file was edited under it.)

## Cleanup owed on resume
- **Revert the `.serialized` edits** on `QFactorCalculation` (`DSPTests.swift`) and the `FindPeaks fixture
  regression` suite (`PeakFixtureRegressionTests.swift`) — they don't fix the cross-suite race and are
  pointless. (They were the only Swift SOURCE edits made chasing this; the `removeAll` deinit edit is also
  uncommitted and can stay or go with the decision above.)
- Representative crash reports: `~/Library/Logs/DiagnosticReports/GuitarTap-2026-07-23-*.ips` (will age out).

## Pointers
- Memory: `project_python_playback_gc_race` (full running log + the Python weakref fix of the sibling race).
- Harness deliverable is a Phase 9 item in `PEAK-LIFECYCLE-PLAN-SWIFT.md` (soak/stress on all 3 platforms).
