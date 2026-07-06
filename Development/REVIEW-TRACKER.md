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
| `dsp/guitar-modes` | ✓ | ✓ | ✓ | all 3 READ. Mode Map table verified vs `GuitarType.modeRanges` (exact). GM-1: added the missing **Generic** (default) column to the Swift + Python tables. Web `guitarModes.ts` RANGES match all 4 types; fixed stale `INVENTORY.md`→`Development/INVENTORY.md` ref |
| `dsp/material-properties` | ✓ | ✓ | ✓ | all 3 READ: Swift gold + Python faithful mirror (formulas/thresholds/coeffs match); web docs cross-checked vs canonical — accurate, no drift |
| `dsp/pitch` | ✓ | ✓ | ✓ | pilot — web enriched (Algorithm Overview + @param/@returns), fixed INVENTORY ref |
| `dsp/spectrum-average` | ✓ | ✓ | ✓ | all 3 READ. Swift `averageSpectra` doc accurate (rationale + formula + edge cases) — no change. Python PY-SA-1: enriched `average_spectra` docstring (added rationale + per-bin formula to mirror Swift). Web WEB-SA-1: enriched `averagePowerDb` (in `guitarFFT.ts`, M3-tagged); WEB-SA-2: documented that it omits the Swift/Python length-mismatch guard — unreachable (callers feed equal-length `GUITAR_FFT_SIZE` spectra), guard NOT added per user |
| `model/guitar-mode-classify` | ✓ | ✓ | ✓ | all 3 READ. `classifyAll` code correct on all 3 (Top<Back guard in both the claiming + remaining-peaks loops). GM-CLASSIFY-1: Swift/Python DocC omitted the guard + Python had a stale "no frequency cursor / 2 Hz guard" claim — fixed. **PY-CLASSIFY-3 (CODE)**: added the remaining-peaks Back guard to Python `_classify_all_tuples` to match `classify_all`/Swift/web (35 tests pass). Web `classify.ts` correct; INVENTORY ref fixed + `classifyAll` TSDoc enriched |
| `model/mode-colors` | ✓ | ✓ | ✓ | all 3 READ. Swift/Python colors match (semantic names + RGB). **WEB-COLORS-1** (real mismatch, user-approved): web `dipole` was purple (canonical red) and `ring` was yellow (canonical purple) — fixed to red/purple, keeping the palette's intentional dark-bg brightening (now documented). WEB-COLORS-2: `MODE_LABEL` dipole "Dipole"→"DP", unknown "—"→"?" to match Swift `abbreviation` |
| `audio/realtime-analyzer` | ✓ | ✓ | — | all 3 READ. Swift ARA-1/2/3: stale ~10 Hz→~43 Hz (×3, 1024-sample buffer), continuous FFT window ~400 ms→~1.4 s, publish ~2 Hz→~0.7 Hz. Python clean; `chunksize` default 16384→1024 aligned (app already passed 1024). **PY-RA-1** (missed on first pass, caught by the peak-hold cross-check during tap-analyzer): `recent_peak_level_db` docstring 0.5 s→2.0 s. **No web member** — the browser's Web Audio API is the engine layer (no analyzer class to port) |
| `audio/tap-analyzer` | ✓ | ✓ | ✓ | all 3 READ. Swift TT-1..8: gatedCaptureDuration 400→500 ms (×2), inputLevelDB ~10→~43 Hz (×2), peakMagnitude ~1→~0.7 Hz, FLC "diagonal/shear"→"torsional/twist" (×2), noise-floor EMA ~10 ms/190 ms→~23 ms/450 ms, onset ~9600→~4800 (**verified empirically**), route-change settle 2→3 s. Python PY-TT-7 (onset) + **doc-parity pass**: ported Swift DocC to ~28 bare/under-documented properties (three-layer peak-selection block + scalar config/state). Web `engine.ts` verified clean (richly documented, accurate); `guitarFFT.ts` trio enriched with @param/@returns |
| `view/analysis-metrics` | ✓ | ✓ | ✓ | all 3 READ. Swift VAM-1 (doc said "four GroupBox sections" incl. a non-existent Calibration section + wrong per-section metrics → three sections + status indicator) + VAM-2 (dead `CompactFFTMetricsOverlay` SeeAlso). Python PY-VAM-1 ("four QGroupBox"→three+status), PY-VAM-2 (same dead SeeAlso), PY-VAM-3 (health colors aligned to Swift: green/yellow/orange/red — code was green/orange/darkorange). **Web member = `MetricsPanel.tsx`** (verified clean/accurate), NOT `AnalysisResults.tsx` — retagged (M4) |
| `view/guitar-summary` | ☐ | ☐ | ☐ | **NEW slug (M4)**: the live Ring-Out + Tap-Ratio guitar-summary bar. Web = `AnalysisResults.tsx` (whole file, tagged). Swift = the Ring-Out/Tap-Ratio *section* of the broad `TapAnalysisResultsView.swift` (~L586–630; symbol-tag pending). Python = the guitar-summary *section* of `tap_tone_analysis_view.py` (symbol-tag pending). Not yet reviewed |
| `view/comparison-results` | ✓ | ✓ | ✓ | all 3 READ. Swift + web clean (Air/Top/Back grid, color dot + label, `—` for missing). **VCR-1**: Python had a dead `bold`/filled-rectangle "averaged row" path copy-pasted from `MultiTapComparisonResultsView` (never triggered here; no caller sets `bold`) with comments misattributing it to Swift `ComparisonResultsView` (which is circle-only) — removed; Python now matches Swift/web. Dedup example logged in RESTRUCTURE-NOTES |
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

## Separate efforts (feature work, not `@parity` comment-doc review)

### Theme — Light / Dark / System

Spec: `THEME-SPEC.md` (**PROPOSED**). Cross-platform feature, **strict lock-step parity**
(design once, implement + ship all three together). Surfaced by the mode-color parity work.
**Status: not started — blocked on confirming the §8 open decisions** (mainly the light
magnitude-gradient hexes + light chrome values). Cells: ☐ todo · ◐ in progress · ✓ done.

| Step | Swift | Python | Web | notes |
|---|---|---|---|---|
| 1. Lock spec — confirm §8 decisions | — shared — | — shared — | — shared — | light mag-gradient + light chrome values; else defaults stand |
| 2. Encode palette (§3 values) | ☐ (S) | ☐ (M) | ☐ (S) | asset-catalog color sets / `THEME` dict / CSS vars |
| 3. Wire setting (persist + Settings control + `system` resolve + live OS follow) | ☐ (S) | ☐ (S) | ☐ (S) | same "Appearance: System/Light/Dark" all three |
| 4. Retheme surfaces | ☐ (S) | ☐ (**L**) | ☐ (M) | Python ~150 `setStyleSheet` + pyqtgraph retrofit = long pole; Swift = hardcoded-white audit; web = chart+chrome wiring |
| 5. Integrated visual QA → ship together | — shared — | — shared — | — shared — | matrix: 2 themes × 3 platforms × {live, cards, annotations, Settings, list, export} |

Exports stay **light** on all three (§5). No DSP/oracle impact — presentation only. Effort:
Swift Small, Web Medium, Python Large.
