# 6-TEST — Cross-Platform Test Normalization

**Status:** Phase 1 done (reviewed). **Phase 2 (web→Swift-spine naming) — structural moves DONE**, green
(web 144 · Python 376). Internal test-name alignment deferred per-file to Phase 3. Created 2026-07-09.
Tracked as the last open Phase-6 item (see `PHASE6-PARITY.md` § 6-TEST) and in `STATUS.md`.

### Progress log
- **Phase 1 (2026-07-09):** analysis + coverage matrix + name-map ledger + coverage-gap mechanism. Reviewed.
- **Phase 2a:** renamed 9 cleanly-tagged web files to canonical slugs (gated-fft, peaks, pitch, classify,
  decay-tracking, measurement-codable, tap-decisions, comparison, display-range); fixed stale `peaks.ts` ref.
- **Phase 2b:** `g11`→`file-playback`; folded `spectrum-average`→`peaks` (mirrors Swift PeakFindingTests);
  split web `g4b-material`→`brace`+`plate`; folded gated `g3b`+`g3c`→`gated-capture` (`test/gated-capture`,
  web-extra); `g3d-guitar`→`guitar-fft` (`test/guitar-fft`, web-extra); **split Python
  `test_material_properties.py`→`test_plate.py`+`test_brace.py`** to match Swift's two-file split. Two
  earlier mis-tags fixed (g3b/g3c were on the physics slugs). Refinements vs the confirmed forks: Fork 3's
  `dsp.test.ts` is a Phase-3 backfill (web tested parabolic/Q only via findPeaks); `g3d` → `guitar-fft`
  (not gated). All green.
- **Remaining Phase 2:** tag/place the still-untagged web files (`g0-wav`, `g3a-calibration`,
  `calibration-store`, `analysis-quality`, `g6/g7/g8/g9`) — these are the reverse-gap behaviors handled with
  Swift/Python in Phase 4; and per-file internal name alignment (Phase 3).
- **Phase 3 (2026-07-09) — behavioral backfill + restructure, IN PROGRESS, UNCOMMITTED:**
  - Built web `src/state/tapSession.ts` (the web's TapToneAnalyzer-equivalent lifecycle state machine) +
    ported the 5 behavioral suites (button-enablement, state-invariants, scenario-trace, start-tap-race,
    measurement-complete); extracted `src/state/buttonEnablement.ts` and wired it into `App.tsx`.
  - Discovery during that wiring surfaced **PC-1** (the Cancel-behavior parity bug) + PC-2/3/4; see the
    "Parity cleanup" section. After a long design dialogue, the finalized rule was locked (see PC-1).
  - **PC-1 CODE-COMPLETE + VERIFIED ALL 3 (uncommitted):** Swift 317 · Python 378 · web 179 + build. `cancel*`
    re-arms via `start*TapSequence` everywhere; button rule → New Tap disabled ⟺ !complete, Cancel = review OR
    active-multi-step, Pause unchanged; B-series B1-B12; scenario S4 + measurement-complete cancel updated to
    re-arm. Web `App.tsx` `cancelTap` re-arms; button mapping dropped the `||cancelled` term.
  - **NEXT:** PC-1 docs (web Quick-Start + shared manual) + **user run-review all 3** → PC-2 (statusMessage) /
    PC-3 (instructionMessage) / PC-4 (web config-reset) → the full TapSession state-ownership consolidation
    (`useSyncExternalStore`; App reads isMeasurementComplete/currentTapCount/isDetecting from the session) →
    remaining pure gaps (frozen-peak-recalc, annotation-state guitar, import-persistence).

## Goal

One **shared, traceable test contract** across all three repos: the same *file names* and the same
*test names* for the same behavior, so "are the three testing the same thing?" is answerable at a
glance. Plus a rule that a change to shared behavior updates the test on **all three** platforms.

## Master definition (the spine)

**Swift `GuitarTap/GuitarTapTests/` is canonical.** `guitar_tap.xctestplan` runs the whole
`GuitarTapTests` target (non-parallel, no per-test enumeration), so the master list *is* the set of
Swift test files + their `@Suite`/`@Test` names. The intent has always been:

- **Python** was developed *from* the Swift definition — same file names (`<Name>Tests.swift` →
  `test_<name>.py`) and same test names. Today it mirrors Swift closely (one `@parity test/<slug>`
  marker per shared file).
- **Web** grew **organically** — a `g0`–`g11` "gate" scheme plus named files — and diverged. It must
  be **rewritten to match the Swift definition** (file + test names).
- Any **web-only** tests that pin real behavior (not web-plumbing) get **back-ported to Swift + Python**
  so coverage is equivalent everywhere.

### Naming convention (canonical → per-platform)
| Concept | Swift (master) | Python | Web (target) |
|---|---|---|---|
| File | `AnnotationStateTests.swift` | `test_annotation_state.py` | `annotation-state.test.ts` |
| Group | `@Suite("AnnotationOffsets")` | `class TestAnnotationOffsets` | `describe('AnnotationOffsets')` |
| Test | `@Test func storesOffsetByID()` | `def test_stores_offset_by_id()` | `it('stores offset by id')` |
| Link | `// @parity test/annotation-state` | `# @parity test/annotation-state` | `// @parity test/annotation-state` |

The web keeps its `G#` oracle code as a **secondary tag** inside the `describe()` (e.g.
`describe('AnnotationOffsets [was g—]')` only where it aids traceability), not as the filename.

## Inventory (this pass)

Swift **21** behavior files (+ `TestRunner.swift` bootstrap). Python **24** files. Web **23** files.
Swift↔Python are near 1:1 by name; the web is the outlier. Full per-file inventory is captured in the
coverage matrix below (built from a three-agent read-only inventory pass, 2026-07-09).

## Coverage matrix — canonical behavior (`test/<slug>`) × platform

Legend: ✓ dedicated suite · ◐ folded/partial · ✗ absent · — n/a. Cells marked ◐/✗ are the work items.

| # | Behavior (slug) | Swift | Python | Web | Note |
|---|---|---|---|---|---|
| **DSP / numeric** |
| 1 | dsp (parabolic + Q) | ✓ DSPTests | ✓ test_dsp | ◐ folded in g2-peaks | web merges vertex/Q into peaks |
| 2 | peaks (find/dedup) | ✓ PeakFindingTests | ✓ test_peak_finding | ✓ g2-peaks | |
| 3 | spectrum-average | ◐ in PeakFindingTests | ◐ in test_peak_finding | ✓ spectrum-average | folding inverted vs web |
| 4 | gated-fft | ✓ GatedFFTParityTests | ✓ test_gated_fft_parity | ✓ g1-gated-fft | |
| 5 | pitch | ✓ PitchTests | ✓ test_pitch | ✓ g4a-pitch | |
| 6 | classify | ✓ GuitarModeTests | ✓ test_guitar_mode | ✓ g4c-classify | |
| 7 | plate | ✓ PlatePropertiesTests | ✓ test_material_properties | ✓ g4b-material | Py/web fold plate+brace; Swift splits |
| 8 | brace | ✓ BracePropertiesTests | ◐ same file | ◐ same file | |
| 9 | calibration parse/interp | ✗ (only via file-playback) | ✗ (only via file-playback) | ✓ g3a + calibration-store | **reverse gap → add to Swift/Py** |
| 10 | analysis-quality (decay bands, ratio) | ◐ ratio in Codable | ◐ ratio in Codable | ✓ analysis-quality | **reverse gap → add to Swift/Py** |
| **Tap state-machine** |
| 11 | tap-decisions | ✓ TapDetectionTests | ✓ test_tap_detection | ✓ g5-tap-decisions | |
| 12 | decay-tracking | ✓ DecayTrackingTests | ✓ test_decay_tracking | ✓ g4d-decay | |
| 13 | measurement-complete | ✓ | ✓ | ✗ (implicit in g11) | **web gap** |
| 14 | state-invariants | ✓ | ✓ | ✗ | **web gap** |
| 15 | scenario-trace | ✓ | ✓ | ✗ | **web gap** |
| 16 | start-tap-race | ✓ | ✓ | ✗ | **web gap** |
| 17 | button-enablement | ✓ | ✓ | ✗ | **web gap** |
| **Annotation / persistence / settings** |
| 18 | annotation-state | ✓ | ✓ | ◐ material-only in g8 | **web gap: guitar path** |
| 19 | frozen-peak-recalc | ✓ | ✓ | ✗ (restore only) | **web gap** |
| 20 | comparison | ✓ ComparisonModeTests | ✓ test_comparison_mode | ✓ g10-comparison | |
| 21 | measurement-codable | ✓ | ✓ | ✓ g5-measurement-codable | |
| 22 | import-persistence | ✓ | ✓ | ◐ round-trips only | **web gap: library append** |
| 23 | display-range | ✓ DisplayRangeTests | ◐ wi6 | ✓ settings-display-range | |
| 24 | measurement-bridge / provenance | ◐ in loadMeasurement | ◐ | ✓ g6, g7 | reverse gap: web has explicit units |
| 25 | file-playback (end-to-end) | ✓ FilePlaybackRegressionTests | ✓ test_file_playback_regression | ✓ g3b/c/d + g11 | numeric backbone |
| **Platform-only (justified — keep, document)** |
| 26 | gesture zoom/pan math | ✓ SpectrumViewGestureTests | ✗ | ✗ | Swift-only (no @parity); web has code, no test |
| 27 | Qt plumbing (QTimer/QSettings/pyqtgraph) | — | ✓ wi1/wi10/comparison-guard | — | Python/Qt-only |
| 28 | effective-peak-id, tap-display-settings | (in analyzer) | ✓ wi2/wi6 (Qt-flavored) | ◐ | shared behavior, Qt harness — reconcile naming |

## Findings

1. **The spine already exists.** Swift + Python tag shared files with the *same* `@parity test/<slug>`.
   Normalization = make the **web speak the slug scheme** (rename files, align test names, add markers).
2. **Web's real gap is the tap state-machine + annotation/recalc suites** (rows 13–19, 22): ~8 behavioral
   suites Swift/Python have that the web lacks. Web is strong on DSP/oracle + persistence round-trips.
3. **Reverse gaps exist** (rows 9, 10, 24): calibration parse/interp and analysis-quality bands are
   dedicated *web* suites with no Swift/Python **unit** counterpart (only exercised indirectly). These
   back-port to the canonical repos.
4. **No shared `parity-oracle.json` in Swift/Python.** Only the web vendors the oracle; Swift/Python
   encode the same goldens as **hardcoded constants kept in sync by hand.** Decide in Phase 5 whether
   that stays (simplest) or Swift/Python read the oracle too.
5. **Folding differences** (rows 1, 3, 7/8): who splits vs merges dsp/peaks/average and plate/brace
   differs per platform. Decide: unfold to match Swift, or document as accepted.

## Coverage-gap detection via `@parity` linkage (how we make "missing" measurable)

The `@parity` map already carries what we need to detect gaps mechanically — two distinct cases:

**A. Missing on SOME platforms (1–2 of 3) — already detectable.** The `test/<slug>` groups exist;
`gen_parity_map.py --check` reports **orphan slugs** (a group present in only 1–2 repos). That *is* the
"which platform lacks this test" report. Today it **under-reports** for two fixable reasons, not slug
divergence (the web's *tagged* files already use canonical slugs): (1) **11 web files are untagged**, so
their behavior is invisible to the map; and (2) **two web tags sit on the wrong file** — `test/brace` /
`test/plate` are on `g3b-brace` / `g3c-plate`, which actually pin *file-playback* (they call
`gatedSingleTapPeak` on WAVs), while the brace/plate **physics** those slugs mean on Swift/Python lives in
the *untagged* `g4b-material`. **Phase 2 (tag the 11 + fix the two mis-tags + rename) makes `--check` an
accurate missing-on-some report** and a natural CI gate.

**B. Missing on ALL platforms (untested everywhere) — needs the impl↔test link.** A nonexistent test
carries no tag, so test tags alone can't show this. But the map **also tags production code** (44 impl
slugs: `dsp/*`, `model/*`, `view/*`, `audio/*`, `state/*`), and the generator already supports linking an
impl group to its test group via a **`tests=` attribute**:

```
@parity dsp/find-peaks tests=test/peaks
@parity dsp/material-properties tests=test/brace,test/plate   # many-to-many is supported
```

The generator treats a linked `test/*` group as the *equivalence evidence* for that impl. So
"untested on all three" = **every impl group with no `tests=` link** (or one pointing at a missing test
group). **Current state: only 7 of 44 impl groups declare a `tests=` link** — the machinery exists but is
unpopulated.

**Deliverables that turn this into a permanent, automatable answer:**
- **Populate `tests=` on every impl group** (fold into the name-map ledger; finish in Phase 5/6).
- **Add a coverage-gap report to `gen_parity_map.py`** — list impl slugs with no test evidence.
- Result: `--check` → missing-on-some; the new report → missing-on-all. Both become one-command CI gates.

## Name-map ledger (Phase 1 deliverable)

Authoritative file map, built from the exact `@parity` tags in all three repos (2026-07-09). Swift is the
master. Status codes: **RENAME** (web suite exists + correctly tagged → just rename file + align test
names) · **TAG+RENAME** (web suite exists but untagged) · **MIS-TAG** (web tag on the wrong file) ·
**GAP** (web suite absent → backfill, Phase 3) · **CONSOLIDATE/FOLD** (web splits or merges differently).

### 1. The 21 canonical behaviors (Swift master → Python → web)
| slug (`test/…`) | Swift file (master) | Python file | Web current | Web → target file | Web status |
|---|---|---|---|---|---|
| annotation-state | AnnotationStateTests | test_annotation_state | (partial in g8-material-load) | annotation-state.test.ts | **GAP** — guitar path absent; g8 = material offsets only |
| brace *(physics)* | BracePropertiesTests | test_material_properties | g4b-material *(untagged)* | brace.test.ts | **TAG+RENAME**; `g3b` is mis-tagged (see below) |
| button-enablement | ButtonEnablementTests | test_button_enablement | — | button-enablement.test.ts | **GAP** |
| classify | GuitarModeTests | test_guitar_mode | g4c-classify | classify.test.ts | RENAME |
| comparison | ComparisonModeTests | test_comparison_mode | g10-comparison | comparison.test.ts | RENAME |
| decay-tracking | DecayTrackingTests | test_decay_tracking | g4d-decay | decay-tracking.test.ts | RENAME |
| display-range | DisplayRangeTests | test_wi6 *(folded)* | settings-display-range | display-range.test.ts | RENAME; Python folds into wi6 |
| dsp *(parabolic+Q)* | DSPTests | test_dsp | *(folded in g2-peaks)* | dsp.test.ts | **FOLD?** split out to match Swift, or document |
| file-playback | FilePlaybackRegressionTests | test_file_playback_regression | g11 (+ g3b/g3c/g3d) | file-playback.test.ts | **CONSOLIDATE** — g3b/c/d = pure-DSP layer, g11 = engine layer |
| frozen-peak-recalc | FrozenPeakRecalculationTests | test_frozen_peak_recalculation | — | frozen-peak-recalc.test.ts | **GAP** |
| gated-fft | GatedFFTParityTests | test_gated_fft_parity | g1-gated-fft | gated-fft.test.ts | RENAME |
| import-persistence | ImportPersistenceTests | test_import_persistence | — | import-persistence.test.ts | **GAP** |
| measurement-codable | MeasurementCodableTests | test_measurement_codable | g5-measurement-codable | measurement-codable.test.ts | RENAME |
| measurement-complete | MeasurementCompleteTransitionTests | test_measurement_complete_transitions | (implicit in g11) | measurement-complete.test.ts | **GAP** |
| peaks | PeakFindingTests | test_peak_finding | g2-peaks | peaks.test.ts | RENAME (also holds folded dsp + spectrum-average) |
| pitch | PitchTests | test_pitch | g4a-pitch | pitch.test.ts | RENAME |
| plate *(physics)* | PlatePropertiesTests | test_material_properties | g4b-material *(untagged)* | plate.test.ts | **TAG+RENAME**; `g3c` is mis-tagged (see below) |
| scenario-trace | ScenarioStateTraceTests | test_scenario_state_trace | — | scenario-trace.test.ts | **GAP** |
| start-tap-race | StartTapSequenceRaceTests | test_start_tap_sequence_race | — | start-tap-race.test.ts | **GAP** |
| state-invariants | StateInvariantTests | test_state_invariants | — | state-invariants.test.ts | **GAP** |
| tap-decisions | TapDetectionTests | test_tap_detection | g5-tap-decisions | tap-decisions.test.ts | RENAME |

**Web gaps to backfill (Phase 3):** annotation-state (guitar), button-enablement, frozen-peak-recalc,
import-persistence, measurement-complete, scenario-trace, start-tap-race, state-invariants — **8 suites.**

**Two mis-tags to fix (Phase 2):** web `g3b-brace` and `g3c-plate` are tagged `test/brace`/`test/plate`
but pin **file-playback** (`gatedSingleTapPeak` on WAVs) — they belong under `test/file-playback`; the
brace/plate **physics** (currently untagged `g4b-material`) is what `test/brace`/`test/plate` mean.

### 2. Web-only suites → back-port to Swift + Python (reverse gaps, Phase 4)
| Web file | Pins | Proposed canonical slug | Swift/Python action |
|---|---|---|---|
| g0-wav | WAV decode/encode fidelity | `test/wav` (new) | add unit suite (or fold into file-playback) — impl `dsp/wav` |
| g3a-calibration + calibration-store | UMIK-1 parse/interp + device resolution | `test/calibration` (new) | add — impl `dsp/calibration` (only exercised via playback today) |
| analysis-quality | decay-quality bands + tap-tone ratio | `test/analysis-quality` (new) | add (ratio currently folded in Codable) — impl `dsp/analysis-quality` |
| spectrum-average | power averaging | `test/spectrum-average` | Swift/Python fold into peaks; impl `dsp/spectrum-average` exists → split everywhere or document |
| g3d-guitar | guitar Air/Top/Back playback (REG-G) | fold → `test/file-playback` | already covered by Swift/Python file-playback |
| g6-measurement-bridge, g7-measurement-4c, g8-material-load, g9-multitap | live↔model bridge, provenance warning, material load, multi-tap entries/PDF | **reconcile** | check whether Swift/Python cover these under existing suites (loadMeasurement paths, Codable, Comparison) before adding named suites |

### 3. impl→test links to populate (`tests=`, Phase 5)
Every production `@parity` group gets a `tests=` pointing at its evidence group(s). Confirmed examples that
already exist (7): `audio/tap-analyzer→tap-decisions`, `dsp/decay→decay-tracking`, `dsp/find-peaks→peaks`,
`dsp/gated-fft→gated-fft`, `dsp/material-properties→brace,plate`, `dsp/pitch→pitch`,
`model/guitar-mode-classify→classify`. The remaining 37 impl groups (incl. `dsp/wav`, `dsp/calibration`,
`dsp/analysis-quality`, `dsp/spectrum-average`, the `view/*` and `state/*` groups) get theirs during
Phases 3–5; groups that end with **no** `tests=` are the "untested on all platforms" report.

### Naming reconciliation questions surfaced by the ledger (decide as each phase reaches them)
- **plate/brace file split:** Swift uses two files (`BraceProperties`, `PlateProperties`); Python merges
  into one (`test_material_properties`). Master = Swift → target is two web files (`brace`, `plate`) and,
  ideally, splitting Python too — or accept the split and tag both slugs on the Python file.
- **dsp vs peaks, spectrum-average:** Swift/Python split `dsp` (parabolic+Q) from `peaks` and fold
  averaging into peaks; web folds dsp into peaks and splits averaging out. Pick one split for all three.
- **file-playback layering:** web has a pure-DSP layer (`g3b/c/d`) *and* an engine layer (`g11`); Swift/
  Python have one engine-level regression. Keep the web DSP layer as justified extra, or consolidate.

## Parity cleanup — status/state divergences (run-review 2026-07-09)

Surfaced by side-by-side platform testing during the Phase-3 `TapSession` consolidation. Fix across all
three (improvements-go-to-all-three), Swift-master, pinning the testable pieces. Canonical = Swift **except
PC-1, where the current Swift/Python/web behavior is itself wrong**.

- **PC-1 — Cancel must behave like New Tap (WRONG on all 3).** Today all three *end* the sequence on Cancel:
  they require a New Tap press, show "Cancelled — press New Tap to start again", and Swift/Python show
  "Tap Detected!" + keep the last peaks while the web shows "Waiting for tap" + clears them. **Correct
  behavior:** Cancel returns to the exact **New-Tap** state — detection re-armed, live spectrum, waiting
  for a tap, peaks/spectrum fresh, **no** "Tap Detected", **no** "Cancelled — press New Tap" message, **no**
  New-Tap press required; buttons in the New-Tap state. → Cross-platform **behavior change** (changes the
  released Swift app): `cancelTapSequence` re-arms (≡ `startTapSequence`, clearing frozen/peaks) on
  Swift → Python → web. Update the cancel expectations in `scenario-trace` (S4 → re-armed state, not
  `complete=true`) and `measurement-complete` on all three, and **`src/state/tapSession.ts`
  `cancelTapSequence`** + web `test/scenario-trace` S4 accordingly. (The just-wired button mapping's
  `|| cancelled → complete` becomes obsolete once cancel re-arms.)
  **Locked button rule (FINAL, 2026-07-09):**
  - **New Tap** — enabled ⟺ **`isMeasurementComplete`** (else disabled; comparison always enabled;
    FFT-not-ready disabled). Every measurement-type switch auto-arms into capturing, so there is **no
    disarmed "not-yet-started" state** — New Tap only lights up once a measurement is complete.
  - **Cancel** — enabled ⟺ **review phase** (acts as "Redo"; plate-only — brace has no review) **OR** an
    **active multi-step** sequence, where multi-step = `numberOfTaps > 1` OR plate, and active = guitar
    detecting/paused, or material phase ∉ {notStarted, complete}. Cancel's *action* re-arms (≡ New Tap).
  - **Pause/Resume** — enabled ⟺ review-phase (Accept) OR detecting OR paused (UNCHANGED — useful even
    single-tap, for setting the threshold without capturing).
  - **Brace has no review/accept phase** — it auto-completes like guitar (single or multi-tap). Only plate
    is multi-phase.
- **PC-2 — Status-bar text on completion.** Multi-tap completion: Swift/Python "Tap Detected!" vs web
  "Waiting for tap…". Target: Swift's "Tap Detected!" on web. Extract a pure `statusMessage(state)`
  mirroring Swift → new `test/status-message`.
- **PC-3 — Instruction text on New Tap (multi-tap material + generic).** Swift "Tap the guitar N times /
  Tap 0/N"; Python adds "Phase 1/1"; web "Ready for fL tap (×N)". Normalize to Swift on Python + web via a
  pure `instructionMessage(state)`. **Confirm** whether Swift's "guitar" wording is intentional for a brace
  before mirroring it.
- **PC-4 — Web reset bug on config change (web-only).** 3-tap brace → switch to Generic → set Taps = 1:
  the web stays in multi-tap mode until New Tap is pressed. A measurement-type / tap-count change must reset
  the sequence immediately. Fix via the session's config-change reset; add a test.

These are the payoff of the consolidation: PC-1 and PC-2/PC-4 ride directly on `TapSession` owning the
lifecycle state; PC-3 is message normalization. All get fixed canonically, in one place, with tests.

## Plan — one phase at a time, each reviewed then verified (run the suite) before the next

- **Phase 1 — Analysis + name map (THIS DOC).** Coverage matrix + canonical naming convention. *For review.*
  Next sub-step once approved: expand into a **full name-map ledger** (every Swift file+test → target
  Python name (verify) → target web name (new)), plus the gap ledger (what to add where) **and the
  impl→test map** (which production slug each `test/<slug>` is evidence for → the future `tests=` links).
- **Phase 2 — Web rewrite to the Swift spine (naming only).** Rename web `g#-*.test.ts` → behavior-slug
  filenames; align `describe`/`it` names to the Swift suite/test names for suites that already exist on
  web; add `@parity` markers. No coverage change. Verify: web suite still green.
- **Phase 3 — Backfill web behavioral gaps.** Add the missing suites to web, one at a time, each mirrored
  from its Swift/Python twin and driven by the same goldens: measurement-complete, state-invariants,
  scenario-trace, start-tap-race, button-enablement, frozen-peak-recalc, annotation-state (guitar path),
  import-persistence (library append).
- **Phase 4 — Back-port web-only tests to Swift + Python.** calibration parse/interp, analysis-quality
  bands, and any measurement-bridge/provenance checks not already folded — as named suites matching the
  Swift convention.
- **Phase 5 — Reconcile folding + platform-only + wire coverage detection.** Make dsp/peaks/average and
  plate/brace split consistently (or document); document the Swift gesture suite and Python Qt suites as
  justified platform-only; settle the oracle-vs-hardcoded-goldens question. **Populate `tests=` on every
  impl group** (all 44, up from 7) and **add the coverage-gap report to `gen_parity_map.py`** (impl slugs
  with no test evidence).
- **Phase 6 — Contract doc + rule + CI gate.** Finalize this matrix as the living coverage doc; add the
  "change shared behavior → update all three" rule; wire `--check` (missing-on-some) + the coverage-gap
  report (missing-on-all) as CI gates; update `STATUS.md`.

## Open decisions (settled)
1. **Rename web files for parity** — **YES** (user, 2026-07-09). Web filenames become the behavior slug;
   `G#` demoted to an optional in-file tag.
2. **One phase at a time, gated on review** — **YES.** Present each phase's concrete diff/plan, get
   approval, execute, verify (run the suite), then proceed.

## Caveat
The matrix cells are from the inventory pass and are **v1** — each ◐/✗ is re-confirmed against the actual
Swift/Python twin at the start of the phase that touches it (folded coverage can hide behind a ◐).