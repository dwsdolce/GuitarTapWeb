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

### The per-phase loop (THE PROCESS — follow it in order, every phase)
1. **Start from the Swift doc's `### Port ledger — Phase N` → the `Python …` subsection** in
   `PEAK-LIFECYCLE-PLAN-SWIFT.md`. That is the guidance — the map of where to look. **Plus** read the
   related **Swift code** (`git show <phase-hash>` — the diff and the surrounding source).
2. **Write the Python plan INTO THIS DOC first — the doc leads the code, never the reverse.** Verify every
   ledger claim against the *Python* source as you go (a ledger claim you can't confirm is a bug in the
   ledger — fix it here). Flip the phase header to 🟡.
3. Only then implement → counterpart tests (the slug the Swift ledger names) → `@parity` tags →
   `gen_parity_map.py --check` (zero new orphans) → golden `5c264de3941837f8` unmoved.
4. Hand the **run-review script** (already in the plan, see anatomy below) to the user. **Not done until the
   user runs it** — [[feedback_not_done_until_user_verifies]]. User does the commit (I print messages on
   screen, never to a file); mirror **Swift's commit granularity** (e.g. Phases 1+2 were one Swift commit).
5. Mark the header `✅ Phase N COMPLETE … Committed <hash>` — **the Python CODE hash only** (mirrors how the
   Swift doc records one code hash per phase; do NOT record the GuitarTapWeb docs hash — I invented that and
   it's wrong/self-referential). Add a Log line.

### Phase-entry anatomy (what a phase section contains — match the completed Phases 1–3)
Before implementing, a phase carries: a **`### Verified against the Python code <date>`** section (the
Swift→Python site mapping, confirmed against source, incl. "consumer list confirmed = N") · **`### The
work`** · **`### Tests`** (slug + which tests, pre-flight expectations) · **`### Parity / verification`** ·
**`### User verification — run-review script`** (the numbered steps that DEFINE "user-verified" — lift them
verbatim from the Swift ledger's run-review script; this is a required section, not optional).
After it lands, add the **`### ✅ Phase N COMPLETE`** block (`Changed (Python)` / `Tests` / `Run-reviewed by
the user`) and keep the **`### Port ledger — Phase N`** (the durable `Rule.`).

## Status legend
⬜ not started · 🟡 in progress · ✅ ported + tests green (NOT user-verified) · ✔️ user-run-reviewed

---

## Phase 1 — The stored set becomes the FULL set

**Goal.** Peaks are captured at the −100 dB floor and stored as the durable `all_peaks`; `current_peaks`
becomes a Peak-Min-filtered *projection* handing back the same objects, so the user sees exactly what they
see today. No visible change. **Invariant:** `all_peaks` must NEVER be assigned a filtered view.

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

**Goal.** A Peak Min change recomputes only the display projection — it detects nothing, classifies nothing,
selects nothing. Selection and classification are facts about the *measurement*; only display depends on
Peak Min. Every auto-selection / classification call site reads the durable `all_peaks`, never the display.

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

**Goal.** Each per-tap `TapEntry` is detected, classified and selected once, at capture, over the full
−100 dB set, and is durable thereafter — nothing re-derives it, least of all a display control. Derived
values (the averaged row) resolve selection over the durable set (`selected_peaks`), never the projection.

### ✅ Phase 3 COMPLETE — suite green (535), parity 79 + USER-VERIFIED (2026-07-23). Committed `a3c5f02` (mirrors Swift `11689b6`).

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

## Phase 4 — One unknown predicate

**Goal.** A peak is unknown only when auto-classification placed it in no mode band **and** the user has not
named it. **Naming a peak makes it known.** One predicate governs all three display surfaces (results panel,
dot layer, annotation badges); the annotation surface additionally applies its All/Selected/None gate. With
Show Unknown Modes on, nothing is filtered anywhere.

### ✅ Phase 4 COMPLETE — suite green (538), parity 79 + USER-VERIFIED (2026-07-23). Committed `6b6cc7d` (mirrors Swift `08c66d5`).

**Changed (Python):**
- `TapToneAnalyzer.is_unknown(peak)` (`peak_mode(peak).normalized == UNKNOWN and not has_manual_override`)
  + `overridden_peak_ids` property (`set(peak_mode_overrides.keys())` — Python stores only user-assigned
  labels, so this is the equivalent of Swift's `.assigned`-case `compactMap`).
- `GuitarMode.peaks_in_display_range` gained `overridden_peak_ids: set = frozenset()`; filter is now
  `p.id in overridden_peak_ids or is_known(...)`. Doc comment reversed (it argued the positional test belongs
  on a chart layer), mirroring Swift.
- All four consumers routed through the one predicate (consumer list **confirmed = four**, each a clean Swift
  counterpart): results panel (`tap_tone_analysis_view.py:2682`, `m != UNKNOWN` → `not analyzer.is_unknown(p)`),
  dot layer (`fft_canvas.py:1757`, passes `self.analyzer.overridden_peak_ids`), annotation badges
  (`visible_peaks`, `tap_tone_analyzer.py:1452`), export-chart legacy fallback
  (`exportable_spectrum_chart.py` `visible_peaks`, derives from `self.mode_overrides`). Dead
  `GuitarMode.UNKNOWN` import removed from the results-panel block. Behaviour-preserving for every peak
  WITHOUT an override (Python's `peak_mode` falls back to a per-frequency `classify_all` lookup, so
  `assigned == UNKNOWN` is out-of-band); unchanged entirely when Show Unknown Modes is on.

**Tests (+3, 535 → 538):** slug `view/dot-layer`, `tests/test_dot_layer.py`. DL7 rationale rewritten
(assertion holds; reason changed) + `dots_with_overrides` helper; DL8 (out-of-band peak becomes visible once
named — the change itself), DL9 (same via a real-mode relabel), DL10 (results row, dot, badge agree on a
user-named peak). Parity 79; golden `5c264de3941837f8` unmoved.

**Verified-not-assumed:** `@parity` tags are file-level (nothing per-member to add); the consumer list is
four (Swift warned it might not be).

**Run-reviewed by the user 2026-07-23 — verified; found ONE issue, DEFERRED to Phase 5 → ✅ RESOLVED in
Phase 5** (the real root was the mode-override routing gap: naming a peak never reached
`analyzer.set_mode_override`, so the analyzer's override/classification was inconsistent across the toggle;
Phase 5's `modeOverrideChanged` routing fixed it). Original capture: with Show Unknown Modes off, give a
selected Top peak a custom mode label, then toggle Show Unknown Modes → the peak is **deselected** in the UI.
Root-caused: the analyzer's `selected_peak_ids`
survives the whole sequence (proven by a model-level repro); the deselection is a **Qt view-layer sync**
limitation in the peak-widget rebuild, which Phase 4 merely made *reachable* (before Phase 4 a
freeform-labelled peak was hidden with the setting off). Swift is immune (SwiftUI derives the star from
`selectedPeakIDs`). This is Phase-5 territory — see the note under Phase 5. Phase 4's predicate itself is
correct and green.

### Port ledger — Phase 4
**Rule.** A peak is unknown only when auto-classification placed it in no mode band **and** the user has not
named it. Naming a peak makes it known. One predicate governs all three display surfaces (results panel, dot
layer, annotation badges); the annotation surface additionally applies its All/Selected/None gate. With Show
Unknown Modes on, nothing is filtered anywhere.

**Run-review script (from the Swift ledger; note the two-step shape) — this is the definition of "user-verified":**
1. Show Unknown Modes **on**; name an out-of-band peak (the Back/Dipole gap is the easiest). Row, dot and
   badge all present.
2. Show Unknown Modes **off**. The named peak **stays** — all three surfaces. *This is the change.*
3. Repeat with a real mode name ("Top") instead of a freeform label — same outcome.
4. Setting off: an **in-band** custom-labelled peak shows everywhere (the table row is the part that used to
   be missing).
5. Setting off: an **unnamed** out-of-band peak is still hidden everywhere — the filter still works.
6. Setting on: everything appears, exactly as before the phase.

## Phase 4a — Rename `current_peaks` → `peaks_above_peak_min`

**Goal.** The Peak-Min-filtered set is a display projection named as such (`peaks_above_peak_min ↔
peaksAbovePeakMin`), not "the peaks". Every question *about the measurement* — save, selection,
classification, per-peak state carry-forward, whether a measurement exists — reads the durable
`all_peaks`; only display reads the projection.

### ✅ Phase 4a COMPLETE — suite green (539), parity 79 + USER-VERIFIED (2026-07-23). Committed `b406690` (mirrors Swift `f5fd2ce`; merged with the select_peak crash fix).

**Python's 4a was much lighter than Swift's** — Phase 2 corollary B + the Phase-1
`guitar_full_save_peaks()` already routed most of Swift's seven-site audit to the durable set. Already
correct, NOT re-touched: the offset/override/prev-selected snapshots (`all_peaks` since Phase 2), the
saved `selected_peak_frequencies` + material persist (over `guitar_full_save_peaks` = `all_peaks`), and
the Save guard (gated on `set_measurement_complete`, never peaks-visible).

**Changed (Python):**
- **Rename** `current_peaks` → `peaks_above_peak_min` (~50 model refs + view/test refs) with a 3-scope
  doc comment (`all_peaks` = measurement · Peak Min = a setting · viewport dot set = the view). Two
  view-local sets renamed with it: `fft_canvas._current_peaks` → `_all_peaks_in_range` (the viewport
  dot set, index-aligned for click hit-testing = Swift's `SpectrumView.allPeaksInRange`); the results
  cache `_current_peaks_all` → `_peaks_above_peak_min`.
- **Four fixes** (a fact resolved over the durable set): the three load-path selection restores
  (material `:667`, no-saved-selection `:671`, frequency-cache seed `:679`) → `all_peaks`; the multi-tap
  comparison averaged row (`:921`) → the shared `selected_peaks` property; `select_all_peaks` →
  `all_peaks` ("all" means all; removed in Phase 5); `guitar_mode_selected_peak_ids` docstring corrected
  (code was already `all_peaks`).
- **select_peak crash fix** (pre-existing, unrelated to the rename): `saved_peaks` is populated only on
  load, so clicking a peak after a LIVE capture raised `IndexError` on an empty lookup. Now resolves the
  highlight magnitude from the dot set (live + loaded), falls back to `saved_peaks` (out-of-viewport
  results-panel selection), and guards the no-match case.

**Tests (+1, 538 → 539):** new `test_reanalyze_preserves_state_of_peaks_hidden_by_peak_min`, driven
through a new `_gaussian_spectrum` / `_freeze_on_real_spectrum` fixture (faithful ports of Swift's
`gaussianSpectrum` / `freezeOnRealSpectrum`) so real `find_peaks` detection runs and the test can't pass
vacuously on the flat-spectrum trap; it asserts its own preconditions. The select_all / none-mode tests
rewritten to select explicitly (not via `select_all`, removed in Phase 5) + reseeded over `all_peaks`; the
two `current_peaks` test names updated. Parity 79; golden `5c264de3941837f8` unmoved. **Follow-up logged**
(STATUS 14 / `FROZEN-RECALC-TEST-PARITY.md`): Python's frozen-recalc tests drive real detection where Swift
injects peaks — same slug, divergent approach, which `--check` misses.

**Run-reviewed by the user 2026-07-23:** Re-analyze preserves a dragged badge + custom name on a
Peak-Min-hidden peak; Save enabled with everything hidden (file reloads complete); Save disabled before a
measurement exists; clicking a peak after a live capture highlights instead of crashing.

### Port ledger — Phase 4a
**Rule.** The Peak-Min-filtered set is a display projection named as such (`peaks_above_peak_min`), not
"the peaks". Every question about the measurement — save, selection, classification, per-peak
carry-forward, whether a measurement exists — reads the durable `all_peaks`.

**Run-review script (from the Swift ledger):**
1. Re-analyze a frozen measurement with a dragged badge + custom mode name on a peak **hidden by Peak
   Min** → both survive.
2. Freeze with Peak Min hiding everything → **Save is enabled**; the saved file reloads complete.
3. Before any measurement exists → **Save is disabled**.

## Phase 5 — The selection model

**Goal.** Classification and selection are **independent**. Classification is band membership (+ any
override) — **many peaks per mode**; deselecting never relabels. Selection is which candidate is
**definitive**. **Invariant: at most one selected peak per Air / Top / Back**; Dipole / Ring / Upper are
unconstrained (clusters). Enforced as invariant maintenance in ONE place, called from selecting a peak and
from changing the mode of an already-selected peak. **No auto-promotion.** Mode resolved via the
override-aware `peak_mode`, not `identified_modes`.

### ✅ Phase 5 COMPLETE — suite green (544), parity 79 + USER-VERIFIED (2026-07-23). Committed `<hash>` (mirrors Swift `5836489` + the reset-label fix).

**Changed (Python):**
- **`enforce_definitive_mode_uniqueness(preferring)` + `single_holder_modes` {AIR, TOP, BACK}** — faithful
  port of Swift's (guitar-only; resolve `peak_mode(winner).normalized`; deselect other selected peaks of
  that mode; never reclassify, never promote). Called from `toggle_peak_selection` (select branch) and
  `set_mode_override`.
- **Select All removed** — model `select_all_peaks`, the button, its connect, the `_on_select_all_peaks`
  handler, and the enable/visible lines. Select None kept.
- **Reset-to-auto label — a REAL bug here, not just divergence.** Added `TapToneAnalyzer.auto_detected_mode`
  (override-blind: `identified_modes` → `classify_all` → UNKNOWN) and routed the label through it via a new
  `PeaksModel._analyzer` back-ref. The old `PeaksModel.peak_mode` read the override-AWARE `_auto_mode_map`
  (it drives mode colours), so "Reset to Auto-Detected (X)" showed the *current* label — verified against the
  code, not the docstring, which lied.
- **Mode-override routing (Qt vs `@Published`) — the two-Top fix.** The live card mode change wrote only the
  view-model (`model.modes`), never `analyzer.set_mode_override`, so `enforce` never ran (relabelling a
  selected Air→Top left TWO selected Tops) AND the analyzer's override state was bypassed. New
  `modeOverrideChanged` signal routes it through the analyzer → `set_mode_override` → `enforce` →
  `peaksChanged`, mirroring the Phase 2 selection routing. **This also resolved the Phase-4-deferred
  Show-Unknown deselection bug** — the override now reaches the analyzer, so classification/selection stay
  consistent across the toggle.
- **Dot-click star.** `canvas.peakSelected` was wired only to `peak_widget.select_row` (table row), never
  `_on_peak_selected` (which draws the graph's red-star `selected_point`). Added the connection so a dot
  click marks the star exactly as a table click does.

**Tests (slug `test/annotation-state`):** new `DefinitiveModeUniqueness` D11–D16 + `auto_detected_mode_ignores_override`;
deleted the two select-all tests (feature gone); the select-none / none-mode tests select explicitly (Phase 4a).
Suite 544; parity 79; golden `5c264de3941837f8` unmoved.

**Not-in-the-original-plan, found in run-review:** the mode-override routing gap and the dot-click wiring gap
were both Qt-vs-SwiftUI view-layer omissions (Phase 2 had routed *selection* through the analyzer but not
mode overrides). The reset-label was a genuine bug, not merely a structural divergence.

**Run-reviewed by the user 2026-07-23:** all consistent with Swift — selecting a 2nd Top displaces the first
(still classified Top); Dipole allows several; overriding a selected peak into Top displaces the holder;
overriding it away leaves Top holderless; "Reset to Auto-Detected" names the auto mode; dot click marks the
star; and the previously-deferred Show-Unknown deselection is gone.

### Port ledger — Phase 5
**Rule.** At most one **selected** peak per Air / Top / Back — the selected one is the definitive Air/Top/Back;
every other peak of that mode is a candidate. Classification is independent (many per mode) and unaffected by
selection; deselecting never relabels. Dipole/Ring/Upper are unconstrained. Enforced in one place, called on
selecting a peak and on changing the mode of an already-selected peak; no auto-promotion; mode resolved
override-aware. `select_all` removed; Select None kept. The reset-to-auto label names the override-blind auto
mode.

**Run-review script (from the Swift ledger):**
1. Select a Top, then a second Top → first deselects, still labelled Top.
2. Dipole/Ring/Upper: several stay selected.
3. Override a selected peak into Top → displaces the definitive Top; override it away → Top holderless.
4. "Reset to Auto-Detected (X)" names the **auto** mode, not the overridden one.

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
- 2026-07-23 — **Phase 3 DONE + user-verified** ("All verified"), committed `a3c5f02` (mirroring Swift
  `11689b6`); suite 535, parity 79. Run-review surfaced the multi-tap-Taps-lingers
  -on-single-tap-load bug — a Python-only view-reset gap (SwiftUI hides the Taps table reactively off
  `showing_multi_tap_comparison`, Qt does not); first fix (before-load, `isVisible()`-gated) was ineffective,
  v2 (unconditional reset AFTER `load_measurement`) verified. **RESUME at Phase 4** (one unknown predicate):
  Swift `08c66d5` adds `TapToneAnalyzer.is_unknown(peak)` + `overridden_peak_ids`, threads
  `overridden_peak_ids` through `GuitarMode.peaks_in_display_range`, routes all 4 consumers (results table,
  dot layer `fft_canvas:1757`, annotation badges, legacy fallback `exportable_spectrum_chart:228`) through the
  one predicate. Python targets already located: `analyzer:1452`, `guitar_mode:430`, `fft_canvas:1757`,
  `exportable_spectrum_chart:228`.
- 2026-07-23 — **Phase 4 DONE + user-verified** (suite 538, parity 79, golden unmoved), mirrors Swift
  `08c66d5`. Predicate `is_unknown` + `overridden_peak_ids`; `peaks_in_display_range` param + doc reversal;
  four consumers converted; DL7 rewritten + DL8–DL10. Run-review surfaced ONE issue, **DEFERRED to Phase 5**
  (not a Phase 4 defect): toggling Show Unknown Modes deselects a custom-labelled selected peak — a Qt
  view-layer sync bug exposed (not caused) by Phase 4; the model keeps `selected_peak_ids` (proven by repro);
  Swift immune via SwiftUI. Logged under Phase 5 to verify-fixed there. **Commit pending** (user commits code;
  header hash filled in after). **RESUME at Phase 4a** (rename `current_peaks` → `peaks_above_peak_min`).
- 2026-07-23 — **Phase 4a DONE + user-verified**, committed `b406690` (mirrors Swift `f5fd2ce`; merged with a
  pre-existing `select_peak` live-capture crash fix). Much lighter than Swift's — Phase 2 + Phase 1 already
  did most of the seven-site audit; only the rename (+ `_current_peaks`→`_all_peaks_in_range`,
  `_current_peaks_all`→`_peaks_above_peak_min`), four load-path/comparison fixes, `select_all`→`all_peaks`,
  and the new reanalyze test on the mirrored `_gaussian_spectrum` fixture. Logged the Python↔Swift
  frozen-recalc test-fixture divergence (STATUS 14 / `FROZEN-RECALC-TEST-PARITY.md`). **RESUME at Phase 5**
  (the selection model). *(Doc marked complete after the code+docs commits — sequencing to fix next phase:
  mark complete BEFORE handing over the commit messages.)*