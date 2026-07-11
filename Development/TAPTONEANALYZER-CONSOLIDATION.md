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
- **3c-B — Absorb the material phase machine into `TapToneAnalyzer`.** Move `matPhase` +
  `start/accept/redo/record/reset/restore` in (the `materialTapPhase` field already exists). Delete
  `useMaterialSession`; App reads `analyzer.materialTapPhase`.
- **3c-C — Split the device out: `AudioEngine` → `RealtimeFFTAnalyzer`.** Move averaging / tap-accumulation /
  completion OUT of the device INTO `TapToneAnalyzer` (device now emits raw per-tap/per-phase spectra +
  level/state). Rename `src/audio/engine.ts` → `realtimeFFTAnalyzer.ts`, class `AudioEngine` →
  `RealtimeFFTAnalyzer`; retag `@parity audio/tap-analyzer` off the device and onto `TapToneAnalyzer`, add
  `@parity audio/realtime-analyzer` to the device. Web now has BOTH canonical classes, 1:1 with Swift/Python.
- **3c-D — Collapse the two-branch rules.** With one source, rewrite `tapsLocked` and `sbProgress` as single
  expressions over `analyzer.currentTapCount` / `numberOfTaps` / `materialTapPhase`.

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

*Sequencing:* 3c-0 ✅ committed → 3c-A (count facts) ✅ committed → 3c-A2 (completion + detection) ✅ done →
**3c-B next** (absorb the material phase machine) → 3c-C (device split + `AudioEngine`→`RealtimeFFTAnalyzer` +
EG-1) → 3c-D (collapse the two-branch rules). No remaining open decisions.