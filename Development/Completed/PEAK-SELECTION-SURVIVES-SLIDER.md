# Deselecting a peak doesn't survive a Peak Min slider move

_Opened 2026-07-21 from run-review. **RESOLVED 2026-07-22 (Swift) by the Phase 2 peak-lifecycle decoupling — see the resolution note at the bottom. Originally: root-caused, not fixed.**
This is a defect in **canonical Swift**, mirrored by Python — not a port divergence._

## Repro (user, on Swift)

1. Drag a peak's annotation label to move it.
2. **Deselect** that peak in the Analysis Results table.
3. Move the Peak Min slider — **any** amount, in either direction.
4. → the peak is **re-selected** (its annotation reappears).

Separately, if the slider is moved far enough that the peak **disappears and then reappears**, the
annotation returns at its **default position** (the drag is lost). See "Related, separate" below.

## Root cause (Swift; Python mirrors the same structure)

`TapToneAnalyzer.togglePeakSelection(_:)` updates **only** `selectedPeakIDs`:

```swift
if selectedPeakIDs.contains(peakID) { selectedPeakIDs.remove(peakID) } else { selectedPeakIDs.insert(peakID) }
userHasModifiedPeakSelection = true
```

It never updates **`selectedPeakFrequencies`**. But that cache is exactly what the selection
carry-forward prefers as its source (`TapToneAnalyzer+PeakAnalysis.swift`, the
`previouslySelectedFrequencies` block):

```swift
if !selectedPeakFrequencies.isEmpty { previouslySelectedFrequencies = selectedPeakFrequencies }
```

So after a deselect the peak is gone from `selectedPeakIDs` but its frequency is **still in the
cache**. Any Peak Min change runs `recalculateFrozenPeaksIfNeeded` → `applyFrozenPeakState`, whose
carry-forward branch iterates `previouslySelectedFrequencies`, matches the peak within tolerance,
and **re-selects it**. No disappear/reappear required — which is what the user observed.

## Why the fix is not a one-liner

The cache is **deliberately stale in one direction**: the carry-forward *appends* the frequencies of
peaks that fell below the threshold —

```swift
} else {
    // Peak is below threshold — preserve its frequency so it
    // is re-selected when the threshold is lowered again.
    carriedFreqs.append(oldFreq)
}
```

— so a selected peak returns when you lower the slider again. That behaviour is wanted. So the fix
must **not** rebuild the cache from `currentPeaks` (that would drop legitimate below-threshold
selections). It has to maintain the cache **incrementally**:

- `togglePeakSelection` — on select, add the peak's frequency; on deselect, remove the entry
  matching that frequency (within the same tolerance the carry-forward uses).
- `selectAllPeaks` / `selectNoPeaks` — keep the cache in step the same way.

Then apply the identical change to Python (`toggle_peak_selection`, `select_all_peaks`,
`select_no_peaks`) and add a carry-forward parity case: *deselect a peak, change Peak Min, assert it
stays deselected.*

## Python has an ADDITIONAL, separate defect on top

Independent of the cache bug, Python's view never tells the analyzer about a selection change at all:

- `TapToneAnalyzer.toggle_peak_selection()` (`tap_tone_analyzer.py:1293`) is **dead code — called
  from nowhere**.
- No view code writes `analyzer.selected_peak_ids`; every write is inside `models/`.
- The table's toggle updates only `peak_widget.model.selected_peak_ids`; the view sends back just
  `userModifiedSelectionChanged(bool)`, whose handler only enables the reset button.
- `tap_tone_analysis_view.py:2619` then pushes `analyzer.selected_peak_ids` **over** the view model
  on every `peaksChanged`, discarding the user's choice.

So Python needs BOTH: the shared cache fix, and routing its selection UI through the analyzer
(`toggle_peak_selection` / `select_all_peaks` / `select_no_peaks`), which is what Swift already does
at `Views/TapAnalysisResultsView.swift:576`. Note `_on_reset_auto_selection` already delegates to the
analyzer and then re-emits `peaksChanged` — that is the established pattern to copy.

## Related, but separate — do not fold in

1. **Annotation position reset when a peak disappears and returns.** The offset remap only carries
   peaks that survive the filter, so a peak filtered out entirely loses its stored offset
   permanently ("peaks that disappeared below the new threshold are simply dropped"). User: "may be
   intentional". Not investigated further.
2. **Web: peaks appear/disappear during slider moves unrelated to their level.** Reported by the
   user; the web otherwise "kind of works" for the deselect case. **Not investigated at all.**

## State — RESOLVED

Root cause established by code inspection on both sides.

**Fixed in Swift by the Phase 2 peak-lifecycle decoupling (2026-07-22).** A Peak Min change no longer
runs `recalculateFrozenPeaksIfNeeded` → `applyFrozenPeakState`, so the carry-forward that read the
stale `selectedPeakFrequencies` cache never fires on a slider move — the deselect survives.

**The proposed incremental-cache fix above was NOT the path taken, and is superseded.** Verified
2026-07-23: Swift's `togglePeakSelection` was not changed — it updates only `selectedPeakIDs` +
`userHasModifiedPeakSelection` (plus Phase 5's `enforceDefinitiveModeUniqueness` on the insert side).
So the doc's *diagnosis* is correct but its *proposed remedy* did not ship; decoupling made the stale
cache harmless without touching the toggle.

**Python port:** mirrors the same decoupling (Phase 2 **A** — the Peak Min slider →
`refresh_displayed_peaks()`, done 2026-07-23). The remaining Python-specific work is the separate
defect below — routing its selection UI through the analyzer — landing as Phase 2 **C**.
Next decision needed: confirm the incremental-cache approach, then Swift → Python → parity test.