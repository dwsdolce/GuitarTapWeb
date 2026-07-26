# Swift `TapToneAnalyzer.deinit` crash — investigation (✅ RESOLVED 2026-07-25)

## Resolution (2026-07-25)

**Root cause — off-main teardown of a main-thread-affine object.** `TapToneAnalyzer` is `@MainActor`
(the app target builds with `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`) and its ~50 `@Published`
properties are main-thread-affine by design. The crashing field is Combine's `Published<T>.Storage`
(a two-case multi-payload enum), destroyed via the Swift runtime's layout-string value witness
(`swift_cvw_destroyImpl` → `multiPayloadEnumGeneric`). In **production** SwiftUI owns the analyzer as
a `@StateObject` and releases it on the **main** thread, so `deinit` runs where the object lives — safe.
The **test target had no default isolation**, so any suite without an explicit `@MainActor` ran on
swift-testing's cooperative pool and dropped its `sut` **off-main**, racing the Combine-subject teardown
→ BUS/EXC_BAD_ACCESS. That is why the crash only ever appeared under the parallel test runner and never
in the app.

**How it was proven (not assumed):** an ASan-instrumented soak tripped in `TapToneAnalyzer.deinit` at
`swift_cvw_destroyImpl` (BUS on a garbage pointer, off-main cooperative thread), and it was **not** a
heap-use-after-free (no freed block) — i.e. the runtime value-witness path, not app double-free.
Disabling layout-string value witnesses (`-Xfrontend -disable-layout-string-value-witnesses`) left the
path identical (ruling that lever out). An `isolated deinit` removed the destroy crash but exposed a
second race (an in-flight `.receive(on: main)` sink writing `statusMessage` on a zombie), so it was
reverted.

**Fix — make the tests match production's isolation.** Add `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`
to the **GuitarTapTests** target (Debug + Release), mirroring the app target. All suites now default to
`@MainActor`, run on the main actor (a serial executor), and tear down on main like production — so no
analyzer is ever destroyed off-main. **No production code change.** Verified ASan-clean at 93/100 soak
runs where the bug previously tripped by run 5–8. The pre-existing per-suite `.serialized` marks on
`QFactorCalculation`/`FindPeaks fixture regression` were reverted (redundant once all tests are
main-serialized); the `cancellables.removeAll()` in `deinit` stays as hygiene.

---

Intermittent `EXC_BAD_ACCESS` in `TapToneAnalyzer.deinit` under swift-testing's parallel test run.
_(Original investigation below, retained for the trail; **superseded by the resolution above**.)_ Related family:
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
- Harness deliverable = [SOAK-STRESS-HARNESS.md](SOAK-STRESS-HARNESS.md) (soak/stress on all 3 platforms;
  this Swift `deinit-soak.sh` is the seed).
