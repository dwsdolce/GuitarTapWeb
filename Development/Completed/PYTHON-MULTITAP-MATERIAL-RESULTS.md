# Python multi-tap MATERIAL results table lags by one phase

**Status:** ✅ **FIXED + USER-VERIFIED 2026-07-16 (Python-only).** User re-ran the WAV: L appears on
completion and persists through C and FLC — no set-then-clear. Root-caused by
instrumented file-playback trace, fixed by resolving the phase frequencies from the persistent
per-phase lists (Swift mirror). Instrumentation fully removed; `_gt_log_enabled` reverted to False.
**To run-review: re-run the same WAV** (`brace-umik-1-python-mac-1784234570.wav`) through a multi-tap
plate — L should appear on completion and STAY through C and FLC (no set-then-clear). Confirmed
PYTHON-ONLY (user: *"The web and swift seem to be fine."*).

**This means it is a PORT DIVERGENCE, not a design bug.** Swift (canonical) and the web both show the
phased material rows correctly on a multi-tap plate. So there is a **known-good reference** on both
sides: diff Python's `peaksChanged → _refresh_results_peaks → set_assignment` flow against Swift's
reactive `MaterialPeakRowView` binding and the web's `MaterialResults` phased logic to find what
Python does differently. Candidate #2 below (shared design bug) is **eliminated**. The fix belongs in
Python's live-results wiring, not in the model's peak computation (the numbers are right — Swift/web
prove the same data renders correctly).

## Symptom (user)

Multi-tap **plate** on Python:
- After the **L** phase completes (N taps averaged, accepted): the **Analysis Results table shows NO
  tap** for Longitudinal — **but the graph shows the averaged waveform with the correct L
  annotation.**
- Then during the **C** phase, *before* accepting Cross-grain: the table shows **BOTH L and C.**

User's read: *"there is something wrong in the entire logic on python."* Agreed — this is a
**one-phase LAG** in the phased material results, not a cosmetic slip. Phase N's row only appears once
phase N+1 completes.

⚠ **Single-tap plate WORKS** (verified earlier, item 7). So the defect is specific to the **multi-tap**
material path. Whatever differs between single and multi-tap capture is the trigger.

## What's CONFIRMED about the mechanism (not yet the root cause)

The live material table (`_material_peak_widget`) and the graph annotation are **both** driven by the
same `peaksChanged` signal (`tap_tone_analysis_view.py:2120-2123`):
- `_on_peaks_changed_results` (2590) → `_refresh_results_peaks` (2658) → `_material_peak_widget.set_assignment(long_freq, cross_freq, flc_freq)`
- `_material_peak_widget.update_peaks`
- `_on_peaks_changed_multi_tap` (4308) — **a multi-tap-specific handler on the same signal**

The material table's L/C/FLC frequencies are resolved in `_refresh_results_peaks` (~2718-2726) by
looking up the **effective** phase id **inside the current peaks list**:

```python
long_id  = analyzer.effective_longitudinal_peak_id
peak_by_id = {p.id: p for p in peaks}          # peaks == analyzer.current_peaks
long_freq  = peak_by_id[long_id].frequency if long_id and long_id in peak_by_id else 0.0
...
self._material_peak_widget.set_assignment(long_freq, cross_freq, flc_freq=flc_freq)
```

`set_assignment(long_freq=0.0, ...)` ⇒ no L row. And `_refresh_results_peaks` **returns early WITHOUT
calling `set_assignment`** when `current_peaks` is empty:

```python
peaks = self._current_peaks_all
if not peaks:
    self.peak_widget.update_data_with_modes([]); return   # set_assignment NOT reached → stale
```

**Why "L+C both appear at C":** when C completes, `current_peaks = combine_plate_peaks()` (spectrum
capture :1672) rebuilds the list to hold **both** the L and C peak objects, so both `effective_*_id`
lookups resolve → both rows fill at once. That half is understood.

## ✅ ROOT CAUSE — CONFIRMED by instrumented file-playback trace (2026-07-16)

Instrumented `_refresh_results_peaks`/`set_assignment` + played the recorded WAV. The trace is
unambiguous — **the L/C/FLC row is SET correctly at each phase completion, then CLEARED to 0 the
instant the next phase begins** (user: *"it gets set and then cleared"*):

```
L completes:      set_assignment L=67.03 (id=34aa…, in_peaks=True)     ← L resolves, row appears
auto-advance L→C: set_assignment L=0.0   (id=34aa…, in_peaks=FALSE)    ← L WIPED
C completes:      set_assignment L=67.03, C=51.86 (both in_peaks=True) ← both appear
auto-advance C→FLC: set_assignment L=0.0, C=0.0 (both in_peaks=FALSE)  ← both WIPED
FLC completes:    set_assignment L,C,FLC all in_peaks=True             ← all three appear
```

Exactly the reported symptom: nothing after L, L+C flash at C, blank, then all three.

**Mechanism:** `effective_longitudinal_peak_id` (and C/FLC) are correct and **persist** across phases
(`effL=34aa…` stays set throughout). But `_refresh_results_peaks` resolves the id→frequency by looking
it up in **`current_peaks`** (`peak_by_id = {p.id: p for p in peaks}`), and `current_peaks` holds only
the **current phase's** peaks — the live cross spectrum during CAPTURING_CROSS does **not** contain the
completed L peak → `in_peaks=False` → `set_assignment(L=0.0)` wipes the row set one event earlier. The
only moments all phases resolve are at a phase-completion (`combine_plate_peaks()` briefly unions them)
and at COMPLETE — which is why it "catches up" one phase late.

**The fix (mirror Swift):** Swift resolves from the **persistent per-phase list**, not currentPeaks —
`TapAnalysisResultsView.swift:421` `analyzer.longitudinalPeaks.first { $0.id == effectiveLongitudinalPeakID }`.
Python must build the id→peak lookup from `analyzer.longitudinal_peaks + cross_peaks + flc_peaks` (each
set once per phase at spectrum_capture:1486/1664/1771 and **NOT cleared on phase-advance** — only on
`redo_current_phase` / `_reset_material_phase_state` / `_load_measurement_body`, all correct), instead
of from the transient `current_peaks`. That is the single defect; the numbers were always right (Swift
and the web prove the same data renders correctly).

## The HOLE (superseded by the trace above) — kept for the record

At L-completion the live-plate branch (spectrum capture :1561-1575) DOES:
- set `current_peaks = longitudinal_peaks` (which contains the avg L peak), and
- `_emit_peaks_array(current_peaks)` → emits `peaksChanged`.

And `effective_longitudinal_peak_id` = userSel ?? selectedLongitudinalPeak.id ?? autoSelected
(`annotation_management.py:110`) — all of which point at the avg L peak that IS in `current_peaks`.
So the lookup **should** resolve at L-completion, and the L row should appear. **It doesn't.** That
contradiction means the real cause is something the static read hasn't shown — candidates, unverified:

1. **A competing `peaksChanged` fires right after** with a different/empty `current_peaks`, re-running
   `_refresh_results_peaks` and clobbering the L assignment. Signal-ordering between the three
   `peaksChanged` handlers (esp. `_on_peaks_changed_multi_tap`) is the prime suspect.
2. **`_on_peaks_changed_multi_tap` swaps the visible table.** It rebuilds the multi-tap COMPARISON
   view when `_multi_tap_results_view.isVisible() and analyzer.tap_entries`. If material multi-tap
   populates `tap_entries` (guitar's `process_multiple_taps` sets it at :2042 — need to confirm
   whether the material path also does), the wrong table could be shown/hidden.
3. **`current_peaks` is briefly empty** at the review transition (a `set_frozen_spectrum([], [])` or a
   reset between taps), hitting the early-return so `set_assignment` never runs for L.
4. **`effective_longitudinal_peak_id` is None at that instant** because `selected_longitudinal_peak`
   /`auto_selected_longitudinal_peak_id` are set in a different order under multi-tap than single-tap.

## How to root-cause it deterministically (recommended before ANY fix)

Do NOT guess-patch a phased state machine. **Reproduce it offline:** feed the recorded **multi-tap
plate WAV** through Python's **file playback** and log, at every `peaksChanged`, the tuple
`(material_tap_phase, len(current_peaks), effective_longitudinal_peak_id, is L-id in current_peaks,
which results widget isVisible, len(tap_entries))`. The phase where L's row fails to render will show
which of the four candidates is true. ⚠ First confirm file-playback exercises the same phased path as
live (OUT-4 territory) — if playback auto-advances L→C without the review pause, add a variant or test
live with logging.

## Parity check still owed

- **Does the WEB have the same multi-tap material phased display, and does it lag too?** Unchecked. If
  the web is correct, its `MaterialResults` phased logic is the reference for what Python's port got
  wrong. If the web is ALSO wrong, this is a shared design bug.
- **Swift** is presumed correct (canonical, reactive `MaterialPeakRowView` binding
  `effectiveLongitudinalPeakID == item.peak.id` re-evaluated per body render). Confirm it actually
  shows L immediately on a multi-tap plate before treating it as the reference.

## Scope / release question (for the user)

Single-tap plate + brace work; multi-tap guitar works. This is **multi-tap MATERIAL** specifically. Is
it a 1.0.2 blocker, or tracked for a fix while the device sweep continues? The measurement DATA is
almost certainly correct (the graph annotation and the saved file derive from the same peaks) — this
reads as a **display/propagation** defect in the live results table, not bad numbers. Confirm by
checking whether the SAVED multi-tap plate `.guitartap` + its PDF show all three phases correctly
despite the live table lag.