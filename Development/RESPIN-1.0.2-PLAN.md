# 1.0.2 RESPIN — implementation plan (survives compaction)

**Created 2026-07-17. Decision (user): respin the 1.0.2 release, ALL HOLDS OFF.** Fix the iPad
material-selection corruption properly, fold in the reasonable delayed Swift fixes, clean up the
deferred mess. Release is delayed — that is accepted. **Version stays 1.0.2; new build number**
(TestFlight accepts same version + new build). This is a **commit (not amend) on all three repos.**

Detail docs: [IPAD-PLATE-PDF-SELECTION.md](IPAD-PLATE-PDF-SELECTION.md) (the selection bug + investigation),
[STATUS.md](STATUS.md) (items 4/7–15), [WEB-PDF-MATERIAL-LAYOUT.md](WEB-PDF-MATERIAL-LAYOUT.md) (12 M/N),
[MATERIAL-LIVE-ANNOTATION-DISPLAY.md](MATERIAL-LIVE-ANNOTATION-DISPLAY.md) (12 R live-annotation fix).

---

## ▶ RESUME HERE (paused 2026-07-17 night — user running more tests tomorrow)

**Done + user-verified:** Step 0 (instrumentation removed), Step 1 (material-selection fix, all 3, incl.
iPad device), Step 2 M/N/R (Swift chart + web legend + the live material-annotation fix on both natives).
**Visibility-UI refinement 2026-07-18 (✅ user-verified all 3, suites green):** reverted the material All/None +
Selected→All coercion — the button keeps 3 states everywhere; for material All == Selected (no per-peak
selection), None hides; the shared setting is never coerced on type switch (that was clobbering the
guitar preference). See the ⚠ note in "THE CORE DESIGN DECISION".

**⚠ DEBUG INSTRUMENTATION IS DELIBERATELY STILL IN — DO NOT STRIP until the user finishes tomorrow's
tests and says go.** It is the `🔬RDBG` material-annotation tracing (separate from the Step-0 MTDBG,
which is already gone):
- **Swift:** `Utilities/Logging.swift` `_gtLogEnabled = true`; `TapToneAnalyzer+SpectrumCapture.swift`
  `rdbgMaterial(_:)` helper + 3 calls (`L-set`/`C-set`/`FLC-set`). Grep `RDBG`.
- **Python:** `utilities/logging.py` `_gt_log_enabled = True`; `models/tap_tone_analyzer_spectrum_capture.py`
  `_rdbg_material` helper + 3 calls. Grep `RDBG`.
- Web has none.

**NEXT (tomorrow, in order):**
1. User finishes testing → **strip all `🔬RDBG` instrumentation + reset both log flags to false** (Swift
   `_gtLogEnabled = false`, Python `_gt_log_enabled = False`). Verify `grep -rn RDBG` empty in both.
2. **Step 3** — commit the `@parity model/quality-colors` comment + add a `@parity` slug for the new
   `effectiveSelectedPeakIDs`/`materialIdentifiedPeaks` cross-platform concept; regenerate PARITY-MAP /
   parity-index / TEST-COVERAGE.
3. **Step 6** docs (manual/help: 3-state button; material has no per-peak selection so Selected shows all
   identified peaks — same as All), **Step 7** poisoned-fixture 3-way test,
   **Step 8** release notes + commit-not-amend all 3 (build numbers roll).

**New parked items (see STATUS):** threshold input-level meter reads high on web (separate, needs its own
investigation); progress-bar-lingers-on-guitar-load (PARKED, likely a cross-platform reset-timing
non-bug — confirm before acting).

---

## THE CORE DESIGN DECISION (user, 2026-07-17)

> **⚠ VISIBILITY-UI REVISED 2026-07-18:** the button keeps its **3 states (All / Selected / None) on
> every measurement type**. For material there is no per-peak selection, so **All and Selected render the
> SAME set** (all identified peaks); only None hides. The shared `annotationVisibilityMode` setting is
> **never coerced** on type change (the earlier All/None + Selected→All coercion clobbered the guitar
> preference when switching types). So wherever this doc below says "visibility = All/None" or mentions a
> `nextMaterialOnly`/coerce, read it as: **material treats Selected == All; no coercion.** The
> data/read/save/load rules are unchanged.

**Material measurements (plate AND brace) have NO per-peak selection.** For material, All and Selected
show the same set (all identified peaks); None hides. The identified peaks (L/C/FLC for plate, L for
brace) in `peaks[]` **are** the peaks; you cannot individually select or deselect them. So:

- `selectedPeakIDs` (an aggregate that only makes sense for **guitar**, where the user picks a subset
  of many detected peaks) is **vestigial for material** — and it is the *only* thing the
  phase-transition glitch corrupts.
- **Everywhere that reads a selection to decide which material peaks to show, use ALL of `peaks[]`**
  (equivalently the per-phase ids), never `selectedPeakIDs`. This makes the corruption **inert**:
  existing corrupt files (`selectedPeakIDs = {C}`) render all three, web-re-exported files render all
  three, new files are correct.
- **Guitar is unchanged** — there "Selected" is a real, user-controllable subset of many peaks.

**Why this is correct, not a workaround:** verified that for a material file `peaks[]` ids == the
per-phase ids exactly (the identified L/C/FLC, nothing else), and the live app already binds material
display to the per-phase ids (`effectiveLongitudinalPeakID`), which is why *the app was never wrong* —
only the PDF/saved `selectedPeakIDs` was. We accept the root cause as an intermittent Release-only
optimizer glitch in the phase-transition writes to `selectedPeakIDs` (a Heisenbug — it vanishes under
instrumentation; see IPAD-PLATE-PDF-SELECTION.md). We do not need to pin the exact line: removing the
aggregate as material's source of truth removes the thing that corrupts.

**One rule to implement, all three platforms:**
> For material (`!isGuitar`): the peak set shown (annotations, PDF, table) = **all of `peaks[]`**.
> `selectedPeakIDs` for material is written as the full identified set (derived from `peaks[]`/per-phase
> ids at save — NOT the live aggregate) and is IGNORED on read. The visibility control is **All / None**.

⚠ **Keep writing `selectedPeakIDs` for material** (user: it must be present for load/format stability),
but write it = all identified peaks, and never read it to filter material. Backward-compatible: an old
app version reading it gets the correct full set; a new app ignores it and uses `peaks[]` anyway.

---

## SCOPE — what ships in this respin

**A. Material-selection fix (all 3 repos)** — the driver, above.
**B. UI change (all 3)** — peak-visibility control becomes **All / None** for material (drop the phantom
"Selected"). Guitar keeps All / Selected / None.
**C. Documentation** — user manual + in-app help: material has All/None, no per-peak selection.
**D. Delayed SWIFT fixes (the reasonable list from IPAD-PLATE-PDF-SELECTION.md §"Which delayed Swift
fixes"):**
- **12(M)** plate chart chips show GUITAR-MODE names (`Unknown`/`Air (Helmholtz)`) instead of roles —
  `ExportableSpectrumChart.swift:626` (peakModes-empty fallback runs the guitar classifier on plate
  peaks); same pattern at `:169`, `:747`. Surfaces in the PDF **and** the Export-Spectrum PNG.
- **12(N)** chart legend drops the `(L)`/`(C)` role suffixes (same chart-export path as M).
- **12(R)** live plate chart annotations don't refresh during capture (waveform + table do).
- **Commit the uncommitted `@parity model/quality-colors` comment** in `MaterialProperties.swift`.
**E. Remove ALL instrumentation** (Swift MTDBG — see "Current tree state").
**F. Test** — a poisoned fixture (3-way) + existing suites + parity regen.

**OUT of scope (stays deferred):**
- **Item 4** (Swift 4800-frame audio buffer). Big, risky, its own test burden, immaterial to lutherie.
  NOT in this respin (user's own "reasonable list" excluded it).
- **Item 11 / 12(O,P,Q)** — the Results-panel cross-platform consistency + Python date/panel items.
  Bigger design work; not this respin unless the user adds them.
- **Guitar residual exposure** — guitar has no per-phase backup, so the material fix doesn't cover a
  (low-risk) guitar `selectedPeakIDs` corruption. Documented, separate follow-up.

---

## IMPLEMENTATION STEPS

### Step 0 — Remove instrumentation (Swift), FIRST — ✅ DONE 2026-07-17
_Restored the 6 MTDBG files (Logging flag, didSet tracer, mtdbgSnapshot helper+calls, xcscheme Release→Debug); `grep MTDBG|mtdbgSnapshot` empty. Only the `@parity` comment + regenerated docs + Quick-Start PDF remain uncommitted._

Revert to a clean tree before writing the fix:
- `GuitarTap/Utilities/Logging.swift` — `_gtLogEnabled = true` → `false`.
- `GuitarTap/Models/TapToneAnalyzer.swift:552` — remove the `didSet` write-tracer on `selectedPeakIDs`.
- `GuitarTap/Models/TapToneAnalyzer+Control.swift` — remove `mtdbgSnapshot(...)` helper + its calls in
  `finalisePlateNoFLC`/`finalisePlateWithFLC`.
- `GuitarTap/Models/TapToneAnalyzer+SpectrumCapture.swift` — remove the `mtdbgSnapshot` call in
  `handleFlcGatedProgress`.
- `GuitarTap/Models/TapToneAnalyzer+MeasurementManagement.swift` — remove the `mtdbgSnapshot` call in
  `saveMeasurement`.
- Verify: `grep -rn "MTDBG\|mtdbgSnapshot" GuitarTap/` → empty.

### Step 1 — Swift material-selection fix — ✅ DONE + USER-VERIFIED incl. the iPad DEVICE (2026-07-17)
_Implemented identically on all 3 (the "one rule"): a model helper `effectiveSelectedPeakIDs` (+ `isMaterial`/`resolvedMeasurementType`) — material → all of `peaks[]`, guitar → saved selection or all. Read sites route through it (Swift: PDF table, chart annotations, detail list, comparison; web: MeasurementDetail; Python: comparison). Save persists the full identified set for material (`persistedSelectedIDs`/`persisted_ids`); load heals (ignore the aggregate for material); visibility control is **All/None** for material (`nextMaterialOnly` + cycle + `visiblePeaks`/`visible_peaks`/`buildMaterialMarkers` + start/type-change coerce). Guitar untouched. Suites: Swift 372 · Python 488 · web 278. **Button follow-ups (user-caught): web button was disabled for material → enabled + coerce to All; Python view cycled a fixed 3-tuple → now 2-state All/None.** User reviewed all 3 with the real corrupt iPad file — peaks all show. **Pending: confirm on the iPad DEVICE that a fresh capture no longer corrupts + renders all three.**

Gate everything on `measurementType.isGuitar` (material = plate + brace = `!isGuitar`).
1. **Read side — the peak set for material = all of `peaks[]`.** Every place that computes "which peaks
   to show" from `selectedPeakIDs`, use all peaks for material instead:
   - PDF export from the saved list: `MeasurementsListView.swift:481`, `MeasurementDetailView.swift:179/297`
     (`Set(measurement.selectedPeakIDs ?? measurement.peaks.map)`) → for material use `Set(measurement.peaks.map)`.
   - Chart export selected set: `ExportableSpectrumChart.swift:724`.
   - Live annotations / `visiblePeaks` (`TapToneAnalyzer.swift:679-692`) — for material, visible set =
     all currentPeaks (subject to All/None mode only).
2. **Save side** (`saveMeasurement` ~`:328`): for material, `selectedPeakIDs` = `Set(currentPeaks.map(id))`
   (all identified), `selectedPeakFrequencies` = their freqs — NOT the live aggregate.
3. **Load/heal** (`loadMeasurement` ~`:685`): for material, `selectedPeakIDs = Set(currentPeaks.map(id))`
   (all peaks), ignoring the saved value → heals existing corrupt files. Guitar keeps the current
   `Set(saved) ?? allPeaks`.
4. **Visibility control UI** — for material, the annotation-visibility menu shows **All / None** only
   (no "Selected"). If the current model has 3 modes, map material `.selected` → treat as `.all`.

### Step 2 — Swift chart fixes (M/N/R) — ✅ M/N/R DONE + USER-VERIFIED 2026-07-17
_**M** ✅ `ExportableSpectrumChart.makeExportableSpectrumView` chips now use L/C/FLC **role** label+color for material (local `roleLabel`/`roleColor`); `peakModeMap` guarded so the guitar classifier never runs on material peaks. **N** ✅ saved-render legend gets `Longitudinal (L)`/`Cross-grain (C)`/`FLC` (matched Swift's own live path + Python); also aligned the **web** brace legend `Longitudinal (fL)`→`Longitudinal (L)` so the chart legend is uniformly `(L)` on all 3. **R** ✅ root-caused via `🔬RDBG` instrumentation (both natives `thread=Main`, annotation source churned `currentPeaks` 87→126→3 while the identified peaks grew 1→2→3): the natives annotated `currentPeaks` (all raw per-phase peaks), the web annotates the accumulated identified peaks. **Fixed both natives to annotate the accumulated identified L/C/FLC** (`materialIdentifiedPeaks` / `material_identified_peaks`), + Python-only: stop the per-frame `analyze_magnitudes` emit for material (killed the raw-"Peak" repaint + table flicker) and add `refresh_annotations()` after the material `update_data()` (annotations were never emitted on that path). `currentPeaks` untouched on both. Full detail: [MATERIAL-LIVE-ANNOTATION-DISPLAY.md](MATERIAL-LIVE-ANNOTATION-DISPLAY.md). Suites: Swift build + 7/7 regression; Python 488; web 278._

- **M/N:** `ExportableSpectrumChart.swift` — for material, the peak-summary chips + legend must use the
  **role** labels (Longitudinal/Cross-grain/FLC), NOT the guitar-mode classifier. Fix the
  `peakModes.isEmpty ? GuitarMode.classifyAll(peaks) : peakModes` fallback at `:626` (+ `:169`, `:747`)
  so material never runs the guitar classifier. Legend keeps `(L)`/`(C)` suffixes.
- **R:** live plate chart annotations refresh as each phase completes (mirror the table/waveform path).
  ⚠ Likely shares the per-phase-vs-aggregate resolution with Step 1 — do together.

### Step 3 — Commit the `@parity` comment
`MaterialProperties.swift` — the `@parity model/quality-colors` comment (currently uncommitted). It
lands with this build (build rolls anyway). Regenerate `PARITY-MAP.md`/`parity-index.json`/
`TEST-COVERAGE.md` (docs, free).

### Step 4 — Web — ✅ DONE 2026-07-17 (folded into Step 1)
_Helpers in `types.ts`; `MeasurementDetail` read routes through `effectiveSelectedPeakIDs` (heals corrupt files); `ANNOTATION_NEXT_MATERIAL` + material-aware cycle; `buildMaterialMarkers` respects All/None; button enabled for material + Selected→All coerce effect. Save already wrote the full set._

- **Read:** already resolves material from per-phase ids (`matPeaks.longitudinal/cross/flc`) — verified
  renders existing corrupt files correctly. No read change needed.
- **Save:** `buildMaterialMeasurement` already derives `selectedPeakIDs` from per-phase — confirm it
  writes the full identified set (it does). Keep.
- **UI:** peak-visibility control → **All / None** for material (`MaterialResults` / the annotation-mode
  control). Guitar unchanged.
- No import-heal needed (corrupt `selectedPeakIDs` is already ignored for material).

### Step 5 — Python — ✅ DONE 2026-07-17 (folded into Step 1)
_Model helpers on `TapToneMeasurement`; save persists full set for material; load heals + coerces mode; `next_material_only` + material-aware `cycle_annotation_visibility`/`visible_peaks`/start-sequence coerce; the view's own 3-tuple cycle made material-aware (2-state) + type-change coerce. Suite 488._

- **Read:** already resolves material from per-phase ids (`tap_analysis_results_view.py:364-366`). No
  change.
- **Save:** ensure material `selectedPeakIDs` = full identified set.
- **UI:** peak-visibility control → **All / None** for material. Guitar unchanged.

### Step 6 — Documentation
- User manual + in-app help / Quick-Start (all 3): material (plate/brace) peak visibility is **All /
  None** — the identified L/C/FLC are the peaks; there is no per-peak selection (that's a guitar
  feature). Regenerate the manual/quick-start PDFs where applicable.

### Step 7 — Tests
- **Poisoned-fixture test (3-way):** a material `.guitartap` with `selectedPeakIDs = {C}` (disagreeing
  with `peaks[]`/per-phase) → assert the render/peak-set = all three (L,C,FLC) on Swift, Python, web.
  The two real iPad broken files are ready-made fixtures. New parity slug, e.g. `test/material-selection`.
- Existing suites green (Swift, Python 488, web 278 — counts will move).
- `parity --check` clean; regenerate the map.

### Step 8 — Release notes + ship
- Release notes entry (all 3): "Plate/brace reports and on-chart peaks could show only one of the three
  measured frequencies (an iPad-only save glitch); material now always shows all three. Peak visibility
  for plate/brace is All/None." Plus the Swift chart-chip fix if user-visible.
- **Commit (not amend) on all three.** Version 1.0.2, new build number = commit count at the release
  commit.
- Swift → new **TestFlight** upload; Python → rebuild installers; web → redeploy.
- **Full re-test sweep** (macOS + iPad + iPhone + PC + Linux) before production ship.

---

## CURRENT TREE STATE (as of 2026-07-17, pre-implementation)

**Swift (`/Users/dws/src/GuitarTap`), build 398, all UNCOMMITTED:**
- MTDBG instrumentation (Logging.swift flag; TapToneAnalyzer.swift didSet; Control.swift helper+calls;
  SpectrumCapture.swift call; MeasurementManagement.swift call) — **REMOVE in Step 0.**
- `@parity model/quality-colors` comment in MaterialProperties.swift — **commit in Step 3.**
- Regenerated PARITY-MAP.md / parity-index.json / TEST-COVERAGE.md + Quick-Start PDF (build artifact).
- ⚠ `git status` FIRST at implementation time — do not trust this list blindly.

**Python (`/Users/dws/src/guitar_tap`), build 440:** HEAD `22207df` already has the multitap-material
results fix + Details type fix + PDF matte + `@parity` comment (all committed). Working tree should be
clean; verify.

**Web (`/Users/dws/src/GuitarTapWeb`), build 112:** HEAD `ec10ced`. Uncommitted = the Development/*.md
doc updates from this investigation (STATUS, IPAD-PLATE-PDF-SELECTION, RESPIN plan, etc.). No web source
changes pending.

**⚠ Build-number rule:** build = `git rev-list --count HEAD`. This respin is a NEW commit on each repo
→ each build number ROLLS. That is intended (TestFlight = same version 1.0.2 + new build). Verify the
new numbers after committing; keep release-note version strings in sync.

---

## RESUME POINTER (post-compaction)
Start at **Step 0** (remove Swift instrumentation), then Step 1. The whole selection fix is one rule:
*material shows all of `peaks[]`; `selectedPeakIDs` is ignored on read and written as the full set;
visibility is All/None.* Guitar untouched. Present per-repo diffs + test results for run-review BEFORE
the user commits (present-then-pause). Nothing is committed until the user runs it.