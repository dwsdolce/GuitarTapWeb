# Comment & Developer-Doc Review Tracker

Tracks Task 1 (comment accuracy/consistency/cross-ref + migrate Swift→Py/web) and
Task 2 (developer API docs). Driven by the `@parity` groups; conventions in
`DEV-DOC-STANDARD.md`. Cells: ☐ todo · ◐ in progress · ✓ done · — no member in that repo.

Task 3 (6-TEST) covers the `test/*` groups — do those there, not here.

| slug | Swift | Python | Web | notes |
|---|---|---|---|---|
| `dsp/calibration` | ✓ | ✓ | ✓ | web: 1–24000 Hz filter (#1) + `referenceLevel` parsing (#2) + fuller TSDoc; Python reference-SPL/Sens precedence aligned to Swift (#5) |
| `dsp/decay` | ✓ | ✓ | ✓ | all 3 READ; FIXED stale "~10 Hz" cadence in Swift (3 spots) + Python (finding #4); web was already accurate (~43 Hz) |
| `dsp/fft` | ☐ | ☐ | ☐ |  |
| `dsp/find-peaks` (model) | ✓ | ✓ | ✓ | ResonantPeak.swift + resonant_peak.py READ & verified accurate (faithful mirror, no edits needed); web Peak enriched |
| `dsp/peak-analysis` (algo) | ✓ | ✓ | ✓ | READ all three: PeakAnalysis.swift (gold; fixed stale reanalyze DocC, finding #3) + peak_analysis.py (accurate mirror) + web findPeaks doc consistent |
| `dsp/gated-capture` | ☐ | ☐ | ☐ |  |
| `dsp/gated-fft` | ☐ | ☐ | ☐ |  |
| `dsp/guitar-fft` | ☐ | ☐ | ☐ |  |
| `dsp/guitar-modes` | ☐ | ☐ | ☐ |  |
| `dsp/material-properties` | ✓ | ✓ | ✓ | all 3 READ: Swift gold + Python faithful mirror (formulas/thresholds/coeffs match); web docs cross-checked vs canonical — accurate, no drift |
| `dsp/pitch` | ✓ | ✓ | ✓ | pilot — web enriched (Algorithm Overview + @param/@returns), fixed INVENTORY ref |
| `dsp/spectrum-average` | ☐ | ☐ | ☐ |  |
| `model/guitar-mode-classify` | ☐ | ☐ | ☐ |  |
| `model/mode-colors` | ☐ | ☐ | ☐ |  |
| `audio/realtime-analyzer` | ☐ | ☐ | — |  |
| `audio/tap-analyzer` | ☐ | ☐ | ☐ |  |
| `view/analysis-metrics` | ☐ | ☐ | ☐ |  |
| `view/comparison-results` | ☐ | ☐ | ☐ |  |
| `view/help` | ☐ | ☐ | ☐ |  |
| `view/main` | ☐ | ☐ | ☐ |  |
| `view/multi-tap-results` | ☐ | ☐ | ☐ |  |
| `view/peak-card` | ☐ | ☐ | ☐ |  |
| `view/save-sheet` | ☐ | ☐ | ☐ |  |
| `view/settings` | ☐ | ☐ | ☐ |  |
| `view/spectrum-chart` | ☐ | ☐ | ☐ |  |
| `view/spectrum-gestures` | ☐ | ☐ | — |  |
| `view/threshold-slider` | ☐ | ☐ | ☐ |  |
| `test/annotation-state` | ☐ | ☐ | — |  |
| `test/brace` | ☐ | ☐ | ☐ |  |
| `test/button-enablement` | ☐ | ☐ | — |  |
| `test/classify` | ☐ | ☐ | ☐ |  |
| `test/comparison` | ☐ | ☐ | ☐ |  |
| `test/decay-tracking` | ☐ | ☐ | ☐ |  |
| `test/display-range` | ☐ | — | ☐ |  |
| `test/dsp` | ☐ | ☐ | — |  |
| `test/file-playback` | ☐ | ☐ | ☐ |  |
| `test/frozen-peak-recalc` | ☐ | ☐ | — |  |
| `test/gated-fft` | ☐ | ☐ | ☐ |  |
| `test/import-persistence` | ☐ | ☐ | — |  |
| `test/measurement-codable` | ☐ | ☐ | ☐ |  |
| `test/measurement-complete` | ☐ | ☐ | — |  |
| `test/peaks` | ☐ | ☐ | ☐ |  |
| `test/pitch` | ☐ | ☐ | ☐ |  |
| `test/plate` | ☐ | ☐ | ☐ |  |
| `test/scenario-trace` | ☐ | ☐ | — |  |
| `test/start-tap-race` | ☐ | ☐ | — |  |
| `test/state-invariants` | ☐ | ☐ | — |  |
| `test/tap-decisions` | ☐ | ☐ | ☐ |  |

## Platform-specific (`@parity none`) — accuracy-only, no migration

_(none tagged yet)_

## Deferred / untagged tail

Files not yet in the `@parity` map (see PHASE6-PARITY.md §6-MAP deferred list):
`signal.ts`, `wav.ts`, `analysisQuality.ts`, material/measurements panels, a few
tests. Give these a lighter accuracy-only pass once the mapped groups are done.
