# TapToneAnalyzer / RealtimeFFTAnalyzer Consolidation (6-TEST step 3c)

**Status:** SPEC — for review. No code until the remaining open decisions (§9) are settled. Created 2026-07-10.
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

- **3c-C2 — Move the GUITAR averaging/accumulation up.** Device stops owning `collected`/`averageSpectra` for
  guitar; it emits **raw per-tap spectra**. The analyzer accumulates them in `capturedTaps` and averages via
  `processMultipleTaps` (already built + tested) when the count is reached; App reads the frozen result + the
  per-tap spectra (`tapSpectra` for the multi-tap view) from the analyzer.
  - **Key dataflow (matches Swift):** the device delivers the gated **samples** to the analyzer; the analyzer
    calls `computeGatedFFT` and accumulates the spectrum — exactly what
    `TapToneAnalyzer.finishGuitarGatedCapture(samples)` already does. Mirrors Swift, where `computeGatedFFT` is
    a **device** method *"called externally by TapToneAnalyzer"* (RealtimeFFTAnalyzer.swift:33). So
    `finishGuitarGatedCapture` **stays as-is — no test change**; the device just stops averaging and hands over
    the per-tap gated samples.
  - **Riskiest single diff.** Run-review: guitar single + multi-tap, the multi-tap comparison view, and the
    file-playback oracle regressions (`file-playback` / `gated-capture` / `guitar-fft`).

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

*Sequencing:* 3c-0 ✅ → 3c-A (count facts) ✅ → 3c-A2 (completion + detection) ✅ → 3c-B (matPhase fact) ✅ done
→ **3c-C next**: the big one — analyzer holds the device (`AudioEngine`→`RealtimeFFTAnalyzer`), move averaging
up, absorb the material transitions + delete `useMaterialSession`, imperative `statusMessage` (D3) + EG-1 →
3c-D (collapse the two-branch rules). All lifecycle *facts* now live on the analyzer; 3c-C moves the
*mechanics*.