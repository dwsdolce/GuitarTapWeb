# Architectural-Parity Restructure — Notes & Inventory

Status: **PLANNED (post-review).** Not started. This doc accrues the raw material; the actual
restructure gets its own **spec, reviewed before any code moves** (per "review before implementing").

## The concern

The web port structurally **diverged from Swift/Python at the view layer** — one native view is
often decomposed into several React components. This was a **choice made during the port, not a
platform constraint.** React does not require small components; a single large component mirroring
a native view file is valid React.

Why the "platform forced it" defense fails: React and SwiftUI are **both declarative component
trees** — structurally *closer* to each other than either is to Qt's imperative widgets. Python/Qt
had the harder mapping job and stayed more cohesive with Swift; the web had the easier job and
diverged more. So the divergence is React-habit (favor small components) applied without pricing in
this project's top priority.

## Why it matters (the priority that was mis-weighed)

All three code bases are maintained **in lockstep**; that is the #1 priority. Structural
parallelism directly serves it — it keeps the `@parity` map ~1:1, makes "are the three the same?"
answerable, and avoids the symbol-level / many-to-many tagging the divergence forces. Generic React
decomposition benefits (small reusable units) are worth **less** here than the parity cost they impose.

## Decision: sequencing = "option 2"

1. **Finish the comment/doc review first.** It *is* the discovery phase the restructure needs —
   every view slug records "this web component ↔ that native section." M4/M5 are the first inventory
   entries. Restructuring before the map is complete would be cutting before measuring.
2. **Then** produce a restructure spec (architectural-parity plan), review it, and execute.
3. Do **not** accept the divergence permanently (contradicts the lockstep priority).

### Lens for the remaining `view/*` review (so option 2 doesn't waste effort)
`view/*` is exactly the layer that will move, so:
- **Do:** verify feature / label / color / value / wording parity; catch real bugs (e.g. mode
  colors, the metrics health-color ramp); record the component↔section mapping (below).
- **Go light on:** deep doc-enrichment (`@param` polish, prose expansion) of web components destined
  to be merged/split — that's the wasted motion.
- **Unchanged:** DSP/model layers — already structurally parallel, nothing moves; keep the strict
  file-1:1 doc bar there.

## Forced vs. chosen (what the restructure must NOT try to unify)

- **Forced (keep divergent, documented):** reactive/threading plumbing (`@Published` ↔ Qt signals ↔
  React state/hooks); audio engine (AVAudioEngine ↔ PortAudio ↔ Web Audio). Already documented
  (see PLATFORM PLUMBING notes in the gated-capture code).
- **Chosen (candidate to unify):** component/file **granularity** at the view layer.

## Inventory — native view → web fan-out (accruing during view/* review)

| Native view (Swift / Python) | Web components today | Restructure note |
|---|---|---|
| `FFTAnalysisMetricsView` / `fft_analysis_metrics_view` | `MetricsPanel.tsx` | 1:1 — fine as-is |
| `TapAnalysisResultsView.swift` (1291 ln: peaks + Ring-Out + Tap Ratio + Plate/Brace props + export) / `tap_tone_analysis_view` guitar-summary | `AnalysisResults.tsx` (Ring-Out/Tap-Ratio only) + `PeakCard.tsx` + material panels + export bar | **fan-out** — candidate to consolidate toward a `TapAnalysisResults` component matching the native file |
| `ComparisonResultsView` (all 3) | `ComparisonResultsView.tsx` | 1:1 — fine. (But Python had copy-pasted `MultiTapComparisonResultsView`'s dead `bold`/rectangle "averaged row" logic — VCR-1, removed. Watch for similar copy-paste between the two comparison views.) |
| **`view/main`** — Swift `TapToneAnalysisView` (main + 5 extensions: Actions/Controls/Export/Layouts/SpectrumViews) / Python `tap_tone_analysis_view.py` (**6868-line MONOLITH**) | `App.tsx` (orchestrator) + child components (each its own slug: spectrum-chart, peak-card, threshold-slider, settings, save-sheet, metrics…) + hooks (useChartView/useAnnotations/useMaterialSession/useAudioEngine) | **3-way structural divergence, the marquee case.** Swift = class-extension split; Python = monolith whose own module doc says *"the full split into separate mixin files is pending"* (a documented intent to match Swift's extensions); web = component + hooks decomposition. Python monolith is **multi-slug** (inline sub-panels belong to guitar-summary / results / material-list). Restructure: split the Python monolith (it already intends to), reconcile the web decomposition, pick a common target. |
| `MultiTapComparisonResultsView` (all 3) | `MultiTapComparisonResultsView.tsx` | 1:1 — fine. Clean mapping in all three; **not** a fan-out. (Source of the dead bold/rectangle path Python copy-pasted into `ComparisonResultsView` — VCR-1.) |
| **`view/settings`** — Swift `TapSettingsView.swift` + 3 extensions (Sections/Actions/LayoutHelpers) / Python `_show_settings()` **inline in the 6868-ln monolith** (+ empty `tap_settings_view_*.py` stubs) | `SettingsPanel.tsx` | **fold-in (opposite of a fan-out).** Swift = file-per-concern split; Python UI is inline in the monolith (stubs mark a pending extraction to mirror Swift); web = one component. The `@parity view/settings` tag was mis-placed on the Python `AppSettings` STORE (mirror of Swift `TapDisplaySettings`) — re-tagged onto `_show_settings`. The store is a separate cross-platform group (Swift `TapDisplaySettings` ↔ Python `AppSettings` ↔ web `settings.ts`) that still needs its own `@parity` slug. |
| **`view/spectrum-chart` + `view/spectrum-gestures`** — Swift splits into `SpectrumView.swift` (chart) **+ `SpectrumView+GestureHandlers.swift`** (gestures) / Python `fft_canvas.py` (+ gesture handling) | **both in one file `SpectrumChart.tsx`** (chart render + wheel/drag/pinch gesture block inline) | **fold-in.** The web has full, touch-aware, region-aware gestures (wheel-zoom, drag-pan, two-finger pinch) — it just **co-locates** them with the chart instead of a separate gesture file, so `view/spectrum-gestures` showed "— no web member" (a mapping artifact, NOT missing functionality). Fix = symbol-level `@parity view/spectrum-gestures` tag on the gesture block in `SpectrumChart.tsx`. Restructure decision: keep gestures inline (web) or split to match Swift — case-by-case. |
| _(add rows as each view slug is reviewed)_ | | |

## Finding from the view/main deep dive (reassuring)

A feature-by-feature dive across `view/main` (controls, toolbar, status bar, enable-logic,
material prompts, banners) found the **user-facing content is in tight parity across all three
despite the structural divergence** — same ranges/defaults, labels, messages, step prompts, wording.
So the divergence is **structure-only**; the content-sync discipline is strong. Implication for the
restructure: it's a **code-organization** job (split Python's monolith, reconcile the web
decomposition), **not** a content-reconciliation job — low risk of behavioural change if the content
is preserved verbatim while the file/component boundaries move.

## Peak-selection & annotation ownership → analyzer (P3, from the analyzer consolidation)

Captured here per the user (2026-07-11): while aligning the analyzer with Swift, a **model↔view boundary
divergence** surfaced that belongs to this restructure, not the state/audio consolidation.

- **Swift:** `TapToneAnalyzer` OWNS the whole peak-selection subsystem — `selectedPeakIDs`, `peakModeOverrides`,
  `peakAnnotationOffsets`, `selectedPeakFrequencies`, `userHasModifiedPeakSelection` — and preserves them
  **by frequency** across the UUID churn `findPeaks` causes (`recalculateFrozenPeaksIfNeeded` /
  `applyFrozenPeakState`). Selection + annotation state is analyzer state.
- **Web:** this lives in the **view** — the `useAnnotations` hook (selection, mode overrides, dragged label
  offsets) + the App `peaks` memo. A port-time view-side choice, same class as the component-granularity
  divergence above.
- **P3 = move that subsystem onto the analyzer** with Swift's by-frequency preservation. It's the most
  view-entangled slice, so it rides with the view-layer restructure rather than the analyzer consolidation.
- **P1 + P2** (main peaks + `tapEntries`-with-peaks into the analyzer) are done first, in the analyzer
  consolidation — **spec: [TAPTONEANALYZER-CONSOLIDATION.md](TAPTONEANALYZER-CONSOLIDATION.md) § Peak analysis.**
  P3 picks up the selection/annotation remainder here.
- **Two 6-TEST parity suites ride on P3** (they exercise exactly this subsystem; testing them against the
  view-side hook now would be thrown away when it moves to the analyzer — rescheduled here 2026-07-12):
  - `frozen-peak-recalc` **selection half** — Swift PR1/PR3–PR7 (`applyFrozenPeakState` by-frequency remap of
    selection / mode-overrides / annotation-offsets). The engine half (PR-A/PR2 on `recalculatePeaks`) already
    shipped 3-way (`ad0487d`); P3 appends the selection tests to that suite.
  - `annotation-state` (whole suite — D1–D8 offsets/selection/visibility/overrides, PS1–PS6 plate-peak selection,
    D3b `userHasModifiedPeakSelection`/`resetToAutoSelection`, `AnnotationStateTests.swift`). Web-only gap until P3.
  When P3 lands, build both suites against the analyzer (mirroring Swift), so both slugs go 3-way.

## Material peaks overload the guitar peak array (natives) — here the WEB is the correct model

_Added 2026-07-21, from the loaded-plate fL bug. Prevention, not a bug fix — which is why it lives
here rather than as its own STATUS item. Fully mapped; ~50 sites._

Swift `TapToneAnalyzer.currentPeaks` and Python `current_peaks` hold **both** guitar peaks **and**
material (plate/brace) peaks. That overloading is a bug factory: a *guitar-only* filter (Peak Min)
reached into the array while a **material** measurement was loaded and deleted the fL peak (Peak Min
−60 vs fL at −62.41 dB), losing it from the peak table *and* the chart annotations. Fixed on Python
in `_emit_loaded_peaks_at_threshold`; Swift got the matching explicit guard (Stage 0).

**Note the direction of travel:** normally the web is the port catching up. Here the **web has the
right design and the natives don't** — its `peaks` array is guitar-only (`if (p.material) peaks = []`)
with material in a `matPeaks { longitudinal, cross, flc }` struct, and a *separate save builder*
`buildMaterialMeasurement` (`src/measurement/fromLive.ts:520`) that constructs the file's `peaks[]`
straight from `matPeaks` and derives `selectedPeakIDs` from the same three. The bug is structurally
impossible there. It is the reference implementation, and its files round-trip with both natives.

**Replacement source (a trap):** the per-phase lists `longitudinalPeaks`/`crossPeaks`/`flcPeaks` are
**NOT** a complete source — they are explicitly emptied on load (Swift `MeasurementManagement.swift:
566,573,580`; Python `:536-538`, comment "peaks come from currentPeaks") and exist only during a live
capture. The complete source is `selectedLongitudinalPeak`/`Cross`/`Flc` — i.e.
`materialIdentifiedPeaks` / `material_identified_peaks` — repopulated on load, and exactly the three
peaks the file format stores.

**Sharp edges (what would NOT survive a naive change):**
1. **File format.** For material, `guitarFullSavePeaks()` / `guitar_full_save_peaks()` returns
   `currentPeaks` verbatim, so `peaks[]` in every material `.guitartap` comes from it. Guitar-only ⇒
   new material files get `peaks: []`, orphaning `selectedLongitudinalPeakID`/`Cross`/`Flc`, which
   every reader (including our own load path) resolves against `peaks[]`. Backward compatibility in
   BOTH directions must be designed. Sequence it: make the material store the save/load source
   FIRST, make the array guitar-only SECOND.
2. **ID coherence** — the saved L/C/FLC ids line up with `peaks[]` today only because both come from
   the same array.
3. **~12 Swift `.disabled(currentPeaks.isEmpty)` guards** (`+Layouts.swift`/`+Controls.swift`) gate
   Save/Export for ALL types — they would silently disable Save and Export for plate/brace.
4. **Re-source, don't just guard:** the material Analysis Results table
   (`TapAnalysisResultsView.swift:391`), the plate-property fallback (`:701-714`), and PDF/image
   export (`TapToneAnalysisView+Export.swift:86,107,125,279,295,305`).

**Verification bar:** round-trip `plate-umik-1-swift-iphone-1784499360.guitartap` (the fL case),
`plate-umik-1-3-tap-swift-ipad-…` (the corrupt-aggregate heal) and the brace fixtures on all three
platforms, byte-comparing saved output before/after.

## Open questions for the spec (later)
- Which fan-outs earn their keep vs. should consolidate? (case-by-case, not a blanket rule)
- Does consolidating hurt React testability enough to matter here? (probably not — DSP is already
  separately testable)
- Naming: align web component filenames to native view names where consolidated.