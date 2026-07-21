# Implementation plan — peak lifecycle, Swift first

_Plan 2026-07-21. Target = [PEAK-LIFECYCLE-SPEC.md](PEAK-LIFECYCLE-SPEC.md). Current-state audit =
[PEAK-LIFECYCLE-GAP-SWIFT.md](PEAK-LIFECYCLE-GAP-SWIFT.md)._

**Swift is implemented and validated FIRST. Python and the web follow only once Swift is
user-verified.** Do not start the ports early — the spec will move under them.

## Ground rules

- **The golden peak baseline must not change.** `peak-baseline-expected.json` +
  `PeakFixtureRegressionTests` are byte-identical across three repos. Detection *itself* is not being
  changed — only *when* it runs. Therefore: pass the −100 floor **explicitly at call sites**
  (`peakMinOverride:`), never change `findPeaks`' default (`+PeakAnalysis.swift:433`).
- **Tests change WITH the phase that changes the behaviour** — never in a separate "fix the tests"
  pass. Several tests assert behaviour the spec deletes; those are deleted or inverted *as part of*
  the phase, with the reason in the commit message.
- **Each phase ends green** (full suite + golden fixtures) and is independently committable.
- Per-phase commits; the user commits. Build numbers roll on every source edit.

---

## Phase 0 — Safety net (no production change)

**Goal:** be able to prove nothing drifted.

1. Record a baseline: full Swift suite, `PeakFixtureRegressionTests`, and the playback-validation
   harness output (`Development/playback-validation/`).
2. Confirm the golden fixture set and `peak-baseline-expected.json` hashes, so any later change to
   them is caught deliberately rather than noticed late.

**Exit:** baseline captured and recorded in this doc.

---

## Phase 1 — The stored set becomes the FULL set (no visible change)

**Goal:** peaks are captured at −100 dB and stored; the display is filtered to Peak Min so the user
sees *exactly* what they see today.

- Detect at −100 (`peakMinOverride: TapToneAnalyzer.peakDetectionFloor`) at the capture sites:
  `+SpectrumCapture.swift:1623` (`processMultipleTaps` — the freeze transition), `:724`, `:1658`.
- Introduce the display projection: **full set → Peak Min → display range → unknown filter**, and
  point the Analysis Results table (`TapAnalysisResultsView.swift:387`), the dot layer
  (`SpectrumView.allPeaksInRange`) and the export paths at it.
- **Auto-selection at freeze runs over the FULL set** (spec §2) — so a sub-Peak-Min Air is selected
  at freeze.
- `guitarFullSavePeaks()` (`+MeasurementManagement.swift:260-270`) collapses to "the stored set";
  saved file content is unchanged (it already writes the full set since 9446217).

**Why this is safe:** `findPeaks`' local-max test is threshold-independent, so detect-at-−100 then
filter-at-PeakMin ≡ detect-at-PeakMin. The visible list does not move.

**Tests:** any test asserting `currentPeaks` *is* the Peak-Min-filtered set must be re-pointed at the
display projection. Golden fixtures must be unchanged — if they move, stop.

**Risk:** medium. Touches the freeze transition and the save path. Watch for the sub-Peak-Min Air now
being selected at freeze (intended, and it fixes the ratio immediately after capture).

---

## Phase 2 — Peak Min becomes a pure filter *(the core change)*

**Goal:** a Peak Min move recomputes the projection and mutates nothing.

- `recalculateFrozenPeaksIfNeeded()` (`+PeakAnalysis.swift:141-276`): delete the live/frozen
  re-detect branch (`:243-275`). A Peak Min change recomputes the display projection only.
- **Delete `applyFrozenPeakState` entirely** (`:485-553`) — the ±5 Hz remapping of offsets, overrides
  and selection.
- **Delete `selectedPeakFrequencies`** (`TapToneAnalyzer.swift:583`) and its seeding
  (`+MeasurementManagement.swift:755-761`).

**Bugs fixed here, all for free:**
- deselected peaks re-selecting on any slider move (the stale cache);
- annotation offsets and mode overrides on hidden peaks being **destroyed**;
- peak identity churning per slider tick.

**Tests — this is where the old model dies.** Delete/invert: `loadedPath_offsetForFilteredOutPeak_isDropped`,
`loadedPath_overrideForFilteredOutPeak_isDropped` (both assert destruction — now they must assert
survival), `loadedPath_annotationOffset_remappedByFrequency`, `loadedPath_modeOverride_remappedByFrequency`,
`liveTapPath_annotationOffset_remappedByFrequency`, `liveTapPath_emptyPeaks_preservesSelectedPeakIDs`.
Rewrite: `loadedPeaks_allBelowThreshold_clearsBothCollections`, `frozenSpectrum_raisedThreshold_removesWeakPeak`,
`loadedPath_manualSelection_carriedForwardByFrequency`, `frozenSpectrum_detectsKnownPeak`,
`afterLoadingCompletes_recalculationRuns`. Re-specify `PeakSelectionPersistenceTests` (built entirely
on "Peak Min re-runs auto-selection").

**Add:** a durability test — set an offset, an override and a selection; sweep Peak Min up past the
peak and back down; assert all three are byte-identical afterwards. This is the spec's whole point.

**Risk:** high — the largest single change. Best run-review checkpoint.

---

## Phase 3 — Per-tap entries computed once

- Delete `recalculateTapEntryPeaks()` (`+PeakAnalysis.swift:287-299`) and its calls at `:235`, `:274`,
  `+MeasurementManagement.swift:859-861`.
- Per-tap peaks + their Air/Top/Back are computed at capture and never re-derived; the multi-tap table
  is independent of Peak Min (spec §5).

**Risk:** low. **Test:** change Peak Min, open the Taps table, assert per-tap values unchanged.

---

## Phase 4 — One unknown predicate

- Add `isUnknown(peak) = assignedMode == .unknown && !hasManualOverride(peak)`.
- Consume it in **both** the results table and the dot layer; delete the two divergent criteria.
- **Fixes:** a custom-labelled peak currently vanishes from both when Show Unknown Modes is off.
- **Re-spec the `view/dot-layer` parity group**: DL1/DL2/DL6/DL7 stand; DL3/DL4/DL5 change from
  `isKnown(frequency)` to the new predicate. `GuitarMode.peaksInDisplayRange` loses its `isKnown` half.

**Risk:** low-medium; touches a rule committed today across three platforms, so the Python/web twins
must be updated when their turn comes.

---

## Phase 5 — The selection model

- Air/Top/Back: at most one holder each. Enforce on **toggle** and on **mode override** (assigning
  Air/Top/Back displaces the current holder; the displaced peak stays a candidate).
- Overriding *away* from Air/Top/Back leaves the mode with no holder — do **not** auto-promote.
- **Remove Select All**: the button (all layouts), `selectAllPeaks()`, and its tests
  (`AnnotationStateTests.selectAllPeaks_selectsAllCurrentPeaks`, `selectAllPeaks_setsModifiedFlag`) —
  deleted with the feature, not rewritten. **Keep Select None.**

**Risk:** medium — user-visible UI change. **Test:** selecting a second Top displaces the first;
overriding a peak to Top displaces the holder; Upper Modes still allows several.

---

## Phase 6 — Derived values unified

- `getPeak(for:)` / `calculateTapToneRatio()` (`+AnalysisHelpers.swift:75-102`) → the **selected
  holder** of the mode.
- `TapToneMeasurement.tapToneRatio` (`TapToneMeasurement.swift:476-483`) → the same rule, replacing
  "first Air/Top in array order".
- Legacy `selectedPeakIDs == nil` keeps meaning "all"; identical result, no migration.

**Risk:** medium — numbers change for any measurement where a winner was deselected (intended).
**Test:** the on-screen ratio and the saved-list ratio agree for the same measurement.

---

## Phase 7 — The remaining triggers

- **Guitar-type change** (`TapToneAnalysisView+Layouts.swift:101-108`, `:251-258`): reclassify;
  **stop** calling `resetToAutoSelection()`, which currently wipes manual selection on *every*
  Settings→Apply including display-only changes.
- **Stop the unconditional `peakMinThreshold` write** (`TapSettingsView+Actions.swift:152`) that fires
  the didSet on any Apply, in any measurement type.
- **Analysis frequency range** (`TapToneAnalyzer.swift:241-244`): explicit re-analyze on change, for
  loaded measurements too (today it does nothing for them).
- **`startTapSequence`** (`+Control.swift:112-275`): clear `peakAnnotationOffsets`,
  `peakModeOverrides`, `userHasModifiedPeakSelection`. Fixes state leaking into the next measurement
  and being written to its file.
- **Material:** add the explicit `isGuitar` guard to the live/frozen branch (`+PeakAnalysis.swift:151-155`)
  rather than relying on material clearing the frozen spectrum.

**Risk:** low individually; several small independent fixes.

---

## Phase 8 — Validation

1. Full Swift suite + golden fixtures + playback validation vs the Phase 0 baseline.
2. **User run-review script:**
   - drag a label, deselect the peak, sweep Peak Min up past it and back → position, selection and
     custom label all unchanged;
   - a custom-labelled peak stays visible with Show Unknown Modes off;
   - change Peak Min, open the Taps table → per-tap values unchanged;
   - select a second Top → the first is displaced; Upper Modes allows several;
   - on-screen ratio == saved-list ratio;
   - start a new measurement → no labels/overrides inherited from the previous one;
   - material: Peak Min disabled, L/C/FLC unaffected.
3. Only then: Python, then web.

---

## Suggested checkpoints for the user

Phases 1–2 together are the substance and the risk; stop for run-review there. Phases 3–7 are smaller
and can be batched. Phase 8 gates the ports.