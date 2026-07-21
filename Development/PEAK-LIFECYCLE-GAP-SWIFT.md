# Swift gap analysis vs PEAK-LIFECYCLE-SPEC

_2026-07-21. Read-only audit; nothing edited. Companion to [PEAK-LIFECYCLE-SPEC.md](PEAK-LIFECYCLE-SPEC.md)._

## Headline

The spec holds up. Violations are **concentrated**, not diffuse: `ResonantPeak` objects are minted in
only two places, and only **two** call sites detect without a new spectrum —

- `TapToneAnalyzer+PeakAnalysis.swift:247` — the `peakMinThreshold.didSet` live/frozen branch
  (re-runs `findPeaks`, **new UUIDs on every 1 dB slider tick**)
- `TapToneAnalyzer+PeakAnalysis.swift:289` — `recalculateTapEntryPeaks()`

Pan/zoom does **not** re-detect in Swift (display range is view `@State`).

## Bugs confirmed or newly found

1. **Deselect doesn't stick** (the reported bug, root cause confirmed). `togglePeakSelection` /
   `selectAllPeaks` / `selectNoPeaks` (`TapToneAnalyzer.swift:645-664`) never update
   `selectedPeakFrequencies`; the stale cache re-selects via the ±5 Hz carry-forward on the next
   slider move. Same mechanism un-sticks `selectNoPeaks()`.
2. **NEW — hidden peaks lose their state permanently.** `applyFrozenPeakState` (`:485-553`) *rebuilds*
   `peakAnnotationOffsets` and `peakModeOverrides` from only the surviving peaks, on **both**
   branches. An offset or custom label on a peak hidden by Peak Min is **destroyed, not hidden**.
3. **NEW — state leaks across measurements.** `startTapSequence` (`+Control.swift:112-275`) clears
   `currentPeaks`/`identifiedModes` but NOT offsets, overrides, `selectedPeakFrequencies` or
   `userHasModifiedPeakSelection`. On the next Peak Min move `applyFrozenPeakState` can **re-attach a
   previous measurement's dragged label or custom mode to a new peak at a similar frequency** — and
   `saveMeasurement` writes them to file regardless.
4. **NEW — selection lost on unrelated settings changes.** `resetToAutoSelection()` runs on *every*
   non-measurement-changing Settings→Apply (`TapToneAnalysisView+Layouts.swift:101-108`), including
   display axes or the unknown-modes toggle. And `TapSettingsView+Actions.swift:152` re-assigns
   `peakMinThreshold` unconditionally, firing the didSet (hence a re-detect) on any Apply.
5. **NEW — loaded files show sub-Peak-Min peaks.** On load `currentPeaks = measurement.peaks` (the
   full set), the Peak Min write is swallowed by the `isLoadingMeasurement` guard, and no view
   filters by Peak Min — so a 1.0.2 file lists peaks below Peak Min until the slider is nudged.

## Gap table (ordered by weight)

| # | Spec clause | Current behaviour | Sites |
|---|---|---|---|
| 1 | Peak Min never detects; it filters | Live/frozen branch re-runs `findPeaks` per tick | `+PeakAnalysis.swift:141-276`; needs a stored full set + a display-filtered projection consumed by `TapAnalysisResultsView.swift:387`, `visiblePeaks`, exports |
| 2 | Offsets/overrides survive Peak Min | Rebuilt, destroying hidden peaks' entries | Delete `applyFrozenPeakState` (`:485-553`); drop `selectedPeakFrequencies` |
| 3 | Frozen set is the full −100 dB set | `processMultipleTaps` detects at Peak Min; only *save* back-fills to −100 | `+SpectrumCapture.swift:1623`, `:724`, `:1658`; then `guitarFullSavePeaks()` collapses |
| 4 | Per-tap peaks computed once | `recalculateTapEntryPeaks()` re-derives peaks *and* per-tap selection at current Peak Min | Delete `:287-299`; calls at `:235`, `:274`, `+MeasurementManagement.swift:859` |
| 5 | Derived values from selected peaks, Peak-Min-independent | `getPeak(for:)` scans all `identifiedModes`; saved-measurement ratio uses a *different* rule | `+AnalysisHelpers.swift:75-102`; `TapToneMeasurement.swift:476-483` |
| 6 | Detection floor always −100 | `effectiveThreshold = peakMinOverride ?? peakMinThreshold` | `+PeakAnalysis.swift:433`, or pass the floor explicitly at call sites (**preferred — protects golden fixtures**) |
| 7 | Selection survives; wand only | Stale cache (bug 1) | Fixed for free by gap 2 |
| 8 | Guitar-type change: manual selection survives | `resetToAutoSelection()` wipes it | `+Layouts.swift:101-108`, `:251-258` |
| 9 | Analysis-range change forces re-analyze | No hook; incidental for live/frozen, nothing for loaded | `TapToneAnalyzer.swift:241-244`; `TapSettingsView+Actions.swift:152` |
| 10 | New capture resets per-peak state | Leaks (bug 3) | `+Control.swift:112-275` |
| 11 | Material: Peak Min plays no role | True, but the live/frozen branch is unguarded (safe only because material clears the frozen spectrum) | `+PeakAnalysis.swift:151-155` |
| 12 | Load re-detects nothing | ✅ conforms | — |
| 13 | Re-analyze is the one destructive control | ✅ conforms | — |

## Where the code argues the SPEC should change

**A. "On load nothing is re-classified" is NOT implementable today.** Mode assignments are not
persisted — `encode` writes `modeLabel` as a convenience string that `init(from:)` deliberately
ignores (`TapToneMeasurement.swift:664-673`). So `loadMeasurement` **must** call `reclassifyPeaks()`
to have any modes at all. Either amend the spec to "classification is re-derived on load from the
file's own saved guitar type" (which is what happens — the saved type is applied first), or add a
per-peak mode field to the format. **Decision required.**

**B. A −100 dB floor on the LIVE path is expensive.** `analyzeMagnitudes` runs `findPeaks` on every
FFT frame; `findPeaks` does parabolic interpolation + a −3 dB bandwidth walk per peak, then an O(n²)
dedup, and `guitarModeSelectedPeakIDs` logs one line per candidate. A real room noise floor sits far
above −100 dBFS, so −100 could turn tens of peaks into hundreds per frame. **Suggested amendment:**
−100 is the floor for the **frozen/stored** set (freeze, Re-analyze, save), where it costs nothing;
the live pre-freeze path keeps a cheap floor. The live set is discarded at freeze, so no per-peak
state depends on it.

**C. The dot layer needs naming in the spec.** The chart dot list is a separate, deliberately
selection-independent rule (`GuitarMode.peaksInDisplayRange`, pinned 3-platform by `DotLayerTests`
DL1–DL7). With a full −100 dB set it would dot every noise wiggle unless it takes Peak Min as an
input. Settle it in the spec, since it is a shared rule.

**D. Derived values: two rules exist and both change.** Live uses `getPeak(for:)` (all identified
modes); the saved-measurement list uses `TapToneMeasurement.tapToneRatio` (all saved peaks, now the
full set). Unify them in the same change, and decide what a legacy file with `selectedPeakIDs == nil`
means (`effectiveSelectedPeakIDs` currently returns "all").

**E. `userHasModifiedPeakSelection` may become vestigial.** Its only job is choosing carry-forward vs
auto-re-derive on a Peak Min move. Once Peak Min mutates nothing it survives only as the wand's
enable condition — but it was just persisted to the file format (`userModifiedSelection`) on all
three platforms. Decide whether it stays in the format.

## Test impact

`FrozenPeakRecalculationTests.swift` (PR1–PR7) is the main casualty: ~6 tests **delete or invert**
(they assert that hidden peaks' offsets/overrides are destroyed, and that the live path remaps by
frequency — exactly the behaviour being removed), ~6 rewrite, ~7 keep. `PeakSelectionPersistenceTests`
is built entirely on "Peak Min re-runs auto-selection on a loaded measurement" and must be
re-specified. `AnnotationStateTests` is **unaffected**.

`PeakFindingTests.swift:142` and `PeakFixtureRegressionTests` + `peak-baseline-expected.json` pin the
golden peak set at the file's Peak Min. They survive **if** the floor is passed explicitly at
production call sites rather than changing `findPeaks`' default — the baseline is 3-repo
byte-identical, so this matters.