# Peak Lifecycle — Python Port Plan & Tracker

Companion to `PEAK-LIFECYCLE-PLAN-SWIFT.md`. Tracks the Python port of the peak-lifecycle
rework. **Swift is canonical**; this doc replays the Swift plan's per-phase **port ledgers**
into Python, one phase at a time.

Python repo: `/Users/dws/src/guitar_tap` (lowercase; NOT the Swift `GuitarTap`). Mirror file split:
`src/guitar_tap/models/tap_tone_analyzer*.py`, `guitar_mode.py`, `tap_tone_measurement.py`, …

---

## Porting discipline (user directive, 2026-07-23)

1. **Read the corresponding Swift change FIRST**, then do the Python one in a **non-divergent**
   fashion — architecture, structure, and naming as close to Swift as possible.
2. **Naming:** Python snake_case mirror of Swift camelCase
   (`all_peaks ↔ allPeaks`, `refresh_displayed_peaks() ↔ refreshDisplayedPeaks()`,
   `peaks_above_peak_min ↔ peaksAbovePeakMin`). Keep the mirror tight.
3. **Diverge ONLY where the language/framework forces it** — chiefly the VIEW layer
   (Qt / `fft_canvas.py` vs SwiftUI), which has not had the architectural-parity restructure.
   Even there, get it as close as possible; name divergences explicitly, don't invent web-only shapes.
4. **Per phase:** implement the Rule → create the counterpart tests named in the Swift ledger →
   update `@parity` tags → `python3 Tooling/parity/gen_parity_map.py --check` (zero new orphans) →
   golden baseline `5c264de3941837f8` **unmoved**. A phase is ported when its tests pass — not when
   the code "looks like" the Swift.
5. **Re-verify every ledger claim against the Python code before implementing.** The Swift ledgers'
   cross-platform entries are a *map of where to look*, not evidence of what is there. A ledger entry
   that cannot be confirmed is a bug in the ledger — correct it in the same change.
6. **Do NOT edit source while a soak/stress run is in flight** (invalidates the built test artifact).

## Status legend
⬜ not started · 🟡 in progress · ✅ ported + tests green (NOT user-verified) · ✔️ user-run-reviewed

---

## Phase 1 — The stored set becomes the FULL set

### ✅ Phase 1 COMPLETE — suite green (530), parity 79 + USER-VERIFIED (2026-07-23). Committed `6068d1a` (with Phase 2).

**Changed (Python):**
- `all_peaks` added as the durable set — a `_all_peaks` backing store + an `all_peaks` property whose setter
  calls `refresh_displayed_peaks()` (mirrors Swift `allPeaks` `@Published` + `didSet`). `current_peaks`
  demoted to its Peak-Min display projection via `refresh_displayed_peaks()` (guitar filters by
  `peak_min_threshold`; material passes `all_peaks` through).
- The 17 `current_peaks =` write sites converted to feed `all_peaks` (capture / detect / load / clear /
  material-accept), mirroring Swift's `allPeaks =` sites. `peak_min_override=PEAK_DETECTION_FLOOR` (−100)
  added at the capture / frozen-re-detect / guitar-averaged `find_peaks` calls. The loaded recalc branch and
  `_emit_loaded_peaks_at_threshold` now assign the FULL saved set (the `>= peak_min` pre-filter removed — the
  data-loss trap). LEFT as-is: the guitar LIVE FFT path keeps `live_threshold` (Swift captures the full set
  at freeze, not the live path); `_emit_peaks_array` keeps its no-op `current_peaks` passthrough.
- `guitar_full_save_peaks()` collapsed to `return list(self.all_peaks)` (mirrors Swift `{ allPeaks }`;
  deleted the re-detect-and-append dance).

**Ledger correction:** 17 analyzer write sites in Python (`_spectrum_capture` 6, `_peak_analysis` 6,
`_control` 4, `_measurement_management` 1), not the "~12" the Swift ledger guessed; `views/fft_canvas.py`
writes a view-local `_current_peaks`, out of scope.

**Tests:** `TestGuitarFullSavePeaks._prep` reseeds `all_peaks` with the full −100 set;
`test_loaded_measurement_is_not_upgraded` seeds a loaded durable set that is NOT re-detected (the two
ledger-named tests, updated in place). Suite 530; parity 79; golden `peak-baseline-expected.json` unmoved.

**Run-reviewed by the user 2026-07-23: "things seem to still work."**

### Port ledger — Phase 1
**Rule.** Detection stores the FULL peak set (fixed −100 dB floor at capture). Peak Min never reaches
detection; it is applied afterward as a projection handing back the *same peak objects*. Auto-selection at
freeze runs over the full set. **Guardrail:** `all_peaks` must NEVER be assigned a filtered view.

---

## Phase 2 — Peak Min becomes a pure filter *(core change)*

### ✅ Phase 2 COMPLETE — suite green (532), parity 79 + USER-VERIFIED (2026-07-23). Committed `6068d1a` (with Phase 1).

**Changed (Python):**
- **A — decouple.** The live Peak Min slider (`fft_canvas.set_threshold:1698`) and the parallel
  `control.py:1105` now call `refresh_displayed_peaks()` instead of `recalculate_frozen_peaks_if_needed()`
  — Peak Min re-projects, never re-detects (mirrors `peakMinThreshold.didSet`). `peak_min_threshold` was made
  a `@property` whose setter re-projects (init sets the `_peak_min_threshold` backing field directly, since a
  Python setter fires on init unlike Swift `didSet`). An explicit `peaksChanged.emit` was added AFTER the
  projection in `set_threshold` — `current_peaks` isn't `@Published`, so the view must be told (a run-review
  found the missing emit: "no peaks come or go").
- **B — corollary.** Every selection/classification site reads the durable `all_peaks` — the recalc snapshot
  (offsets/overrides/prev-selected), `reset_to_auto_selection`, `guitar_mode_selected_peak_ids` default, and
  `reclassify_peaks`.
- **C — selection routed through the analyzer.** New `PeaksModel.selectionToggled(peak_id)` signal (emitted
  from `set_show_value` on a user toggle) → `_on_peak_selection_toggled` → `analyzer.toggle_peak_selection`
  + `peaksChanged.emit`; select-all/none route to `analyzer.select_all_peaks()` / `select_no_peaks()`. The
  existing push-over then syncs the widget model from the analyzer — no longer discards the user's choice.
  Fixes the deselect-not-surviving-a-slider defect (`PEAK-SELECTION-SURVIVES-SLIDER.md`, resolved by the A
  decoupling, as in Swift). No incremental `selected_peak_frequencies` cache (Swift keeps none — verified).
- **D — non-item (verified).** Python's leader line already draws from the live peak coords, so Swift's
  `frozenPeakPosition` bug has no Python analog. Also fixed a *pre-existing* annotation "Reset Position" bug
  found in run-review (`_default_pos` was conflated with the saved offset) — now uses the computed default
  and clears the offset via `reset_annotation_offset`, mirroring Swift `isMoved` / `resetAnnotationOffset`.
- **Ledger corrections:** `_emit_loaded_peaks_at_threshold` is the LOAD path, NOT a Peak-Min trigger (the
  Swift ledger's claim was wrong). The `TapToneAnalyzer.deinit` crash is a SEPARATE parked concern —
  `DEINIT-CRASH-INVESTIGATION.md`.

**Tests (+2, 530 → 532):** inverted `test_PRA4_...clears_display_keeps_durable_set` (display empties,
`all_peaks` survives); new `TestPeakMinDurability` — the sweep test (identity / selection / override / offset
survive a Peak Min sweep, driving `peak_min_threshold =` directly) + the deselect-survives-slider guard. One
reset-to-auto test reseeded to `all_peaks`. Parity 79; golden unmoved.

**Run-reviewed by the user 2026-07-23, all checks pass:** Peak Min sweep reveals/hides peaks; toggle /
select-all / none route through the analyzer; a deselected peak survives a sweep; and "Reset Position" is
enabled after reset-to-auto and returns the label to its true default.

### Port ledger — Phase 2
**Rule.** A Peak Min change recomputes the display projection and mutates nothing else. Detection,
classification and selection are facts about the *measurement*; only display depends on Peak Min.
**Corollary:** every auto-selection and classification call site reads the DURABLE set, never the displayed one.

---

## Phase 3 — Per-tap entries computed once

### ✅ Phase 3 COMPLETE — suite green (535), parity 79 + USER-VERIFIED (2026-07-23). Uncommitted (awaiting user commit).

**Changed (Python):**
- Per-tap capture (`_spectrum_capture.py:2025`) now passes `peak_min_override=self.PEAK_DETECTION_FLOOR` —
  each `TapEntry` stores the FULL −100 set at capture (the Python-specific gap Phase 1 didn't cover; Swift's
  capture already passed the floor at `+SpectrumCapture.swift:1664`). **Landed first**, so the deletion below
  can't freeze a filtered set.
- Deleted `_recalculate_tap_entry_peaks` + its 3 call sites (`_peak_analysis` loaded/live recalc branches,
  `_measurement_management` load), with a removal comment at each; dropped the stale load-path justification
  ("re-running find_peaks ensures consistency" — the exact defect, fighting loaded-peaks-authoritative).
  Mirrors Swift `recalculateTapEntryPeaks()` removal.
- Added `selected_peaks` property (`[p for p in self._all_peaks if p.id in self.selected_peak_ids]`; mirrors
  Swift `selectedPeaks`) and adopted it in the two multi-tap averaged-row consumers — screen
  (`_populate_multi_tap_results_view`) and PDF (`_on_export_multi_tap_pdf`) — which previously filtered the
  DISPLAY set (`current_peaks` / a local `all_peaks = list(analyzer.current_peaks)`), so a selected peak below
  Peak Min vanished from the averaged Air/Top/Back row. **Screen consumer will move to `definitive_mode_info`
  in Python Phase 6b, matching current Swift** (Swift adopted `selectedPeaks` in both at Phase 3, then 6b
  refined the screen one — so `selected_peaks` here is correct for THIS phase).
- Updated the `_on_peaks_changed_multi_tap` docstring (Qt re-render handler, no Swift counterpart); it still
  earns its keep — the Averaged row follows selection, though the per-tap rows are now durable.

**Tests (+3, 532 → 535):** `test_peak_min_sweep_leaves_tap_entries_untouched` (drive the `peak_min_threshold`
property); `test_recalculate_frozen_peaks_leaves_tap_entries_untouched` (both branches — the direct guard
against the deleted call returning); `test_selected_peaks_resolve_over_durable_set`. Parity 79; golden unmoved.

**Run-review OWED** (corrected 2026-07-23 — Peak Min is DISABLED in the Taps/comparison view, and Phase 2 had
already decoupled the slider, so "sweep Peak Min while viewing the Taps table" is impossible/moot; the unit
test drives the model directly): (1) a fresh multi-tap capture saved → reloaded **agrees with itself** — the
reloaded per-tap table is the full saved set, not re-detected at the saved Peak Min (the main Phase 3 fix, and
the predicted visible change on OLD multi-tap files); (2) the multi-tap **PDF's per-tap + Averaged rows match
the screen**; (3) on the averaged view select a peak, then raise Peak Min to hide it from the display, then
open the Taps table — the **Averaged row (and PDF) still includes it**.

**RETRACTED (do not re-file):** the "instance vs static `resolved_mode_peaks` divergence" is NOT real — every
static caller receives already-selection-filtered peaks (Swift ledger retraction applies to Python too).

**✅ RUN-REVIEW BUG (2026-07-23, user-found; FIX v2 VERIFIED — "All verified"):** Do a multi-tap → save → then
load a SINGLE-tap measurement → the multi-tap **Taps table stays visible**, showing the OLD per-tap rows (Tap
1/2/3) + the NEW loaded measurement's **Averaged** row (196.4/239.2). "Should be impossible" — a single-tap
measurement showing a Taps table.
- **Root cause (verified):** `tap_entries` IS cleared on load (`_measurement_management.py:812` → `[]` when the
  loaded measurement has none). But `_restore_measurement` (view) NEVER resets the multi-tap **VIEW**: the
  reset (hide `_multi_tap_results_view`, silently uncheck + gray the `_multi_tap_toggle_btn`, re-show
  `peak_widget`) lives ONLY inside `_on_multi_tap_toggled`'s `if not checked:` block (~`tap_tone_analysis_view.py:2536-2555`),
  which load does not call. So the stale 3-tap widget stays up. Phase 3's `selected_peaks` averaged-row makes
  its Averaged row now reflect the LOADED peaks (more visibly wrong). **Pre-existing gap, not a Phase 3
  regression** (the deleted recompute never ran for single-tap load; the view-reset gap predates it).
- **PRECISE FIX (verified against Swift + Python):** The MODEL is already correct — `load_measurement` sets
  `self.showing_multi_tap_comparison = False` (`_measurement_management.py:813`, mirrors Swift
  `+MeasurementManagement.swift:856`). And `_update_multi_tap_toggle_state` (`view:4251`) only sets the toggle
  BUTTON's visible/enabled — it does NOT hide `_multi_tap_results_view` or re-show `peak_widget`. SwiftUI hides
  the multi-tap view automatically off `showingMultiTapComparison`; Qt does not. So the ONLY fix: in
  `_restore_measurement` (`view:4358`), when the multi-tap widget is showing, reset it — the SAME reset as
  `_on_multi_tap_toggled`'s `if not checked:` block (`~2540-2554`): silently uncheck + gray the toggle, hide
  `_multi_tap_results_view`, re-show `peak_widget`. (Best: extract that block into a `_reset_multi_tap_view()`
  helper called from both.)
- **❌ FIRST FIX INEFFECTIVE (user: "No change"):** added the reset block inline at the TOP of
  `_restore_measurement` (before `load_measurement`), GATED on `if self._multi_tap_results_view.isVisible():`.
  Two flaws: (1) it ran BEFORE `load_measurement`, so any re-show during the synchronous `measurementComplete`
  handlers would undo it; (2) the `isVisible()` guard is fragile — if it returns False the reset silently
  no-ops. User re-tested and saw no change.
- **✅ FIX v2 APPLIED 2026-07-23 (suite 535 green; NEEDS RUN-REVIEW):** moved the reset to run AFTER
  `analyzer.load_measurement(m)` (`view:~4378`) so it is the final word regardless of what the
  `measurementComplete` handlers touch, and made it UNCONDITIONAL — gated on `if not
  analyzer.showing_multi_tap_comparison:` (True after every load, since `load_measurement` clears it) rather
  than on widget `isVisible()`. Silently unchecks/grays the `_multi_tap_toggle_btn` and hides
  `_multi_tap_results_view`; leaves `peak_widget` / `_material_scroll` to the existing load logic (which
  already shows the loaded results, per the screenshot). Verify: multi-tap → save → load a single-tap → Taps
  table is gone, single-tap results shown. Also re-check: load a MULTI-tap file → its Taps toggle re-enables
  (via `_update_multi_tap_toggle_state` on measurementComplete) and opening it still works. **NB (Python):
  restart the app to pick up source changes — Python has no build step.** POSSIBLE FOLLOW-UP: if the multi-tap
  chart OVERLAY curves linger on load, also clear them (load rebuilds the spectrum, so likely fine — confirm in
  run-review).

### Port ledger — Phase 3
**Rule.** A `TapEntry` is detected, classified and selected once, at capture, over the full −100 dB set,
durable thereafter — nothing may re-derive it. Derived values (the averaged row) resolve selection over the
durable set (`selected_peaks`), never the Peak Min projection.

## Phase 4 — One unknown predicate  ⬜
**Rule.** A peak is unknown only when auto-classification placed it in no mode band **and** the user
has not overridden it. (Verify at port time.)

## Phase 4a — Rename `current_peaks` → `peaks_above_peak_min`  ⬜
**Rule.** The Peak-Min-filtered set is a display projection named as such
(`peaks_above_peak_min ↔ peaksAbovePeakMin`). (Follows Phase 1's projection; rename at port time.)

## Phase 5 — The selection model  ⬜
**Rule.** At most one **selected** peak per Air / Top / Back — the selected one is the *definitive* peak.
Selecting a 2nd Top displaces the 1st. `select_all_peaks` REMOVED (note: `tap_tone_analyzer.py:1309`).
Reset-to-Auto menu names the mode it restores to. (Verify at port time.)

## Phase 6 — Derived values unified  ⬜
**Rule.** Every derived "the Air/Top/Back" value reads the **definitive** peak (selected + override-aware).
(Verify at port time.)

## Phase 6b — Definitive modes for the two override-blind surfaces  ⬜
**Rule.** A comparison measurement stores its resolved definitive Air/Top/Back as **mode→peakID**
(`mode_peak_ids ↔ modePeakIDs`); older comparison files healed on decode. (Verify at port time.)

## Phase 7 — The remaining triggers  ⬜
**Rules.** (1) Guitar-type change re-derives classification + selection and clears overrides
(`reclassify_for_guitar_type_change ↔ reclassifyForGuitarTypeChange`); (2) analysis-range setting removed
(fixed 30–2000 constant); (3) new tap sequence clears per-peak state. Plus the Python GC-race teardown
audit ([[project_python_playback_gc_race]]) + the soak/stress harness deliverable. (Verify at port time.)

---

## Cross-cutting deliverables (all ports)
- **Docs:** release notes (Python repo) + in-app Help/Quick-Start (Python has one) mirror the Swift
  wording (the 3 HelpView corrections + the "Peaks & Modes" behaviours). Manual is Swift-only — nothing
  to port, but Python behaviour must MATCH it. (Swift did these as ONE docs commit at the end — mirror that.)
- **Soak/stress harness** (Phase 9 deliverable): `pytest` + `pytest-repeat` + `pytest-timeout`, skip slow
  playback; detect crashes/hangs. Mirror the Swift harness's lesson — watch for crash artifacts, not just
  the runner's exit text.

## Log
- 2026-07-23 — doc created; Phase 1 plan verified against Python code (17 write sites, not ~12).
- 2026-07-23 — **Phases 1 & 2 DONE + user-verified**, committed `6068d1a` (bundled, mirroring Swift `9f9bc89`);
  suite 532, parity 79, golden unmoved. Reformatted this doc to the Swift plan's `✅ COMPLETE` style.
- 2026-07-23 — Phase 3 plan verified against code; NOT started. **RESUME at Phase 3 step 1** (add the −100
  floor to the per-tap capture `_spectrum_capture.py:2025`, then the deletion). Nothing uncommitted in any
  repo (Swift docs, Python 1+2, and GuitarTapWeb docs all committed).