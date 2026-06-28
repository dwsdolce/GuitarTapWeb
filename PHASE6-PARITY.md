# Phase 6 — Parity completion & analysis features (web)

**Status:** planning. Builds on **Phase 5** (shipped, tracked outside this repo — no PHASE5
doc): export PNG + PDF (single + saved-comparison), Play-File through the live pipeline +
headless regression harness, device picker + calibration import, Pause/Cancel tap controls,
draggable annotations + Reset Labels, per-capture "Dump Capture Audio". Canonical references:
Swift `GuitarTap` (`/Users/dws/src/GuitarTap`) leads on both algorithm and UX; Python
`guitar_tap` (`/Users/dws/src/guitar_tap`) is the mirror. Replicate by reading the source.

## Goal
Close the remaining gaps so the web reaches **feature parity** with the Swift/Python apps:
the ring-out/tap-tone analysis a luthier reads off the results panel, a log-frequency view,
draggable material labels, the multi-tap PDF, the continuous session recording, and in-app
help — plus the version/build identity the desktop apps show.

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

### 6a — Ring-out / decay-time computation
The model already carries `decayTime` and encode/decode round-trips it, but **nothing computes
it**. Port the decay-tracking state machine: Swift `TapToneAnalyzer+DecayTracking.swift`
(start/track/measure), Python `models/tap_tone_analyzer_decay_tracking.py`. It tracks the
captured signal's magnitude fall from the onset peak down to a **−15 dB** threshold → ring-out
seconds, with per-guitar-type quality thresholds (already ported in
`src/dsp/analysisQuality.ts` `decayQuality`). Lands in the web engine's post-onset path
(the continuous level is already computed for the meter). Unlocks the Ring-Out box everywhere
(PDF guitar analysis currently omits it because `decayTime` is null). **Highest leverage** —
feeds 6b and the PDF.

### 6b — Live "Analysis Results" panel (Ring-Out + Tap-Tone-Ratio)
The web already **computes** tapToneRatio (`dsp/analysisQuality.ts`) and renders both boxes in
the **PDF** (`pdfReport.ts` drawGuitarAnalysis), but the **live results pane** (App.tsx right
column) shows only the peak list. Add the two analysis boxes — Ring-Out Time (needs 6a) and
Tap Tone Ratio (ready now) — matching Swift `TapAnalysisResultsView` (~569–628): value +
quality label + color + ideal-range hint. Tap-Tone-Ratio can ship before 6a lands.

### 6c — Log-frequency axis
`SpectrumChart`/`spectrumRender` already support `logFreq` (xFor uses log10; FREQ_TICKS_LOG
exists), but it's hardcoded `false`, has **no toggle**, and the wheel/drag interaction
**early-returns** when logFreq is set (`if (logFreq) return`). Port log-space pan/zoom from
Swift `SpectrumView+GestureHandlers` (logAnchor/logMin/logMax) and log-space badge anchoring
(`PeakAnnotations` uses log10(freq)); add a setting + a ⋯ Chart-Options / toolbar toggle.

### 6d — Material annotation dragging
Drag infra is generic (annoKey/annoOffset + badgeRects from Phase 5), but App passes
`onAnnotationDrag/onResetLabels = undefined` for material/comparison and material markers carry
no `annoKey`. Swift drags L/C/FLC labels too. Thread `annoKey` + a material offset store (key by
phase or peak frequency) through `buildMaterialMarkers`, App state, and save/load — the guitar
path is the template.

### 6e — Multi-tap PDF report
Web multi-tap export is image-only. Swift `exportMultiTapPDFReport` / `generateMultiTapReport`
produce a **two-page** report (the averaged single-measurement report + a per-tap comparison
page); Python `export_multi_tap_pdf`. Add a multi-tap variant to `pdfReport.ts` reusing the
existing single-page + comparison-table drawers. (Single-measurement and saved-comparison PDFs
already done in Phase 5.)

### 6f — Continuous session-recording WAV
Phase 5 added the **per-capture** dump (guitar per-tap + material per-phase analyzed buffers).
Swift **also** writes a **continuous session buffer** (`finishSessionRecording` accumulates
every accepted phase across the whole measurement → one `*_session_*.wav`). Add a continuous
accumulation buffer in the engine (gated to the dump setting) + a session WAV at completion.
Lower value than 6a–6e.

### 6g — In-app Help View + online User Manual link
Two distinct things both Swift and Python expose, and the web currently has **neither** (only the
chart's zoom/pan popover):

- **6g-1 — Help View** (in-app sectioned help): Swift `HelpView.swift` (~697 lines, 13+ sections:
  setup, guitar/plate/brace workflows, ring-out, tap-tone ratio, material properties,
  troubleshooting), Python `views/help_view.py` (`HelpDialog`, opened via `_show_help`). Add a
  Help panel/modal — prefer **deriving from the canonical `Documentation/Manual` markdown** over
  re-authoring.
- **6g-2 — User Manual (online) link**: opens the published manual in a new tab. Swift
  `DocumentationLinks.userManual`, Python `_open_user_manual` — both build the SAME versioned URL
  `https://www.dolcesfogato.com/guitar_tap/manual/GuitarTap-User-Manual-{version}.html` (embed
  `__APP_VERSION__` so it tracks releases, exactly as the desktop apps embed the marketing version).

**How the desktop apps expose these:** via the **menu bar** Help menu — macOS Swift and the Python
desktop app both put "Help" (→ Help View) and "User Manual" there; the Swift About & Help **Settings**
section repeats both. (iOS Swift may use a toolbar "?" — no parity weight for the web.) There is **no
in-toolbar Help button** in either desktop app.

**Web plan (no menu bar):** add a **Help button on the control bar (`.toolbar-app`), immediately to
the right of Settings**, using a standard web help glyph (circled "?"). It opens the **Help View**
modal (6g-1), which itself contains the **User Manual (online)** link (6g-2) — so the single button
covers both, the way the desktop Help menu groups them. Also surface both in **Settings → About &
Help** (parity with the desktop About; currently the web About has neither). The chart's existing "?"
popover is unrelated (zoom/pan controls) and stays.

### 6h — Per-measurement-type display ranges (minor)
Swift keys displayMinFreq/displayMaxFreq per `MeasurementType`; web `settings.ts` uses a single
**global** displayMinHz/displayMaxHz, so switching type doesn't restore a type-specific default
range. Low priority.

## Architecture & tooling (HIGH PRIORITY — do early)

These are not feature parity, but the user has flagged them high priority. The model/view
*separation* the Swift/Python apps get from `Models/Utilities/Views` already exists in the web tree
under idiomatic names — `dsp/` + `measurement/` + `settings.ts` = the **model/domain layer** (pure,
oracle-tested), `components/*.tsx` = **views**, `audio/engine.ts` = a **service**, `format/` =
**utilities**. React expresses the ViewModel layer as **custom hooks**, not a folder. The real
divergences are two:

### 6-ARCH — ViewModel hooks + presentation layer
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
**6-ARCH first / alongside 6a-6b** (user: high priority) — extracting hooks de-risks every feature
that touches `App.tsx` (6b especially), so do the `useAudioEngine`/`useMeasurementLibrary` extraction
and the `presentation/` move early, incrementally, tests green after each step. **6-MAP** can land
anytime (independent tooling) — recommend right after the `presentation/` move so the anchors are added
as files settle. Then features: **6a (decay) → 6b (live analysis boxes)** (highest user value, feeds
the PDF) → **6c (log freq)**, **6d (material drag)**, **6e (multi-tap PDF)** in any order → **6f, 6g,
6h** polish. Verify each gap against current `main` before starting (Phase 5 already closed some items
an earlier audit listed as missing — e.g. per-capture WAV, saved-comparison PDF).