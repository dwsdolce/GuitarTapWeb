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
- **Every completed phase carries a Port ledger, written the SAME turn the phase lands.** Not
  reconstructed at Phase 8 — by then the reasoning is buried under several compactions. Swift *code*
  does not port; the **rule** and the **test list** do. Four fields, no more:
  1. **Rule** — one platform-independent sentence. This is what Python and the web implement.
  2. **Swift** — the symbols changed.
  3. **Python / web counterparts** — looked up *now*, while the context is live. Name the symbol even
     when the answer is "doesn't exist yet"; that absence *is* the port work.
  4. **Tests** — added / deleted / inverted, with the `@parity` slug. Python's turn then reduces to
     "make these named tests exist and pass", and `gen_parity_map.py --check` flags any that never got
     twins. A missed port becomes a build-visible orphan instead of a bug found in six months.
- **Spec corrections go into the spec.** When a phase discovers [PEAK-LIFECYCLE-SPEC.md](PEAK-LIFECYCLE-SPEC.md)
  was wrong (Phase 1 already amended it — live path stays cheap at Peak Min), amend the spec, not just
  the phase notes. The spec is the artifact Python and the web are built against.

---

## Cross-platform anchor map

The counterpart lookup, done once. Phase ledgers reference these rather than repeating them.

| Concept | Swift | Python | Web |
|---|---|---|---|
| Durable full set | `allPeaks` (`TapToneAnalyzer.swift`) | **none** — `current_peaks` (`tap_tone_analyzer.py:278`) is the only set | **none** |
| Display projection | `currentPeaks` + `refreshDisplayedPeaks()` (`TapToneAnalyzer.swift:387`) | **none** | `recalculatePeaks` (`state/tapToneAnalyzer.ts:305`) |
| Peak Min trigger | `peakMinThreshold.didSet` (`TapToneAnalyzer.swift:231`) | `recalculate_frozen_peaks_if_needed()` (`…_peak_analysis.py:120`) | `useLayoutEffect` dep array (`App.tsx:512-514`) |
| Loaded-peak branch | `recalculateFrozenPeaksIfNeeded` (`+PeakAnalysis.swift:206`) | `_emit_loaded_peaks_at_threshold()` (`…_peak_analysis.py:826`) | `p.loadedPeaks.filter(magnitude >= peakMin)` (`tapToneAnalyzer.ts`) |
| Detection floor | `peakDetectionFloor` (−100) via `peakMinOverride:` | `find_peaks(peak_min_override=)` (`…_peak_analysis.py:389,443`) | `peakMinOverride ?? peakMinThreshold ?? -60` (`dsp/peaks.ts:178`) |
| ±5 Hz carry-forward | `applyFrozenPeakState` (`+PeakAnalysis.swift:495`) | `_apply_frozen_peak_state` (`…_peak_analysis.py:116`) | **none** — peaks are re-minted, per-peak state is simply lost |
| Selection cache | `selectedPeakFrequencies` (`TapToneAnalyzer.swift:618`) | `…_measurement_management.py:702` | **none** |
| Full save set | `guitarFullSavePeaks()` (`+MeasurementManagement.swift`) | re-detect-and-append (`…_measurement_management.py:198-222`) | **none** |

**The structural warning this map surfaces:** the web reaches the same defect by a different
mechanism. `peakMin` sits in the **dependency array** of the recompute effect, so a slider tick
re-runs `findPeaks` on the frozen spectrum and mints new peak objects — and because the web has no
carry-forward remap at all, offsets and overrides keyed by peak id are destroyed outright rather than
approximately preserved. The web port is therefore *not* a transcription of the Swift diff: it is
"remove `peakMin` from the recompute inputs, apply it in a separate display selector." Same rule,
different surgery.

---

## Phase 0 — Safety net (no production change)

**Goal:** be able to prove nothing drifted.

1. Record a baseline: full Swift suite, `PeakFixtureRegressionTests`, and the playback-validation
   harness output (`Development/playback-validation/`).
2. Confirm the golden fixture set and `peak-baseline-expected.json` hashes, so any later change to
   them is caught deliberately rather than noticed late.

**Exit:** baseline captured and recorded in this doc.

### ✅ Phase 0 COMPLETE — baseline recorded 2026-07-21

| Item | Value |
|---|---|
| Swift suite | **418 passed**, 93 suites, EXIT 0 (`xcodebuild test -scheme guitar_tap -destination 'platform=macOS'`) |
| Golden peak baseline | `peak-baseline-expected.json` = **`5c264de3941837f8`** — byte-identical in all 3 repos. **If this moves, STOP.** |
| Shared fixtures | all `.guitartap` fixtures now hash identically across the 3 repos |
| Python suite | 535 passed (unchanged by Phase 0) |

**Found and fixed during Phase 0:** the `contreras-classical` fixture had drifted — Python's copy
still used the pre-rename `tapLocation` key while Swift/web used `measurementName`, so the shared
`test/measurement-codable` parity fixture was not actually shared and the three platforms exercised
different decode branches. Fixture aligned (all now `9472da20a5e84ba1`) and the legacy fallback
pinned deliberately on all three (it had been covered only by that accident). Committed separately:
Swift `c38f6f4`, Python `098b12c`, web `67545e1`.

**Note on the scheme:** it is `guitar_tap` (lower-case), not `GuitarTap`. A stale DerivedData
signature caused a spurious `CodeSign ... code object is not signed at all` build failure mid-Phase-0;
`xcodebuild clean` cleared it.

**Playback-validation harness:** deliberately NOT baselined. It is slow, manual, needs the WAV corpus,
and Phases 1–2 do not change detection *results* — only when detection runs. Run it only if the
golden baseline moves, or at Phase 8.

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

### ✅ Phase 1 COMPLETE — suite green (418) + USER-VERIFIED invisible (2026-07-21). Committed `9f9bc89`.

**Design chosen (Option B of two):** add `allPeaks` as the durable set; `currentPeaks` becomes
`@Published private(set)` and *derived* — `allPeaks` filtered by Peak Min, handing back **the same
`ResonantPeak` objects** so filtering can never disturb identity. Rejected Option A (make
`currentPeaks` the full set) because it silently changes the meaning of a property with **70 read
sites**; Option B has 17 **compiler-checked** write sites instead. The compiler duly found two
assignments a regex had missed.

**THE INVARIANT — do not break it:** `allPeaks` is ALWAYS the durable full set. It must never be
assigned a filtered view. I did exactly that in both `recalculateFrozenPeaksIfNeeded` branches and it
was a real **data-loss** defect: the durable set shrank as Peak Min rose, and since the save path now
reads `allPeaks`, saving after raising the slider would have written fewer peaks. Caught by
`loadedMeasurementIsNotUpgraded`. Both branches now set `allPeaks` whole and take
`let peaks = currentPeaks` for the legacy downstream remapping — which keeps Phase 1 behaviourally
invisible instead of dragging Phase 2 forward.

**Changed (Swift):**
- `TapToneAnalyzer.swift` — `allPeaks` + derived `currentPeaks` + `refreshDisplayedPeaks()`;
  `peakMinThreshold.didSet` re-projects before calling the recalc.
- Detection floor → `peakDetectionFloor` (−100) at the CAPTURE sites only:
  `+SpectrumCapture.swift` gated capture / `processMultipleTaps` (freeze) / per-tap entries, and the
  recalc's live-frozen branch. **Live path (`+PeakAnalysis.swift:110`) and material (adaptive median)
  deliberately unchanged** — per the spec amendment, live stays cheap.
- `guitarFullSavePeaks()` collapsed to `allPeaks` (the re-detect-and-append dance is redundant, and
  it minted throwaway UUIDs).
- 17 write sites `currentPeaks =` → `allPeaks =`.
- Tests: `.allPeaks` for setup in 4 files; `prep()` in `PeakFindingTests` now seeds the FULL set;
  `loadedMeasurementIsNotUpgraded` simulates load properly; 3 more tests in
  `RecalculateFrozenPeaksIntegration` pinned to `.generic` (Peak Min filtering is guitar-gated now,
  so they were relying on inherited global state).

**Verified:** production build EXIT 0; test build EXIT 0; **full suite 418 passed, 0 issues**;
**golden baseline UNMOVED — `5c264de3941837f8` in all 3 repos** (the key Phase 1 criterion:
detection is unchanged, only its timing).

**Run-reviewed by the user: "I see no changes."** — which is exactly the pass condition for a
phase whose whole purpose is to be behaviourally invisible.

**Committed** with Phase 2 in a single Swift commit, `9f9bc89` (they had become entangled by the time
either was ready). Still held back deliberately, and unrelated to this phase:
`guitar_tap/src/guitar_tap/views/fft_canvas.py` — it is rewritten by the Python port (Phase 9).

### Port ledger — Phase 1

**Rule.** Detection stores the FULL peak set, found at a fixed −100 dB floor at capture time. Peak Min
never reaches detection; it is applied afterwards as a projection that hands back *the same peak
objects*, so filtering can never disturb identity. Auto-selection at freeze runs over the full set.

**Swift.** `allPeaks` added as the durable set; `currentPeaks` demoted to a derived
`@Published private(set)` projection via `refreshDisplayedPeaks()`; `peakMinOverride:
peakDetectionFloor` at the capture sites only; `guitarFullSavePeaks()` collapsed to `allPeaks`.

**Python.** No durable set exists — `current_peaks` (`tap_tone_analyzer.py:278`) *is* the working set,
written from ~12 sites across `_control`, `_spectrum_capture`, `_measurement_management`. The port is
the same Option B split: add `all_peaks`, make `current_peaks` a read-only projection, then convert
each write site. Unlike Swift there is **no compiler** to enumerate them — so grep `current_peaks =`
and `self.current_peaks` and work the list explicitly; this is the highest-risk part of the Python
port. `guitar_full_save_peaks` equivalent (`…_measurement_management.py:198-222`) collapses the same
way, deleting the re-detect-and-append dance.

**Web.** Also no durable set. `recalculatePeaks` (`tapToneAnalyzer.ts:305`) computes *and* filters in
one pass; the split is to store the unfiltered result and expose the projection separately. Detection
floor: pass `peakMinOverride: -100` at the frozen-capture call, leaving `dsp/peaks.ts:178`'s default
untouched.

**Tests.** `PeakMinDurabilityTests` (new suite, 5 tests, pinned `.generic`);
`PeakFindingTests.prep()` reseeds the full set; `loadedMeasurementIsNotUpgraded` simulates load
properly; 3 `RecalculateFrozenPeaksIntegration` tests pinned `.generic`. Parity slug:
`test/frozen-peak-recalc`. **Golden baseline `5c264de3941837f8` must not move on any platform** — it
is the proof that only detection's *timing* changed.

**Trap, learned the hard way.** `allPeaks` must NEVER be assigned a filtered view. Doing so in the two
recalc branches was real data loss: the durable set shrank as Peak Min rose, and the save path reads
it. Both ports will present exactly the same temptation at the same two places.

---

## Phase 2 — Peak Min becomes a pure filter *(the core change)*

**Goal:** a Peak Min move recomputes the projection and mutates nothing.

**All three bullets below are SUPERSEDED — see the decision in the completion block. The goal was met
by decoupling the trigger; none of the three is deleted.**

- ~~`recalculateFrozenPeaksIfNeeded()` (`+PeakAnalysis.swift:141-276`): delete the live/frozen
  re-detect branch (`:243-275`).~~ **KEPT.** A Peak Min change recomputes the display projection only
  — achieved via the didSet, not by deleting the branch.
- ~~**Delete `applyFrozenPeakState` entirely**~~ (`:485-553`) — the ±5 Hz remapping of offsets,
  overrides and selection. **KEPT.**
- ~~**Delete `selectedPeakFrequencies`**~~ (`TapToneAnalyzer.swift:583`) and its seeding
  (`+MeasurementManagement.swift:755-761`). **KEPT.**

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

### ✅ Phase 2 COMPLETE — suite green (419) + USER-VERIFIED (2026-07-22). Committed `9f9bc89`.

**Done — and this is the whole first-order effect:** `peakMinThreshold.didSet`
(`TapToneAnalyzer.swift:231-241`) no longer calls `recalculateFrozenPeaksIfNeeded()`. It re-projects
and nothing else. A slider sweep now detects nothing, classifies nothing and touches no per-peak
state.

**Also fixed here** (three regressions the user's run-review caught, all ONE root cause — selection
and classification were reading the *display* set): `resetToAutoSelection`, both
`recalculateFrozenPeaksIfNeeded` branches and `reclassifyPeaks()` now read `allPeaks`. Symptoms were
Re-analyze selecting nothing when Peak Min hid everything, the wand choosing from the single visible
peak, and — because the Top and Back bands overlap — a **Back peak becoming Top** on reload.
Separately, the annotation leader line detached during a drag: `PeakAnnotations.swift` froze *both*
endpoints at drag start, but only the label anchor (`frozenChartPosition`) needs freezing; the dot
does not move. `frozenPeakPosition` deleted.

**DECISION 2026-07-22 — all three planned deletions are CANCELLED.** The live/frozen re-detect branch,
`applyFrozenPeakState` and `selectedPeakFrequencies` are all KEPT.

The plan assumed all three existed only to service Peak Min, so decoupling the slider would leave
them dead. That assumption was wrong. Decoupling the didSet did not make them dead — it made them
**correctly scoped**. `recalculateFrozenPeaksIfNeeded()` now runs on exactly two paths:

- **load** — saved peaks arrive with their own UUIDs, which cannot match anything already in memory;
- **explicit Re-analyze** — `findPeaks` re-runs and mints entirely new `ResonantPeak` identities.

On both, peak identity genuinely does change, and the user's offsets, overrides and selection are
keyed by the *old* identities. Taken one at a time:

- **The live/frozen re-detect branch** *is* Re-analyze. Deleting it would leave the one operation
  whose entire purpose is to re-run detection with nothing to run. The branch was never the problem;
  reaching it from a slider move was.
- **`applyFrozenPeakState`** is how per-peak state survives a legitimate re-detection. Matching
  offsets, overrides and selection forward by frequency within ±5 Hz is precisely the right tool when
  identities have been re-minted. Deleting it would silently discard dragged labels and custom mode
  names on every Re-analyze and on every load.
- **`selectedPeakFrequencies`** is the frequency-keyed selection cache that carry-forward reads. Its
  stale-cache bug was a symptom of the slider driving recalc, not of the cache itself.

**What made the difference:** the fix was never "delete the machinery", it was "stop firing it for a
display change." Once Peak Min no longer triggers recalc, the bugs the deletions were meant to fix
(deselected peaks re-selecting, offsets on hidden peaks destroyed, identity churning per tick) are
already gone — they were all downstream of the trigger, not of the mechanism. The machinery that
remains now runs only where it is genuinely needed.

**Consequence for the ports:** Python's `_apply_frozen_peak_state` and its selection cache
(`…_measurement_management.py:702`) are likewise kept. The web has neither, and after Phase 9 will
**need** the equivalent — it currently destroys per-peak state whenever peaks are re-minted, which is
the same hole from the other direction.

**User-verified 2026-07-22:** Re-analyze with everything hidden, wand with partial visibility, fresh
capture → save → reload (Air selected, Back stays Back), annotation leader line — all good.

### Port ledger — Phase 2

**Rule.** A Peak Min change recomputes the display projection and mutates nothing else. Detection,
classification and selection are facts about the *measurement*; only display may depend on Peak Min.
Corollary, and the source of three separate bugs in one session: **every auto-selection and
classification call site must read the durable set, never the displayed one.**

**Swift.** didSet → `refreshDisplayedPeaks()` only; `allPeaks` at the four selection/classification
sites; `frozenPeakPosition` removed from `PeakAnnotations.swift`.

**Python.** Peak Min reaches peaks through `recalculate_frozen_peaks_if_needed()`
(`…_peak_analysis.py:120`) and `_emit_loaded_peaks_at_threshold()` (`:826`). Same decoupling: a
threshold change re-emits the projection, never re-enters detection or classification. Python's
selection UI is additionally **not routed through the analyzer** at all — see
[PEAK-SELECTION-SURVIVES-SLIDER.md](PEAK-SELECTION-SURVIVES-SLIDER.md); that routing is a prerequisite,
not a detail. `views/fft_canvas.py` is deliberately held uncommitted because it is rewritten here.

**Web.** The fix is structurally different — remove `peakMin` from the `useLayoutEffect` dependency
array (`App.tsx:512-514`) so the slider stops re-entering `recalculatePeaks`, and apply it in a
display selector alongside range and unknown filtering. Until that lands the web destroys per-peak
state on every slider tick (no carry-forward exists to soften it). Overlaps the already-logged
[WEB-CHART-INTERACTION-BUGS.md](WEB-CHART-INTERACTION-BUGS.md) — pan/zoom re-selecting deselected
peaks is the same root cause reached from a different input.

**Tests.** `loadedPeaks_allBelowThreshold_clearsBothCollections` → renamed
`…_clearsDisplayButKeepsClassification` and **inverted**: `currentPeaks` empties, `allPeaks` and
`identifiedModes` survive. It had been pinning the defect. Slug `test/frozen-peak-recalc`; both ports
need the inverted twin, not the original. Still owed on all three: a durability test that sets an
offset + override + selection, sweeps Peak Min past the peak and back, and asserts all three
byte-identical — it needs a realistic Gaussian-spectrum harness, because `freeze()` installs a flat
−100 spectrum that makes the recalc early-return and any test built on it vacuous.

---

## Phase 3 — Per-tap entries computed once

### Verified 2026-07-22 before starting — the deletion is right, but not for the reason the plan said

Unlike Phase 2's cancelled deletions, `recalculateTapEntryPeaks()` is not merely redundant, it is
**actively destructive**. Four findings:

1. **Capture already stores the full set.** `+SpectrumCapture.swift:1664` builds each `TapEntry` with
   `peakMinOverride: TapToneAnalyzer.peakDetectionFloor`. Phase 1 closed this.
2. **`recalculateTapEntryPeaks()` undoes it.** `+PeakAnalysis.swift:295` calls
   `findPeaks(magnitudes:frequencies:)` with **no override**, falling back to `peakMinThreshold`. Each
   run overwrites the durable per-tap set with a filtered one, mints fresh UUIDs and rebuilds
   `selectedPeakIDs`. **`tapEntries` is persisted**, so this is the same data-loss shape as the
   `allPeaks` invariant breach: load a multi-tap measurement with Peak Min raised, save, and the
   per-tap sets are permanently truncated.
3. **The load caller's own comment states the defect.** `+MeasurementManagement.swift:850-858`
   justifies itself with "the saved tapEntries may contain peaks detected at a different threshold …
   re-running findPeaks ensures consistency" — i.e. re-detecting a loaded measurement, straight
   against [[project_loaded_peaks_authoritative]].
4. **A live inconsistency exists right now.** Since Phase 2 the recalc no longer fires on a slider
   move, so a *fresh* multi-tap capture keeps its −100 entries while a *reloaded* one has them
   re-detected at Peak Min. Same measurement, two different per-tap sets.

**Risk is NOT low — correct the original rating.** `GuitarMode.classifyAll` claims one peak per mode
in ascending frequency, so changing the *size* of the set can change the assignments (the same
overlapping-Top/Back hazard that produced Back→Top in Phase 2). Deleting the function makes reloaded
files agree with fresh captures — a correction, but a **visible** one on existing multi-tap files.

### The work

- Delete `recalculateTapEntryPeaks()` (`+PeakAnalysis.swift:293-305`) and its three call sites:
  `:240` (loaded branch), `:280` (live branch), `+MeasurementManagement.swift:858`. Drop the stale
  load-path comment with it. *(This also disposes of a duplicated doc-comment block on the function —
  lines 286-289 repeat two sentences verbatim, and their "Called from … (slider changes)" note was
  made false by Phase 2. No separate fix needed; the comment dies with the function.)*
- Per-tap peaks + their Air/Top/Back are computed at capture and never re-derived; the multi-tap table
  is independent of Peak Min (spec §5).
- **RETRACTED — the "instance vs static `resolvedModePeaks` divergence" is NOT REAL.** An earlier
  revision of this phase claimed the on-screen multi-tap table and the PDF could name different
  Air/Top/Back peaks, because the table calls `entry.resolvedModePeaks(guitarType:)` (which filters by
  `selectedPeakIDs` first) while export/list/detail call the static
  `TapToneAnalyzer.resolvedModePeaks(peaks:guitarType:)` (which does not). **I read the call sites
  without reading their inputs.** Every static caller receives peaks that were *already*
  selection-filtered when the entry was built — `+Export.swift:361` (`entry.peaks.filter {
  selectedIDs.contains($0.id) }`), `MeasurementsListView.swift:483`,
  `+MeasurementManagement.swift:977` (`effectiveSelectedPeakIDs`), `MeasurementDetailView.swift:293`.
  Classifying a pre-filtered set is the same computation the instance form performs internally, so the
  two paths agree. No `TapEntry` is ever passed raw to the static resolver. **Nothing to fix; do not
  re-file this.** The general lesson is recorded under the checkpoints section.

- **The real defect in the same code — selection resolved over the DISPLAY set.** Two sites filter
  `currentPeaks` by `selectedPeakIDs` to build the *averaged* row:
  `TapAnalysisResultsView.swift:450` (on screen) and `TapToneAnalysisView+Export.swift:378` (the
  multi-tap PDF). Since Phase 1 auto-selects over the full set, a selected peak may legitimately sit
  below Peak Min — and then it silently vanishes from the averaged Air/Top/Back row, on screen and in
  the PDF, as the slider moves. This is the exact defect class fixed at four sites in Phase 2:
  **selection is a fact about the measurement; resolve it over `allPeaks`.** Both sites move to
  `allPeaks`. (Left alone: `+Export.swift:125` and `:305`, which build `rangeFilteredPeaks` for the
  exported peak *table* — that table is a picture of what is displayed, so `currentPeaks` is correct
  there. And `TapAnalysisResultsView.swift:239`, a Select All enable-test, dies with Phase 5.)

**Tests:**
- change Peak Min, assert `tapEntries` (peaks *and* `selectedPeakIDs`) are unchanged — via the
  `peakMinThreshold` property, the real user path, not by calling the recalc directly;
- call `recalculateFrozenPeaksIfNeeded()` on both branches and assert `tapEntries` unchanged — the
  direct guard against the deleted call being reintroduced;
- a selected peak below Peak Min still appears in the averaged mode row.

### ✅ Phase 3 COMPLETE — suite green (422) + USER-VERIFIED (2026-07-22). UNCOMMITTED.

**Changed (Swift):**
- `recalculateTapEntryPeaks()` deleted from `+PeakAnalysis.swift`, with its three call sites (both
  recalc branches and `loadMeasurement`). Both removal points carry a comment saying what used to be
  there and why it went, so it is not "restored" later as a missing recompute.
- New `TapToneAnalyzer.selectedPeaks` — `allPeaks.filter { selectedPeakIDs.contains($0.id) }`. The
  on-screen multi-tap table (`TapAnalysisResultsView.swift:450`) and the multi-tap PDF
  (`TapToneAnalysisView+Export.swift:378`) both had this expression inline over `currentPeaks`;
  they now share the one property. Two birds: the Peak Min leak is fixed, and the two paths are
  structurally incapable of drifting apart.

**Tests (+3, 419 → 422):** `peakMinSweep_leavesTapEntriesUntouched` (drives the slider property),
`recalculateFrozenPeaks_leavesTapEntriesUntouched` (both branches — the direct guard against the
deleted call returning), `selectedPeaks_resolveOverDurableSet_notTheDisplayProjection`. Parity map
clean: 79 groups, no orphans; no new file, so `test/frozen-peak-recalc` covers them.

**Run-reviewed by the user 2026-07-22, all four checks pass:** a pre-existing multi-tap file holds its
Taps table steady across a Peak Min sweep; a fresh capture saved and reloaded now agrees with itself;
the multi-tap PDF's per-tap and Averaged rows match the screen; and a selected peak raised above Peak
Min stays in the Averaged row in both. The predicted visible change on older multi-tap files was not
disruptive in practice.

*(One false alarm during the review, worth not re-investigating: an apparently hung PDF export was a
save panel hidden behind the window. No defect. It did surface a genuine robustness gap — no
re-entrancy guard on the export/save actions — logged as STATUS item 13, outside this plan.)*

### Port ledger — Phase 3

**Rule.** A `TapEntry` is detected, classified and selected **once, at capture**, over the full −100 dB
set, and is thereafter durable — nothing may re-derive it, least of all a display control. Derived
values resolve selection over the durable set, never over the Peak Min projection.

**Swift.** `recalculateTapEntryPeaks()` + 3 call sites deleted; `TapToneAnalyzer.selectedPeaks` added
and adopted by the two multi-tap averaged-row consumers.

**Python.** `_recalculate_tap_entry_peaks` (`…_peak_analysis.py:254`) with **three** call sites,
matching Swift exactly: `…_peak_analysis.py:216`, `:246`, `…_measurement_management.py:846`. Delete
all three.

Also touch, but do not treat as a call site: `views/tap_tone_analysis_view.py:4302`
`_on_peaks_changed_multi_tap`. It only calls `_populate_multi_tap_results_view()`; its *docstring*
cites `_recalculate_tap_entry_peaks()` and goes stale with the deletion. The handler exists because
Qt is imperative — SwiftUI re-renders `TapAnalysisResultsView` automatically when `@Published
tapEntries` changes, so Swift needs no counterpart. Not a divergence, a framework consequence. After
the port the per-tap table no longer changes with Peak Min, so decide whether the `peaksChanged`
subscription still earns its keep.

**Ordering constraint, verified:** Python's per-tap capture at `…_spectrum_capture.py:2021` calls
`self.find_peaks(t_mags, t_freqs)` with **no `peak_min_override`** — Phase 1's −100 floor was never
applied to Python's tap entries. So **Phase 1's Python port must land before Phase 3's**, or deleting
the recompute would freeze a Peak-Min-*filtered* set permanently. Swift did not have this hazard
(`+SpectrumCapture.swift:1664` already passes the override).

**Web.** Per-tap entries are `capturedTaps` (`state/tapToneAnalyzer.ts:91`), whose comment already
records the defect: *"Each entry's peaks are (re)found by recalculatePeaks at the current Peak Min."*
Same rule, same shape as the web's Phase 2 work — the per-tap re-find comes out of the Peak Min
recompute path.

**Tests.** The three above; slug `test/frozen-peak-recalc`. Both ports need all three, and the
`selectedPeaks` twin needs a home property (neither platform has one — the expression is inline).

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

## Phase 4a — Retire `currentPeaks`

**Goal:** two concepts, not three.

Phase 1 deliberately leaves `currentPeaks` in place as a Peak-Min-filtered projection so the other
~70 read sites keep working unchanged. But it is a **half-filtered intermediate** — Peak Min applied
at the model, range and unknown applied again in each view — and that halfway state is exactly why
the results table and the dot layer drifted apart in the first place. Leaving a misleadingly-named
property behind is how the next round of confusion starts.

End state:

- **`allPeaks`** — the durable set. Everything non-display reads this: save, load, selection,
  derived values.
- **one display projection** — `allPeaks` → Peak Min → display range → `isUnknown` — consumed by the
  results table, the dot layer and exports. This is `peaksInDisplayRange` (built 2026-07-21 for the
  dot layer, extended by Phase 4 with the `isUnknown` predicate) with Peak Min added as a parameter.
- **`currentPeaks` deleted.**

**Why here and not in Phase 1:** retiring it means classifying all ~70 read sites into "wants the
durable set" vs "wants the displayed set". Doing that audit while behaviour is also changing makes
any regression unattributable. By this phase the behaviour is settled and verified, so a
mis-classification shows up as a display bug rather than a data bug.

**Risk:** medium, but mechanical — the compiler finds every site once the property is removed.

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

**Scope note:** this phase is the *aggregate* measurement's derived values. Anything per-tap belongs
to **Phase 3**. (An earlier revision routed a supposed per-tap `resolvedModePeaks` divergence here and
then to Phase 3; it was retracted as not real — see Phase 3.)

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

## Phase 9 — The ports

Held until Swift is user-verified: starting earlier means Python absorbs every spec correction twice.

**Replay the port ledgers phase by phase — do not port the accumulated Swift diff in one pass.** Each
phase's ledger is a rule plus a named test list, so each replays as a small independently-verifiable
step. Python first, then web ([[feedback_what_does_swift_do]]: Swift → Python → web, every time).

Per phase, per platform: implement the **Rule**, create the counterpart tests named in the ledger,
update `@parity` tags, run `gen_parity_map.py --check` and confirm zero new orphans, confirm the
golden baseline is unmoved. A phase is ported when its tests pass on that platform — not when the
code "looks like" the Swift.

**Do not transcribe the Swift diff.** The anchor map above shows why: the web reaches the same defect
through a React dependency array and has no carry-forward machinery at all, so its fix is a different
edit expressing the same rule. Python has no compiler to enumerate the `current_peaks` write sites
that Swift's type system handed us for free.

---

## Suggested checkpoints for the user

Phases 1–2 together are the substance and the risk; stop for run-review there — done 2026-07-22.

**Phase 3 needs its own run-review** and should not be batched: verification upgraded it from "low
risk" to a visible change on existing multi-tap files (see its findings block). Phases 4–7 are smaller
and can be batched. Phase 8 gates the ports; Phase 9 is the ports themselves.

**Standing lesson from Phases 2 and 3: verify each phase's bullets against the code before executing
them.** Both were written from the gap analysis, before Phases 1–2 changed the ground. Phase 2's
deletions turned out to be wrong; Phase 3's turned out to be right but for a different reason and at a
different risk level. Neither would have been caught by executing the bullet as written.

**And verify the findings too, not just the plan.** Phase 3's "instance vs static `resolvedModePeaks`"
item was *my own* finding, added during verification, and it was wrong — I traced which resolver each
call site used but never traced what was passed *into* it. A finding about a data-flow divergence is
not established until both ends have been read. When a claim is "these two paths disagree", read the
inputs before writing it down; the plan is load-bearing and a confident wrong entry costs more than a
missing one.