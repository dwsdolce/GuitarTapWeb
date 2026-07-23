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
  reconstructed at Phase 8 — by then the reasoning is buried under several compactions.

  **Purpose (sharpened 2026-07-22): the ledger's load-bearing content is the faithful record of what
  was done TO SWIFT. The ports are *generated from that record* by reproducing it non-divergently —
  "read what Swift did, replicate it." Swift *code* does not port; the rule and the tests do.** The
  ledger is authoritative about Swift and *only* Swift.

  1. **Rule** — one platform-independent sentence. What every platform must end up doing.
  2. **Swift** — the symbols changed. This, with the Rule and Tests, is the authoritative record.
  3. **Ports (UNVERIFIED)** — a *prediction* of the Python/web shape, to **verify against the code at
     port time, never trust from this doc**. These are guesses that point where to look; three of
     them have already proven wrong this session. A wrong prediction here must not become an
     instruction to implement. See the Phase 9 warning.
  4. **Tests** — added / deleted / inverted, with the `@parity` slug. The port then reduces to "make
     these named tests exist and pass", and `gen_parity_map.py --check` flags any that never got
     twins. A missed port becomes a build-visible orphan instead of a bug found in six months.
- **Spec corrections go into the spec.** When a phase discovers [PEAK-LIFECYCLE-SPEC.md](PEAK-LIFECYCLE-SPEC.md)
  was wrong (Phase 1 already amended it — live path stays cheap at Peak Min), amend the spec, not just
  the phase notes. The spec is the artifact Python and the web are built against.

---

## Cross-platform anchor map

The counterpart lookup, done once. Phase ledgers reference these rather than repeating them.

> **The Swift column is authoritative. The Python and Web columns are UNVERIFIED predictions —
> confirm each against the code at port time, never trust them from this doc.** They point where to
> look; they are not a specification. Symbol names and "none" claims may already be stale, and three
> such predictions elsewhere in this plan proved wrong when checked.

| Concept | Swift (authoritative) | Python (unverified) | Web (unverified) |
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

**Python (UNVERIFIED — confirm at port time).** No durable set exists — `current_peaks` (`tap_tone_analyzer.py:278`) *is* the working set,
written from ~12 sites across `_control`, `_spectrum_capture`, `_measurement_management`. The port is
the same Option B split: add `all_peaks`, make `current_peaks` a read-only projection, then convert
each write site. Unlike Swift there is **no compiler** to enumerate them — so grep `current_peaks =`
and `self.current_peaks` and work the list explicitly; this is the highest-risk part of the Python
port. `guitar_full_save_peaks` equivalent (`…_measurement_management.py:198-222`) collapses the same
way, deleting the re-detect-and-append dance.

**Web (UNVERIFIED — confirm at port time).** Also no durable set. `recalculatePeaks` (`tapToneAnalyzer.ts:305`) computes *and* filters in
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

**Python (UNVERIFIED — confirm at port time).** Peak Min reaches peaks through `recalculate_frozen_peaks_if_needed()`
(`…_peak_analysis.py:120`) and `_emit_loaded_peaks_at_threshold()` (`:826`). Same decoupling: a
threshold change re-emits the projection, never re-enters detection or classification. Python's
selection UI is additionally **not routed through the analyzer** at all — see
[PEAK-SELECTION-SURVIVES-SLIDER.md](PEAK-SELECTION-SURVIVES-SLIDER.md); that routing is a prerequisite,
not a detail. `views/fft_canvas.py` is deliberately held uncommitted because it is rewritten here.

**Web (UNVERIFIED — confirm at port time).** The fix is structurally different — remove `peakMin` from the `useLayoutEffect` dependency
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

### ✅ Phase 3 COMPLETE — suite green (422) + USER-VERIFIED (2026-07-22). Committed `11689b6`.

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

**Python (UNVERIFIED — confirm at port time).** `_recalculate_tap_entry_peaks` (`…_peak_analysis.py:254`) with **three** call sites,
matching Swift exactly: `…_peak_analysis.py:216`, `:246`, `…_measurement_management.py:846`. Delete
all three.

Also touch, but do not treat as a call site: `views/tap_tone_analysis_view.py:4302`
`_on_peaks_changed_multi_tap`. It only calls `_populate_multi_tap_results_view()`; its *docstring*
cites `_recalculate_tap_entry_peaks()` and goes stale with the deletion. The handler exists because
Qt is imperative — SwiftUI re-renders `TapAnalysisResultsView` automatically when `@Published
tapEntries` changes, so Swift needs no counterpart. Not a divergence, a framework consequence. After
the port the per-tap table no longer changes with Peak Min, so decide whether the `peaksChanged`
subscription still earns its keep.

**Ordering constraint (read against the code 2026-07-22 — still re-confirm at port time, the file may
have moved):** Python's per-tap capture at `…_spectrum_capture.py:2021` calls
`self.find_peaks(t_mags, t_freqs)` with **no `peak_min_override`** — Phase 1's −100 floor was never
applied to Python's tap entries. So **Phase 1's Python port must land before Phase 3's**, or deleting
the recompute would freeze a Peak-Min-*filtered* set permanently. Swift did not have this hazard
(`+SpectrumCapture.swift:1664` already passes the override).

**Web (UNVERIFIED — confirm at port time).** Per-tap entries are `capturedTaps` (`state/tapToneAnalyzer.ts:91`), whose comment already
records the defect: *"Each entry's peaks are (re)found by recalculatePeaks at the current Peak Min."*
Same rule, same shape as the web's Phase 2 work — the per-tap re-find comes out of the Peak Min
recompute path.

**Tests.** The three above; slug `test/frozen-peak-recalc`. Both ports need all three, and the
`selectedPeaks` twin needs a home property (neither platform has one — the expression is inline).

---

## Phase 4 — One unknown predicate

### Verified against the code 2026-07-22, and the rule settled with the user

**The agreed rule.** With **Show Unknown Modes off**:

| Surface | Shown when |
|---|---|
| Results table row | the peak is **identified** |
| Chart dot | the peak is **identified** — independent of selection *and* of annotation mode |
| Annotation badge | the peak is **identified** *and* admitted by annotation visibility: `Selected` → must be selected · `All` → any identified peak · `None` → nothing |

"Identified" means *not* unknown, by **either** route — auto-classification or a user override. A peak
the user has named is identified by definition (user, 2026-07-21: *"a peak that has a custom mode is
NOT unknown"*). `All` genuinely means all: an identified but unselected peak still gets a badge —
that is the point of the three-state control (user, 2026-07-22: *"ALL means all — that is why the
annotation visibility has All/Selected/None"*).

**The workflow this exists to serve — and the reason it can only be tested in two steps.** With Show
Unknown Modes **off** an unknown peak has no row, no dot and no badge, so there is **nothing to
right-click**: a user can never name an out-of-band peak while the setting is off. The real sequence
is therefore: turn Show Unknown Modes **on** to go looking → find something real (a wolf note, a
mode outside the expected band) → **name it** → turn the setting back **off** to declutter. Before
Phase 4 that last step *threw the work away* — the peak the user had just identified vanished from
all three surfaces. Any run-review script that says "with the setting off, label an unknown peak" is
impossible as written.

With **Show Unknown Modes on**, nothing is filtered on any of the three surfaces. Both criteria
short-circuit today (`TapAnalysisResultsView.swift:408`'s second term; `GuitarMode.swift:276`'s
`guard`), and that is unchanged. **The whole phase is scoped to one setting state** — which shrinks
the test matrix to the off-cases plus a single "nothing is filtered" assertion per platform.

**Correction to the plan's premise — there are FOUR copies of the criterion, not two:**

| # | Site | Surface | Criterion today |
|---|---|---|---|
| 1 | `TapAnalysisResultsView.swift:408` | table row | **assigned mode** |
| 2 | `GuitarMode.swift:277` via `peaksInDisplayRange` | chart dots | positional `isKnown` |
| 3 | `TapToneAnalyzer.swift:745` `visiblePeaks` | annotation badges | positional `isKnown` |
| 4 | `SpectrumView.swift:422` `visiblePeaks` legacy fallback | annotations, for call sites that pass no explicit list | positional `isKnown` |

The original bullet named 1 and 2 only. Converting those alone would have *created* an inconsistency
rather than removing one: a custom-labelled peak would regain its row and its dot but still lose its
badge.

**Correction to a claim made earlier in this work:** `classifyAll` does **not** leave unclaimed
in-band peaks unknown — `GuitarMode.swift:207` falls back to per-frequency lookup for anything the
one-per-mode claiming pass did not take. Therefore, for a peak with **no override**,
`assignedMode == .unknown` is *equivalent* to "outside every band" — exactly what
`isKnown(frequency:)` tests. **The four criteria agree everywhere except under a user override**, so
this phase is behaviour-preserving for every non-overridden peak.

**What actually diverges today** (all three cases require an override):

| Case | Table row | Chart dot |
|---|---|---|
| Freeform label ("Wolf note"), in-band | hidden | **shown** |
| Freeform label, out-of-band | hidden | hidden |
| Relabelled to a known mode, out-of-band | **shown** | hidden |

The original bullet described only the middle row. The first and third are the visible
inconsistencies — name a peak and its row vanishes while its dot stays. The mechanism: an override of
`.assigned(label)` is run through `GuitarMode.fromDisplayName(label)`; a real mode name yields that
mode, a freeform label yields `.unknown` (`+AnalysisHelpers.swift:49`). The dot never consults the
override at all.

**This reverses a deliberate, documented decision — not an oversight.** `GuitarMode.swift:251-254`
argues explicitly that the two "differ only under a user override; the positional test is the one
that belongs on a chart layer." That comment predates the user's ruling and must be **rewritten** as
part of this phase, not left contradicting the code.

### The work

- Add the predicate. Consume it at **all four** sites; delete the four divergent criteria.
- **API shape (agreed):** `peaksInDisplayRange` gains `overriddenPeakIDs: Set<UUID> = []`. Sites 2 and
  4 have no analyzer reference, and the overrides live on the analyzer. A set parameter keeps the
  function **static and pure**, keeps the parity tests trivial, and ports to Python and TypeScript
  unchanged — preferred over passing a closure or the analyzer itself. Site 3 needs nothing: it is on
  the analyzer already.
- Rewrite the `GuitarMode.swift:251-254` doc comment to state the new rule and why it changed.
- **Re-spec the `view/dot-layer` parity group**: DL1/DL2/DL6/DL7 stand; DL3/DL4/DL5 change from
  `isKnown(frequency)` to the new predicate.

**Risk:** low — behaviour is unchanged for every peak without a user override, and unchanged entirely
when Show Unknown Modes is on. (Downgraded from "low-medium": the concern was that it touches a
three-platform rule, but the ports are Phase 9 and the ledger carries the re-spec.)

### ✅ Phase 4 COMPLETE — suite green (425), parity clean + USER-VERIFIED (2026-07-22). Committed `08c66d5`.

**Changed (Swift):**
- `TapToneAnalyzer.isUnknown(_:)` — the one predicate. Plus `overriddenPeakIDs`, the analyzer's set
  of user-named peaks, for the static/view sites.
- `GuitarMode.peaksInDisplayRange` gains `overriddenPeakIDs: Set<UUID> = []`; a named peak is kept
  regardless of position. Its doc comment, which argued the opposite, rewritten with a `- Note:`
  recording what changed and why.
- All four consumers converted: results table (`TapAnalysisResultsView.swift`), dot layer and the
  legacy annotation fallback (`SpectrumView.swift`, which derives the set from the `modeOverrides`
  it is already handed — **no new view parameter needed**), and `TapToneAnalyzer.visiblePeaks`.

**Test re-spec — and the plan's prediction here was wrong.** It expected DL3/DL4/DL5 to change and
DL7 to stand. In fact **no existing assertion changed at all**: DL3/DL4/DL5 are non-override cases
where the old and new rules provably agree, and DL7's in-band override was kept under both rules.
Only DL7's *rationale* needed rewriting — it used to hold because the layer was positional, it now
holds because a named peak is known. The behaviour change had **no** coverage, so three tests were
added (422 → 425): **DL8** an out-of-band peak becomes visible once named (the Phase 4 change
itself), **DL9** the same via a real-mode relabel, **DL10** table, dot and badge all agree on a
user-named peak.

### Port ledger — Phase 4

**Rule.** A peak is unknown only when auto-classification placed it in no mode band **and** the user
has not named it. Naming a peak makes it known. One predicate governs all three display surfaces;
the annotation surface additionally applies its All/Selected/None gate. With Show Unknown Modes on,
nothing is filtered anywhere.

**Swift.** As above.

**Python / web (UNVERIFIED — confirm at port time).** Both carry the `view/dot-layer` twins committed 2026-07-21 and both need: the
predicate, the `overridden_peak_ids` / `overriddenPeakIds` parameter on their
`peaks_in_display_range` / `peaksInDisplayRange`, all four consumers converted, the same doc-comment
reversal, and DL8–DL10. **Verify each platform's consumer list rather than assuming it is four** —
Swift's fourth site is a legacy view fallback that may have no counterpart, and the web's dot/panel
split lives in `spectrumRender.ts` + `App.tsx` (`displayPeaksInRange`) rather than one shared helper.

**Tests.** DL1–DL10, slug `view/dot-layer`. DL8 is the one that proves the change landed; DL1–DL7
should pass **before and after** the port, which makes them a useful pre-flight check.

**Run-review script (all three platforms) — note the two-step shape, per the workflow above:**
1. Show Unknown Modes **on**; name an out-of-band peak (the Back/Dipole gap is the easiest). Row, dot
   and badge all present.
2. Show Unknown Modes **off**. The named peak **stays** — all three surfaces. *This is the change.*
3. Repeat with a real mode name ("Top") instead of a freeform label — same outcome.
4. Setting off: an **in-band** custom-labelled peak shows everywhere (the table row is the part that
   used to be missing).
5. Setting off: an **unnamed** out-of-band peak is still hidden everywhere — the filter still works.
6. Setting on: everything appears, exactly as before the phase.

---

## Phase 4a — Rename `currentPeaks` → `peaksAbovePeakMin`

**Goal:** a name that states what the stage is, and an audit of every site that reads it.
*(Originally "Retire `currentPeaks` — two concepts, not three". See the verification below for why
deletion was the wrong end state.)*

Phase 1 deliberately leaves `currentPeaks` in place as a Peak-Min-filtered projection so the other
~70 read sites keep working unchanged. But it is a **half-filtered intermediate** — Peak Min applied
at the model, range and unknown applied again in each view — and that halfway state is exactly why
the results table and the dot layer drifted apart in the first place. Leaving a misleadingly-named
property behind is how the next round of confusion starts.

### Verified 2026-07-22 — the "delete it" premise is WRONG. Rename instead.

The three stages are not redundant; they have **different scopes**, and that is why a middle stage
has to exist somewhere:

| Stage | Scope | Changes when |
|---|---|---|
| `allPeaks` | the measurement | a new capture or an explicit Re-analyze |
| Peak Min filter | a **setting**, model-level, global to the measurement | the user moves the slider |
| display range + `isUnknown` | the **viewport**, view-level | pan, zoom, or a different chart instance |

The model genuinely needs the Peak-Min stage on its own: `visiblePeaks`
(`TapToneAnalyzer.swift:766`) picks annotation candidates after Peak Min but **before** any range,
because the view applies range afterwards. Deleting the stored property turns that into an inline
`allPeaks.filter { $0.magnitude >= peakMinThreshold }` repeated at every such site — which is exactly
how the divergences these phases have been removing get reintroduced.

**Decision (user, 2026-07-22): rename, don't delete** — *"as long as it clearly indicates purpose and
why it is there."* `currentPeaks` → **`peaksAbovePeakMin`**, carrying a doc comment that states the
three scopes above, so the property can never again be read as "the peaks". This achieves the stated
goal — *"leaving a misleadingly-named property behind is how the next round of confusion starts"* —
while keeping a stage that earns its place. The compiler still forces the same whole-codebase audit,
because every reference has to be touched and classified.

### The seven durable-vs-displayed defects the audit surfaced

Classifying the sites is what finds these; they are the same defect class fixed in Phases 2, 3 and 4 —
code that wants a **fact about the measurement** but reads the **display projection**.

| Site | What it does | Why wrong |
|---|---|---|
| `+PeakAnalysis.swift:170` | selection carry-forward fallback | selection is a fact |
| `+PeakAnalysis.swift:178` | annotation-offset snapshot | a hidden peak's dragged label is dropped, then lost on Re-analyze |
| `+PeakAnalysis.swift:184` | mode-override snapshot | same — a hidden peak's custom name is lost |
| `+PeakAnalysis.swift:577` | `guitarModeSelectedPeakIDs` default arg | auto-selection over the visible set; every explicit caller now passes `allPeaks`, so the default is a loaded gun |
| `+MeasurementManagement.swift:371` | saved `selectedPeakFrequencies` | a selected sub-Peak-Min peak's frequency never reaches the file |
| `+MeasurementManagement.swift:1099` | `avgSelectedPeaks` | the **third** copy of the expression fixed at two sites in Phase 3 — use `selectedPeaks` |
| `TapToneAnalyzer.swift:731` | `selectAllPeaks()` | selects only what is visible (dies in Phase 5 regardless) |

Note 178/184: Phase 2 removed the *trigger* (the slider) for the "offsets and overrides on hidden
peaks are destroyed" bug, but **Re-analyze still reaches this code**, so the loss still happens there.

### The Save guard

**Corrected scope:** the ten `.disabled(currentPeaks.isEmpty …)` sites are **not** on the export
buttons — Export PDF and Export Spectrum are unguarded entirely (`TapAnalysisResultsView.swift:358`).
They are on exactly two controls repeated across five layouts: **Annotations** and **Save**.

`macosSaveButton` has no other gate, so `currentPeaks.isEmpty` doubles as the "is there a measurement"
test — and does it badly: during live detection `currentPeaks` tracks the live spectrum, so whether
Save is enabled mid-capture depends on how much room noise clears Peak Min.

**Decision (user, 2026-07-22):** WYSIWYG — *"Save is only disabled when there is no measurement to
save - even if the graph shows no peak annotations."* The reasoning: the save is non-destructive (the
full −100 set plus the Peak Min setting are written since Phase 1), so a measurement saved with
everything hidden reloads and reveals everything when the slider drops. And *"a capture that detected
nothing is not a capture"* — the empty case the guard imagines does not occur.

```swift
.disabled(!tap.isMeasurementComplete && tap.displayMode != .comparison)
```

Annotations keeps its existing guard — with nothing displayed there is nothing to cycle.

**Not a bug, ruled 2026-07-22:** a PDF exported with Peak Min hiding everything shows an empty chart
on page 1 next to a fully-populated multi-tap table on page 2. Each page renders what was on screen.
*"It saved exactly what was displayed on the screen. That sounds correct."* Do not re-file.

**Why here and not in Phase 1:** the audit means classifying every read site into "wants the durable
set" vs "wants the displayed set". Doing that while behaviour is also changing makes any regression
unattributable. By this phase the behaviour is settled and verified, so a mis-classification shows up
as a display bug rather than a data bug.

**Risk:** medium. The rename is mechanical and compiler-checked, but the seven fixes are real
behaviour changes and the Save guard is user-visible in the live state.

### ✅ Phase 4a COMPLETE — suite green (426), parity clean + USER-VERIFIED (2026-07-22). Committed `f5fd2ce`.

**Run-review found one bug, deferred to Phase 6 by decision, not fixed here:** the tap-tone ratio
ignores mode overrides, so renaming the Top peak still yields a ratio. Predates the rework. See
Phase 6.

**Changed (Swift):** the rename (97 references), all seven fixes, the Save guard, and four
material-path sites made explicit (`allPeaks` rather than relying on the two being equal for
material). `TapAnalysisResultsView:239`'s Select All enable-test also moved to `allPeaks.count`, or it
would never have matched after `selectAllPeaks()` started selecting the durable set.

**Two existing tests inverted — and this is the phase's best evidence.**
`loadedPath_offsetForFilteredOutPeak_isDropped` and `..._overrideForFilteredOutPeak_isDropped`
asserted that a hidden peak's dragged label and custom name **are destroyed**. Both are on the Phase 2
plan's "asserts destruction, must assert survival" list, and both **outlived Phase 2** — because that
phase removed the slider as a *trigger* without changing the code, and Re-analyze still reaches it.
They now assert survival and are renamed `..._survives`. The green suite before this phase was
therefore *pinning the defect in place*.

**New test:** `reanalyzePreservesStateOfPeaksHiddenByPeakMin`, driven through a new
`gaussianSpectrum` / `freezeOnRealSpectrum` fixture. The flat −100 spectrum installed by `freeze()`
makes `findPeaks` detect nothing, so the recalc early-returns and any test built on it passes
vacuously — the trap that produced a worthless deselect guard earlier in this work. The new fixture
asserts its own preconditions (two peaks detected) so it cannot rot into vacuity.

**Run-review script:** take a peak that already shows an annotation badge, **drag that badge to a new
position** and give the peak a custom mode name → raise Peak Min until the peak is hidden →
**Re-analyze** → lower Peak Min. The badge must return to the dragged position with its custom name
intact.
Then: with Peak Min above every peak, confirm **Save** is enabled and the saved file reloads complete;
and confirm Save is still disabled before any measurement exists.

### Port ledger — Phase 4a

**Rule.** The Peak-Min-filtered set is a display projection named as such (`peaksAbovePeakMin` /
`peaks_above_peak_min`), not "the peaks". Every question *about the measurement* — save, selection,
classification, per-peak state carry-forward, whether a measurement exists — reads the durable set.

**Swift.** Rename (97 refs) + seven durable-vs-displayed fixes + Save gated on `isMeasurementComplete`
+ four material sites made explicit.

**Python (UNVERIFIED — confirm at port time).** `current_peaks` → `peaks_above_peak_min`, and the **same seven-site audit**: the port must
re-derive the equivalent of each fixed Swift site, NOT transcribe them — grep `current_peaks` in
`_peak_analysis.py` / `_measurement_management.py` and classify each as durable-vs-displayed. Save
guard: find the "no peaks" disable and move it to the completeness flag. Python has no compiler, so
this is the highest-miss-risk port in the plan.

**Web (UNVERIFIED — confirm at port time).** `state/tapToneAnalyzer.ts` — the projection is computed inside `recalculatePeaks`, so there
is no stored `currentPeaks` to rename; the durable-vs-displayed split has to be *introduced*, not
renamed. Re-verify against the code (this is exactly the entry the Phase 9 warning was written for).

**Tests, slug `test/frozen-peak-recalc`.** Two **inverted** (the phase's best evidence):
`loadedPath_offsetForFilteredOutPeak_isDropped` → `_survives`, and the override twin — both asserted a
hidden peak's state is *destroyed*; they now assert it survives. One new:
`reanalyzePreservesStateOfPeaksHiddenByPeakMin`. New fixture `gaussianSpectrum`/`freezeOnRealSpectrum`
— **both ports need the equivalent**, because the flat-spectrum trap (recalc early-returns → vacuous
pass) exists identically in Python and the web. Also slug `test/annotation-state`:
`selectNoPeaks_clearsAll` and `noneMode_returnsEmpty` had incidental `selectAllPeaks()` setup rewritten
to select explicitly (they must not depend on a feature Phase 5 removes).

## Phase 5 — The selection model

### The rule, in the user's terms (2026-07-22)

**Classification and selection are independent. Do not conflate them.**

- **Classification** — band membership, plus any user override. **Many peaks per mode**: five peaks
  inside the Air band are five Air peaks. Selection never changes it. *Deselecting a peak does not
  relabel it* — it stays an Air/Top/Back peak, it just stops being the definitive one.
- **Selection** — which one of those candidates is **definitive**. This is what Phase 5 constrains.

**The invariant:** *at most one selected peak per Air, Top and Back.* The selected one is **the
definitive Air/Top/Back**; every other peak of that mode is a candidate. Dipole / Ring / Upper Modes
are unconstrained — they are clusters, not single physical resonances.

**Enforcement is invariant maintenance, not two special cases.** The plan previously listed separate
rules for toggle and for mode override; they collapse. Only two things can break the invariant:

1. **Selecting a peak** whose mode already has a definitive holder → the previous holder is
   deselected (it remains a candidate, still classified, merely no longer definitive).
2. **Changing the mode of an ALREADY-SELECTED peak** so that its new mode now has two selected peaks.
   Overriding an *unselected* peak to Top does nothing to selection — it just becomes another Top
   candidate.

**No auto-promotion**, and it needs no special rule: override the definitive Top away from Top and
Top simply has no definitive peak until one is chosen. Nothing promotes because nothing is promoting.
**Select None is likewise a legitimate state** — a full set of classified Air/Top/Back peaks with no
definitive ones.

**Resolve the mode through `peakMode(for:)` — the override-aware path — NOT `identifiedModes`.** The
latter is built from `classifyAll` alone and never consults overrides (the defect logged in Phase 6);
using it here would make Phase 5 inherit that bug on day one.

**Why this matters is Phase 6's half:** the definitive Air/Top/Back must be used **consistently by
every consumer** — the tap-tone ratio, the PDF, the measurements list, the multi-tap table —
*"whether it was defined by the auto-select or by the user select."* Phase 5 establishes the
definitive peak; Phase 6 makes everything read it.

### The work

- Enforce the invariant in `togglePeakSelection` (`TapToneAnalyzer.swift:736`) and on mode change for
  an already-selected peak (`setModeOverride`, `:680` — which today writes `peakModeOverrides` and
  touches selection not at all).
- **Remove Select All**: `selectAllPeaks()` (`:749`) and the button. **Keep Select None** (`:755`).

**Verified corrections to the original bullets:**
- *"the button (all layouts)"* — there is only **one** Select All button
  (`TapAnalysisResultsView.swift:231`), sharing an `HStack` with Select None and the wand. Unlike the
  Save/Annotations guards, it is not repeated per layout.
- A **third** use of `selectAllPeaks()` the plan did not name: `noneMode_returnsEmpty`
  (`AnnotationStateTests.swift:237`) calls it incidentally as setup for an unrelated assertion. That
  one is **rewritten** to select explicitly, not deleted with the feature. The two named tests
  (`selectAllPeaks_selectsAllCurrentPeaks:101`, `selectAllPeaks_setsModifiedFlag:145`) do go.

**Risk:** medium — user-visible UI change. **Tests:** selecting a second Top deselects the first and
leaves it classified Top; overriding an already-selected peak to Top displaces the previous definitive
Top; overriding an *unselected* peak to Top changes no selection; overriding the definitive Top away
leaves Top with no definitive peak; Dipole/Ring/Upper still allow several; Select None leaves
classification intact.

### ✅ Phase 5 COMPLETE — suite green (431 incl. the reset-label fix), parity clean + USER-VERIFIED (2026-07-22). Committed `5836489`.

**Changed (Swift):**
- `TapToneAnalyzer.singleHolderModes` = `[.air, .top, .back]`, and
  `enforceDefinitiveModeUniqueness(preferring:)` — the one place the invariant is maintained. It only
  ever *removes* other peaks from the selection: it never reclassifies and never promotes.
  Guitar-gated (material has no per-peak selection). Resolves the mode through `peakMode(for:)`, the
  override-aware path, so Phase 5 does not inherit the Phase 6 blindness.
- Called from the two places that can break the invariant: `togglePeakSelection` (on select only) and
  `setModeOverride` (both the main-thread and the async branch).
- `selectAllPeaks()` and its button removed; the results-panel header comment rewritten to say why
  there is no Select All. `selectNoPeaks()` untouched.

**Tests 426 → 430** (+6 new, −2 removed): `DefinitiveModeUniqueness` suite D11–D16 covering all six
cases above. Parity clean at 79 groups.

**Correction to the verification, found while editing:** there were **four** uses of
`selectAllPeaks()` in the tests, not three. The two named in the plan were deleted with the feature;
**two** incidental setup uses were rewritten to select explicitly — `noneMode_returnsEmpty`
(`AnnotationStateTests.swift:237`) *and* `selectNoPeaks_clearsAll` (`:119`), which the earlier count
missed.

**Open question for the user — legacy files, NOT addressed here.** `loadMeasurement` restores
`selectedPeakIDs` straight from the file, with no enforcement. A measurement saved before Phase 5 can
therefore contain two selected Top peaks, and loading it reproduces that state; the invariant then
holds for every subsequent interaction but not for what is on screen at load. Deliberately not
"fixed" on my own initiative, because silently changing what a saved measurement shows is the user's
call: heal on load, leave as-is, or flag it.

**Run-review script:** select a second Top → the first deselects and its row still reads Top ·
relabel an already-selected peak to Top → it becomes the definitive Top and the previous one is
displaced · relabel an *unselected* peak to Top → nothing about the selection changes · relabel the
definitive Top to a freeform name → Top has no definitive peak and nothing is promoted · select
several Dipole peaks → all stay · Select None → all peaks keep their mode labels · confirm the Select
All button is gone and Select None and the wand still work.

### Port ledger — Phase 5

**Rule.** At most one **selected** peak per Air / Top / Back — the selected one is the *definitive*
Air/Top/Back. Classification is independent and unconstrained (many peaks per mode); deselecting never
relabels. Dipole / Ring / Upper allow several. The invariant is maintained in ONE place, called from
the only two things that can break it: selecting a peak, and changing the mode of an already-selected
peak. Never auto-promote. Resolve the mode via the **override-aware** path.

**Swift.** `singleHolderModes` + `enforceDefinitiveModeUniqueness(preferring:)`, called from
`togglePeakSelection` (select branch) and `setModeOverride` (both threads). `selectAllPeaks()` + its
one button removed; `selectNoPeaks()` kept.

**Python (UNVERIFIED — confirm at port time).** `toggle_peak_selection` / `set_mode_override` in `tap_tone_analyzer.py` — same enforcement,
resolving mode through the override-aware accessor (`peak_mode`, NOT `identified_modes`). Remove the
Select All action + button; keep Select None. **Also required first:** Python's selection UI is not
routed through the analyzer today ([[project_peak_selection_slider_bug]]), so the enforcement has
nowhere to live until that routing lands — a prerequisite, not a detail.

**Web (UNVERIFIED — confirm at port time).** `state/tapToneAnalyzer.ts` selection actions; remove the Select All control in `App.tsx`.
Same override-aware resolution.

**Tests, slug `test/annotation-state`.** New `DefinitiveModeUniqueness` suite, six cases: second Top
displaces first (and the displaced peak stays classified Top); Dipole allows several; override an
already-selected peak into Top displaces the holder; override an *unselected* peak changes no
selection; override the definitive Top away leaves it holderless (no promotion); Select None leaves
classification intact. **Deleted with the feature:** `selectAllPeaks_selectsAllCurrentPeaks`,
`selectAllPeaks_setsModifiedFlag` — the ports delete their twins, they are not re-created.

### Reset-to-Auto label fix — independent bug, found in the Phase 5 run-review

**Not a lifecycle phase.** Predates the rework; ported alongside Phase 5 because it was fixed here.

**Rule.** The "Reset to Auto-Detected (X)" menu item names the mode the reset **restores to** — the
override-blind auto-classification — not the peak's current (possibly overridden) label. Applies to
the two interactive paths (desktop menu + iOS sheet); they must not diverge. Read-only rows show no
reset item, so they are unaffected.

**Swift.** New model accessor `autoDetectedMode(for:)` (override-blind: reads `identifiedModes`,
falls back to `classifyAll`). `CombinedPeakModeRowView` gains an `autoDetectedMode` parameter used by
both reset labels; the Results call site passes it; `MeasurementDetailView` (read-only) needs
nothing. `.unknown` is shown parenthesised like any other mode (user: *"Unknown is unknown - a
legitimate state"*).

**Python / web (UNVERIFIED — confirm at port time).** Both have the same reset control and the same latent bug — the reset label reads the
current mode. Add the equivalent override-blind accessor and feed it to the reset label on both
platforms, both interactive paths, no divergence. **Verify** each has the desktop-vs-mobile split
Swift has before assuming two paths.

**Test, slug `test/annotation-state`.** `autoDetectedMode_ignoresOverride` (D8b): a peak overridden to
another mode still reports its auto-detected mode. Both ports need the twin.

---

## Phase 6 — Derived values unified

- `getPeak(for:)` / `calculateTapToneRatio()` (`+AnalysisHelpers.swift:75-102`) → the **selected
  holder** of the mode.
- **AND the mode must be the EFFECTIVE one — respect user overrides.** Found in the Phase 4a
  run-review (user, 2026-07-22): *"If I rename the top peak to unknown and then reanalyze there is
  still a tap ratio shown - although there is now no top peak identified."*

  Same shape as Phase 4, different predicate. There are two notions of "what mode is this peak":
  `peakMode(for:)` (**override-aware**, used by the results table, the dot layer and the annotation
  badges) and `identifiedModes` (**override-blind** — `reclassifyPeaks()` builds it straight from
  `GuitarMode.classifyAll(allPeaks)`). `getPeak(for:)` reads the second. So renaming the Top peak
  removes it from every display surface while `identifiedModes` still files it as Top, and the ratio
  divides by a peak the app is simultaneously reporting is not a Top.

  Phase 4 unified the *"is this unknown?"* question; this is the *"which mode is it?"* question,
  still split. Expect `TapToneMeasurement.tapToneRatio` to share the blindness — on-screen and saved
  values would then agree with each other while both being wrong, so agreement is not sufficient
  evidence here.

  Predates the whole lifecycle rework; not introduced by any phase. Deferred from 4a deliberately
  (user: *"log it in phase 6 so we can close out 4a"*).
- `TapToneMeasurement.tapToneRatio` (`TapToneMeasurement.swift:476-483`) → the same rule, replacing
  "first Air/Top in array order".
- Legacy `selectedPeakIDs == nil` keeps meaning "all"; identical result, no migration.

**Scope note:** this phase is the *aggregate* measurement's derived values. Anything per-tap belongs
to **Phase 3**. (An earlier revision routed a supposed per-tap `resolvedModePeaks` divergence here and
then to Phase 3; it was retracted as not real — see Phase 3.)

**Risk:** medium — numbers change for any measurement where a winner was deselected (intended).
**Test:** the on-screen ratio and the saved-list ratio agree for the same measurement.

### ✅ Phase 6 CORE COMPLETE — suite green (441), parity clean + USER-VERIFIED (2026-07-22). Committed `4984ed0` (with 6b).

**One rule, one resolver.** Added `GuitarMode.effectiveMode(override:auto:)` — a resolvable override
wins, a freeform override → `.unknown`, else the auto-classification. The single definition of
"which mode is this peak, really." `peakMode(for:)` now delegates to it (behaviour-preserving; D7/D8
pass unchanged).

**The definitive peak** — the *selected* peak whose *effective* mode is that mode:
- Analyzer `getPeak(for:)` rewritten to this. Fixes the user's bug: rename the Top peak and
  `getPeak(.top)` → nil → no ratio, matching every other surface. Deselecting the Top does the same.
- `TapToneMeasurement.tapToneRatio` gets a `definitivePeak(for:)` helper applying the identical rule
  over `effectiveSelectedPeakIDs` (guitar: saved selection or all; material: all, moot). The
  prediction held exactly — the struct ratio was override-blind AND selection-blind (`peaks.first`,
  array order). Both ratios now compute by one rule and cannot disagree.
- `resolvedModePeaks` (static) gained an `overrides:` parameter and is override-aware; the on-screen
  **multi-tap averaged row** now passes `analyzer.peakModeOverrides` through
  `MultiTapComparisonResultsView`.

**Legacy heal at decode** (Decision 1, agreed): guitar files with a nil selection are auto-selected
to the definitive set; a pre-Phase-5 selection holding two Air/Top/Backs is pruned to the strongest
per mode. Sets the same `wasHealed` flag as the duplicate-peak heal, so the library re-saves
identically (Decision: *"if one change forces a save the other should"*). Also closes the Phase 5
open question — a loaded legacy file can no longer show two selected Tops.

**Scope limit, logged not skipped:** `ComparisonEntry` carries no `peakModeOverrides`, so the
cross-measurement comparison tables/PDF and the multi-tap **PDF** averaged row still resolve modes
override-blind. Making them override-aware needs overrides stored in `ComparisonEntry` — a
`.guitartap` schema addition. **Follow-up item, not part of Phase 6.**

**Two visible changes to expect on existing files** (both intended, both flagged to the user): a
legacy saved-list ratio may move (old rule was `peaks.first` = lowest-frequency, ~meaningless), and a
legacy multi-tap file with a bad selection is silently corrected + re-saved on first load.

**Tests +10 (431 → 441).** Analyzer `DefinitivePeakAndRatio` D17–D20 (selected-holder-not-strongest;
the rename-drops-ratio repro; deselect-drops-ratio; override-retargets-Top). Struct `TapToneRatio`
+3 (freeform override → nil; override retargets Top; deselected Top → nil). `SelectionHealOnDecode`
+3 (nil → healed; two Tops → pruned; valid → not reflagged). Slug `test/annotation-state` +
`test/measurement-codable`.

**Run-review script:** rename the Top peak → the ratio disappears (screen and PDF); deselect the Top
→ ratio disappears; relabel another peak to Top → ratio returns using it; open an old multi-tap or
guitar measurement saved before this work → it shows a sensible ratio and (if its selection was bad)
is silently repaired; on-screen ratio == saved-list ratio for the same measurement.

### Port ledger — Phase 6

**Rule.** Every derived "the Air/Top/Back" value reads the **definitive** peak: the *selected* peak
whose *override-aware* mode is that mode. One shared effective-mode resolver feeds the analyzer, the
saved measurement's ratio, and the static resolver. Legacy files are healed to a valid definitive
selection on read, re-saving under the same flag as the duplicate-peak heal.

**Swift.** `GuitarMode.effectiveMode(override:auto:)`; `peakMode` delegates; `getPeak` → definitive;
`TapToneMeasurement.definitivePeak(for:)` + `tapToneRatio`; static `resolvedModePeaks(overrides:)`;
`MultiTapComparisonResultsView` averaged row; decode heal in `init(from:)`.

**Python / web (UNVERIFIED — confirm at port time).** Both have the same two blind ratios (a live
`calculate_tap_tone_ratio` reading auto-classification, and a saved-measurement ratio) and both need
the shared effective-mode resolver + definitive-peak rule. Expect the same `ComparisonEntry`-style
limitation for comparison paths. The decode heal maps to each platform's measurement-decode path
(Python `TapToneMeasurement` decode / web reader); mirror the "same repair, same re-save" contract.

**Tests, slugs `test/annotation-state` + `test/measurement-codable`.** D17–D20, the three struct-ratio
override/selection cases, and the three decode-heal cases. **Fixture caution recorded for the ports:**
mode-band frequencies are per guitar type — the Swift tests broke twice on frequencies assumed to be
in a band that weren't (classical Top is 170–230, generic 140–260). Pick fixture frequencies against
the actual band table, and put a peak below the Back lower bound when you need it Top-only.

### Phase 6b — Definitive modes for the two override-blind surfaces  ✅ COMPLETE, suite green (447), parity clean, USER-VERIFIED. Committed `4984ed0`.

**Multi-tap Averaged-row bug found + fixed in run-review (2026-07-22, USER-VERIFIED).** The Averaged
row used `resolvedModePeaks` (strongest-per-mode over a re-classified subset), so overriding an
out-of-band peak to Top showed a louder Back-band peak as Top and left Back empty (user's 3-tap file:
Top→138.2 gave Top=233, Back empty). Root cause: it wasn't the definitive rule the rest of the app
uses. Fix: the Averaged row is now `analyzer.definitiveModeInfo()` / `measurement.definitiveModeInfo()`
(= `getPeak` per mode + an override flag); per-tap rows stay each tap's own auto-classification (a
tap's peaks are unrelated to the averaged override — user's call, no frequency-matching). An
overridden Averaged value is shown **italic with `*`**, the SAME convention page 1's peak table uses
(user asked for consistency; replaced an earlier tag glyph). Tests D21/D22. **Comparison-measurement
self-describing behaviour (Track 1) built but not separately run-reviewed yet.**

**Documentation deliverables now captured** — see the "Documentation deliverables" section under Phase
8. The `.guitartap` `modePeakIDs` field must be documented in the manual's format appendix with its
introducing version.

Found after the Phase 6 core landed: two surfaces still resolve modes override-blind. The user
corrected a conceptual conflation I was making — **these are two UNRELATED things** that merely share
the `ComparisonEntry` struct as a container, and must be kept separate:

**Track 1 — Comparison MEASUREMENT (overlays several *separate* saved measurements). NEEDS A FORMAT
CHANGE.** It aggregates *other* measurements, so their override context is not otherwise in this file.
User ruling (2026-07-22): *"If a user decides that Top is different from the auto and saves that in
the measurement then the comparison has to use it."* Approach chosen = **B (store the resolved
mapping, not the overrides)**, because the file must be self-describing — an independent reader must
reproduce the displayed Air/Top/Back **without reimplementing `classifyAll`** and without needing
override data that would be absent. Decisions locked:
- Add `modePeakIDs: [String: UUID]?` to the persisted `ComparisonEntry` **and** the in-memory
  `comparisonSpectra` tuple (`TapToneAnalyzer.swift:1116`), keyed by canonical mode name
  (`{"Air (Helmholtz)": uuid, "Top": uuid, "Back": uuid}`) so Python/web read it directly. Peak IDs
  reference the entry's own stored peaks — self-contained. (User: *"As long as peakID works on all
  ports then peakID is fine"* — peak UUIDs already round-trip in the format on all 3; **pin this as a
  must-verify in the port ledger, don't assume**.)
- Populate at **build-from-source** (`+MeasurementManagement.swift` ~975, `spectraAndSnapshots`,
  where the full source `TapToneMeasurement`s with overrides are in hand): definitive mode→peakID via
  the effective-mode rule.
- Build site to persist: `saveComparison` (`+MeasurementManagement.swift:1028`, the only ComparisonEntry
  construction that is saved).
- Render: `ComparisonResultsView.swift:30` (on-screen, reads the tuple) + the saved-comparison PDF
  read the stored mapping; re-derive only as a fallback when absent.
- **Heal legacy on decode + re-save** (`ComparisonEntry` decode / measurement decode), same
  `wasHealed`-style contract. Caveat, accepted: a pre-existing saved comparison never stored
  overrides, so its heal reproduces only what the old app showed (override-blind); comparisons created
  after this change are fully correct. No way to recover an override never written.

**Track 2 — Multi-tap MEASUREMENT (one measurement, many taps). NO FORMAT CHANGE.** All its data —
`peaks`, `selectedPeakIDs`, `peakModeOverrides`, `tapEntries` — is already in its own `.guitartap`
file. The averaged row just resolves override-aware from data it already owns; per-tap rows stay
positional (different UUIDs, no per-tap overrides). **On-screen averaged row is already done** (Phase
6 core: `MultiTapComparisonResultsView` takes `overrides`). Remaining = the **three multi-tap PDF
paths** pass `peakModeOverrides` to `resolvedModePeaks` inline: `TapToneAnalysisView+Export.swift:389`
(uses `tap.peakModeOverrides`), `MeasurementDetailView.swift:300` and `MeasurementsListView.swift`
(use `measurement.peakModeOverrides`). The `ComparisonEntry` reuse here is a throwaway PDF container,
**not** a comparison — keep that distinction in the code comments and the ports.

**Was about to start building both tracks when the user broke.** Next action: get the go (Track 1
changes the `.guitartap` format) and build.

### What was built (Swift)

**Track 1 — comparison measurement (format change).** New `ComparisonEntry.modePeakIDs: [String:
UUID]?` — the definitive `{mode name: peak id}` per overlaid spectrum, resolved override-aware from
the source at build (`loadComparison(measurements:)` via `measurement.definitivePeak(for:)`). Carried
on the in-memory `comparisonSpectra` tuple (added a `modeIDs` element — the compiler found all tuple
sites; the multi-tap chart-overlay population sets `[:]` since its table is separate). `saveComparison`
persists it; `loadComparison`-from-entries reads it; `ComparisonResultsView`, the on-screen detail
view, and both comparison PDFs read the stored map (`ComparisonEntry.modeFrequency(_:)`), re-deriving
positionally only as a fallback. **Legacy heal at decode:** a pre-6b entry (nil `modePeakIDs`) is
filled positionally and flagged `wasHealed` → the library re-saves, same contract as the other heals.
Self-describing: a reader reproduces the table by peak-ID lookup, no `classifyAll`, no override data.

**Track 2 — multi-tap measurement (no format change).** The three multi-tap PDF averaged rows now
pass the measurement's own `peakModeOverrides` to `resolvedModePeaks` (a no-op for per-tap rows —
disjoint UUIDs). On-screen was already done in the Phase 6 core.

**Tests +4 (441 → 445), `ComparisonModePersistence` suite:** a source override shows as the
comparison's Top; `modeFrequency` reads the stored map even when it deliberately disagrees with
`classifyAll` (proves the file is authoritative); `modePeakIDs` round-trips; a legacy entry heals +
flags re-save. Slug `test/comparison`.

**Run-review:** compare measurements where one has a renamed Top → the comparison table + PDF show the
rename; save, reload → still correct; open a comparison saved before this build → sensible values, and
it re-saves; a multi-tap PDF's Averaged row respects an override.

### Port ledger — Phase 6b

**Rule.** A comparison measurement stores its resolved definitive Air/Top/Back as **mode→peakID** per
overlaid spectrum (computed override-aware from each source), so the saved file is self-describing —
reproducible by peak-ID lookup without re-running classification or needing the sources' overrides.
Multi-tap tables need no format change: they resolve override-aware from the single measurement's own
already-stored data. **These two are unrelated — keep them conceptually separate in code and ports.**

**Swift.** `ComparisonEntry.modePeakIDs` + `modeIDMap`/`modeFrequency`; `comparisonSpectra` tuple gains
`modeIDs`; populate at `loadComparison(measurements:)`; persist at `saveComparison`; read at every
comparison render; decode heal. Multi-tap: overrides passed inline at the 3 PDF sites.

**Python / web (UNVERIFIED — confirm at port time).** Add the `modePeakIDs` field to the comparison
entry in each platform's `.guitartap` reader/writer (Python `ComparisonEntry` twin, web reader),
keyed by the SAME canonical mode names. **VERIFY peak UUIDs round-trip through comparison entries on
each platform before relying on peakID** (user's condition) — if a platform doesn't preserve them,
that must be fixed first. Populate override-aware at build; heal legacy on read + re-save. Multi-tap:
pass the measurement's overrides to the averaged-row resolution.

**Tests, slug `test/comparison`.** The four above. The self-describing test (stored map wins over
`classifyAll`) is the important one — it pins that the reader must NOT re-classify.

---

## Phase 7 — The remaining triggers

Each bullet verified against the current code 2026-07-22; line numbers refreshed. Decisions taken with
the user in discussion — recorded here because the reasoning is not obvious from the diff.

- **1. Guitar-type change — `Option 1` (clean slate). DECIDED with the user.** Today
  `TapToneAnalysisView+Layouts.swift:105-106`/`:255-256` call `reclassifyPeaks()` +
  `resetToAutoSelection()` on **every** non-measurement-changing Settings→Apply, wiping manual
  selection even on a display-only change (Peak Min, dB, range). Fix: fire this **only when the guitar
  type actually changed**, and on that change treat it as a full re-derivation for the new type —
  reclassify, clear `peakModeOverrides` (labels were made against the *old* bands' meaning),
  re-auto-select. One-sentence contract: *"Changing the guitar type re-analyses every peak for the
  new type; manual labels and selections are cleared."*

  *Rejected `Option 2` (preserve overrides + selections, re-map the rest):* more respectful of manual
  work but cannot be stated without an "except", and has a genuinely ambiguous case Option 1 avoids —
  a peak manually *selected but not labelled* whose mode flips under the new bands (still "my Top", or
  now "the Back"?). Consistency also favours Option 1: a full measurement-type change already
  re-captures, so a guitar-subtype change re-deriving (without re-capture) is the natural softer
  analogue, and an override made under the old bands can mislead under the new.

- **2. Unconditional `peakMinThreshold` write** (`TapSettingsView+Actions.swift:152`) — **CANCELLED.**
  The plan item predates Phase 2. That write fires the didSet, but Phase 2 reduced the didSet to a
  cheap non-mutating `refreshDisplayedPeaks()`, so it is now harmless. Nothing to do.

- **3. Analysis frequency range → REPLACED: remove the SETTING, keep the concept as a constant.**
  DECIDED with the user 2026-07-22. The original bullet (re-analyze on range change) is moot because
  the setting is going away. The analysis range is legacy — the user has **never** changed it and sees
  no reason to. It is a real, fixed bound on where useful modes live (**30…2000 Hz**: 30 reaches the
  material fLC; nothing useful above 2000). Verified default is exactly 30/2000, single value, and it
  is **NOT persisted in the `.guitartap` format** (UserDefaults only). So:
  - `TapDisplaySettings.analysisMin/MaxFrequency` become constants returning the 30/2000 defaults (no
    UserDefaults read/write). `findPeaks` still restricts detection to the range — **the concept
    stays, only the knob goes.** Zero behavioural change (everyone used the default).
  - Remove the two analysis-frequency fields + their validation from the Settings sheet; the old
    UserDefaults keys are left orphaned (harmless, ignored).
  - **Do not touch the display/pan-zoom range** — separate concept, stays user-controllable.
  - The old UI bound the analyzer's `minFrequency`/`maxFrequency` to those fields; confirm they simply
    stay seeded at the constant once the bindings go.
  - **Checked read-only surfaces (Swift, 2026-07-22):** NOT shown in the Measurement Details pane or
    any PDF/export. It DID appear in **two in-app Help entries** (`HelpView.swift`: the "Analysis
    Frequency Range" row and an "Advanced Settings" mention) — both removed. So the surfaces to clear
    per platform are: the **setting control**, the **in-app Help/manual entry**, and a check that it
    is not shown read-only in details/exports.
  - **All three platforms (user emphasised):** the setting, its UI, AND its in-app help text exist on
    Python and web too. Phase 9 removes all of them there; check each platform's details/export
    surfaces as well. Swift analyzer keeps `minFrequency`/`maxFrequency` seeded from the 30/2000
    constant (mechanism unchanged) — mirror that (keep the detection range, drop the knob).
  - **Doc:** user-visible removal → release notes + a manual note (settings + any manual section that
    described the analysis range), all three platforms.

- **4. `startTapSequence` state leak** (`+Control.swift`): CONFIRMED. It clears `allPeaks` /
  `identifiedModes` but **not** `peakModeOverrides`, `peakAnnotationOffsets`, `selectedPeakIDs`,
  `selectedPeakFrequencies`, `userHasModifiedPeakSelection` — stale entries (dead UUIDs, invisible on
  screen) get written into the next measurement's file. Clear them all in `startTapSequence`.

- **5. Material `isGuitar` guard** — likely already satisfied: the Peak Min projection is guitar-gated
  in `refreshDisplayedPeaks()`, so material is never filtered. Confirm at build; probably a no-op or a
  clarifying comment.

**Risk:** low individually; several small independent fixes.

### ⏳ Phase 7 CODE WRITTEN — suite green (447), parity clean, NOT yet run-reviewed. UNCOMMITTED.

**Done:** item 1 (guitar-type change = clean slate via `reclassifyForGuitarTypeChange`, gated on the
type actually changing; display-only Applies leave selection/classification alone; the wand stays the
pure-auto action); item 3 → the analysis-range **setting removed** (fixed 30–2000 constant; UI + help
gone; no format change); item 4 (`startTapSequence` now clears `peakModeOverrides`,
`peakAnnotationOffsets`, `selectedPeakIDs`, `selectedPeakFrequencies`, `userHasModifiedPeakSelection`
— no leak into the next file). Item 2 cancelled (obsolete). Item 5 confirmed already satisfied
(projection is guitar-gated). No new model tests — items are UI-triggered; covered by run-review.

### Crash fix — `TapToneAnalyzer` deinit Combine race (found during Phase 7 testing)

A user-supplied crash report (and an intermittent suite abort — 301 tests in 3 s then SIGSEGV) showed
`TapToneAnalyzer.deinit` → `Set<AnyCancellable>` teardown → `PublishedSubject.Conduit.cancel()` →
`os_unfair_lock_lock` at `0x0`. Root cause: the analyzer subscribes to `fftAnalyzer.$magnitudes` /
`$frequencies` / … via `.receive(on:).sink` in `cancellables`; the **synthesized** deinit releases
stored properties in an unspecified order, so when `fftAnalyzer` (and its `@Published` subjects)
released before `cancellables`, cancelling a subscription locked a **freed** subject. Fix: an explicit
`deinit { cancellables.forEach { $0.cancel() } }` — the deinit body runs before ivar release, so
subscriptions tear down while the subjects are alive; the later release drops already-cancelled
(idempotent) cancellables.

**Scope/severity, verified — NOT a user-facing crash:** the app holds exactly **one**
`TapToneAnalyzer` per session (macOS single `Window` +
`applicationShouldTerminateAfterLastWindowClosed → true`; iOS single `WindowGroup` with URL routing),
so it only deinits as the app terminates, where a teardown crash is invisible. The suite hit it
because it creates/destroys thousands of analyzers. Only theoretical user path = iPad multi-window
scene close, and even then it is a race. Latent since the subscriptions were added; **not** a Phase 7
regression. Kept because it is cheap, correct, and unblocks the suite. Verified: full suite green
(447) across repeated runs (a race is made unlikely, not proven gone).

### Port ledger — Phase 7 (+ analysis-range removal + deinit fix)

**Rules.** (1) A guitar-type change re-derives classification and selection for the new type and
clears manual labels (clean slate); a display-only settings change disturbs nothing; the pure-auto
reset stays reachable (the wand). (2) A new capture clears ALL per-peak state so nothing leaks into
the next file. (3) The analysis range is a fixed 30–2000 constant, not a setting. (4) Tear down
`@Published` subscriptions deterministically in `deinit`.

**Swift.** `reclassifyForGuitarTypeChange`; `onApply(measurementChanged:guitarTypeChanged:)`;
`startTapSequence` clears; `analysisMin/MaxFrequency` constants + Settings/Help removal; explicit
`deinit`.

**Python / web (UNVERIFIED — confirm at port time).** Same four rules. The analysis-range setting +
its UI + in-app help exist on both — remove all three, keep detection fed by the 30–2000 constant,
and check each platform's details/export surfaces. The Combine-deinit race is Swift-specific; the
Python/web equivalents (Qt signal teardown / React effect cleanup) have their **own** lifecycle — do
NOT transcribe the deinit; verify each platform's teardown independently (Python has a related
QObject GC race pattern: [[project_python_playback_gc_race]]).

**Tests.** No new unit tests (UI-triggered behaviours + a deinit race); covered by the run-review
script. Both ports: add run-review items, not unit tests, for these.

### Run-review script — Phase 7 (owed; user runs it, then commit)

1. **Guitar-type change = clean slate.** Override a peak's mode and select a couple of peaks; Settings
   → change guitar type (Classical → Flamenco) → Apply → everything re-classified for the new type,
   manual labels cleared, fresh auto-selection.
2. **Display-only Apply disturbs nothing.** Same measurement; change only Peak Min or dB (leave type)
   → Apply → selection and labels untouched.
3. **Wand still = pure auto.** Press the wand → selection resets to pure auto.
4. **No state leak.** On a measurement with a custom label + a dragged annotation + a selection: save;
   New Tap; capture a fresh measurement; save; reload → the new file has none of the previous
   labels/offsets/selection.
5. **Analysis-range setting gone.** Settings → no "Analysis Frequency Range" field; detection still
   finds peaks; Help no longer lists it.
6. **Material unaffected.** Plate/brace: Peak Min disabled, L/C/FLC identified as before.
7. **(deinit fix)** Sanity: general use, quit/relaunch cleanly. (Not reliably user-observable — a
   teardown race only exercised at scale; the suite is the real evidence.)

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
3. **Documentation deliverables (below) complete** — the plan is not done until these are.
4. Only then: Python, then web.

---

## Documentation deliverables — REQUIRED before the lifecycle plan is complete

Flagged by the user 2026-07-22: *"we have to update the user manual with the file format changes …
and the version that they are made in. This is in addition to any behavioral changes as well as the
changes in the release notes."* These were missing from the plan. All three must be done, on **all
three platforms** where applicable, and each format change must name the **version/build it was
introduced in** (build number = `git rev-list --count HEAD`; fill in at ship time). Editable doc
surfaces per repo: see [[project_doc_surfaces]]. Manual audience: [[project_user_manual_audience]].

### 1. `.guitartap` file-format changes (manual App. B / format appendix + the reader/writer docs)

**Verified 2026-07-22 by diffing every format struct against the tagged `1.0.1` source (build 332):
exactly TWO format additions since 1.0.1, no others.** `SpectrumSnapshot`, `TapEntry`, `ResonantPeak`
and `UserAssignedMode` are unchanged. Both additions are backward-compatible optional fields
(tolerant reader / minimal writer).

| Field | Struct | Introduced | Status |
|---|---|---|---|
| `userModifiedSelection` | `TapToneMeasurement` | **1.0.2** (build 398, released) | shipped |
| `modePeakIDs` | `ComparisonEntry` | **next version** (Phase 6b) | uncommitted at time of writing |

- **`userModifiedSelection`** — manual/auto selection-persistence flag; legacy files with no field
  default to manual (`true`). Shipped in **1.0.2** but **may not yet be in the manual's format
  appendix — audit and add it, named with version 1.0.2.**
- **`ComparisonEntry.modePeakIDs`** — `{canonical mode name: peak UUID}`; makes a saved comparison
  self-describing. Document field, shape, and its ship version (fill in at ship time).
- **Re-save-on-heal behaviours** (schema unchanged, written content changes on first load of an old
  file): the selection heal (nil / invariant-violating guitar selection → definitive set) and the
  comparison-entry heal. Note that opening + saving a pre-lifecycle file normalises it.

### 2. Behavioural changes (user manual body)

The user-facing behaviour the lifecycle phases changed — each needs a manual pass:
- Peak Min is **display-only** — hiding a peak never un-detects, un-selects, un-classifies or
  un-labels it; a hidden peak returns exactly as left (Phases 1–2, 4a).
- **Naming a peak makes it known** — a custom-labelled peak stays visible with Show Unknown Modes off
  (Phase 4).
- **Definitive Air/Top/Back** — at most one selected per mode; the selected one is *the* Air/Top/Back
  and drives every derived value (ratio, PDF, list, multi-tap Averaged row); **Select All removed**,
  Select None kept (Phases 5–6).
- **Ratio & derived values respect overrides** — rename the Top and the ratio/derived values follow
  or clear (Phase 6).
- **Multi-tap Taps table** — per-tap rows are each tap's own auto-classification; the **Averaged row**
  is the definitive (override-aware) result, an overridden value shown *italic with `*`*, matching
  the PDF peak table (Phase 6b + fix).
- **Reset-to-Auto** menu names the auto-detected target mode, not the current label (reset-label fix).
- Peak Min **disabled for material**; Save enabled whenever a measurement exists (even with all peaks
  hidden) (Phase 4a).

### 3. Release notes (per repo, per [[project_release_notes_conventions]])

Summarise the behavioural changes above for users, plus a one-line note that the `.guitartap` format
gained a comparison field (self-describing comparison modes) and that older files are upgraded
automatically on open. Match wording across Swift / Python / web when the ports land.

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

### ⚠️ Re-verify every Python and web claim in the ledgers at port time

**The ledgers' cross-platform entries are a map of where to look, not evidence of what is there.**
Treat each one as a starting point to be re-checked against the code, never as a fact to build on.

This is not generic caution. Over the Phase 3 and 4a work the following went into these documents
stated as fact and were wrong, each caught only because the user challenged it:

- an instance-vs-static `resolvedModePeaks` divergence that does not exist — the call sites were
  traced, the *inputs* to them were not (retracted in Phase 3);
- Python having "four call sites, one more than Swift" — the fourth was a **docstring mention**
  inside a Qt repaint handler (corrected in the Phase 3 ledger);
- ten `.disabled(currentPeaks.isEmpty)` guards described as covering the export buttons — they cover
  Annotations and Save; the export buttons have no guard at all (corrected in Phase 4a).

The failure mode is consistent: **a grep hit counted as evidence without opening it**, and confidence
tracking how much reasoning went in rather than how much was actually read. Two of those three
claims lived in this file, trusted, until challenged.

That matters more here than anywhere else in the plan. A wrong claim in conversation costs a
correction; a wrong claim in this file becomes the specification Python and the web are built against
months later, when nobody remembers which entries were read and which were assembled. So at port
time: open the cited file at the cited line, confirm it says what the ledger claims, and correct the
ledger in the same change when it does not. **A ledger entry that cannot be confirmed is a bug in
the ledger, not a feature to implement.**

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