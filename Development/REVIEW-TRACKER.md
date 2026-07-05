# Comment & Developer-Doc Review Tracker

Tracks Task 1 (comment accuracy/consistency/cross-ref + migrate Swift→Py/web) and
Task 2 (developer API docs). Driven by the `@parity` groups; conventions in
`DEV-DOC-STANDARD.md`. Cells: ☐ todo · ◐ in progress · ✓ done · — no member in that repo.

Task 3 (6-TEST) covers the `test/*` groups — do those there, not here.

| slug | Swift | Python | Web | notes |
|---|---|---|---|---|
| `dsp/calibration` | ✓ | ✓ | ✓ | web: 1–24000 Hz filter (#1) + `referenceLevel` parsing (#2) + fuller TSDoc; Python reference-SPL/Sens precedence aligned to Swift (#5) |
| `dsp/decay` | ✓ | ✓ | ✓ | all 3 READ; FIXED stale "~10 Hz" cadence in Swift (3 spots) + Python (finding #4); web was already accurate (~43 Hz) |
| `dsp/fft` | ✓ | ✓ | ✓ | all 3 READ. Swift fix: computeFFT doc dropped stale `calibrationCorrections` (cat-1). Python fix: scipy→numpy + performFFT→computeFFT (cat-1). Web: TSDoc enriched. Map note M2 (web-primitive group) |
| `dsp/find-peaks` (model) | ✓ | ✓ | ✓ | ResonantPeak.swift + resonant_peak.py READ & verified accurate (faithful mirror, no edits needed); web Peak enriched |
| `dsp/peak-analysis` (algo) | ✓ | ✓ | ✓ | READ all three: PeakAnalysis.swift (gold; fixed stale reanalyze DocC, finding #3) + peak_analysis.py (accurate mirror) + web findPeaks doc consistent |
| `dsp/gated-capture` | ✓ | ✓ | ✓ | all 3 READ. Swift: GC-1 arch-header window numbers + diagram (500 ms buffer / 400 ms FFT / fftSize continuous), GC-2 dispatch-branch doc, GC-3 400→500 ms capture window, + PLATFORM PLUMBING note. Python: PY-1..4 mirror (continuous=fft_size, diagram, 400→500 ms, stale "No Swift counterpart"), + plumbing note. Web: enriched `alignCaptureToOnset`+`findLevelCrossing`, M3 tag `findDominantPeak`→gated-fft. Divergence (GCD closure vs Qt signal/slot) documented both sides |
| `dsp/gated-fft` | ✓ | ✓ | ✓ | all 3 READ. Swift: GF-1 findDominantPeak 15→6 dB, GFFT-1 computeGatedFFT summary "linear"→dB, GFFT-2 0.74→1.35 Hz/bin, GFFT-3 add missing longitudinal-handler DocC, GFFT-4 cross/FLC handler phase wording (review-pause vs auto-advance), GFFT-5 FLC "shear/diagonal"→"torsional/twist" (fLC=twist mode; Glc=shear modulus), GFFT-6 Hann clause. Python: PY-GFFT-A compute_gated_fft docstring, PY-GFFT-B FLC term, PY-GFFT-C 3 handler docstrings. Web: computeGatedFFT doc already full; findDominantPeak enriched. **Empirically verified** vDSP_HANN_DENORM = periodic (2πn/N) vs np.hanning symmetric (N−1): different windows, ~1e-7 Hz peak-freq impact at 16384–32768 → left as documented sub-precision platform diff |
| `dsp/guitar-fft` | ✓ | ✓ | ✓ | all 3 READ. Swift `performFFT` FILE_DEBUG comment fixed (cat-1) → frame-bookkeeping; Python `perform_fft` docstring fixed (dropped phantom FILE_DEBUG bullet, added Qt int-encoding note). Web `dftAnalRect` doc enriched (matches computeFFT/dft_anal). Map note **M3**: web `guitarFFT.ts` is multi-group — added per-symbol `@parity` tags (`averagePowerDb`→spectrum-average, orchestration trio→audio/tap-analyzer) |
| `dsp/guitar-modes` | ☐ | ☐ | ☐ |  |
| `dsp/material-properties` | ✓ | ✓ | ✓ | all 3 READ: Swift gold + Python faithful mirror (formulas/thresholds/coeffs match); web docs cross-checked vs canonical — accurate, no drift |
| `dsp/pitch` | ✓ | ✓ | ✓ | pilot — web enriched (Algorithm Overview + @param/@returns), fixed INVENTORY ref |
| `dsp/spectrum-average` | ✓ | ✓ | ✓ | all 3 READ. Swift `averageSpectra` doc accurate (rationale + formula + edge cases) — no change. Python PY-SA-1: enriched `average_spectra` docstring (added rationale + per-bin formula to mirror Swift). Web WEB-SA-1: enriched `averagePowerDb` (in `guitarFFT.ts`, M3-tagged); WEB-SA-2: documented that it omits the Swift/Python length-mismatch guard — unreachable (callers feed equal-length `GUITAR_FFT_SIZE` spectra), guard NOT added per user |
| `model/guitar-mode-classify` | ☐ | ☐ | ☐ |  |
| `model/mode-colors` | ☐ | ☐ | ☐ |  |
| `audio/realtime-analyzer` | ☐ | ☐ | — |  |
| `audio/tap-analyzer` | ☐ | ☐ | ☐ | web members = orchestration trio (`guitarModePeaks`, `modePeaksFromSpectrum`, `guitarMultiTapModePeaks`) inside `src/dsp/guitarFFT.ts` (tagged per-symbol, M3) — enrich docs here vs canonical |
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
