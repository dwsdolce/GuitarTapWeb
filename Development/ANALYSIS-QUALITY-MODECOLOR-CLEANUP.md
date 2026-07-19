# Analysis-quality + mode-color cleanup — ✅ COMPLETE (committed all 3, 2026-07-18)

**✅ DONE + committed all 3 (2026-07-18).** Intermediate working doc for **STATUS item 8** (the
missing-test parity sweep), reached while working **item 12-O**. Began as "lock the 3 untested `@parity`
groups with tests" (`dsp/analysis-quality`, `model/mode-colors`, `model/quality-colors`). Writing the
Python test surfaced a real **Python structural divergence**, which the user turned into the three tasks
below (all done + user-verified + committed). **All 3 slugs now have tests on all 3 platforms; parity
`--check` is fully clean (74 groups).** The one thing still deferred to the styles work (STATUS item 3) is
the *layer violation* — Swift/Python hang `WoodQuality.color` off the model enum instead of presentation —
which is architectural, not a missing test. This doc is now an audit-trail record; STATUS.md is the SSOT.

## The user's 3 tasks
1. **Fix the structural + nominative divergence** that made the tap-tone-ratio quality impossible to find.
2. **Mode-colors:** find out why there are 2+ maps; if Python is the outlier, remove the divergence.
3. **Rework the now-incomplete test.**

## What was found (verified)
- **Swift & web are single-source.** Swift: `Float.decayQuality/tapToneRatioQuality(+Color)` in
  `Extensions.swift`; `GuitarMode.color`. Web: `analysisQuality.ts`; `MODE_COLOR` (`modeColors.ts`). Both
  reused by the live UI **and** the PDF.
- **Python re-implemented per surface, with drift:** decay quality was on `GuitarType` (model), but the
  ratio quality existed only as private view-local copies — `_ratio_quality` (PDF `tap_analysis_results_view.py`)
  and `_tap_ratio_quality` (live `tap_tone_analysis_view.py`) — plus the live view had its OWN `_decay_quality`
  that **re-hardcoded thresholds** and used **different (Material-Design) colors** than the model/PDF. That
  private naming (`_ratio_quality`, not `tap_tone_ratio_quality`) is why a cross-platform grep found nothing.
- **⚠ LESSON (feedback_do_not_act_on_assumptions #6):** I first grepped only `models/` and wrongly concluded
  "Python is missing the feature," then wrote a decay-only test and barreled on. A surprising cross-platform
  gap is a STOP-and-verify signal, not a fact. Verify exhaustively; a narrow negative ≠ absence.

## Decision (user): base on SWIFT (canonical), not web (the web is itself a port of Swift)
- **Home:** `src/guitar_tap/views/utilities/extensions.py` — the existing "Mirrors Swift's Extensions.swift"
  file. Module functions (Python can't extend `float`).
- **Colors = SwiftUI system-color hexes** (what Swift's semantic colors resolve to). Decay:
  `#8E8E93 / #FF9500 / #FFCC00 / #34C759 / #007AFF` (gray/orange/yellow/green/blue). Ratio (red/orange/green):
  Low `#FF3B30`, Below Target `#FF9500`, Ideal `#34C759`, Above Target `#FF9500`, High `#FF3B30`.
- Labels: decay = Very Short/Short/Moderate/Good/Excellent; ratio = Low/Below Target/Ideal/Above Target/High
  (bands 1.7/1.9/2.1/2.3, Ideal inclusive of 1.9 and 2.1). Thresholds come from `GuitarType.decay_thresholds`
  (classical 0.15/0.35/0.6/1.0). Web keeps its brightened palette (intentional dark-chart adaptation).

## New Python API (in extensions.py)
`decay_quality_label(decay, guitar_type)`, `decay_quality_color(decay, guitar_type)`,
`tap_tone_ratio_quality_label(ratio)`, `tap_tone_ratio_quality_color(ratio)` — all return str/hex.
File tagged `# @parity dsp/analysis-quality tests=test/analysis-quality`.

## DONE (item 1 code — Python)
- `extensions.py`: added the 4 functions + the `@parity` tag.
- `guitar_type.py`: **removed** `decay_quality_label`/`decay_quality_color` (kept `decay_thresholds`);
  replaced its `@parity dsp/analysis-quality` comment with a plain note pointing at extensions.py.
- `tap_analysis_results_view.py` (PDF): `from views.utilities import extensions as _ext`; **deleted**
  `_ratio_quality`; decay + ratio call sites now use `_ext.*` (wrapped in `colors.HexColor(...)`).
  `_mode_color` (guitar) still present — that's item 2.
- `tap_tone_analysis_view.py` (live): imports `_ext` + `_GTy`; `set_ring_out` and `update_tap_tone_ratio`
  use `_ext.*`; **deleted** `_decay_quality` + `_tap_ratio_quality`.

## ITEMS 1 + 3 — ✅ CODE COMPLETE (2026-07-18), NOT committed, NOT user-run-reviewed
1. ✅ **Stale comment** `tap_tone_analysis_view.py:~1640` fixed (now points at extensions.py helpers).
2. ✅ **`tests/test_analysis_quality.py` reworked** — imports `decay_quality_*` + `tap_tone_ratio_quality_*`
   from `views.utilities.extensions`; covers decay (thresholds + label + color) AND ratio (label + color).
3. ✅ **Parity map regenerated** (`dsp/analysis-quality` Python file now extensions.py). `--check` clean
   EXCEPT one pre-existing gap: **`model/quality-colors` (MaterialProperties.swift) has NO test** — that is
   the 3rd original untested group (material L/C/FLC property colors), a SEPARATE concern from these 3 tasks.
   Decide with the user whether to pin it too or document it as a justified gap.
4. ✅ **Suites green:** Python full 495 passed; web analysis-quality+mode-colors 25 passed; Swift
   AnalysisQuality (6) + ModeColors (1) = 7 passed, 2 suites. (Swift scheme is `guitar_tap`;
   `-only-testing` needs the STRUCT type name `AnalysisQualityTests`, not the `@Suite` display name.)
   ⚠ STILL NEEDS: user run-review of the **live Qt panel** + **PDF** — the live-panel decay/ratio colors
   changed from Material-Design hues to the SwiftUI system hexes.

## ITEM 2 — mode-colors — ✅ RESOLVED (2026-07-18). ONE Swift edit made, NOT committed/run-reviewed.
**Two wrong reports corrected by verifying against Swift (the STOP-and-verify lesson, again):**
1. My "3 Python maps to consolidate" was WRONG — I counted `_mode_color` *function names*. Reality:
   `peak_annotations._mode_color` + `peak_card_widget._mode_color` are **dispatchers that DELEGATE** to
   `GuitarMode.color` (guitar) / `_MATERIAL_MODE_COLORS` (material); they hold no guitar-color data.
2. My "the PDF `_mode_color` drifted, route it to `GuitarMode.color`" was WRONG — Swift's PDF
   (`PDFReportGenerator.modeColor`, :595) hardcodes the **exact same muted palette** (air `0,0.5,0.8`,
   dipole `0.6,0,0.8`, ring `0.8,0,0.4`…). Python's PDF is a **faithful port**, NOT drift. That edit would
   have BROKEN parity. Swift *deliberately* uses a muted PDF palette ≠ the on-screen `GuitarMode.color`.

**Verified single-source status:** Web = one `MODE_COLOR` map, all consumers delegate ✅. Python =
`GuitarMode.color` + delegating dispatchers ✅. **Swift was the lone outlier** — `PeakAnnotations.modeColor`
(:210) had a hardcoded per-mode switch duplicating `GuitarMode.color` verbatim (.cyan/.green/…).
**FIX MADE:** in `GuitarTap/Views/PeakAnnotations.swift`, replaced that switch with
`return (classifiedMode ?? .unknown).color`. Builds; `ModeColorsTests`+`AnalysisQualityTests` (7) pass.
Python/web unchanged (already correct). ⚠ Needs: user run-review (guitar annotation colors are unchanged —
pure refactor, values verified identical) + commit.

**DEFERRED TO THE STYLES/THEME WORK (user, 2026-07-18): "we are not touching color differences until we do
the styles work."** No cross-platform color-VALUE reconciliation now — parked under STATUS item 3 (Theme
Light/Dark/System), not as standalone decisions:
- The 3-way PDF palette difference (Swift+Python muted vs web brightened `MODE_COLOR`).
- The untested `model/quality-colors` group (MaterialProperties) — leave as a documented gap for now.
- Any per-platform mode-color hue unification (Swift `.cyan` / web brightened / Python RGB — by design today).
This cleanup only touched STRUCTURE (single-source), never cross-platform values.
**Principle (user, 2026-07-18):** consolidate *functional* colors so a given role is defined ONCE per
platform (no duplication); the actual VALUE each functional color resolves to is a per-platform decision
made at styles time. Item 1's live-panel hues were switched to Swift's system hexes only as the single
placeholder value — styles will set the real per-platform functional colors.

## Uncommitted tree (all three repos) — this cleanup + the earlier parity-test work
**Earlier parity-test work (still uncommitted):**
- Swift: new `GuitarTapTests/ModeColorsTests.swift`, `AnalysisQualityTests.swift`; `@parity … tests=…`
  added to `GuitarMode.swift` + `Extensions.swift`. PARITY-MAP/parity-index/TEST-COVERAGE will change on regen.
- Python: new `tests/test_mode_colors.py` (passes), `tests/test_analysis_quality.py` (**now broken** — rework);
  `@parity … tests=…` on `guitar_mode.py`.
- Web: new `test/mode-colors.test.ts` (passes), `@parity test/analysis-quality` added to existing
  `test/analysis-quality.test.ts`; `@parity … tests=…` on `modeColors.ts` + `analysisQuality.ts`.
**This consolidation (uncommitted):** Python `extensions.py`, `guitar_type.py`,
`tap_analysis_results_view.py`, `tap_tone_analysis_view.py`.

## Standing rules (do not drop)
- **Present-then-pause**; NOT done until the USER runs it; commit messages PRINTED on screen (never
  committed), `git status` each repo FIRST; `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- A cross-platform "gap" is a STOP → verify everywhere or ask. [[feedback_do_not_act_on_assumptions]]

## Broader context (post this cleanup)
Respin Steps 0–2 + the visibility-UI refinement are COMMITTED; items 8/10/12-O/13/14/15 done. After this
cleanup, the queued big item is the **documentation pass** (User Manual + HelpView/Quick-Start + release
notes, build-number-agnostic per the new process) covering the respin + the prior heavily-amended commit,
then respin Steps 6/7/8. See [RESPIN-1.0.2-PLAN.md](RESPIN-1.0.2-PLAN.md).