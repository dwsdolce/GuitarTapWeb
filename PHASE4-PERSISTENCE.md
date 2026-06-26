# Phase 4 — Persistence & Measurements (web)

**Status:** planning. Builds on Phase 3 (UI complete) and the sample-rate epic (Swift +
Python + docs done; the web's load-time warning lands here). Canonical references:
Swift `Views/Measurements/*`, `Models/TapToneMeasurement.swift`; Python mirror.

## Goal
A luthier can **save** a tap measurement, see it in a **library**, **load** it back into
the view, **import/export** `.guitartap` files that round-trip byte-for-byte with the
Swift/Python apps, and **compare** measurements — all client-side, offline-capable.

## Terminology
- A **measurement** is a saved record. Kinds: guitar (generic/acoustic/classical/
  flamenco), material (plate/brace), and **comparison** — *a measurement based on other
  measurements* (`comparisonEntries`; `isComparison` when present). Comparison is not a
  separate subsystem — the model/library handle it like any measurement; only the chart
  overlay + results table + "create from selection" are comparison-specific.
- **Multi-tap comparison** is **not** a measurement — it's a **view** of the per-tap
  components (`tapEntries`) inside one multi-tap guitar measurement (each tap vs the
  average). A view toggle, not a record.

## Storage model (DECIDED: IndexedDB + file import/export)
Per-platform local libraries are **not** shared; only `.guitartap` files are. This is
exactly how Swift ↔ Python already interoperate (each keeps its own
`saved_measurements.json`; they exchange `.guitartap` files).
- **In-app library** → **IndexedDB** = the web's private `saved_measurements.json`
  equivalent. It is browser-sandboxed and **not readable by Swift/Python** (and vice
  versa) — that's expected. Spectra are large base64 float32 blobs, so not localStorage.
  One object store keyed by measurement `id`.
- **Cross-app sharing** → `.guitartap` files via browser **download / file-picker
  upload** (no server). Byte-compatible with the desktop apps (the parity work).
- Settings stay in localStorage (Phase 3).
- (File System Access API for folder-based sharing was considered and deferred —
  Chromium-only; import/export covers all browsers.)

## Format parity (the critical piece)
The web has **no measurement model yet** — Phase 3 only has live `Spectrum`/`Peak`.
4a creates TS `TapToneMeasurement` + `SpectrumSnapshot` + `ResonantPeak` (de)serialization
matching the **canonical Swift `JSONEncoder` output** (Python already mirrors it):
- SpectrumSnapshot spectra → `frequenciesData` / `magnitudesData` = **base64 of
  little-endian IEEE-754 float32** (`Float32Array(...).buffer` → base64). Decode accepts
  the legacy plain-array form too.
- UUID-keyed maps (`peakAnnotationOffsets`, `peakModeOverrides`) → **flat alternating
  arrays** (Swift `[UUID:V]` encoding).
- Integral `Float`s emitted without `.0`; numbers quantized to **float32** text.
- Provenance incl. **`sampleRate`** (Phase-sample-rate field), `microphoneName/UID`,
  `calibrationName`; `measurementType`/`guitarType`; optional fields omitted when nil.
- **Validation:** vendor the `contreras-classical-…guitartap` fixture into
  `test/fixtures/`; round-trip test (decode → encode → byte-compare) + field assertions,
  extending the existing oracle harness.

## Sub-phases (each independently shippable)

### 4a — `.guitartap` model + serialization parity ✅ DONE
TS model + encode/decode; round-trip test vs the vendored fixture. No UI yet. The model
covers all measurement kinds — including `comparisonEntries` (comparison measurements)
and `tapEntries` (multi-tap components) — so 4d needs no new serialization.

Landed in `src/measurement/` (`types`, `floatJson`, `base64`, `decode`, `encode`, barrel
`index`). Test `test/g5-measurement-codable.test.ts` (12 tests) mirrors the Swift
`MeasurementCodableTests` / Python `test_measurement_codable`.

**Design (agreed with the user):** the **reader/writer code is the definition**, not any
accumulated file. **Writer = minimal canonical** (current Swift `encode(to:)` field set —
`peakMinThreshold` never `peakThreshold`, `sampleRate` only when known, convenience
`measurementType`/`guitarType` + per-peak `modeLabel`); **reader = tolerant** of every
legacy shape. The luthier-facing spec lives in the Swift user manual **Appendix B**
(`app-b-file-formats.md`), expanded with: float32-shortest number precision + the
double-precision exceptions, `modeLabel`, and a comprehensive "Legacy compatibility
(reader-only)" table. The vendored Contreras file is an OLD save (legacy `peakThreshold`,
extra `hysteresisMargin`/`maxPeaks`, no `sampleRate`) → it's the legacy-decode regression,
not a spec.

**Bar = semantic round-trip, not byte-identity** (PLAN.md). Both shipping writers (Swift
`JSONEncoder [.prettyPrinted,.sortedKeys]` + `.iso8601`; Python `json.dump(sort_keys=True,
indent=2)`) agree on keys+values but differ in whitespace — so even Swift↔Python aren't
byte-identical. The two encoding subtleties reproduce exactly in JS: float32-shortest text
via `Math.fround` + shortest-precision search (integers without `.0`), and base64 LE
float32 blobs round-trip byte-for-byte.

### 4b — Library: save, list, load ✅ DONE (guitar)
- **Save sheet** (name + notes) → build a measurement from the current frozen result
  (peaks, snapshot, settings provenance incl. sampleRate) → IndexedDB.
- **Measurements list** (panel/route): rows from IndexedDB; **Load into view** (restores
  frozen spectrum + peaks + ranges), **Rename / edit notes**, **Delete** (confirm).
- Loading restores the frozen state (mirrors Swift `loadMeasurement`), including the
  spectrum-blank-safe path we fixed.

Landed: `src/measurement/store.ts` (IndexedDB CRUD, one store keyed by `id`),
`src/measurement/fromLive.ts` (`buildGuitarMeasurement` live→model + `measurementToLive`
model→live), `components/SaveSheet.tsx`, `components/MeasurementsPanel.tsx`; App. B toolbar
gained **Save** + **Measurements**. Test `test/g6-measurement-bridge.test.ts` (3 tests)
pins the bridge (build → serialize → parse → restore). 59 web tests green.

**Bridge design (same algorithm as Swift/Python — verified against the source):** live
peaks have numeric ids and overrides keyed by `frequency.toFixed(1)`; the model uses UUID
peaks and UUID-keyed maps. Save mints a UUID per peak.

**Load injects the saved peaks; it does NOT re-derive.** This matches Swift
`loadMeasurement` (`currentPeaks = measurement.peaks`, guarded by `isLoadingMeasurement`)
and `recalculateFrozenPeaksIfNeeded` / Python `recalculate_frozen_peaks_if_needed`: for a
loaded measurement the saved peaks are authoritative, and **Peak Min only filters them by
magnitude** — `findPeaks` is never re-run on the loaded spectrum (the spectrum is stored
for display and may not reproduce the saved peaks; the analysis range isn't even stored).
The web holds `loadedPeaks` (saved peaks as `Peak[]` with stable index ids); `peaks =
loadedPeaks ? loadedPeaks.filter(m ≥ peakMin) : findPeaks(...)`. Selection restores 1:1
from `selectedPeakIDs` (→ indices) and survives filtering because ids are stable;
overrides restore by frequency. `loadedPeaks` clears on a fresh capture / New Tap /
type change, reverting to the live `findPeaks` path. Two one-shot guards
(`skipNextTypeResetRef`, `loadingRef`) stop the type-change and fresh-capture reset
effects from clobbering a restore.

> Earlier this re-derived peaks via `findPeaks` on load — a divergence from native that
> could show a different peak set than was saved (different analysis range / FFT session).
> Corrected to the inject-and-filter algorithm above.

**Scope:** guitar save+load done. **Material LOAD/display done** (this follow-up):
`onLoadMeasurement` branches on `longitudinalSnapshot` → `measurementToLiveMaterial`
rebuilds the per-phase spectra, the selected L/C/FLC peaks, and the dimensions, and sets
phase=complete. The chart now **overlays** the per-phase spectra (L blue / C orange / FLC
purple, with a legend) via a new `SpectrumChart` `overlays` prop — used for both loaded
and live material (the old single `matSpectrum` became per-phase `matSpectra`). Test
`test/g8-material-load.test.ts` (4). **Material SAVE is still pending** (Save disabled in
material mode) — needs a `buildMaterialMeasurement`. Comparison + multi-tap views are 4d.

### 4c — Import / Export + load-time warning ✅ DONE
- **Export**: row ⋯ menu → **Export Measurement** writes a `.guitartap` (1-element JSON
  array via `serializeGuitarTapFile`, byte-compatible with Swift/Python). Filename =
  `guitarTapFilename(m)` (Swift `baseFilename` slug + unix ts). Uses the File System Access
  **`showSaveFilePicker`** save dialog so the user picks the location (Chromium); falls back
  to a plain Downloads-folder download on Safari/Firefox (no API there).
- **Import**: Measurements header **Import…** button → file-picker (`.guitartap`/json) →
  `parseGuitarTapFile` → **assigns a fresh `id` per measurement** (`newMeasurementId`) →
  `saveMeasurement` each → refresh; **auto-loads when the file holds exactly one**. Parse
  errors shown inline. The fresh-id step mirrors Swift `importMeasurements` (which appends
  copies): re-importing the same file adds a NEW library entry instead of overwriting by
  id (the web store is id-keyed, unlike Swift's array).
- **Load-time warning** (closes the web sample-rate epic): `measurementWarning(m, {micName,
  sampleRate, calibrationName})` in `fromLive.ts`, mirroring Swift `loadMeasurement` /
  Python `load_measurement`: recorded mic ≠ current input → name warning; same mic but
  calibration and/or sample rate differ → "recorded with a different …" warning; else null.
  Shown as a dismissible banner; cleared on New Tap / fresh capture. Web adapts: "current
  mic" = live `track.label`, calibration is absent (so a recorded calibration always
  differs). **Mic labels are normalised before comparing** (drop parenthetical suffixes /
  case / whitespace) because `track.label` differs across browsers for the SAME device —
  Chrome "MacBook Pro Microphone (Built-in)" vs Safari "MacBook Pro Microphone" — which
  otherwise false-flagged a mic mismatch; the meaningful sample-rate/calibration signals
  still fire. (Swift matches the stable CoreAudio UID; the web has only the label.)
  Test `test/g7-measurement-4c.test.ts` (11 tests). 70 web tests green.

### 4d — Comparison measurement type + multi-tap view
Two distinct things that share a chart overlay:
- **Comparison measurement** (a record): multi-select ≥2 library measurements → create a
  comparison (`comparisonEntries`) that's saved/loaded/listed like any measurement.
  Rendering needs SpectrumChart **multi-trace** support + a per-spectrum **Air/Top/Back
  results table** (`ComparisonResultsView`). The model serialization (4a) already covers
  `comparisonEntries`.
- **Multi-tap comparison** (a view, not a record): toggle on a loaded multi-tap guitar
  measurement to overlay each `tapEntries` spectrum vs the averaged result
  (`MultiTapComparisonResultsView`). Driven by `tapEntries`, which 4a round-trips.

### 4e — PWA / offline
- Web app manifest + service worker (cache the static bundle + worklet); installable;
  works offline. Fits the existing static `dist/` deploy.

## Out of scope → Phase 5
Deferred past persistence and collected in **Phase 5** (see PLAN.md): PNG/PDF/JSON
**export**, **Play-File** (WAV through the live pipeline), **device picker + calibration
import**, **draggable annotations + Reset Labels**, **Pause/Cancel** tap controls.
Optional/future: cloud sync, File System Access folder sharing.

## Open decisions
1. **Library UI placement** — a Measurements **modal** (like Settings) vs a side
   panel vs a route? (Recommend a modal/drawer for parity + simplicity.)
2. **Comparison now or defer** — 4d is the largest UI; do 4a–4c first, then decide.
3. **PWA scope** — basic offline cache now, or full installable PWA with icons?
4. **Storage backend** — DECIDED: IndexedDB + `.guitartap` import/export (above).

## Sequencing
4a (model/serialization + tests) → 4b (save/list/load) → 4c (import/export + warning,
closes sample-rate) → 4d (comparison) → 4e (PWA). Review after 4a and 4c.