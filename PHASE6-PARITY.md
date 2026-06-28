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

## Out of scope / optional
- **Cloud sync** and **File System Access folder sharing** — from the original PLAN.md
  "Optional:" line; **not** a Swift/Python parity gap (neither app has cloud sync). May be dropped.

## Sequencing
**6a (decay compute) → 6b (live analysis boxes)** first — highest user value and feeds the PDF.
Then **6c (log freq)**, **6d (material drag)**, **6e (multi-tap PDF)** in any order. **6f, 6g,
6h** as polish. Verify each gap against current `main` before starting (Phase 5 already closed
some items an earlier audit listed as missing — e.g. per-capture WAV, saved-comparison PDF).