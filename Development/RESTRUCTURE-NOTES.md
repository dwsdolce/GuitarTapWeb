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
| _(add rows as each view slug is reviewed)_ | | |

## Open questions for the spec (later)
- Which fan-outs earn their keep vs. should consolidate? (case-by-case, not a blanket rule)
- Does consolidating hurt React testability enough to matter here? (probably not — DSP is already
  separately testable)
- Naming: align web component filenames to native view names where consolidated.