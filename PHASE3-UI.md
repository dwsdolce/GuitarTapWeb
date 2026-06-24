# Phase 3 — React UI (live tap analysis & material measurement)

Phase 3 builds the interactive UI on top of the validated Phase 2 DSP core
(`src/dsp/`, see `PHASE2-DSP-HARNESS.md`). The DSP is the contract; this phase
adds the audio engine (mic → AudioWorklet → tested DSP), the React views, and the
plate/brace measurement flow. The canonical UI is the Swift app
(`GuitarTap/Views/...`); Python mirrors it. Module-by-module correspondence lives
in `PARITY-MAP.md`.

## Success criterion (the gate to Phase 4)

A luthier can, in the browser, run a guitar tap analysis **and** a plate/brace
material measurement end-to-end — matching the native apps' behavior, layout, and
numbers — without any Swift/Python repo present. Numeric parity holds to the
`PLAN.md` bar (2–3 dp); categorical output (mode labels, wood quality, phase
transitions) matches exactly. Phase 2's 44 DSP tests stay green throughout.

## 1. Architecture — engine shell around the pure DSP

```
mic ─▶ public/spectrum-processor.js   (AudioWorklet: 1024-sample chunks + RMS)
        │  postMessage
        ▼
   src/audio/engine.ts  (main thread)
        │  • continuous live spectrum (accumulate 65536 → dftAnalRect)
        │  • tap detection (2-chunk level-crossing, 0.2 s pre-roll)
        │  • guitar capture (65536 non-gated) → onCapture
        │  • material capture (~500 ms gated) → onMaterialCapture
        │  • clipping, multi-tap power-average
        ▼
   React (src/App.tsx + components/)  — peak-finding/classification/material
                                        formulas run here on src/dsp, so Peak Min /
                                        type changes re-analyze the frozen spectrum
```

Sample rate is read from the live `AudioContext` (never hardcoded — PLAN risk #1).
The worklet is intentionally tiny (plain JS, no bundling); all real math is the
tested `src/dsp/` core, called on the main thread.

## 2. In scope for Phase 3

- Live spectrum chart (hand-rolled canvas), threshold meter, level/clipping.
- Guitar flow: always-on tap detection, multi-tap averaging, rich peak cards.
- Settings (measurement type, material inputs, advanced ranges) — localStorage.
- Material flow: gated multi-phase plate/brace capture + property results.
- Deployment as a static subpath site (see README "Deploy").

Out of scope (Phase 4 / later): IndexedDB session history, `.guitartap`
read/write, PWA/offline, device picker + calibration import, interactive chart
zoom/pan + draggable annotations, multi-tap comparison overlay, PDF/PNG export.

## 3. Feature checklist

| # | Feature | Native counterpart | Status |
|---|---|---|---|
| U0 | Vite/React scaffold; auto-start mic (no Start button) | — / app launch | ✅ |
| U1 | Live spectrum chart (canvas, axes, markers) | `SpectrumView` | ✅ |
| U2 | Threshold meter (canvas, ticks, peak-hold, clipping, pointer-drag) | `ThresholdSlider` | ✅ |
| U3 | Tap detection → 65536 capture → freeze | `TapToneAnalyzer` | ✅ |
| U4 | Rich peak cards (icon+range, editable label, pitch/Q/BW/color mag, select) | `CombinedPeakModeRowView` | ✅ |
| U5 | Multi-tap stepper + power-average | `averageSpectra` | ✅ |
| U6 | Settings (Audio / Measurement Type+inputs / Advanced / About) | `TapSettingsView` | ✅ |
| U7 | Material plate flow (L→C→[FLC]) with Accept/Redo | `MaterialTapPhase` + analyzer | ✅ |
| U8 | Material brace flow (single L tap) | `MaterialTapPhase` | ✅ |
| U9 | Material-property results (moduli, quality, Gore) | material results view | ✅ first cut |

## 4. Audio parity gotcha (RESOLVED)

Browsers (Chrome AND Safari on macOS) deliver ~17 dB hotter capture unless AGC is
disabled via **both** `getUserMedia` constraints **and** `track.applyConstraints`
+ legacy `goog*` flags. After that the live level matches Python's −45 dBFS. A
diagnostics readout (`AGC · EC · NS`) is shown in the status bar. There is no input
trim (the native app has none either).

## 5. UX rule (learned the hard way)

Match the native app **exactly** — section/control order, naming, no invented
controls. The toolbar follows `regularTapControlsWide` (Taps │ Threshold │ Peak
Min, actions right-aligned); Settings follows `TapSettingsView` order (Audio →
Measurement Type w/ nested inputs → Advanced → About). When in doubt, read the
Swift view before building.

## 6. Run & deploy

```sh
npm run dev        # local UI (root path)
npm test           # 44 DSP tests (vitest)
npm run build      # typecheck + production build → dist/
```

Deploy: static `dist/` copied (incl. `assets/`) to
`dolcesfogato.com/guitar_tap/guitar_tap_web/`; production `base` is set in
`vite.config.ts`; HTTPS required (mic + AudioWorklet). Full notes in README.

## 7. Open parity items for the next pass

- Material results **layout/fields** vs the native plate/brace results view
  (current is a first cut — verify field set, formatting, units).
- Confirm material **tap-detection threshold** behavior (shares the Threshold
  control) triggers cleanly in a real room.
- Mode-label override persistence is in-memory (keyed by frequency); wiring to
  `.guitartap` save/load is Phase 4.

## 8. Toolbar layout — TITLE BAR + TAP-CONTROL ROW (DONE — Phase-3 wrap-up)

The native macOS app puts the view/app buttons on the **unified title-bar line**
(packed toward the right) with a separate **tap-control row** below
(`TapToneAnalysisView+Controls.swift`). The web mirrors that: the app title sits left,
the buttons pack right on the same line; the tap controls are their own row.

> There is **no "Results" toggle** on the desktop layout — don't add one.

**Title bar — view/app controls (packed right):**

| Button | Action | Phase | Web status |
|---|---|---|---|
| **Auto dB** | Toggle dB auto-scale (`autoScaleDB`/`toggleAutoScale`) — fits the dB axis on each spectrum while on; resets to the saved range when off. Session-only. | 3 | ✅ |
| **Annotations** | Cycle annotation visibility (`cycleAnnotationVisibility`): All → Selected → None. Label stays "Annotations"; the icon (👁/★/🚫) reflects the mode. Persisted (default Selected). Disabled in material / no-peaks. | 3 (visibility) / 5 (draggable) | ✅ |
| **Metrics** | Open the metrics panel (`FFTAnalysisMetricsView`) — Config / Performance / Peak Detection | 3 | ✅ |
| Settings | Open Settings | 3 | ✅ |
| Save | Save measurement | 4 | Phase 4 |
| Measurements | Open the library | 4 | Phase 4 |
| Crosshair (iOS) | Cursor readout mode | 3/5 | n/a (web hover later) |
| Play File | Analyze a WAV through the pipeline | 5 | Phase 5 |

**Tap-control row (measurement controls):**
New Tap · Pause/Resume · Cancel · Taps · Threshold · Peak Min.
(Web has Taps/Threshold/Peak-Min/New Tap; Pause/Cancel are Phase 5. Material mode
repurposes Pause/Cancel as Accept/Redo — already done.)

**Wrap-up notes (parity):**
- **Auto-dB** mirrors `autoScaleDB`: filters displayed magnitudes to (−100, 20), pads
  by `max(10, range·0.1)`, clamps to −120…20, enforces a ≥20 dB span. Not persisted
  (Swift keeps `isAutoScaleEnabled` as transient `@State`).
- **Annotation visibility** maps `visiblePeaks`: All → every detected peak (after the
  `showUnknownModes` filter already in `displayPeaks`), Selected → chosen results,
  None → no badges. Persisted to localStorage (Swift persists to UserDefaults),
  bypassing the Settings dialog like tap-threshold / peak-min.
- **Metrics** Performance section is fed by live-FFT timing instrumented in
  `engine.ts` (`onMetrics`: last + 30-frame-avg processing ms + frame rate); Config &
  Peak Detection are derived from sample rate / FFT size / displayed spectrum.