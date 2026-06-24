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

### 4a — `.guitartap` model + serialization parity
TS model + encode/decode; round-trip test vs the vendored fixture. No UI yet. The model
covers all measurement kinds — including `comparisonEntries` (comparison measurements)
and `tapEntries` (multi-tap components) — so 4d needs no new serialization.

### 4b — Library: save, list, load
- **Save sheet** (name + notes) → build a measurement from the current frozen result
  (peaks, snapshot, settings provenance incl. sampleRate) → IndexedDB.
- **Measurements list** (panel/route): rows from IndexedDB; **Load into view** (restores
  frozen spectrum + peaks + ranges), **Rename / edit notes**, **Delete** (confirm).
- Loading restores the frozen state (mirrors Swift `loadMeasurement`), including the
  spectrum-blank-safe path we fixed.

### 4c — Import / Export + load-time warning
- **Export**: download the measurement(s) as `.guitartap` (and copy-JSON).
- **Import**: file-picker `.guitartap`; auto-load if exactly one; add to library.
- **Load-time warning** (closes the web sample-rate epic): on load, compare the
  measurement's **microphone / calibration / sample rate** against the current setup;
  tiered message (mic mismatch → mic only; same mic → calibration and/or rate). Mirrors
  the Swift/Python `microphone_warning` tiering.

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