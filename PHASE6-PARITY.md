# Phase 6 — Parity completion & analysis features (web)

**Status:** in progress (updated 2026-06-28) — see the **Progress** checklist below. Builds on **Phase 5** (shipped, tracked outside this repo — no PHASE5
doc): export PNG + PDF (single + saved-comparison), Play-File through the live pipeline +
headless regression harness, device picker + calibration import, Pause/Cancel tap controls,
draggable annotations + Reset Labels, per-capture "Dump Capture Audio". Canonical references:
Swift `GuitarTap` (`/Users/dws/src/GuitarTap`) leads on both algorithm and UX; Python
`guitar_tap` (`/Users/dws/src/guitar_tap`) is the mirror. Replicate by reading the source.

## Goal
Close the remaining gaps so the web reaches **feature parity** with the Swift/Python apps:
the ring-out/tap-tone analysis a luthier reads off the results panel,
draggable material labels, the multi-tap PDF, the continuous session recording, and in-app
help — plus the version/build identity the desktop apps show. (A log-frequency axis is NOT a
gap — see 6c: neither native app exposes a user toggle, and the web already mirrors that.)

## Progress
- ✅ **Versioning & identity** — 1.0.1 + git-commit build, shown like the desktop apps
- ✅ **6-ARCH** — ViewModel hooks (`useAudioEngine`/`useMaterialSession`/`useAnnotations`/`useChartView`) + `presentation/` layer extracted
- ✅ **6a** — Ring-out / decay-time computation (`dsp/decay.ts`, wired into the engine)
- ✅ **6b** — Live "Analysis Results" panel (Ring-Out + Tap-Tone-Ratio) + footer status
- ✅ **6c** — DROPPED (not a parity gap; the original audit was wrong)
- ✅ **6d** — Material annotation dragging (single shared offset store, save/load)
- ✅ **6e** — Multi-tap PDF report (two-page: averaged + per-tap comparison)
- ✅ **6f** — Continuous session-recording WAV (guitar live + file; live material; gated on the dump setting)
- ⬜ **6g** — In-app Help View + online User Manual link
- ⬜ **6h** — Per-measurement-type display ranges (minor)
- ⬜ **6i** — Decay clock → audio-time everywhere + cross-platform ring-out regression test
- ⬜ **6j** — Status-bar review (footer status + metrics line) vs Swift/Python
- ⬜ **6-MAP** — parity anchors + generated map (needs tag-syntax sign-off)
- ⬜ **6-TEST** — cross-platform test review & normalization (major)

## Versioning & identity ✅ DONE (kicked off Phase 6)
Web now matches the Swift/Python scheme: short version = `package.json` `version` = **1.0.1**
(= Swift `MARKETING_VERSION`, Python `version` file); **build number = git commit count**
(`git rev-list --count HEAD`) — the same source as Swift's "Set Build Number from Git" build
phase (→ `CFBundleVersion`) and Python's `gen_version_build.sh` (→ `version_build`, runtime
git fallback). Injected via `vite.config.ts` `define` (`__APP_VERSION__`, `__APP_BUILD__`;
fallback `"0"` outside git), declared in `src/vite-env.d.ts`. Shown as **"Guitar Tap 1.0.1
(NNN)"** in the app title bar **and** the browser tab title (`document.title`) — mirroring the
Swift/Python window titles — plus Settings → About and the PDF report footer. ("Phase N" was
only ever an internal milestone label and is gone from the UI.)

## Sub-phases (each independently shippable)

### 6a — Ring-out / decay-time computation ✅ DONE
**Done 2026-06-28:** `src/dsp/decay.ts` (`DecayTracker` + pure `measureDecayTime`) — post-tap peak →
first sample below peak−15 dB → seconds, in AUDIO time (deterministic / file-playback-safe); wired into
`audio/engine.ts` (`onDecay`, `get decayTime`); tested in `test/g4d-decay.test.ts`. Original gap below.

The model already carries `decayTime` and encode/decode round-trips it, but **nothing computes
it**. Port the decay-tracking state machine: Swift `TapToneAnalyzer+DecayTracking.swift`
(start/track/measure), Python `models/tap_tone_analyzer_decay_tracking.py`. It tracks the
captured signal's magnitude fall from the onset peak down to a **−15 dB** threshold → ring-out
seconds, with per-guitar-type quality thresholds (already ported in
`src/dsp/analysisQuality.ts` `decayQuality`). Lands in the web engine's post-onset path
(the continuous level is already computed for the meter). Unlocks the Ring-Out box everywhere
(PDF guitar analysis currently omits it because `decayTime` is null). **Highest leverage** —
feeds 6b and the PDF.

### 6b — Live "Analysis Results" panel (Ring-Out + Tap-Tone-Ratio) ✅ DONE
**Done 2026-06-28:** `components/AnalysisResults.tsx` rewritten to the native compact 2-column format
(Ring-Out | divider | Tap Ratio), pinned below the scrollable peak list & above the export bar, always
visible, with "Waiting…" / "Need Air & Top" empty states. Also restored the footer status indicator
(green ● "Analyzing" / gray ● "Stopped"). Original gap below.

The web already **computes** tapToneRatio (`dsp/analysisQuality.ts`) and renders both boxes in
the **PDF** (`pdfReport.ts` drawGuitarAnalysis), but the **live results pane** (App.tsx right
column) shows only the peak list. Add the two analysis boxes — Ring-Out Time (needs 6a) and
Tap Tone Ratio (ready now) — matching Swift `TapAnalysisResultsView` (~569–628): value +
quality label + color + ideal-range hint. Tap-Tone-Ratio can ship before 6a lands.

### 6c — Log-frequency axis — DROPPED (NOT a parity gap; the original audit was wrong)
Verified 2026-06 against both apps: `isLogarithmic` / `is_logarithmic` is a SERIALIZED model field
that is set to **`false` at every construction site** and is **never toggled by any UI** — there is no
`Toggle`/menu/setting for it in Swift (`TapSettingsView+Sections` toggles are only measureFlc /
showUnknownModes / dumpCaptureAudio; the one `$isLogarithmic` binding is inside a `#Preview`) or
Python. Swift carries DORMANT log-rendering/gesture code (`SpectrumView+GestureHandlers`,
`PeakAnnotations`), Python doesn't even have that. **The web already mirrors this exactly**: a dormant
`logFreq` capability (hardcoded false) + the serialized `isLogarithmic` field + no toggle. Adding a
log-frequency toggle would DIVERGE from Swift/Python (which have none), so do NOT implement it.

### 6d — Material annotation dragging ✅ DONE
Confirmed against the gold standard: Swift/Python use ONE `peakAnnotationOffsets` store (keyed by peak
UUID) for ALL peaks — there is no material-specific annotation code (one shared `spectrumView` +
`resetAllAnnotationOffsets` for both). So the web now reuses the SINGLE shared offset store for material
too rather than a separate one: `buildMaterialMarkers` sets `annoKey`/`annoOffset` (key =
`frequency.toFixed(1)`); `useAnnotations` gained a `material` flag so the fresh-capture reset steps
aside in material mode (material's lifecycle clears on `startMaterial`, restores on load); the chart's
existing drag/Reset-Labels are enabled for material; and offsets persist via the same
`peakAnnotationOffsets` slot (re-keyed UUID↔frequency in `buildMaterialMeasurement` /
`measurementToLiveMaterial`). Tests: 3 round-trip cases in `g8-material-load.test.ts`. (Live drag
gesture reuses the guitar path verbatim — worth a quick browser confirm.)

### 6e — Multi-tap PDF report ✅ DONE
**Done 2026-06-28:** `pdfReport.ts` refactored into a reusable `renderReportContent(cur, data)` +
shared `drawFooters` so `generateMultiTapPdfReport(averaged, comparison)` composes a **two-page**
report exactly like Swift `generateMultiTapReport` — page 1 the averaged single-measurement report,
page 2 the per-tap comparison. Page 2 is built by `multiTapPdfData(m)` (presentation) which
synthesizes comparison entries from the measurement's `tapEntries` + a trailing "Averaged" entry
(`multiTapComparisonEntries`, model layer, mirroring Swift `cmpEntries`) and feeds them back through
the existing comparison PDF path — so it can't drift from a saved-comparison report. `App.exportPdf`
gates on `m.tapEntries.length > 1` ("multi-tap always produces the two-page report", like Swift).
Per-tap colors reuse `COMPARISON_PALETTE`; averaged uses `MULTITAP_AVG_COLOR`. 5 tests in
`g9-multitap.test.ts`; 132 green, typecheck+build clean. (Single + saved-comparison PDFs were Phase 5.)

### 6f — Continuous session-recording WAV ✅ DONE
**Done 2026-06-29:** the engine accumulates every pipeline chunk into a session buffer while
`sessionRecording`, emitting it once at measurement completion via the new `onSessionAudio(samples,
rate, label)` callback → App writes `session_<label>.wav`. Mirrors Swift `finishSessionRecording`:
labels `Guitar_<n>tap` / `Plate_LC` / `Plate_LCF` / `Brace`; paused segments excluded (pause/resume
toggle the flag); redone material phases truncated via checkpoints (`checkpointSession`/`redoSession`).
Accumulation is **gated on the `dumpCaptureAudio` setting** (config flag synced from App) so there's
zero buffering cost when the diagnostic is off. **Guitar** is engine-managed (auto-start in `arm()` +
the file-playback guitar branch, auto-finish on the final tap) so it covers live AND file playback;
**live material** is driven by `useMaterialSession` (start/checkpoint/redo/finish/cancel). Tests:
3 cases in `g11-file-playback` (Guitar_1tap continuous+bounded, Guitar_8tap label, off→none); 135 green.
**Known minor gap:** file-playback *material* sessions aren't recorded (the engine owns that auto-advance
path; live material — the actual diagnostic use — is fully wired). Low value (you already have the file).
**Parity correction (2026-06-29) — ALL THREE PLATFORMS:** the "Dump Capture Audio" diagnostic now writes
ONLY the continuous session WAV per measurement; the per-capture/intermediate dumps are gone. The session
file already contains every APPROVED tap/phase in capture order (redone phases truncated via the
checkpoint mechanism), which is the whole point — replay reproduces the measurement. Changes:
(1) the web's per-phase material dump (a Phase-5 over-implementation) was removed; (2) the **per-tap
"guitar" dump** that Swift+Python+web all wrote in finish[Guitar]GatedCapture was removed from **all three**
(Swift `+SpectrumCapture.swift:621`, Python `…spectrum_capture.py:777`, web engine `onCaptureAudio` —
removed entirely). So a 3-tap guitar = one `session_Guitar_3tap.wav`; a plate = one `session_Plate_LCF.wav`
(5 taps/phase × 3 phases = 15 taps, in order). **Redo-of-first-phase** is handled by the session-start
checkpoint `[0]` (Swift `Control.swift:172` + Python `:622` already seeded it; the web now seeds `[0]` in
`startSessionRecording` too). Verified: web 135 tests, Python 372 tests; Swift edit is a clean
single-statement removal (params still used; on the Apple-review hold — edited, not committed).

### 6g — In-app Help View + online User Manual link
Two distinct things both Swift and Python expose, and the web currently has **neither** (only the
chart's zoom/pan popover):

- **6g-1 — Help View** (in-app sectioned help): Swift `HelpView.swift` (~697 lines, 13+ sections:
  setup, guitar/plate/brace workflows, ring-out, tap-tone ratio, material properties,
  troubleshooting), Python `views/help_view.py` (`HelpDialog`, opened via `_show_help`). Add a
  Help panel/modal — prefer **deriving from the canonical `Documentation/Manual` markdown** over
  re-authoring. **The Help View does NOT itself link to the User Manual** — verified `HelpView.swift`
  contains no `DocumentationLinks.userManual` reference (only descriptive prose at ~line 275 telling
  the reader where the Help button / Settings live). 6g-1 and 6g-2 are **separate, sibling actions**.
- **6g-2 — User Manual (online) link**: opens the published manual in a new browser tab. Swift
  `DocumentationLinks.userManual`, Python `_open_user_manual` — both build the SAME versioned URL
  `https://www.dolcesfogato.com/guitar_tap/manual/GuitarTap-User-Manual-{version}.html`. **The online
  User Manual is ONE shared resource serving all three apps** (Python, Swift, and the web) — the web
  links to the same manual, embedding `__APP_VERSION__` in the URL exactly as the desktop apps embed
  their marketing version.

**How the apps expose these:**
- **iOS / iPadOS (the model for the web):** a **toolbar Help icon (`questionmark.circle`) immediately
  to the right of Settings** opens a **two-item popover menu** (`helpMenuPopover`): ① **Help View**
  (`questionmark.bubble` → `showingHelp`), ② **User Manual** (→ `DocumentationLinks.userManual`).
  This is the exact pattern the user described.
- **macOS Swift / Python desktop:** the **menu-bar Help menu** holds both items; the **Settings →
  About & Help** section repeats both. No in-toolbar Help button on desktop.

**Web plan (no menu bar → mirror the iOS toolbar pattern):** add a **Help icon on the control bar
(`.toolbar-app`), immediately right of Settings** (circled "?"). It opens a **two-item menu**: ① **Help
View** (6g-1) and ② **User Manual (online)** (6g-2) — siblings, mirroring `helpMenuPopover` exactly
(NOT the manual nested inside the Help View). Also surface the User Manual link in **Settings → About &
Help** (parity with the desktop About; the web About currently has neither). The chart's existing "?"
popover is unrelated (zoom/pan controls) and stays.

### 6h — Per-measurement-type display ranges (minor)
Swift keys displayMinFreq/displayMaxFreq per `MeasurementType`; web `settings.ts` uses a single
**global** displayMinHz/displayMaxHz, so switching type doesn't restore a type-specific default
range. Low priority.

### 6i — Decay clock → audio-time everywhere + cross-platform ring-out regression test
The live-decay audit (2026-06-29) left one gap: the three apps now share the decay *algorithm* (20·log10(rms)
dBFS, ~43 Hz per-chunk cadence, 2.0 s peak-hold seed, max-post-tap → first-below-(peak−15 dB)), but NOT
the same *clock*. The **web** times decay on the AUDIO clock (sample-count / rate) → deterministic and
correct under headless/fast file playback. **Swift** (`Date()`) and **Python** (`time.monotonic()`) time
decay on WALL-CLOCK — fine for live mic / real-time-paced playback, but a fast/headless play of a recorded
file yields ~0 wall-clock deltas → garbage ring-out. So a deterministic ring-out value can be pinned in the
web today but NOT in Swift/Python's fast regression harness.
**Plan:** (1) move Swift + Python decay timing to audio-sample time (mirror the web) — also more correct
for real file playback, and makes ring-out *values* identical across platforms for the same WAV; then
(2) add a shared **REG-G ring-out** regression test to all three (web `g11-file-playback`, Python
`test_file_playback_regression`, Swift `FilePlaybackRegressionTests`) that plays a guitar WAV
(`Recording 5.wav` single-tap is already a shared fixture) and asserts `decayTime` against a golden value
within tolerance. NB: Swift is the master and on Apple-review hold — the clock change is behavioral, so it
waits for a release window; sequence the web test first (it's deterministic now), Python/Swift after the
clock move. Builds on the audit recorded in the Phase 6 memory.

### 6j — Status-bar review (footer status + metrics line)
Audit the app's bottom status bar for Swift/Python parity — content, wording, and conditions. The web
footer currently shows the run indicator (green ● "Analyzing" / gray ● "Stopped", added in 6b) plus a
metrics line (e.g. "48.0 kHz · 0.73 Hz/bin · 0.73 fps · AGC ? · EC off · NS ?"). Open questions: do Swift
and Python show the same fields, in the same order, with the same labels/units? Are the "?" states (AGC/NS
unknown) handled the same, or should they resolve to on/off? Is the sample-rate / bin-width / fps line a
native feature or web-only? Compare against Swift's and Python's status presentation and reconcile (drop
web-only clutter, add any missing native fields). Not yet scoped against the canonical source — start with
a read of how Swift/Python render their status/footer.

## Architecture & tooling (HIGH PRIORITY — do early)

These are not feature parity, but the user has flagged them high priority. The model/view
*separation* the Swift/Python apps get from `Models/Utilities/Views` already exists in the web tree
under idiomatic names — `dsp/` + `measurement/` + `settings.ts` = the **model/domain layer** (pure,
oracle-tested), `components/*.tsx` = **views**, `audio/engine.ts` = a **service**, `format/` =
**utilities**. React expresses the ViewModel layer as **custom hooks**, not a folder. The real
divergences are two:

### 6-ARCH — ViewModel hooks + presentation layer ✅ DONE
**Done 2026-06-28:** extracted `useAudioEngine`, `useMaterialSession`, `useAnnotations`, `useChartView`
hooks (App.tsx ~1,570 → ~1,250 lines) and moved the non-component `.ts` (chartTypes, modeColors,
spectrumRender, spectrumExport, pdfReport, measurementImage) into a `presentation/` layer so the model
no longer imports from views. Tests green after each step. Original plan below.

- **`App.tsx` is ~1,570 lines** — it's the de-facto ViewModel (most state + handlers) inline in the
  root view. Extract **custom hooks**, each owning a coherent slice of state + its handlers (the React
  ViewModel): candidates `useAudioEngine` (engine lifecycle + capture/material callbacks + clip/level),
  `useMeasurementLibrary` (save/list/load/import/export + loaded-state restore), `useAnnotations`
  (offsets/overrides/selection), `usePlayFile`, `useChartView` (view range + reset). `App.tsx` becomes
  thin wiring + layout. Do it **incrementally, one hook at a time**, re-running the 112 tests after each
  (no behavior change). Pairs naturally with **6b** (both touch results-pane state).
- **Move the non-component `.ts` files out of `components/`** — `pdfReport.ts`, `spectrumExport.ts`,
  `spectrumRender.ts`, `measurementImage.ts`, `modeColors.ts` are presentation/transform logic, not
  React components. Relocate to a `presentation/` (or `render/` + `export/`) layer so `components/` is
  purely views. Mechanical (import-path churn only).
- Result: a clean layer mapping to the desktop apps — `dsp`+`measurement` = Models, `hooks/` =
  ViewModels, `components/` = Views, `audio/` = service, `presentation/` = view-side transforms,
  `format/` = Utilities.

### 6-MAP — Parity mapping: in-code anchors + generated map (retire the hand-maintained file)
Problem (user): the central **`PARITY-MAP.md`** must be hand-maintained and will diverge; generic
searches across THREE repos are error-prone. Today the mapping lives in three places — the central
file (rots), ~38 files' **informal** "mirrors Swift X / Python Y" comments (co-located, good), and the
**name-echoing convention** (`classify.ts` ↔ `GuitarMode.classify`). The behavioral contract is the
**oracle** (`parity-oracle.json` + `sync-oracle.sh --check`), which already cannot silently diverge.

**Decision/approach:** make the **co-located in-code anchors the single source of truth**, and
**generate** the central map from them so the file becomes a build artifact that can't rot:
1. **Standardize a greppable anchor tag** in each web module header, e.g.
   `// @parity swift=GuitarTap/Models/GuitarMode.swift:classify python=src/guitar_tap/models/guitar_mode.py:classify`
   (formalizes the 38 existing informal comments). It travels with the code and is reviewed in the same
   diff → minimal divergence; finding a counterpart is one grep, not a guess.
2. **`tooling/gen-parity-map.ts`** scans the `@parity` tags → regenerates the `PARITY-MAP.md` tables
   (prose intro stays hand-written). `--check` in CI (mirroring `sync-oracle.sh --check`): regenerate &
   diff (map provably current) **and** assert every referenced Swift/Python path still exists (catches
   drift when the canonical side moves/renames — the one failure mode co-location can't catch).
3. Keep the **oracle** (behavioral) and **name-echoing** (search aid) as the other two legs.
Net: no hand-maintained map, no generic 3-repo searches, and staleness is caught by CI. (Open question
for sign-off: exact tag syntax + whether to also emit a reverse index keyed by Swift symbol.)

### 6-TEST — Cross-platform test review & normalization (MAJOR)
A full audit of the test suites across all three repos to establish a **shared common core** that every
platform runs, with **matching test names** for the same behavior, plus platform-specific extras where
justified. Today the suites overlap but aren't normalized: Swift `GuitarTapTests/*.swift` (~22 files)
and Python `tests/test_*.py` (~24 files) **already mirror each other by name** (e.g.
`AnnotationStateTests` ↔ `test_annotation_state.py`, `DecayTrackingTests` ↔ `test_decay_tracking.py`,
`ButtonEnablementTests` ↔ `test_button_enablement.py`, `StateInvariantTests`, `ScenarioStateTraceTests`,
`MeasurementCodableTests`, `FilePlaybackRegressionTests`, …); the **web** (`test/*.test.ts`, ~20 files)
uses a different scheme (G0–G11 + named) and is **missing several behavioral suites** the other two
have (e.g. decay tracking — blocked on 6a — button enablement, state invariants, scenario traces,
frozen-peak recalculation, import persistence as named suites). The web's strength is the oracle-driven
DSP layer; its gap is the state-machine/UI-behavior suites.

How to go about it:
1. **Inventory → coverage matrix.** List every test in each repo; build a matrix of *behavior × platform*
   (rows = a canonical behavior/suite name, cols = Swift/Python/Web → present? test name? oracle case?).
   This surfaces what's shared, what's unique-and-justified, and what's missing on each side.
2. **Adopt one canonical suite-naming scheme** (Swift/Python already agree → use theirs as the spine;
   keep the web's `G#` oracle codes as a secondary tag). Rename web suites so the same behavior reads
   the same across all three (ties into 6-MAP's `@parity` anchors — tag each test file with its
   counterparts).
3. **Backfill the common core both directions.** Port missing shared tests so all three run an
   equivalent core (web gets the behavioral/state suites; Swift/Python get any web-only checks worth
   sharing). Use the existing shared **oracle** (`parity-oracle.json`) as the fixture source so numeric
   expectations stay identical; only the harness differs per language.
4. **Document the contract.** A short coverage-matrix doc (generated or curated) + a rule: a change to
   shared behavior updates the test on **all three** platforms (same as the "update all three + oracle"
   rule for algorithms).
Scope note: this is a **major** review — sequence it after 6-ARCH/6-MAP (so the web suites land in their
final layout/naming) and alongside the feature sub-phases (e.g. the decay-tracking suite arrives with
6a). Builds on the existing paired Swift/Python analyzer-state tests (the parity test suite).

## Out of scope / optional
- **Cloud sync** and **File System Access folder sharing** — from the original PLAN.md
  "Optional:" line; **not** a Swift/Python parity gap (neither app has cloud sync). May be dropped.

## Sequencing
**Done so far:** ~~6-ARCH~~ → ~~6a (decay)~~ → ~~6b (live analysis boxes)~~ → ~~6c (log freq, DROPPED — not a parity gap)~~ → ~~6d (material drag)~~ → ~~6e (multi-tap PDF)~~.

**Remaining:** **6g (Help View + manual link)**,
**6h (per-type display ranges, minor)**, **6j (status-bar review)** in roughly that priority order;
**6i (decay clock → audio-time + ring-out regression test)** is gated on a Swift release window (the
clock change is behavioral, Apple-review hold); plus the tooling **6-MAP** (needs tag-syntax sign-off)
and the **6-TEST** normalization (major — sequence after 6-MAP so the web suites land in their final
naming). Verify each gap against current `main` before starting (Phase 5 +
the work above already closed several items an earlier audit listed as missing — e.g. per-capture WAV,
saved-comparison PDF, the log-axis "gap").