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

## Phase 1 — The stored set becomes the FULL set  🟡 (code + verification DONE 2026-07-23; mirror durability tests pending)

**Step 3 DONE:** `guitar_full_save_peaks()` collapsed to `return list(self.all_peaks)` (mirrors Swift
`{ allPeaks }`; deleted the re-detect-and-append dance). Updated the two ledger-named tests to the new model
(`TestGuitarFullSavePeaks._prep` seeds `all_peaks` with the full −100 set = fresh capture;
`test_loaded_measurement_is_not_upgraded` sets `all_peaks = displayed` = a loaded durable set that is NOT
re-detected). **Verification: suite 530 passed / 7 deselected; parity `--check` clean (79 groups); golden
`peak-baseline-expected.json` unmoved (`test_peak_fixture_regression` green).** Parity tool lives in the
SWIFT repo (`GuitarTap/Tooling/parity/gen_parity_map.py`), not the Python repo.

**REMAINING for Phase 1:** port the Swift **`PeakMinDurabilityTests`** (new suite, ~5 tests, pinned generic) —
the new-capability proof (full set saved to −100; lowering Peak Min reveals a sub-Peak-Min Air peak; hidden
peak returns with same id). NOTE: the *sweep-preserves-offset/override/selection* durability test belongs to
**Phase 2** (Peak Min still triggers recalc until Phase 2 decouples it).

**Step 1 DONE (additive, no behaviour change yet):** added `self._all_peaks` (durable) + an `all_peaks`
property whose setter calls `refresh_displayed_peaks()` (mirrors Swift `allPeaks` `@Published` + `didSet`),
and `refresh_displayed_peaks()` (mirrors `refreshDisplayedPeaks()` — guitar filters by `peak_min_threshold`,
material passes `all_peaks` through). Uses `self._tds.measurement_type().is_guitar` (`_tds` is a per-method
local elsewhere; instance ref is the safe one post-init). `PEAK_DETECTION_FLOOR = -100.0` already existed on
the PeakAnalysis mixin. Fast suite: **530 passed, 7 deselected**.

**Step 2 DONE (16 durable-set conversions; suite still 530 green):** converted the `current_peaks =` writes
to `all_peaks =` at all capture/detect/load/clear/material-accept sites, mirroring Swift's `allPeaks =`
sites. Non-trivial ones: loaded recalc branch + `_emit_loaded_peaks_at_threshold` now assign the FULL saved
set (removed the `>= peak_min` pre-filter — the data-loss trap) and emit the projection; live-tap frozen
re-detect + guitar-averaged capture now pass `peak_min_override=self.PEAK_DETECTION_FLOOR`. LEFT: the guitar
LIVE path keeps `live_threshold` (Swift captures the full set at freeze, not the live FFT path); and
`_emit_peaks_array` (`_spectrum_capture.py:2078`) keeps its no-op `current_peaks = peaks` passthrough (always
called with `self.current_peaks`). Only `refresh_displayed_peaks` (`tap_tone_analyzer.py:999`) and that
passthrough still assign `current_peaks`. Green passed because fixtures' peaks sit above the default Peak Min
(projection == full), so **step 3's durability test is what actually proves the new capability**.

**NEXT — step 3:** collapse `guitar_full_save_peaks()` → `all_peaks`; add `test_peak_min_durability`
(offset+override+selection survive a Peak Min sweep past a peak); reseed full set in peak-finding prep;
`gen_parity_map.py --check` (zero new orphans) + golden `5c264de3941837f8` unmoved.

**Rule.** Detection stores the FULL peak set (fixed −100 dB floor at capture). Peak Min never reaches
detection; it is applied afterward as a projection handing back *the same peak objects*. Auto-selection
at freeze runs over the full set.

**Swift reference.** `allPeaks` (durable) added; `currentPeaks` → derived `@Published private(set)`
projection via `refreshDisplayedPeaks()`; `peakMinOverride: peakDetectionFloor` at capture sites only;
`guitarFullSavePeaks()` collapsed to `allPeaks`.

**Python — VERIFIED against code 2026-07-23 (corrects the Swift ledger's "~12 sites"):**
- No durable set today — `current_peaks` (`tap_tone_analyzer.py:278`, `= []  # mirrors currentPeaks`)
  IS the working set.
- **17 analyzer write sites** (`current_peaks =`), not ~12:
  - `_spectrum_capture.py`: 1493, 1510, 1672, 1784, 1978, 2074 (guitar + material capture)
  - `_peak_analysis.py`: 87, 181, 186, 228, 233, 854
  - `_control.py`: 349, 728, 997, 1051
  - `_measurement_management.py`: 491 (load)
- `views/fft_canvas.py:1763/1768` write `_current_peaks` — a **view-local** variable, NOT the
  analyzer's set. Out of scope for Phase 1.
- `guitar_full_save_peaks()` (`_measurement_management.py:191`, caller :321) collapses to `all_peaks`.

**Python plan.**
1. Add `self.all_peaks: list = []` (durable) beside `current_peaks`.
2. `refresh_displayed_peaks()` (mirror `refreshDisplayedPeaks`): `current_peaks = [p for p in all_peaks
   if p.magnitude >= peak_min_threshold]` for guitar, `= all_peaks` for material.
3. Convert the 17 write sites: detection/capture write `all_peaks` then re-project; clears clear both.
4. Detection floor: pass the −100 floor at the capture/detect calls only.
5. Collapse `guitar_full_save_peaks()` → `all_peaks`.

**Guardrail (ledger's hard-won trap).** `all_peaks` must NEVER be assigned a filtered view — it shrinks
the durable set as Peak Min rises and the save path reads it (real data loss). Two recalc branches
present this temptation.

**Tests.** New `test_peak_min_durability` (mirror `PeakMinDurabilityTests`, pinned generic); reseed the
full set in peak-finding test prep; frozen-recalc integration tests. Parity slug `test/frozen-peak-recalc`.
Golden `5c264de3941837f8` unmoved.

---

## Phase 2 — Peak Min becomes a pure filter *(core change)*  🟡 (A–E DONE 2026-07-23, suite 532 / parity 79; C user-verified; needs a final run-review of the peak_min property change)

**E DONE + `peak_min_threshold` made a property (didSet mirror):**
- Converted `peak_min_threshold` to a `@property` whose setter calls `refresh_displayed_peaks()` — mirrors
  Swift `@Published var peakMinThreshold { didSet { refreshDisplayedPeaks() } }` and matches the `all_peaks`
  precedent. Init sets the `_peak_min_threshold` backing field directly (Swift `didSet` doesn't fire on init;
  a Python setter would, before `_all_peaks` exists). Persistence + the `peaksChanged` emit stay at the call
  sites (Python `current_peaks` isn't signal-backed, so emitting in the setter would fire prematurely during
  capture/load). `set_threshold` (fft_canvas + control) folded down to `peak_min_threshold = …` + emit.
- **Tests:** inverted `PRA4` (`..._clears_display_keeps_durable_set` — display empties, `all_peaks` survives);
  added `TestPeakMinDurability` — the sweep test (identity/selection/override/offset survive a Peak Min sweep,
  driving `peak_min_threshold =` directly now that it re-projects) + the deselect-survives-slider guard.
  **532 passed** (+2), parity clean (79), golden unmoved.
- **D = CLOSED (verified at code level, not assumed):** Swift's `frozenPeakPosition` was DELETED in Phase 2
  (freezing the dot endpoint was the bug); the non-divergent target is its absence. Python's leader line
  (`peak_annotations._update_arrow`) already draws from the LIVE peak coords (`_peak_freq`/`_peak_mag`) to the
  dragged label — no frozen peak. Swift also keeps `frozenChartPosition` (freezes the LABEL anchor so a
  mid-drag axis change doesn't move it) — a SwiftUI mechanism (positions recomputed from data each render).
  Python has no analog because `update_annotation` NEVER repositions an existing on-screen label (the
  `idx >= 0` branch only updates html/color/pen — no `setPos`); the saved offset is applied ONLY in the
  new-annotation `else` branch. So the `sigXRangeChanged → peaksChanged → update_annotation` path leaves a
  being-dragged label untouched, and the label (a data-coord `pg.TextItem`) stays put across a range change.
  No `frozen_peak_position` and no `frozen_chart_position` needed — framework-forced view-layer divergence,
  allowed by the porting rules.
- **Annotation "Reset Position" PARITY FIX (run-review find, 2026-07-23; pre-existing bug, compare-to-Swift):**
  Python conflated the annotation's default with its saved offset — `create_annotation` set
  `_default_pos = xy_text`, and `refresh_annotations` always `clearAnnotations`+rebuilds, so after any rebuild
  of a moved label (reset-to-auto, pan/zoom, mode-change) `_default_pos` became the DRAGGED position →
  "Reset Position" disabled + reset-to-saved-offset. Swift bases `isMoved` on `offset != .zero` and
  `calculateChartPosition()` always ignores the offset; reset = `resetAnnotationOffset(for:)`. FIX (mirrors
  Swift): `_default_pos` is now the computed default `(freq, mag + _LABEL_OFFSET_DB)` always; "Reset Position"
  calls `analyzer.reset_annotation_offset(peak_id)` (pops the stored offset, mirroring Swift's `removeValue`)
  + moves to the true default, so it survives the next rebuild. Threaded `peak_id`/`analyzer` into
  `create_annotation`→`connect_arrow`→`DraggableTextItem`. Suite 532 + 46 annotation tests green.
  **✔️ USER-VERIFIED 2026-07-23** (move label → reset-to-auto → Reset Position still enabled + returns to default).
- **Owed:** re-confirm the Peak Min **sweep** + selection still work after the `peak_min_threshold` property
  conversion (the annotation fix is verified; the sweep re-check is the one item not explicitly reconfirmed).

**A follow-up FIX (user run-review found it):** decoupling A swapped `recalculate_frozen_peaks_if_needed()`
(which ended by emitting `peaksChanged`) for `refresh_displayed_peaks()` (which emitted nothing) — so a Peak
Min sweep re-projected but the view never redrew ("no peaks come or go"). Python `current_peaks` is a plain
attr, not Swift's `@Published peaksAbovePeakMin`, so it needs an explicit emit. Fixed: `set_threshold`
(`fft_canvas.py` + `control.py`) now emits `peaksChanged(current_peaks)` AFTER `refresh_displayed_peaks()`.
Deliberately NOT inside `refresh_displayed_peaks()` (would fire premature emits during capture). **User-verified:
lower Peak Min reveals fainter peaks, raise hides; toggle/select-all/none route through the analyzer; deselect
survives a Peak Min sweep.**

**Verified decouple map (2026-07-23):** the LIVE Peak Min slider is `_on_peak_min_changed` →
`fft_canvas.set_threshold` (VIEW `:1686`, which sets `peak_min_threshold` at `:1689`) → recalc at `:1698`.
The model `control.py:1105 set_threshold` is a parallel path (not called from views). `fft_canvas:1364`
= x-axis RANGE (Phase 7), `view:7006` = Settings-apply (Phase 7 reshapes), `_emit_loaded_*` calls = C.

**A — decouple DONE:** `control.py:1105` and **`fft_canvas.py:1698`** recalc → `refresh_displayed_peaks()`
(the live slider now re-projects, never re-detects). Mirrors Swift `peakMinThreshold.didSet`.
**B — corollary DONE:** `current_peaks` → `all_peaks` at recalc snapshot (offsets/overrides/prev-selected),
`reset_to_auto_selection`, `guitar_mode_selected_peak_ids` default, `reclassify_peaks` (classify input +
identified_modes comprehension; emit stays projection). One test reseeded (`test_D3b_reset_to_auto…` →
`all_peaks`), same pattern as Phase 1. **530 passed, parity clean (79), golden unmoved.**

**REMAINING:**
- **C — CORE DONE 2026-07-23 (view-layer; NEEDS RUN-REVIEW — Qt wiring not unit-tested):**
  routed selection through the analyzer, mirroring Swift's row `onToggleSelection`.
  - `peaks_model.py`: new `selectionToggled(str)` signal, emitted from `set_show_value` on a USER toggle
    (skipped for programmatic bulk updates via `_programmatic_update`).
  - `tap_tone_analysis_view.py`: connect `selectionToggled` → `_on_peak_selection_toggled` →
    `analyzer.toggle_peak_selection(id)` + `peaksChanged.emit`; `_on_select_all/deselect_all` now route to
    `analyzer.select_all_peaks()` / `select_no_peaks()` + emit (were widget-local). The existing push-over
    (`view:2617`) syncs the widget model back from the analyzer — no longer discards the user's choice.
  - **NO incremental `selected_peak_frequencies` cache maintenance** — superseded by the A decoupling
    (verified Swift's `togglePeakSelection` keeps no cache); doc updated.
  - **LEDGER CORRECTION:** `_emit_loaded_peaks_at_threshold` is the **LOAD path** (`fft_canvas:767` def
    "called by guitar_tap.py after loading"; `view:4514` load-restore), **NOT** a Peak-Min trigger — the
    Swift Phase 2 ledger's claim that "Peak Min reaches peaks through `_emit_loaded_peaks_at_threshold`" is
    inaccurate. No redirect needed (C-3 was a non-item; verified before acting).
  - **Still owed:** run-review (toggle a peak in the table → analyzer selection + annotations update; select
    all/none; deselect survives a Peak Min sweep).
- **D:** annotation leader-line — mirror Swift `frozenPeakPosition` removal (freeze only the label anchor).
- **E (tests):** rework `test_frozen_peak_recalculation.py` (invert `PRA4` → display empties but
  `all_peaks`+`identified_modes` survive; adjust `PRA2/PRA3`); add the `PeakMinDurability` sweep suite +
  deselect-survives-slider parity case.

**(original stub rule/refs below)**

**Rule.** A Peak Min change recomputes the display projection and mutates nothing else. Detection,
classification and selection are facts about the *measurement*; only display depends on Peak Min.
**Corollary:** every auto-selection and classification call site must read the DURABLE set, never the
displayed one.

**Swift ref.** `peakMinThreshold.didSet` → `refreshDisplayedPeaks()` only; `allPeaks` at the four
selection/classification sites; `frozenPeakPosition` removed. `applyFrozenPeakState`,
`selectedPeakFrequencies`, the re-detect branch are all **KEPT** (they serve load + explicit Re-analyze).

**Python (to verify at port time).** Peak Min reaches peaks via `recalculate_frozen_peaks_if_needed()`
(`_peak_analysis.py:120`) and `_emit_loaded_peaks_at_threshold()` (`:826`). Decouple: a threshold change
re-emits the projection only. **Prerequisite:** Python's selection UI is NOT routed through the analyzer
— see `PEAK-SELECTION-SURVIVES-SLIDER.md`; `views/fft_canvas.py` is held uncommitted because it is
rewritten here. `_apply_frozen_peak_state` + selection cache (`_measurement_management.py:702`) are KEPT.

---

## Phase 3 — Per-tap entries computed once  ⬜
**Rule.** A `TapEntry` is detected, classified and selected **once, at capture**, over the full −100 dB
set. (Detail + Python sites to verify at port time.)

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
  to port, but Python behaviour must MATCH it.
- **Soak/stress harness** (Phase 9 deliverable): `pytest` + `pytest-repeat` + `pytest-timeout`, skip slow
  playback; detect crashes/hangs. Mirror the Swift harness's lesson — watch for crash artifacts, not just
  the runner's exit text.

## Log
- 2026-07-23 — doc created; Phase 1 plan verified against Python code (17 write sites, not ~12); porting
  discipline recorded. Awaiting go on Phase 1 implementation.