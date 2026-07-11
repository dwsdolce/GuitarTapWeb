# TapToneAnalyzer / RealtimeFFTAnalyzer Consolidation (6-TEST step 3c)

**Status:** APPROVED — IN PROGRESS. All §9 decisions settled. Created 2026-07-10. Committed through the **§10
Peak-analysis effort** (3c-0/A/A2/B/C1/C2a committed 2026-07-10; C2b + P1 + P1b + P2 + selection-flicker fix
committed 2026-07-11, folding C2b). **3c-C3a + C3b ✅ committed 2026-07-12** (material phase
machine → analyzer + `useMaterialSession` deleted + analyzer holds the device (C3a); material averaging + peak-find
up, device now a pure emitter (C3b); §11). **NEXT = C4** (imperative statusMessage + EG-1) → C5 (shrink
useAudioEngine) → 3c-D. **EG-2** (material live spectrum) deferred until 3c complete. See §5/§5b/§10/§11 for status.
(Supersedes the earlier `TAPSESSION-CONSOLIDATION.md` draft — renamed because the class it was named after is
being renamed to the canonical `TapToneAnalyzer`.)

> The largest, most architectural step of Phase 3. **No behavior goal** — the app must look and act
> identically after it. The goal is to bring the web's state/audio layers back onto the **canonical
> Swift/Python shape**, names and responsibilities included.

## 0. Goals (priority order)

1. **PRIMARY — align the web's architecture with the canonical Swift/Python design, names included.** The web
   port collapsed **two** canonical classes into one and left the state machine unwired; this step un-collapses
   it into the same two classes, with the **same names**, so the three codebases have corresponding structure,
   not just corresponding output. Same alignment goal as the view-layer [[project_architectural_restructure]] /
   `RESTRUCTURE-NOTES.md` effort, applied to the state+audio layer (and partly absorbing it).
2. **Kill the derived-stale bug class** (PC-2 / PC-4) — a direct consequence of a single source of truth.
3. **Collapse the two-branch rules** (`tapsLocked`, `sbProgress`, mixed `buttonRule`/`statusMessage` inputs)
   that only exist to reconcile the scattered state sources.

### Naming decision (SETTLED 2026-07-10)

Names must be **identical across all three repos**; rename in whichever direction yields the best name.

- **State/analysis layer → `TapToneAnalyzer`** (canonical; Swift/Python already use it). **Web renames
  `TapSession` → `TapToneAnalyzer`.**
- **Mic/FFT device layer → `RealtimeFFTAnalyzer`** (canonical; Swift/Python already use it). **Web renames
  `AudioEngine` → `RealtimeFFTAnalyzer`.** We do **not** rename the Swift class to `AudioEngine` — Swift's
  `RealtimeFFTAnalyzer` *owns an `AVAudioEngine`* (RealtimeFFTAnalyzer.swift:97), so `class AudioEngine`
  holding an `AVAudioEngine` would be actively confusing.
- **Net: no Swift/Python renames** — they are already `TapToneAnalyzer` + `RealtimeFFTAnalyzer`. The web
  conforms on both names **and** responsibilities.

### Target class correspondence

| Responsibility | Swift (unchanged) | Python (unchanged) | Web today | Web after 3c |
|---|---|---|---|---|
| Lifecycle state + transitions + averaging/completion + material phase machine | `TapToneAnalyzer` | `tap_tone_analyzer*` | scattered: `TapSession`(unwired) + analysis parts of `AudioEngine` + `useMaterialSession` + App `useState` | **`TapToneAnalyzer`** (single owner) |
| Mic graph, FFT, gated capture, level/clipping, device mgmt, session-WAV | `RealtimeFFTAnalyzer` | `realtime_fft_analyzer*` | rest of `AudioEngine` | **`RealtimeFFTAnalyzer`** (held by `TapToneAnalyzer`) |
| View reads state | SwiftUI `@Published` | Qt signal refresh | App derives from 4 sources | `useSyncExternalStore(analyzer)` |

## 1. Why (the symptom that proves the misalignment)

The core lifecycle facts are each computed from a *different* place today, so a change to one lags another:

| Fact | Canonical owns it as | Web derives it from |
|---|---|---|
| currentTapCount | `currentTapCount` field | `progress.collected` (engine → useAudioEngine `useState`) |
| numberOfTaps | `numberOfTaps` field | App `useState` **and** `progress.total` (the PC-4 split) |
| isMeasurementComplete | `isMeasurementComplete` field | `captured != null` / `matPhase === 'complete'` |
| isDetecting | `isDetecting` field | `engineState === 'listening' \|\| 'capturing'` |
| materialTapPhase | `materialTapPhase` field | `matPhase` (useMaterialSession `useState`) |

Swift/Python can't have PC-2/PC-4 because all five are fields on one `TapToneAnalyzer`, mutated together.

## 2. Current architecture (the collapse)

The parity tags reveal the collapse:
- Swift/Python: `TapToneAnalyzer` (`@parity audio/tap-analyzer`) **and** `RealtimeFFTAnalyzer`
  (`@parity audio/realtime-analyzer`) — two classes.
- Web: `src/audio/engine.ts` (`AudioEngine`) is tagged **`audio/tap-analyzer`** — it stands in for
  `TapToneAnalyzer` *and* does `RealtimeFFTAnalyzer`'s mic/FFT/capture work. There is **no** web file tagged
  `audio/realtime-analyzer`. Plus `src/state/tapSession.ts` (`TapSession`, `@parity state/tap-session`) — the
  canonical lifecycle state machine, fully built and unit-tested, but **unwired** (App never imports it).

So the web has one over-stuffed `AudioEngine` + one unused `TapSession`, and `App` re-derives the lifecycle
facts from `engineState` / `progress` / `matPhase` / `captured` / `numberOfTaps`. `useMaterialSession` owns the
material phase machine separately. *(Full App state inventory: 2026-07-10, in the session record.)*

## 3. Target architecture

Mirror Swift exactly: **`TapToneAnalyzer` is the analyzer that owns the state and holds a
`RealtimeFFTAnalyzer` device.**

```
   ┌──────────────────────────────────────────────┐
   │ TapToneAnalyzer  (src/state/tapToneAnalyzer.ts)│  @parity audio/tap-analyzer (+ state/*)
   │  OWNS: isDetecting, currentTapCount,           │
   │        numberOfTaps, isMeasurementComplete,    │
   │        capturedTaps, frozen*, materialTapPhase │
   │  TRANSITIONS: start/cancel/pause/resume,       │
   │        accept/redo (material), processTaps      │
   │        (averaging), load, setNumberOfTaps, …    │
   │  + subscribe / getSnapshot   (React store seam) │
   │  + holds a RealtimeFFTAnalyzer                  │
   └───────────────┬────────────────────────────────┘
       drives ↑↓ per-tap/phase events   reads ↓ useSyncExternalStore
   ┌───────────────┴───────────────┐    ┌───────────┴───────────────────┐
   │ RealtimeFFTAnalyzer           │    │ App / components (render)      │
   │ (src/audio/realtimeFFTAnalyzer│    │  derived rules read analyzer   │
   │  .ts)  @parity audio/realtime-│    │  fields from ONE snapshot      │
   │  analyzer — mic, FFT, gated   │    │  (tapsLocked, sbProgress,      │
   │  capture, level, WAV, devices │    │   buttonRule, statusMessage)   │
   │  NO averaging/completion/phase│    └────────────────────────────────┘
   └───────────────────────────────┘
```

`useMaterialSession` and `useAudioEngine` collapse into a thin `useTapToneAnalyzer()` that constructs the
analyzer + device and returns `useSyncExternalStore(analyzer.subscribe, analyzer.getSnapshot)`.

## 4. Key design decisions

- **D1 — Incremental, never big-bang.** Phases in §5, each full-suite-green and **run-reviewed** before the
  next. `App.tsx` is the hottest file; no mega-diff.
- **D2 — Store seam = immutable snapshot (recommended).** `TapToneAnalyzer` gains `subscribe(fn)` (listener
  Set) + `getSnapshot()` returning a frozen snapshot rebuilt only when `notify()` fired since last read.
  Transitions call `notify()`; device-driven field writes go through thin setters that `notify()`. Unit tests
  keep direct field access (they don't use the store). *Alt:* bare `version` counter — simpler but fights
  React-18 strict mode. **Open (§9).**
- **D3 — `statusMessage` is a mutable imperative field on `TapToneAnalyzer` (SETTLED — align with canonical).**
  Both Swift and Python own `statusMessage`/`status_message` as a field, written through a single helper
  (Python `_set_status_message`, Swift the equivalent) that stashes `_latest_real_status` and applies a
  **clipping override/restore** layer (`_set_clipping` swaps the display to "⚠ Input clipping…" and back). The
  field is set at every transition (start, warm-up exit, each capture, accept/redo, device-change, tap-count
  change, …). The web mirrors this: `TapToneAnalyzer.statusMessage` (a notified field) + a `setStatusMessage`
  helper with the same `_latestRealStatus` clipping override, set at each transition; the device forwards
  clipping to `analyzer.setClipping`. *(Earlier functional recommendation reversed — it diverged from BOTH
  canonical apps and can't produce transient strings.)*
  - **Bonus — closes gaps the functional model can't:** the PC-2 documented omissions (`Initializing… (Ns)`,
    `File: L complete, capturing C…`, `No signal detected — tap again`) and the **EG-1** "No signal/resonance"
    message become reproducible, because they're set imperatively at their transition. Fold EG-1's re-arm +
    message into this work (the device's empty/no-peak failure path → `analyzer` sets the message + re-arms).
  - **Test impact:** `test/status-message` is reworked to **drive transitions and assert the field** (how
    Swift/Python would test it) rather than call a pure function — which also makes its back-port to Swift/Python
    natural (retires that orphan). The PC-2 pure `statusMessage(state)` function is absorbed into the analyzer's
    per-transition string-setting.
- **D4 — Move averaging/analysis up: REQUIRED (was optional).** Chosen naming (`RealtimeFFTAnalyzer` for the
  device) forces it: the device can't honestly be a `RealtimeFFTAnalyzer` while it owns averaging,
  tap-accumulation, and completion — those are `TapToneAnalyzer`'s job. So `RealtimeFFTAnalyzer` delivers
  **raw per-tap / per-phase** spectra; `TapToneAnalyzer.processMultipleTaps` (which already exists + is tested)
  becomes the real averaging path. This is the split itself.

## 5. Migration plan (each phase: suite green + parity map regen + run-review)

- **3c-0 — Rename `TapSession` → `TapToneAnalyzer`** — ✅ DONE (2026-07-10). `src/state/tapSession.ts` →
  `tapToneAnalyzer.ts` (git mv); class `TapSession` → `TapToneAnalyzer`; 5 importers (buttonEnablement + 4 test
  suites); `@parity` slug `state/tap-session` → `state/tap-tone-analyzer` on the web file **and** the Swift +
  Python canonical anchors; map regenerated (63 groups, slug still 3-way). tsc clean · 205 tests. No behavior
  (analyzer still unwired — unit-tests only), so no run-review needed.
- **3c-A — Introduce the store + migrate the count facts** — ✅ DONE (2026-07-10). Split from the broader
  original 3c-A because the derived rules are shared with the material path; the counts are the safe,
  value-preserving first slice. Added the immutable-snapshot store seam (`subscribe`/`getSnapshot`/`notify` +
  device-driven setters) to `TapToneAnalyzer`, a `useTapToneAnalyzer()` hook (useSyncExternalStore), and moved
  **`numberOfTaps` + `currentTapCount`** onto the analyzer as the single source: the device's `onProgress`
  drives `setCurrentTapCount` (the `progress` React state is removed); `changeTaps`/load drive
  `setNumberOfTaps`; the derived rules (`tapsLocked`, `sbProgress`, `buttonRule`, `statusMessage`) read the
  analyzer. **Retires the PC-4 class at the source** (no more `numberOfTaps` vs `progress.total` split). tsc ·
  205 tests · build green. Run-review pending.
- **3c-A2 — Migrate completion + detection facts** — ✅ DONE (2026-07-10). `isDetecting`/`isDetectionPaused`
  driven from the device `onState` (one place); `isMeasurementComplete` driven by wrapping `setCaptured` so
  every set/clear also calls `analyzer.setComplete(s != null)` (no per-site divergence). Switched
  `sbDetecting`/`sbComplete`/`buttonRule`/`statusMessage.hasCapture` to read the analyzer. `engineState`
  stays for the raw-state reads (className, `tapsLocked`, `statusMessage` switch, `sbProgress`) — those
  migrate in 3c-C/3c-D. `captured` stays as the frozen *spectrum* (display); the analyzer owns the
  completion *fact*. Value-preserving; tsc · 205 tests · build green. Run-review pending.
- **3c-B — Migrate the `matPhase` fact** — ✅ DONE (2026-07-10). Re-scoped from the original "absorb the whole
  phase machine + delete useMaterialSession": the transitions are engine-coupled (armMaterial, session
  checkpoints, calibration search ranges), so moving them needs the analyzer to *hold the device* — that's the
  3c-C work. So 3c-B migrates just the **fact**: `useMaterialSession.setMatPhase` now drives
  `analyzer.setMaterialTapPhase` (keeping `matPhaseRef` for the transitions' synchronous reads); App reads
  `snapshot.materialTapPhase`; the `matPhase` useState is gone. **The analyzer now owns ALL lifecycle facts**
  (counts, completion, detection, phase). Value-preserving; tsc · 205 tests · build green. Run-review pending.
  The transition-mechanics absorption + `useMaterialSession` deletion folds into 3c-C.
  - **Design note:** result *data* (`captured`, `matSpectra`, `matPeaks`) deliberately stays React-side, not
    in the lean useSyncExternalStore snapshot — a pragmatic web adaptation (Swift's analyzer holds everything;
    the web keeps bulk spectra out of the snapshot). The analyzer owns the state *machine* (facts + transitions).
- **3c-C — Split the device out: `AudioEngine` → `RealtimeFFTAnalyzer`.** The big one — decomposed into
  C1–C5 in §5b. Move averaging / tap-accumulation / completion / material orchestration OUT of the device
  INTO `TapToneAnalyzer` (device becomes a pure mic/FFT/gated-capture emitter), rename + retag, imperative
  `statusMessage` (D3), EG-1. Web ends with BOTH canonical classes, 1:1 with Swift/Python.
- **3c-D — Collapse the two-branch rules.** With one source, rewrite `tapsLocked` and `sbProgress` as single
  expressions over `analyzer.currentTapCount` / `numberOfTaps` / `materialTapPhase`.

## 5b. 3c-C breakdown (each sub-step: tsc + suite green + run-review + commit)

3c-C is the only phase that touches the **core capture path**, so it is split into small, separately
verifiable diffs. Scope facts: `AudioEngine` = 9 importers / 36 refs; `finishGuitarGatedCapture` is used by
only `test/start-tap-race`; the device is 978 lines, `useAudioEngine` 295, `useMaterialSession` 233.

- **3c-C1 — Rename `AudioEngine` → `RealtimeFFTAnalyzer` (mechanical + retag)** — ✅ DONE (2026-07-10).
  `src/audio/engine.ts` → `realtimeFFTAnalyzer.ts`; class + device interfaces (`RealtimeFFTAnalyzerCallbacks/
  Config`) renamed; 9 files updated (the `useAudioEngine` *hook* name kept — renamed in C5). Retagged: device
  → `audio/realtime-analyzer` (web joins the canonical 3-way group); `audio/tap-analyzer tests=test/tap-decisions`
  moved onto `tapToneAnalyzer.ts` (now 3-way there). Map regen (63 groups). Pure rename — tsc · 205 tests · build
  green; no run-review needed. *(Device still averages here — the honest name arrives with C2.)*

- **3c-C2 — Move the GUITAR averaging/accumulation up.** Split into C2a/C2b (user OK 2026-07-10) to isolate the
  risky capture-flow change from the broad display-read migration.
  - **Dataflow (SETTLED — confirmed Swift AND Python):** the FFT is the **device's** job (Swift/Python
    `computeGatedFFT`/`compute_gated_fft` live on `RealtimeFFTAnalyzer`); accumulation + averaging is the
    **analyzer's** (`captured_taps` + `process_multiple_taps` on `TapToneAnalyzer`). So the device computes each
    per-tap spectrum (keeps its FFT — web guitar `dftAnalRect` + calibration, **unchanged** → won't perturb the
    oracle) and **delivers the spectrum raw**; the analyzer accumulates **spectra** (not samples) and averages.
    Native has the analyzer *pull* the FFT via the device method; the web has the device *push* the spectrum —
    functionally identical. *(The analyzer's `finishGuitarGatedCapture(samples)` uses the wrong (gated) FFT and
    is replaced by a spectrum-accumulate method; the 2 state-only tests that use it feed a spectrum instead.)*
  - **3c-C2a — averaging/accumulation up, BRIDGED — ✅ DONE + run-reviewed + COMMITTED (2026-07-10; tsc · 205
    tests · build green).** Device stopped averaging: dropped the `collected: Spectrum[]` accumulator for a
    lightweight `guitarTapCount`; the guitar `finishCapture` branch now emits each per-tap spectrum RAW via a new
    `onGuitarTap(spectrum)` callback and signals `onGuitarComplete()` at the end (the single `onCapture` callback
    is gone). FFT + calibration in the device are **unchanged** → zero numeric drift. The analyzer gained
    `recordGuitarTap(spectrum)` (accumulate a tap) + `beginGuitarAccumulation()` (clear at a fresh arm), replacing
    the old test-only `finishGuitarGatedCapture(samples)` (which used the WRONG gated FFT); `processMultipleTaps`
    does the real averaging. The bridge lives in `useAudioEngine`: `onGuitarTap`→`recordGuitarTap`,
    `onGuitarComplete`→`processMultipleTaps` then feed the analyzer's frozen average + per-tap spectra to App's
    existing `onGuitarCapture` (so `captured`/`tapSpectra` React state + all display code are untouched);
    `onProgress(0)`→`beginGuitarAccumulation`. **Tests:** `start-tap-race` R4 rewritten to `recordGuitarTap`
    (mirrors R2/R3 — the idle transition, not the record, clears `isDetecting`); **`file-playback` guitar helper
    now drives a real `TapToneAnalyzer`** through the device's per-tap emissions and reads the averaged result off
    `processMultipleTaps` — stronger + mirrors Swift's `forTesting()` analyzer shape; `measurement-complete`
    unchanged (already feeds `capturedTaps` directly); `decay-tracking` dropped its `onCapture` placeholder. No
    file moves → `@parity` tags unchanged (map regen = 63 groups, same 4 tracked orphans). **Run-review:** guitar
    single + multi-tap, the multi-tap comparison view, cancel mid-multi-tap, pause/resume, play-file guitar, and
    the oracle regressions.
  - **3c-C2b — Decision-2 alignment — ✅ IMPLEMENTED (2026-07-11; tsc · 205 tests · build green; run-review
    pending).** The analyzer now owns the frozen guitar spectrum (`frozenMagnitudes/Frequencies`, already there)
    **and** a `tapSpectra` field mirroring **Swift `tapEntries`** — the per-tap DISPLAY spectra, built from
    `capturedTaps` at completion (>1 tap), **restored on load**, cleared on reset; distinct from the raw
    `capturedTaps` (not restored on load), exactly like Swift's tapEntries-vs-capturedTaps split (confirmed by
    reading Swift `loadMeasurement:784` + Python). Both are exposed on `TapToneSnapshot`
    (`frozenSpectrum: Spectrum | null` ref-cached on the `frozenMagnitudes` ref so downstream memos don't churn;
    `tapSpectra: Spectrum[]`). New/changed analyzer transitions: `processMultipleTaps` also builds `tapSpectra`
    + notifies; `loadMeasurement({magnitudes, frequencies, taps})` restores per-tap + notifies; new
    `clearResult()` clears frozen + per-tap + `capturedTaps` + completion + notifies. App retired the
    `captured`/`tapSpectra` `useState` + the `setCaptured` wrapper; reads them through two snapshot **aliases**
    (`const captured = snapshot.frozenSpectrum`, `const tapSpectra = snapshot.tapSpectra`) so ALL ~12 downstream
    reads are unchanged; the ~8 writers route to `clearResult` (New Tap / type-switch / play-file / comparison /
    material-load / compare), `loadMeasurement` (guitar load), or `processMultipleTaps` (capture completion, run
    in App's `onGuitarCapture` after the comparison guard). The hook's `onGuitarComplete` now just calls
    `onGuitarCapture()` (no spectrum payload). No `@parity` changes. **Run-review:** guitar single + multi-tap
    (+ the per-tap comparison view + its PDF), load a saved single- and multi-tap measurement, comparison, and
    play-file.

- **3c-C3 — Absorb the MATERIAL transitions; delete `useMaterialSession`.** Move `startMaterial` / `accept` /
  `redo` / `record` / `reset` / `restore` + `matSearch` (calibration ranges) + `finishMaterialSession` + the
  FLC cooldown into `TapToneAnalyzer` (which now holds the device, so it calls `device.armMaterial` /
  `checkpointSession` / `redoSession`). Material averaging moves up too (device emits per-phase raw taps).
  - **Result-data decision — ALIGN with Swift (user, 2026-07-10; SUPERSEDES the 3c-B "stays React-side" note):**
    the analyzer OWNS the result spectra/peaks as fields, mirroring Swift `TapToneAnalyzer`
    (`frozenMagnitudes` / `longitudinalSpectrum` / `crossSpectrum` / `longitudinalPeaks` / `crossPeaks` / …),
    exposed via the snapshot (a few array refs, rebuilt on change — lean-snapshot cost negligible). App reads
    `snapshot.matSpectra` / `matPeaks` / `frozen*` instead of React state. **Also revisit `captured`** (left
    React-side in 3c-A2) → move the frozen guitar spectrum + per-tap spectra onto the analyzer too, for full
    parity. This is a scope increase over the original plan but it is the aligned design.
  - Delete `useMaterialSession`; App calls `analyzer.startMaterial/accept/redo`. Run-review the full plate/brace
    flow (L→C→FLC, accept/redo, cooldown, cancel, load).

- **3c-C4 — Imperative `statusMessage` field (D3) + EG-1.** Add `statusMessage` as a notified field on the
  analyzer, written through a `setStatusMessage(msg)` helper that stashes `_latestRealStatus` and applies the
  **clipping override/restore** (`setClipping`) — mirroring Python `_set_status_message` / `_set_clipping`. Set
  it at each transition (start / warm-up-analog / capture / accept / redo / device-change / tap-count / load).
  The device forwards clipping → `analyzer.setClipping`. **EG-1:** the device's empty / no-peak capture failure
  → `analyzer` sets `"No signal/resonance detected — tap again"` + re-arms. Rework `test/status-message` to
  drive transitions and assert the field (retires the orphan; natural Swift/Python back-port). App reads
  `analyzer.statusMessage`; the functional `statusMessage(state)` module is absorbed. Broad but mostly
  mechanical; run-review every status string + clipping.

- **3c-C5 — Shrink `useAudioEngine`.** With the capture flow + material owned by the analyzer, `useAudioEngine`
  collapses to device lifecycle + telemetry (level/spectrum/metrics/device+calibration). Much of the
  callback-mirroring disappears. (May land incrementally across C2–C4.)

**Pacing:** C1 is safe (mechanical) — good standalone commit. C2 and C3 are the real risk (capture path) — one
at a time, heavy run-review each. C4 is broad but low-risk-per-string. Recommend: do C1 now, then pause for a
go/no-go before C2.

## 6. What collapses (the payoff)

- `tapsLocked` (App L478, two branches) → `analyzer.currentTapCount > 0 && !analyzer.isMeasurementComplete`.
- `sbProgress` (App L680, guitar/brace/plate branches over `progress`+`numberOfTaps`) → one expression over
  `analyzer.*`.
- `sbComplete`, `buttonRule` input, `statusMessage` input stop mixing `captured`/`matPhase`/`progress`/
  `engineState` — all read `analyzer.isMeasurementComplete` / `currentTapCount` / `isDetecting`.
- `useMaterialSession` (whole hook) + most of `useAudioEngine`'s lifecycle mirroring disappear.

## 7. Risks & verification

- **Highest-risk file (`App.tsx`) + the core capture path (device split, 3c-C).** Each phase run-reviewed
  against the full matrix: guitar single/multi, plate, brace, load, compare, play-file, device-switch,
  pause/resume, cancel, dump-audio.
- **The 5 analyzer unit suites + `test/status-message` + `test/tap-count-change` stay green** — 3c-0 only
  renames; 3c-A/B/C preserve the analyzer's tested API and only add/move plumbing.
- **`useSyncExternalStore` correctness** — no tearing / missed renders (React-18 strict mode on).
- **3c-C is the riskiest** — the raw-per-tap device change touches the file `gated-capture` / `guitar-fft` /
  `file-playback` regression suites exercise; run them plus the oracle regressions after the split.
- **No behavior change is the acceptance bar.** Each phase independently committable + green.

## 8. `@parity` / test impact

- 3c-0: `state/tap-session` slug moves with the renamed file (keep the slug, or rename to
  `state/tap-tone-analyzer` for name-consistency — decide in §9).
- 3c-C: `audio/tap-analyzer` moves from the (web) device to the (web) `TapToneAnalyzer`; new
  `audio/realtime-analyzer` tag on the (web) `RealtimeFFTAnalyzer` → the web finally has a member of that
  canonical group. Regenerate `PARITY-MAP.md` each phase ([[feedback_parity_tags_maintained]]).
- No **new canonical behavior** → no new 3-way test slug expected; the existing suites cover it.

## 9. Decisions

*Settled:* naming (§0) · **D2 = immutable snapshot** store seam · **D3 = imperative `statusMessage` field**
(align with canonical; folds in EG-1 + the PC-2 transient gaps) · **D4 = device split required** · slug renamed
`state/tap-session` → `state/tap-tone-analyzer` · EG-1 in scope (lands in 3c-C with the device failure path).

*Sequencing:* 3c-0 ✅ → 3c-A ✅ → 3c-A2 ✅ → 3c-B ✅ → **3c-C in progress**: C1 (rename `AudioEngine`→
`RealtimeFFTAnalyzer`) ✅ committed → C2a (guitar averaging/accumulation up, bridged) ✅ committed → **§10
Peak-analysis effort — C2b (frozen + per-tap onto snapshot) + P1 + P1b + P2 + selection fix ✅ committed
2026-07-11 as ONE commit** (folded C2b per the user 2026-07-11 so the interim `tapSpectra` name never landed and
`tapEntries` carrying peaks arrived whole). **NEXT = 3c-C3** (absorb material transitions, delete
`useMaterialSession`) → C4 (imperative `statusMessage` D3 + EG-1) → C5 (shrink `useAudioEngine`) → 3c-D (collapse
two-branch rules). (§10 P3 = selection/annotations → analyzer, tracked in RESTRUCTURE-NOTES.md.)
All lifecycle *facts* live on the analyzer; 3c-C moves the *mechanics*. **Decisions settled:** device computes
FFT + delivers per-tap spectrum, analyzer accumulates spectra + averages (D1); analyzer owns the result spectra
via the snapshot (D2 align); imperative statusMessage (D3); device split required (D4).

## 10. Peak analysis into the analyzer (SPEC — for review; folds C2b)

**Goal:** the analyzer owns peak analysis, mirroring Swift `TapToneAnalyzer+PeakAnalysis` / Python — moving it
out of the view (the App `peaks` useMemo, `classifyAll`/`modeByPeak`, `tapRows`, and — for P3 — `useAnnotations`).
This is what the user meant by "do what Swift does": Swift's per-tap `TapEntry` carries **peaks**, so the web's
per-tap field must too (closing the `tapSpectra`≠`tapEntries` name-**and**-content mismatch). Reason this is its
own effort: peak-finding location is the single largest, most-interconnected view↔model surface in the port.

**Swift reference (read + verified 2026-07-11, `TapToneAnalyzer+PeakAnalysis.swift`):**
- `recalculateFrozenPeaksIfNeeded` — the ONE reactive recompute (Peak Min / guitar-type change). **Loaded-
  authoritative:** when `loadedMeasurementPeaks` is set it FILTERS them by threshold and never re-runs findPeaks
  (saved peaks may not reproduce); the live path runs findPeaks on the frozen spectrum. Preserves
  selection / annotation offsets / mode overrides **by frequency** across findPeaks' UUID churn (`applyFrozenPeakState`).
- `recalculateTapEntryPeaks` — re-runs findPeaks on each stored `TapEntry.snapshot` at the current threshold.
- `reclassifyPeaks` / `guitarModeSelectedPeakIDs` — classification + auto per-mode selection.
- `reanalyzePeaks` — clears loaded peaks, re-runs on the frozen spectrum (the Re-analyze button; web already has this).

**Web today:** all of the above is view-side — the `peaks` useMemo (findPeaks + `loadedPeaks` filter),
`classifyAll`, `tapRows`, and the `useAnnotations` hook (selection / overrides / dragged offsets). The analyzer
holds spectra only (C2b).

**Phases** (each: tsc + suite green + parity regen + **run-review** + commit; loaded-peaks-authoritative tests
stay green throughout). **Status: ✅ P1 + P1b + P2 + selection-flicker fix COMMITTED 2026-07-11** (single commit `refactor(6-test): 3c §10
P1/P2 — peak analysis moves into the analyzer`, folding the previously-uncommitted C2b so `tapSpectra` never
landed; run-reviewed "runs smoothly"; tsc · 205 · build · parity 63). **NEXT = 3c-C3.**
- **P1 — main peaks + classification into the analyzer — ✅ implemented + run-reviewed.** `analyzer.recalculatePeaks()`
  mirrors `recalculateFrozenPeaksIfNeeded` (loaded-authoritative filter vs live findPeaks; classification). App
  drives it from a `useLayoutEffect` on Peak Min / guitar type / analysis-range / frozen; the analyzer exposes
  `peaks` + `modeByPeak` on the snapshot; the view reads them via aliases (the `peaks`/`modeByPeak` useMemos are
  gone). **Absorbs the uncommitted C2b.**
- **P1b — live peaks while waiting — ✅ implemented + run-reviewed.** `recalculatePeaks` also runs on the LIVE
  spectrum when not complete (frozen once complete), so the peak list + annotations track each live FFT frame,
  mirroring Swift `analyzeMagnitudes`. (Closed a pre-existing web divergence surfaced during P1 review; the live
  spectrum is gated off after completion to avoid recomputing frozen peaks every frame.)
- **P2 — `tapEntries` with peaks — ✅ committed.** Replaced `tapSpectra` with
  `tapEntries: TapEntry[]` (`{tapIndex, spectrum, peaks}`), built at completion, recomputed on Peak Min inside
  `recalculatePeaks` (Swift `recalculateTapEntryPeaks`), restored on load from the file's per-tap spectra (peaks
  re-found, as Swift does). `tapRows` / multi-tap overlays / save (`fromLive`) read `analyzer.tapEntries`;
  per-tap peaks stay value-identical (findPeaks default range + `resolvedModePeaks` == the old
  `modePeaksFromSpectrum`). Per-mode selection is derived on demand (read-only table), not stored. Lands the
  name + content alignment the user flagged.
- **Selection-flicker fix — ✅ committed with the P1/P2 batch.** In "selected" annotation mode, dragging Peak Min
  flickered the annotations because `useAnnotations.selectedIds` (React state) lagged `autoIds` by an effect while
  the peak ids churned. Fixed: the effective selection is now derived synchronously (`userModified ? selectedIds
  : autoIds`), mirroring Swift `applyFrozenPeakState` setting `selectedPeakIDs` in the same pass as `currentPeaks`.
- **P3 — selection / overrides / annotation offsets → analyzer** (Swift's by-frequency preservation, incl.
  carrying a MANUAL selection across Peak Min id-churn — `applyFrozenPeakState` lines 608-629). **Tracked in
  [RESTRUCTURE-NOTES.md](RESTRUCTURE-NOTES.md)** (user, 2026-07-11) — the most view-entangled slice, belongs with
  the view-layer restructure.

**Risks:** loaded-peaks-authoritative (its own invariant + tests + [[project_loaded_peaks_authoritative]]) — the
analyzer must own "filter, never re-find"; Peak Min / guitar type / analysis-range reactivity becomes
analyzer-triggered (App wires the triggers); annotation peak-IDs; multi-tap table + PDF. Largest behavioral
surface in the consolidation → phased + heavy run-review; no behavior change is the bar.

**C2b status: ✅ committed 2026-07-11 as part of this effort's single commit** — folded in (user chose this so
`tapSpectra` never landed). Its frozen-spectrum + snapshot plumbing became part of P1; its `tapSpectra` was
replaced by P2's `tapEntries`.

## 11. 3c-C3 — Material orchestration into the analyzer

**Status: C3a + C3b ✅ committed 2026-07-12** (run-reviewed). C3a moved the material phase machine onto the
analyzer (deleted `useMaterialSession`, analyzer holds the device); C3b moved material averaging + peak-find up
(device is now a pure gated-capture emitter for both guitar + material; REG-B1/P1/P2 oracles unchanged).
**NEXT = C4** (imperative statusMessage + EG-1) → C5 (shrink useAudioEngine) → 3c-D (collapse two-branch rules).
**EG-2** (feed liveSpectrum into the material chart — a pre-existing gap, NOT a C3 regression) is **deferred
until 3c is complete** (user 2026-07-12: keep the 3c spine focused; side-tracks don't survive compaction). Two divergences were corrected during C3a: (1) an initial pure pass-through `useCallback`
wrapper layer in App (user caught it — Swift/Python call the analyzer directly, so App now does too); (2) a
latent bug — `analyzer.measurementType` was NEVER synced (`setMeasurementTypeAndNotify` had no callers) and
`MeasurementType` was DUPLICATED on the analyzer (its copy even dropped `'generic'`) — reconciled to the single
settings type + wired the sync effect.

**Goal:** move the plate/brace phase machine onto `TapToneAnalyzer` and delete `useMaterialSession`, mirroring
Swift — whose `TapToneAnalyzer` owns `handle{Longitudinal,Cross,Flc}GatedProgress` + `materialCapturedTaps` +
`longitudinalSpectrum`/`crossSpectrum`/`flcSpectrum`, and **holds `fftAnalyzer`** (the device). This is the phase
where the web analyzer starts holding a **device reference**.

**Split (user-approved 2026-07-11):**
- **C3a — orchestration + state up, BRIDGED.** Analyzer owns material state + transitions + a device reference;
  the device still averages the per-phase taps + finds the material peak (emits `onMaterialCapture` as today).
  Value-preserving (like C2a was for guitar).
- **C3b — material averaging + peak-find up — ✅ committed 2026-07-12.** Device emits each raw per-phase gated
  tap (`onMaterialTap`) + signals `onMaterialPhaseComplete(phase?)` (`materialCollected`→`materialTapCount`); the
  analyzer accumulates in `materialBuffer` (`recordMaterialTap`) then `averageSpectra` + `findDominantPeak` on
  the average using `matSearch`'s range (`recordMaterialPhaseComplete`, was `recordMaterialCapture`). Gated FFT +
  calibration stay in the device → zero drift; `file-playback` `playMaterial` drives a real analyzer, REG-B1/P1/P2
  pass. Completes device purity (pure gated-capture emitter for guitar + material). Mirrors guitar C2a.

**C3a — what moves off `useMaterialSession` onto the analyzer:**
- **State (→ snapshot; match Swift, user #3):** `matSpectra` (mirrors Swift `longitudinalSpectrum`/`crossSpectrum`/
  `flcSpectrum`) + `matPeaks` become analyzer fields exposed on the snapshot (ref-cached like `frozenSpectrum`);
  App reads them via aliases (same pattern as C2b `captured`/`tapEntries`). `materialTapPhase` already lives on
  the analyzer — the transitions read it synchronously, so `matPhaseRef` is dropped.
- **Transitions:** `startMaterial` / `acceptMaterial` / `redoMaterial` / `recordMaterialCapture` / `resetMaterial`
  / `restoreMaterial`, plus `matSearch` (L/C/FLC ranges), `finishMaterialSession` (WAV label), and the FLC
  reposition **cooldown** timer (owned by the analyzer, cleared on reset/cancel).
- **Device reference:** `analyzer.setDevice(engine)`, called by `useAudioEngine` when it creates the device.
  Transitions call `this.device?.armMaterial / checkpointSession / redoSession / startSessionRecording /
  finishSessionRecording`; read `this.device.playingFile`. (A *reference* — device creation/lifecycle stays in
  `useAudioEngine`; full ownership is C5.)

**Settings for `matSearch` (verified against Swift + Python 2026-07-11):**
- **calibration — READ FROM THE DEVICE (not a setter).** Swift reads `fftAnalyzer.calibrationCorrections`
  (SpectrumCapture:675); Python reads `self.mic._calibration` (spectrum_capture:810). So the web analyzer reads
  `this.device.calibration` via a new **getter on `RealtimeFFTAnalyzer`** — matches canonical, no duplication.
- **measureFlc — MIRRORED SETTER on the analyzer.** Swift reads `TapDisplaySettings.measureFlc`
  (Control:221/337, SpectrumCapture:1344, TapDetection:372); Python reads `_tds.measure_flc()`. The web has no
  analyzer-visible global settings singleton, so it mirrors `measureFlc` onto the analyzer via a setter — exactly
  as `numberOfTaps` (also a `TapDisplaySettings` value) is already mirrored. The web adaptation of "read the
  settings singleton."

**Delete `useMaterialSession`;** App calls `analyzer.startMaterial/accept/redo`; the device `onMaterialCapture` →
`analyzer.recordMaterialCapture`; App reads `snapshot.matSpectra`/`matPeaks`/`materialTapPhase`.

**`@parity`:** reconcile the deleted `useMaterialSession`'s slug (if any) in the map; the material orchestration
aligns onto the analyzer's `audio/tap-analyzer` group (Swift `TapToneAnalyzer+SpectrumCapture`). Regenerate.

**Risk / run-review (heavy):** full plate L→C→FLC, brace, accept/redo, the FLC reposition cooldown, file-playback
material (engine auto-advance), load a saved material measurement, cancel, dump-audio. No material-orchestration
unit coverage → run-review is the gate. Acceptance bar: no behavior change.