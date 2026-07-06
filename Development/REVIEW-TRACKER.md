# Comment & Developer-Doc Review Tracker

Tracks Task 1 (comment accuracy/consistency/cross-ref + migrate Swift→Py/web) and
Task 2 (developer API docs). Driven by the `@parity` groups; conventions in
`DEV-DOC-STANDARD.md`. Cells: ☐ todo · ◐ in progress · ✓ done · — no member in that repo.

Task 3 (6-TEST) covers the `test/*` groups — do those there, not here.

## Doc-parity audit (added 2026-07-06)
A slug is **read/behavior ✓** (the table below) when its comments were read + verified. It is
**doc-parity ✓** (this section) only when all three platforms document the same *meaningful*
symbols to equivalent depth — the measurable definition in `DEV-DOC-STANDARD.md`. These are
**separate gates**; a slug can be read-✓ but doc-parity ⚠. Mechanical gate:
`python3 Development/tools/doc_coverage.py [slug-prefix]` — coverage = `documented/total`
(web = % with **TSDoc**, not `//`). `*` = multi-slug file (symbol-level attribution pending, M3).

Snapshot (in-scope finished slugs; `test/*` excluded — Task 3). Swift/Python sub-100% is mostly
private view-helpers / Qt accessors / multi-slug noise (parity-OK per criterion 2); the systemic
real gap is **web TSDoc**.

Coverage = % of the **public/exported** surface documented (internal helpers excluded from the
gate). `(x/y)` = raw fraction where noise remains. Tool corrected 2026-07-06: measures the
public surface only, and skips multi-line class/def signatures (was false-flagging documented
classes like `TapToneAnalyzer`).

| slug | S | P | W | doc-parity | back-fill |
|---|---|---|---|---|---|
| `dsp/pitch` | 100 | 100 | 100 | ✓ | — |
| `dsp/fft` | 100 | — | 100 | ✓ | — |
| `dsp/calibration` | 100 | 100 | 100 | ✓ | web type summaries added |
| `dsp/find-peaks` | 100 | 100 | 100 | ✓ | web `Peak` + `FindPeaksOptions` summaries |
| `dsp/decay` | 100 | 100 | 100 | ✓ | web `DecaySample` summary |
| `dsp/gated-fft` | 100 | — | 100 | ✓ | web `GatedFFTResult`; Swift `finishGatedFFTCapture` doc |
| `dsp/gated-capture` | — | — | 100 | ✓ | web: module block + 7 types/consts |
| `dsp/guitar-fft` | — | 100 | 100 | ✓ | web 5 types/const (multi-slug file) |
| `dsp/guitar-modes` | 100 | — | 100 | ✓ | web module block + type summaries |
| `dsp/material-properties` | 100 | 100 | 100 | ✓ | web `WoodQuality`/`WoodType`/`GrainDirection` |
| `dsp/spectrum-average` | — | 100 | 100 | ✓ | web `averageSpectra` `//`→TSDoc |
| `model/guitar-mode-classify` | — | — | 100 | ✓ | web `ResolvedMode` + module block |
| `model/mode-colors` | — | 100 | 100 | ✓ | web 5 consts `//`→TSDoc |
| `view/multi-tap-results` | (5/11) | (2/6) | 100 | ✓ | WEB-MTC-1; Swift/Python residual = private helpers at parity |
| `audio/tap-analyzer` | 100 | 100 | 100 | ✓ | web engine+guitarFFT; Python `is_detecting`/`display_mode` getter docstrings |
| `audio/realtime-analyzer` | 100 | 100 | — | ✓ | Swift `RealtimeFFTAnalyzer` class doc + 2 consts; Python `selected_input_device` getter |
| `view/analysis-metrics` | (44) | 80 | 0 | ⚠ web | web `MetricsPanel` — VIEW LAYER (not started) |
| `view/comparison-results` | (29) | 67 | 0 | ⚠ web | web — VIEW LAYER |
| `view/help` | (0/2) | 83 | 0 | ⚠ web | web `QuickStartGuide` — VIEW LAYER |
| `view/main` | 74 | 46 | 0 | ⚠ web | web `App.tsx` — VIEW LAYER |
| `view/*` (remaining) | — | — | ~0 | ⚠ web | peak-card, save-sheet, settings, spectrum-chart, threshold-slider, guitar-summary |

**Status (2026-07-06): DSP + model + audio doc-parity COMPLETE — every non-view slug is 100%
across all three platforms** (setters/dunders/private helpers excluded per the definition). The
tool now measures the public surface, skips multi-line signatures, and excludes property
setters. Remaining: the **view-layer web components** (~0% TSDoc) — the larger remaining batch
(next). Re-run the tool per slug as the gate; flip a row to ✓ only when the gate + a human read
of the undoc list agree.

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
| `view/help` | ✓ | ✓ | ✓ | **Detailed content parity review** (extracted+diffed all 3, ~1700 lines). Content well-synced (same 10 sections + technical facts). VHELP-1: Swift class-doc section table was stale (listed non-sections Ring-Out/Tap-Ratio/Material-Properties, omitted Controls/Tap Controls/Settings/Glossary) — corrected. Measurement-type enumeration order aligned to canonical **Generic, Acoustic, Classical, Flamenco, Plate, Brace** in all mentions (Swift ×2, Python ×3, web ×3; Swift Settings-ref was already correct; web dropped "Classical **Guitar**"→"Classical"). Decisions (user): tap↔click kept **per-platform** (intentional, not drift); menu-bar/toolbar content differs correctly per platform. Left as-is: minor "Tap OK" drop + cosmetic (≈ vs "approximately") |
| `view/main` | ✓ | ✓ | ✓ | **DEEP-DIVED** (Swift 6-file split, Python 6868-line monolith [split "pending" per its own doc], web App.tsx + components + hooks). Traced 6 feature areas across all 3: controls bar (Taps 1–10/1, Threshold −80…−20/−40, Peak Min −100…−20/−60, labels, buttons), toolbar (order+labels), status bar (messages, "Phase 1/2 · Tap 3/5", exit hints), Peak Min enable (disabled plate/brace+comparison), dynamic material prompts ("Step 1: Longitudinal (L) Mode"…"Measures shear stiffness" — identical), loaded-settings banner — **all at parity**. Only finding: **VMAIN-1** Python `_build_controls_bar` docstring listed a non-existent "Hysteresis" control (removed). Key takeaway: **content is tightly synced despite the structural divergence** — divergence is structure-only. Layout is inherently platform-specific (not a parity target) |
| `view/multi-tap-results` | ✓ | ✓ | ✓ | all 3 READ. **Structure/behavior/labels at full parity** (header `Tap\|Air\|Top\|Back`, `Tap N` rows w/ palette dots, bold `Averaged` row w/ **square** indicator, `resolved_mode_peaks`, `—` for missing, `%.1f Hz`). Averaged color identical everywhere (**#FFD900** = Swift `Color(1.0,0.85,0.0)`). **PY-MTC-1**: palette comment named non-existent `TapToneAnalyzer.comparisonPalette` → `multiTapPalette`. **PY-MTC-2**: removed duplicate "Mirrors Swift…" line in module docstring. **WEB-MTC-1**: web was below the doc bar (only a file header) though it's a clean **1:1** component (not a restructure fan-out) → added TSDoc on the component, both interfaces, and the two palette constants. **Palette colors → THEME-SPEC §3.5** (added): the 5-color palette is another appearance-adaptive system-color set (Swift `.blue….teal`, Python froze light, web froze dark/brightened) — same gap as mode colors; RGB unification deferred (lockstep). Swift & web code clean, no code changes |
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
