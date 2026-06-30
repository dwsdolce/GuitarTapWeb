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
- ✅ **6g** — In-app Quick Start Guide + online User Manual link (toolbar Help menu + Settings → About) — also added the always-live crosshair the audit had missed
- ✅ **6h** — Per-measurement-type display ranges
- ✅ **6i** — Cross-platform ring-out (REG-G) regression test added to all three (golden 0.0853 s ±0.03; web/Python/Swift green). Decay-clock audio-time rework deliberately **skipped** after risk/benefit review — real-time-paced test pins the value with no app-code change; the clock rework + "fast playback tests" deferred to 6-TEST.
- ✅ **6j** — Status-bar review (+ material instruction panel, loaded-settings banner, mic-error modals)
- ✅ **6k** — Multi-tap averaging per MATERIAL phase (numberOfTaps applies to plate/brace phases too)
- ✅ **6l** — Analysis Results pane consistency + hover-tip port — **DONE 2026-06-30**: Python select icons; web fixed-header selection row + icons + disabled states; tooltips across toolbar/tap/results/peak-cards/chart/library; device-name row + normal header kept visible while waiting; per-mode peak glyphs (incl. override glyph+colour swap) + `Q:`/`BW:` formatting + mode-label-as-text + Export-PDF label; chart-options menu un-clipped. Cancel-button "divergence" investigated → **not a bug** (all three identical; was a mixed tap-count comparison).
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

### 6g — In-app Quick Start Guide + online User Manual link ✅ DONE
**Done 2026-06-30.** Mirrors the iOS pattern: a **toolbar Help button** (`HelpIcon`, right of Settings)
opens a **two-item menu** (`.help-menu`) — **Quick Start Guide** → in-app modal
`components/QuickStartGuide.tsx` (window title "Quick Start Guide"); **User Manual** →
`window.open(userManualUrl, '_blank', 'noopener,noreferrer')` (new tab) with
`userManualUrl = https://www.dolcesfogato.com/guitar_tap/manual/GuitarTap-User-Manual-${__APP_VERSION__}.html`.
Both are **also** surfaced in **Settings → About & Help** (`.set-help-links`; SettingsPanel gains
`userManualUrl` + `onShowQuickStart` props — the latter closes Settings then opens the guide).

The Quick Start content is data-driven (`QUICK_START_SECTIONS`, 10 sections) ported from Python
`help_view.py`, **web-adapted**: the Menu-Bar / keyboard-shortcut row became a **Toolbar** row (the
web has no menu bar and no shortcuts); the iPhone-only and "Re-analyze Peaks" rows were dropped (no
web equivalent); "wand" → the **Auto** button; "Play Audio File (File menu, Ctrl+Alt+O)" → "click the
**Play File** button". Each section header and every control row carries an **icon** — the toolbar/tap
glyphs were extracted into a shared **`components/icons.tsx`** so the guide renders the *exact same*
glyphs as the live controls (App.tsx imports them from there too), plus section-header icons matching
the native mdi/SF symbols.

**Always-live crosshair (audit miss, built as part of 6g).** The audit had *not* flagged that the web
lacked the spectrum crosshair that Swift/Python have always-on. Built in `presentation/spectrumRender.ts`
+ `components/SpectrumChart.tsx`: a hover crosshair (keys off `e.buttons === 0`, so mouse/trackpad/pen
hover shows it and press-drag pans) with 3 snap modes mirroring Python `fft_canvas`: free (live) → raw
cursor; frozen → nearest FFT bin; comparison/material overlays → always lock to the nearest curve,
colour-matched. **Touch toggle:** on a touchscreen (no hover), a **Crosshair button on the control bar
between Auto dB and Annotations** (exactly the iOS `Play File · Auto dB · Crosshair · Annotations` order)
toggles a one-finger drag between moving the crosshair and panning. Touch detected via
`navigator.maxTouchPoints` (+ `any-pointer: coarse`), NOT `(hover: hover)` — iPadOS Safari's desktop UA
reports `hover:hover=true` with no mouse, which would have hidden the toggle. Glyph = the iOS SF Symbol
pair `dot.viewfinder` (off) / `plus.viewfinder` (on), accent-tinted when on. `crosshairMode` is owned by
`App.tsx` (control-bar button) and passed into the chart as a prop. Quick Start's Crosshair + Toolbar
rows document this placement. Verified live on iPad + iPhone (user, 2026-06-30). Web-only platform detail
(touch detection + the toolbar toggle) — nothing to mirror back to Swift/Python, whose iOS path already
handles this via `#if os(iOS)`. 142 web tests green, tsc + build clean throughout.

Original gap + plan below.

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

### 6h — Per-measurement-type display ranges ✅ DONE
**Done 2026-06-29:** the web now keys the display frequency range per `MeasurementType`, matching
Swift (`minFrequency(for:)`/`maxFrequency(for:)`, `displayMinFreq_<rawValue>`) and Python
(`min_frequency_for`/`max_frequency_for`). `settings.ts`: replaced the flat global
`displayMinHz`/`displayMaxHz` with a per-type map `displayRanges: Partial<Record<MeasurementType,
{minHz,maxHz}>>` (only stores user-customized types; unset → default) plus `defaultDisplayRange(type)`,
`displayRangeFor(s,type)`, and `setDisplayRangePatch(s,type,range)`. Canonical per-type defaults
adopted: **guitar (all subtypes) 75–350, plate 20–200, brace 30–1000** — `App.tsx`'s hardcoded
material override (plate 10–300 / brace 50–1200) was **deleted**; the chart range now resolves from
`displayRangeFor(settings, measurementType)`. Save Current View, the Settings Frequency-Range fields,
and the Display "Reset to Defaults" all read/write the **current type's** range (other types' saved
ranges untouched); Reset uses the per-type factory default. The chart
right-click "Defaults" reset goes to `defaultDisplayRange(measurementType)`; "Saved" goes to the
persisted per-type range.

**Loaded range is TRANSIENT (parity audit correction, same day):** a cross-platform comparison showed
Swift (`setLoadedAxisRange`, loadMeasurement.swift:554) and Python (`set_loaded_axis_range`,
measurement_management.py:412/1067) apply a loaded measurement's saved axis range as a **transient
override** of the persisted display setting — they do NOT persist it. The web's first 6h cut persisted
it (carried over from the old global-on-load behavior). Corrected: added a `loadedView: ChartView | null`
layer in `useChartView` (`effectiveDefault = loadedView ?? defaultView`) mirroring Swift's
`loadedAxisRange`. On load (guitar `live.view`, material `mat.view`) the whole axis range — **freq AND
dB** — is set transiently and NOTHING axis-related is written to settings (`fromLive` drops `minDb/maxDb`
and the freq fields from both settingsPatches; the range rides in `view`). `loadedView` is cleared on
every new-measurement entry (type switch, guitar/material capture, play-file, New Tap), so a new capture
shows the user's persisted per-type range — not the loaded measurement's. Reset-to-saved still targets
the persisted setting, reset-to-defaults the per-type factory. So loading a measurement never mutates
the user's display settings, exactly like Swift/Python. Tests: `settings-display-range.test.ts` (5) +
`g8-material-load` updated (range in `view`, not the patch); 142 web tests green, typecheck + build clean. (Web was unreleased so no migration was needed; Swift/Python already
correct and unchanged.) Below = original gap note.

Swift keys displayMinFreq/displayMaxFreq per `MeasurementType`; web `settings.ts` uses a single
**global** displayMinHz/displayMaxHz, so switching type doesn't restore a type-specific default
range. Low priority.

### 6i — Cross-platform ring-out regression test — ✅ DONE 2026-06-30 (decay-clock rework deliberately SKIPPED)
**Done 2026-06-30, no application-code changes.** A shared **REG-G ring-out** test was added to all three —
web `test/g4d-decay.test.ts`, Python `tests/test_file_playback_regression.py::test_REG_G_generic_guitar_ringout`,
Swift `FilePlaybackRegressionTests.REG_G_genericGuitarRingOut_matchesGolden` — each plays `Recording 5.wav`
(REG-G1 fixture: generic, −40 dB, 1 tap) through the full live engine and asserts the ring-out against a
shared golden **0.0853 s ± 0.03 s**. Measured: web **0.0853** (audio-clock, deterministic), Python **0.091**,
Swift in-tolerance — all green.

**Why the decay-clock rework was skipped (user-reviewed risk/benefit 2026-06-30).** The original plan was to
move Swift+Python decay timing to audio-sample time so a *fast/headless* play yields a deterministic value.
But: (a) the fixture is only **0.53 s**, so a real-time-paced play is ~1–2 s — fast enough; (b) at real-time
pace **wall-clock ≈ audio-time 1:1**, so Swift/Python's existing wall-clock decay already lands within ±0.03
of the web's audio-clock value (no code change needed to pin it); (c) the Swift rework is genuinely risky —
`trackDecayFast` runs on the main thread via an async Combine `$inputLevelDB` subscription, so doing it
correctly means stamping the audio time at the audio-thread compute site and carrying it across the Combine
boundary (touching a released app's audio pipeline). **Decision: a good ring-out test with minimal/no app
changes wins; test runtime is a nuisance, not a problem.** The audio-clock rework + the related
"decouple file-playback from the real-time `sleep`/`Thread.sleep` pacing → make the 18–30 s playback tests
instant" idea are left as a **separate, larger 6-TEST item** (the pacing — not the decay window — is what
makes those suites slow; removing it needs the decay clock *and* verifying nothing else depends on
wall-clock/event-loop timing, with Swift's main-thread Combine decay as the hard blocker).

<details><summary>Original gap + plan (superseded)</summary>

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
</details>

### 6j — Status-bar review ✅ DONE
**Done 2026-06-29.** Exhaustively mapped Swift + Python (parallel readers) → the web's status bar diverged
in wording, order, and missing elements; brought it to canonical parity in three stages plus two loaded-
measurement fixes that surfaced during browser verification:

- **A — material instruction panel:** new `MaterialInstructionPanel.tsx` below the chart (plate/brace
  only) — phase dot + short status + "Phase N/M" + icon + bold title + detailed body, verbatim from Swift
  `materialInstructionsView`.
- **B — status-bar wording:** replaced the web's strings with the canonical `statusMessage` set (guitar +
  material, symmetric L→C / C→FLC transitions, review prompts, complete, loaded, cancelled), plus a
  clipping override (`⚠ Input clipping — reduce mic gain`, wired to the existing detector) and an auto
  device-change message.
- **C — status-bar widgets + order:** reordered to match Swift (left: state dot + "Waiting for tap…/Tap
  Detected!" + level; right: ⏸ Complete + "Peak: X dB @ Y Hz" + active dot + statusMessage + "Phase X/Y ·
  Tap N/M"); guitar level shows peak magnitude (Swift), Starting… fallback; **removed** the web-only
  `kHz·Hz/bin·fps` and `AGC·EC·NS` spans (native keeps those only in the Metrics modal). User rule applied:
  duplicate exactly what Swift/Python show; drop what they don't ([[feedback_improvements_all_three_platforms]]).
- **Loaded-settings banner:** restore the loaded measurement's `numberOfTaps` (was stuck at 1) + show the
  Swift `showLoadedSettingsWarning` row ("Settings from loaded measurement — Threshold: X dB · Taps: N") in
  the status-bar region; cleared on new measurement / taps change.
- **Mic-error modals:** converted the inline mic-error banner + Retry button + load-warning banner to modal
  dialogs (`AlertModal`) matching Swift `.alert` / Python `QMessageBox`: "Microphone Not Connected",
  "Microphone Access Required" (Open Settings → Retry on web, since a browser can't open System Settings),
  "Audio Engine Error". Categorized live errors (permission vs engine) in `useAudioEngine`.

User-verified in the running web app. Swift/Python were already canonical (web was the lone outlier), so
these are web-only changes that close the gap; nothing changed on Swift/Python. Original audit notes below.

### 6j — Status-bar review (original audit) (footer status + metrics line)
Audit the app's bottom status bar for Swift/Python parity — content, wording, and conditions. The web
footer currently shows the run indicator (green ● "Analyzing" / gray ● "Stopped", added in 6b) plus a
metrics line (e.g. "48.0 kHz · 0.73 Hz/bin · 0.73 fps · AGC ? · EC off · NS ?"). Open questions: do Swift
and Python show the same fields, in the same order, with the same labels/units? Are the "?" states (AGC/NS
unknown) handled the same, or should they resolve to on/off? Is the sample-rate / bin-width / fps line a
native feature or web-only? Compare against Swift's and Python's status presentation and reconcile (drop
web-only clutter, add any missing native fields). Not yet scoped against the canonical source — start with
a read of how Swift/Python render their status/footer.

### 6k — Multi-tap averaging per MATERIAL phase ✅ DONE
**Done 2026-06-29:** mirrored Swift `handleLongitudinalGatedProgress`. The engine now collects
`numberOfTaps` gated spectra per material phase into `materialCollected`; while `< total` it re-arms the
SAME phase (Swift `reEnableDetectionForNextPlateTap`) and emits per-phase tap progress; at `total` it
`averageSpectra`-s the phase's taps, re-finds the dominant peak on the AVERAGED spectrum within the
phase's search range (`findDominantPeak`), and emits one `onMaterialCapture` → review/advance (so
`useMaterialSession` still sees one capture per phase, and the session WAV + checkpoint/redo already
cover multi-tap-per-phase). UI: the **Taps stepper is now shown in material mode** (was `{!material &&}`);
`tapsLocked` is material-aware (locked from the first phase until complete); `matInstruction` shows
"N/total captured, tap again" while capturing. Backward-compatible at `numberOfTaps=1` (average of 1 =
the tap; peak re-found on it is identical) — REG-P1/B1 plate/brace file-playback tests still pass.

**Latent bug found during porting (fixed 2026-06-29):** Swift/Python material handlers averaged the
phase spectra but then auto-selected the **last tap's** dominant peak, not the averaged one — Swift
`buildAllPeaks` overwrote the nearby averaged peak with `dominantPeak` (the last tap) for UUID
consistency, and Python mirrored it. Result: plate L/C/FLC reported last-tap values, defeating the
point of averaging. Web was originally correct (re-found the peak on the averaged spectrum). Fix: all
three now re-find the dominant peak on the AVERAGED spectrum via `findDominantPeak` within the phase
range (mirrors the guitar `processMultipleTaps` path). The masked magnitude deltas on the REG-P2 fixture
were fL 0.94 dB, fC 0.81 dB, fLC 2.62 dB — only fLC exceeded the old ±1.0 dB tolerance, which is how the
bug surfaced.

**Test coverage (REG-P2):** `plate-umik-1-web-mac-3-taps.wav` (9 taps, 3/phase, UMIK-1) replayed at
`numberOfTaps=3` with the SAME fixture + averaged baseline across all three platforms
(fL 68.2587/−71.5858/15.667, fC 117.4681/−56.5436/26.667, fLC 35.3011/−63.6008/6.0). REG-P2's magnitude
tolerance is tightened to **±0.5 dB** (vs the generic ±1.0) since the averaged values are deterministic
across engines — this reliably catches any regression to last-tap selection. Green on web (vitest),
Python (pytest), and Swift (Swift Testing).

Swift & Python apply `numberOfTaps` to plate/brace phases too: each phase (L, C, FLC) collects
`numberOfTaps` taps and averages their spectra before review/advance (Swift `handleLongitudinalGatedProgress`
+ cross/FLC variants; Python `_handle_longitudinal_gated_progress` etc., gated by `captured < total`). So a
plate at 5 taps = 5/phase × 3 = 15 taps. The web does NOT: (a) the **UI** hides the Taps stepper in material
mode (`App.tsx` `{!material && …}`), and (b) the **engine** captures a single tap per phase — material
`finishCapture` never loops on `numberOfTaps` or averages (only the guitar path does). Fix: thread a
per-phase accumulator through the engine's material capture (collect `numberOfTaps` gated results, average
via the existing `averageSpectra`, then advance to review) — mirror the guitar multi-tap loop and Swift's
per-phase progress; and show the Taps stepper in material mode. Backward-compatible at `numberOfTaps=1`
(average of 1 = the tap), so the REG-P1/B1 file-playback fixtures (1 tap/phase) are unaffected. The session
WAV + checkpoint/redo already handle multi-tap-per-phase (redo re-does the whole phase). NEW backlog
2026-06-29 (user-flagged).

### 6l — Analysis Results pane consistency + hover tooltips — ✅ DONE 2026-06-30
**Implemented 2026-06-30:** (6l-1) Python — Select-All/None icons swapped from the blank-on-macOS
`SP_Dialog*` to qtawesome `fa5s.check-circle` / `fa5s.times-circle` (kept `fa5s.magic`); the unused
`style = self.style()` removed; syntax-checked. (6l-2) Web — "Showing X–Y Hz" + the selection row lifted
OUT of `.results-scroll` into a FIXED block between `.results-head` and the scroll (only `.cards` scroll
now). (6l-3) Web — text All/None/Auto → icon-only buttons `CheckIcon`/`CancelIcon`/`WandIcon`
(checkmark.circle / xmark.circle / wand.and.stars), Swift disabled states (All when all displayed peaks
selected, None when none selected, Auto when `!userModified`), exact Swift tooltips. (6l-4) Web — Swift
`HintText` mirrored into a `HINTS` const in App.tsx and applied across the toolbar (Play File / Auto dB
[dynamic] / Annotations [dynamic] / Save / Measurements / Metrics / Settings), tap controls (Taps /
Threshold / Peak Min fields; New Tap; Pause/Resume/Accept [dynamic]; Cancel/Redo [dynamic]), results pane
(∿ Taps [dynamic], Export Spectrum), peak cards (star [already matched]; mode label, web "click" verb),
and chart (? "Zoom & Pan Controls"); Measurements library wording aligned (row, Compare, ⋯ Actions) —
Export All kept its web-appropriate "(backup / move to another browser or device)" instead of Swift's
"share/AirDrop". 142 web tests green, tsc + build clean. **6l-OPEN still needs a decision (below).**

**6l-5 — device-name row + waiting-state layout (DONE 2026-06-30).** The web replaced the whole pane
with a "No tap captured yet." placeholder while waiting; Swift/Python keep the normal header (mic name +
"Showing X–Y Hz" + selection controls) visible and just leave the peak list empty. Fixed: (a) added a
`.results-mic` device-name row (row 2, shown when `!comparison`) — the user confirmed mic-in-header is the
parity goal; no Re-analyze button (web has none by design). (b) the "Showing… + selection" row now renders
whenever in the guitar peak view (dropped the `displayPeaks.length>0` gate) so it stays put while waiting;
the All/None/Auto buttons disable themselves when there are no peaks (the `.every` checks + `!userModified`
already handle empty). (c) empty peak list shows nothing while not-captured (matches native) and "No peaks
above Peak Min." only when captured-but-filtered. 142 tests green, tsc + build clean.

**Cancel-button investigation (RESOLVED — not a divergence).** Reported as web/native differing while
waiting. Read all three: Swift `cancelButtonEnabled` (TapToneAnalysisView.swift:198-208), Python
`_update_tap_buttons` (L2594/2661-2667), web `cancelEnabled` — ALL identical: enabled iff `isDetecting &&
numberOfTaps > 1 && currentTapCount < numberOfTaps` (so single-tap → disabled, multi-tap → active from the
first tap). User confirmed the apparent difference was a mixed tap-count comparison (one app in multi-tap,
another in single). No change made to any app.

**6l-6 — peak-row rendering parity (DONE 2026-06-30).** From a 2-app audit of one peak row
(Swift `CombinedPeakModeRowView.swift` + `GuitarMode.swift`; Python `peak_card_widget.py` +
`guitar_mode.py`). Four fixes, Swift canonical:

1. **Per-mode glyph** — the web showed a colored dot; Swift/Python show a per-mode icon. Added web SVGs
   (`components/icons.tsx`) + a `MODE_ICON` map in `PeakCard.tsx`, matching `GuitarMode.icon`:

   | Mode | Swift SF Symbol | Python qtawesome | Web SVG |
   |---|---|---|---|
   | Air (Helmholtz) | `wind` | `fa5s.wind` | `WindIcon` |
   | Top | `arrow.up.and.down` | `fa5s.arrows-alt-v` | `ArrowUpDownIcon` |
   | Back | `square.fill` | `fa5s.square` | `SquareFilledIcon` |
   | Dipole | `circle.lefthalf.filled` | `fa5s.adjust` | `DipoleIcon` |
   | Ring Mode | `circle.dashed` | `fa5s.circle-notch` | `CircleDashedIcon` |
   | Upper Modes | `waveform` | `fa5s.wave-square` | `WaveformIcon` (reused) |
   | Unknown | `questionmark.circle` | `fa5s.question-circle` | `HelpIcon` (reused) |
   | (user-defined override) | `tag.fill` | `fa5s.tag` | — *(not yet; web icon still follows the auto mode, see note)* |

   The range badge (✓ / ⚠) stays stacked under the glyph and is hidden for Unknown/Upper (web's
   `inRangeFor` already returns null there — matches Swift's guard). Web `!`→`⚠` for the warn glyph.

2. **Q / BW format** — canonical is `Q: <v>  BW: <v> Hz` (colon + space; label muted, value bold).
   Swift uses **one decimal** for Q (`%.1f`); the web was `Q 28.0` (no colon) → now `Q: 28.0`. **Python
   diverged** (`Q: {q:.0f}`, integer) → fixed to `{q:.1f}` (`peak_card_widget.py:290`) so all three match
   Swift. BW was already one-decimal everywhere.

3. **Mode label as text** — Swift uses a `Menu` (macOS) / `Sheet` (iOS); Python a `QToolButton`+`QMenu`:
   colored text, *italic* when manually overridden, click to reassign (quick-pick modes + extended +
   Custom… + Reset-to-auto). The web used a `<select>` showing the OS dropdown chrome. Made it read as
   text via `appearance: none` + `.override` italic; the existing ` ✎` suffix on the selected option is
   the edit indicator; click still opens the (native, un-clipped) reassign list. Kept the native select
   (not a custom popup) deliberately — a custom menu would be clipped by `.results-scroll`'s overflow,
   whereas the native popup renders above it.

4. **Export-PDF label** — the results-panel button: Swift "Export PDF", web "Export PDF", Python was
   "Export PDF Report" → fixed to "Export PDF" (`tap_tone_analysis_view.py:1466`). The File-menu /
   measurements-row full-name labels ("Export PDF Report…") were left as-is (Swift spells those out too).

Canonical row layout (L→R): star · mode glyph (+ range badge stacked under) · mode label (left) +
frequency (right, bold) · ♪ pitch+cents · `Q:` `BW:` (left) + magnitude dB (right, colour-coded).

**Override glyph+colour swap (DONE 2026-06-30).** Like Swift, a manual override now swaps the glyph AND
colour (and the label-text colour) to the override mode, not just the label text. `PeakCard` derives them
from the EFFECTIVE label via `MODE_BY_DISPLAY_NAME` (reverse of `MODE_DISPLAY_NAME`); a custom label that
isn't a known mode gets the tag glyph (`TagIcon`) in teal (`USER_MODE_COLOR`), mirroring Swift's
`tag.fill` + RGB(0,128,128). (The range badge still uses the auto mode's range — unchanged.)

**Chart-options menu clipping (DONE 2026-06-30, web-only polish).** The ⋯ / right-click Chart Options menu
was `position: absolute` inside `.chart-host`, so `.chart-wrap`'s `overflow: hidden` clipped it near the
window edge. Switched `.chart-ctx` to `position: fixed` (z 60) with VIEWPORT coords + an on-screen clamp
(`useLayoutEffect` measures the menu and pins it inside the viewport with 8px padding; `alignRight` anchors
the ⋯ menu's right edge to the button). Not a parity item — native apps don't have the overflow constraint.
(The chart's `?` Zoom/Pan help popover uses the same absolute pattern but is anchored to its fixed
top-right button — its position is constant and can't run off-screen, so it needs no change.)

142 web tests green, tsc + build clean; Python syntax-checked.

Spec / canonical reference below (kept for the record).

### 6l — Analysis Results pane consistency + hover tooltips — SPEC
Flagged by the user from a side-by-side of the three apps' Analysis Results pane (web / Swift / Python).
Two divergences + a follow-on (hover tips). Captured here from a 3-agent canonical audit so it's
reviewable before any code changes. **Swift is canonical** — Python and web both conform to it.

**The two divergences:**
1. **Selection-control set + icons.** Web has **All / None / Auto** as *text* buttons. Swift has the same
   three as *icon-only* buttons. Python *appears* (in the screenshot) to have only Reset-to-auto. → all
   three should agree on Swift's three-icon set.
2. **Scroll boundary.** Swift & Python keep **"Showing X–Y Hz" + the selection controls in a FIXED header
   above the scroll**; only the peak cards scroll. The web put that row *inside* `.results-scroll`. → move
   it out so **only peak cards scroll**.

**Follow-on — hover tips on web?** YES. The `title=` attribute shows on desktop hover and is a no-op on
touch — the exact behaviour of macOS `.help()`. So Swift's full tooltip set should be ported to the web
controls (most web buttons have a `title` already, but many are missing or don't match Swift's wording).

#### Canonical Swift spec (`Views/TapAnalysisResultsView.swift`)
- **Selection controls** — icon-only, `.controlSize(.mini)`, order left→right:
  | Control | SF Symbol | Action | Tooltip | Disabled when |
  |---|---|---|---|---|
  | Select All | `checkmark.circle` | `selectAllPeaks()` | "Select all peaks" | all peaks already selected, **or** not guitar |
  | Select None | `xmark.circle` | `selectNoPeaks()` | "Deselect all peaks" | no peaks selected, **or** not guitar |
  | Reset to Auto | `wand.and.stars` | `resetToAutoSelection()` | "Reset to automatic mode selection" | `!userHasModifiedPeakSelection` (guitar only — hidden otherwise) |

  In plate/brace mode Select All / None stay visible but **disabled**, tooltip → "Peak selection is fixed
  during plate/brace measurements". Hidden entirely while `showingMultiTapComparison`.
- **Scroll structure** (top→bottom):
  - **FIXED header** (OUTSIDE the ScrollView): row 1 = "Analysis Results" title + type badge (or the
    multi-tap Taps toggle); row 2 = **device name + Re-analyze button** (`arrow.trianglehead.2.counterclockwise`,
    "Re-analyze peaks from spectrum using the current algorithm"); row 3 = **"Showing X–Y Hz" + the
    selection controls**. Then a `Divider`.
  - **ScrollView**: peak cards + (plate/brace) properties / Gore / process sections.
  - **FIXED footer** (OUTSIDE the ScrollView): guitar Ring-Out + Tap-Ratio summary; status indicator +
    **Export Spectrum** (`chart.line.uptrend.xyaxis`) / **Export PDF** (`doc.richtext`).

#### Python state (`views/tap_tone_analysis_view.py`) — VERIFIED: buttons exist but render BLANK on macOS
**Confirmed by reading the source (not the agent's word).** Python **already has all three buttons** in
`freq_row`, fully wired and visibility-managed: `select_all_btn` (L923-932), `deselect_all_btn` (L934-943),
`reset_auto_selection_btn` (L945-952); connected at L1843-1845; shown when peaks exist
(`setVisible(_has_peaks)`, L3803-3805); enabled in guitar mode (L2216-2217); model/analyzer methods exist
(`peaks_model.select_all_peaks/deselect_all_peaks`, `tap_tone_analyzer.select_all_peaks/select_no_peaks`,
`…peak_analysis.reset_to_auto_selection`). In git since 2026-04-02 ("Refactoring to match swift").

**Why the user sees only the wand:** the icon sources differ —
`select_all_btn` → `style.standardIcon(SP_DialogApplyButton)`; `deselect_all_btn` →
`style.standardIcon(SP_DialogCancelButton)`; `reset_auto_selection_btn` → `qta.icon("fa5s.magic")` (the
only qtawesome icon). **Qt's macOS style does not supply the `SP_Dialog*` standard pixmaps**, so those two
buttons render as **blank 22×22 boxes** (present + sized, no glyph) — only the wand shows. So the user is
right that there aren't "3 select icons": one visible (wand) + two invisible/blank.
→ **6l-1 ACTION (Python):** swap Select-All / Select-None from the non-rendering `SP_Dialog*` standard
icons to **qtawesome** (`fa5s.check-circle` / `fa5s.times-circle`; keep `fa5s.magic`) so they actually
appear; re-check the macOS render. Pure icon-source fix — buttons, wiring, visibility, enable logic are
already correct; do **not** add duplicate buttons. Swift is canonical & already correct; Python mirror only
(not Apple-gated).

#### Web today (`App.tsx` results pane, `components/AnalysisResults.tsx`)
- `.results-head` (fixed) = h2 + multi-tap Taps toggle + type badge. **`.results-sub`** ("Showing X–Y Hz"
  + `.sel-buttons` All/None/Auto as TEXT) is **inside `.results-scroll`** (wrong — should be fixed header).
- Ring-Out/Tap-Ratio (`AnalysisResults`) + the Export footer are **already pinned** below the scroll (6b).
- No device-name / Re-analyze row (web has **no Re-analyze** by design — loaded peaks are authoritative,
  [[loaded_peaks_authoritative]]).

#### Tasks
- **6l-1 (Python):** verify + align select-all/none icons to qtawesome and visibility (above). Python mirror,
  not Apple-gated. Update the paired Swift/Python parity assertion if one covers these controls.
- **6l-2 (Web — layout):** lift the "Showing X–Y Hz" + selection row OUT of `.results-scroll` into a fixed
  block between `.results-head` and `.results-scroll`, gated to the guitar peak list
  (`!comparison && !material && !showMultiTap && displayPeaks.length>0`). Only `.cards` scroll.
- **6l-3 (Web — icons + states):** swap text All/None/Auto → icons: All=`CheckIcon` (checkmark.circle),
  None=`CancelIcon` (xmark.circle), Auto=`WandIcon` (wand.and.stars — **already added to
  `components/icons.tsx`** as the one pre-staged building block). Mirror Swift disabled states (All when all
  displayed peaks selected; None when none selected; Auto when `!userModified`). Tooltips → exact Swift
  strings ("Select all peaks" / "Deselect all peaks" / "Reset to automatic mode selection").
- **6l-4 (Web — hover tooltips):** add `title=` to every control per the Swift inventory below, incl. the
  DYNAMIC variants (Auto dB on/off, Pause/Resume/Accept, Cancel/Redo, Annotations-by-mode, per-peak star
  select/deselect, peak mode-label). Audit the current web `title`s and fill gaps / fix wording.
- **6l-OPEN (decision):** Swift/Python show a **device-name row** (and Re-analyze) in the results header;
  the web has neither. Re-analyze is intentionally absent (loaded-peaks-authoritative). **Do we add the
  device-name line to the web results header for parity, or leave it (web shows the device in Settings +
  status bar)? — needs user sign-off.**

#### Swift tooltip inventory (source of truth for 6l-4)
`HintText` constants (`Views/Utilities/Extensions.swift`):
```
start(isRunning)    running ? "Stop audio analysis" : "Start audio analysis and tap detection"
showResults         "View detected peaks with mode assignments and frequencies"
showMetrics         "View FFT analysis metrics including sample rate and resolution"
save                "Save the current measurement with measurement name and notes"
exportSpectrum      "Export spectrum image as PNG file"
autoScale(enabled)  enabled ? "Auto-scale dB enabled - click to disable and reset"
                            : "Automatically scale dB range to fit the current spectrum"
measurements        "View and manage saved measurements"
settings            "Configure spectrum display, analysis parameters, and audio input"
taps                "Number of taps to average for peak detection (1-10)"
threshold           "Signal level that triggers tap detection. Lower values detect quieter taps. In brace/plate mode this is used as the headroom above the ambient noise floor, not an absolute level."
hysteresis          "How far the signal must drop below the detection threshold before the detector resets and is ready for the next tap. Prevents a single loud tap from triggering multiple detections."
peakMin             "Minimum peak magnitude shown on the spectrum chart. In guitar mode this also gates which peaks are reported. In brace/plate mode the tap capture uses its own adaptive noise floor, so this only affects chart display."
newTap              "Start a new tap sequence to detect and analyze resonance peaks"
cancel              "Cancel the current tap sequence and start over"
resetLabels         "Reset all peak label positions to their default locations"
pauseDetection      "Pause tap detection to experiment with taps without advancing the sequence; spectrum stays live"
resumeDetection     "Resume tap detection to continue the in-progress sequence"
```
Per-control (web target → exact text):
- **Toolbar:** Play File → "Feed an audio file through the analysis pipeline"; Auto dB → `autoScale(on/off)`
  (dynamic); Crosshair → (none in Swift — keep the web's current text); Annotations →
  "Annotation visibility: {mode label}" (dynamic); Save → `save`; Measurements → `measurements`;
  Metrics → `showMetrics`; Settings → `settings`; Help → (none); Results [phone/iPad] → `showResults`.
- **Tap controls:** Taps stepper → `taps`; Threshold slider → `threshold`; Peak Min slider → `peakMin`;
  each slider's **reset arrow** → "Reset to default"; New Tap → `newTap`;
  Pause/Resume/Accept → `pauseDetection` / `resumeDetection` / "Accept this tap and continue" (dynamic);
  Cancel/Redo → `cancel` / "Redo this tap phase" (dynamic).
- **Results pane:** Taps comparison toggle → "Compare individual taps"; Show-averaged toggle → "Show
  averaged result only"; Re-analyze → "Re-analyze peaks from spectrum using the current algorithm"
  (web N/A); Select All / None / Reset → see 6l-3 table; per-peak **star** → "Select peak" / "Deselect peak"
  (dynamic); per-peak **mode label** → "Manually assigned — tap to change or reset" / "Tap to assign a mode
  label" (dynamic); Export Spectrum → `exportSpectrum`; Export PDF → (Swift: button label only).
- **Chart:** ⋯ Chart options → "Chart options"; ? Zoom/Pan info → "Zoom & Pan Controls"; dragged peak label
  → "Drag to reposition label" / "Drag to adjust • Right-click to reset position" (dynamic).
- **Measurements / library:** row → "Double-click to load measurement" / "Toggle selection for comparison"
  (dynamic); Compare → "Select measurements to overlay on a comparison chart"; Export All → "Export the
  whole library as one .guitartap file (share/AirDrop or save to disk)"; row ⋯ menu → "Actions".

**Pre-staged so far:** only `WandIcon` was added to `components/icons.tsx` (inert export) before this was
paused for documentation. No layout/wiring/Python changes made yet.

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
**Done so far:** ~~6-ARCH~~ → ~~6a (decay)~~ → ~~6b (live analysis boxes)~~ → ~~6c (log freq, DROPPED — not a parity gap)~~ → ~~6d (material drag)~~ → ~~6e (multi-tap PDF)~~ → ~~6f (session WAV)~~ → ~~6h (per-type display ranges)~~ → ~~6j (status-bar review)~~ → ~~6k (per-phase multi-tap averaging)~~ → ~~6g (Quick Start Guide + manual link + crosshair)~~ → ~~6l (Analysis Results pane consistency + hover-tip port)~~ → ~~6i (cross-platform ring-out test — decay-clock rework skipped)~~.

**Remaining:** the tooling **6-MAP** (needs tag-syntax sign-off) and the **6-TEST** normalization (major —
sequence after 6-MAP so the web suites land in their final naming). NOTE: a sub-item now lives under
6-TEST — "decouple file playback from real-time pacing so the 18–30 s Python/Swift playback suites run
instant like the web" (needs the decay audio-clock + Swift's main-thread Combine decay moved to a sync
audio-thread feed; see 6i for the risk write-up). Verify each gap against current `main` before starting (Phase 5 +
the work above already closed several items an earlier audit listed as missing — e.g. per-capture WAV,
saved-comparison PDF, the log-axis "gap").