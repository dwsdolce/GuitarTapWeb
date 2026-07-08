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
| `view/analysis-metrics` | (2/6) | 80 | 100 | ✓ web | web `MetricsPanel` done; Swift residual = internal SwiftUI subview helpers |
| `view/comparison-results` | 100 | 100 | 100 | ✓ | web `ComparisonResultsView` done |
| `view/help` | 100 | 100 | 100 | ✓ | web `QuickStartGuide` done |
| `view/main` | (12/17) | (8/22) | 100 | ✓ web | web `App` orchestrator done; Swift internal helpers + Python monolith noise |
| `view/peak-card` | 100 | 100 | 100 | ✓ | FULL REVIEW done — Swift inputs + Python methods + web TSDoc; 2 Python visual-parity fixes; map tag added to real impl |
| `view/save-sheet` | 100 | 100 | 100 | ✓ | FULL REVIEW done — fixed web content drift (labels/placeholder/help text) + Python getter docstrings + web props TSDoc |
| `view/settings` | 100 | — | 100 | ✓ | FULL REVIEW done — **web** content aligned to canonical (the divergent one); Swift stale DocC ×2; Python UI faithful (stub "Gore gap" was false) + map re-tag (UI symbol-tagged in monolith; store de-tagged). Python `—` = UI inline in the view/main monolith |
| `view/threshold-slider` | 100 | 100 | 100 | ✓ | FULL REVIEW done — full content/behavior parity; Swift stale-path comment fixed; Python `paintEvent` + web props/component TSDoc |
| `view/spectrum-gestures` | 16/17 | 100 | ✓sym | ✓ | FULL REVIEW done — faithful gesture parity; map symbol-tag (web co-locates in SpectrumChart.tsx); false "log-mode gap" withdrawn (log unreachable everywhere) |
| `view/spectrum-chart` | 100 | 100 | 100 | ✓ | FULL REVIEW done — no content drift; doc-parity 100/100/100; rendering internals platform-specific (map+parity lens); log-freq paths pending removal |
| `view/guitar-summary` | (M5 file) | — | 100 | ✓ | FULL REVIEW done — **GS-1 real bug fixed** (Python decay "Good" threshold 0.70→0.75 to match Swift/web canonical); labels/formats parity; symbol-tags added; colors → THEME-SPEC §3.6; web AnalysisResults 100%. Swift `—`/(M5) = section lives in the untagged broad `TapAnalysisResultsView.swift`. **✅ ALL view/* slugs now reviewed.** |

**Status (2026-07-06): doc-parity back-fill COMPLETE for every ALREADY-REVIEWED slug** — all
non-view slugs + the 5 reviewed view slugs (`analysis-metrics`, `comparison-results`, `help`,
`main`, `multi-tap-results`) are at web 100%, Swift/Python documented at the public/type level.
The tool measures the public surface, skips multi-line signatures + trailing-comment
signatures, excludes property setters and members of private types (Swift `private struct`,
Python `class _Name`), and credits Swift file-top `///` banners. **The remaining view slugs are UNREVIEWED and are NOT
doc-parity back-fill targets** — they get their docs as part of their own full review (next
phase). Re-run the tool per slug as the gate; flip a row to ✓ only when gate + human read agree.

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
| `view/guitar-summary` | ✓ | ✓ | ✓ | all 3 READ (full review). **Structure/labels/formats at full parity** — captions "Ring-Out"/"Tap Ratio", `%.2fs`/`%.2f:1`, "Waiting…"/"Need Air & Top", subs "–15 dB"/"Ideal: 1.9–2.1", tap-ratio thresholds 1.7/1.9/2.1/2.3 + labels. **REAL BUG (GS-1):** Python `_decay_quality` acoustic/generic "Good" threshold was **0.70**, but Swift `GuitarType.decayThresholds` (canonical) + web both use **0.75** → fixed Python to 0.75 (a 0.70–0.75 s ring-out was mis-graded). **Quality colors → THEME-SPEC §3.6** (Swift system / Python Material / web tuned — appearance-adaptive, not reconciled inline). **Map (M4):** symbol-tagged `guitarAnalysisSummary` (Swift) + the inline bar (Python monolith). Doc-parity: web `AnalysisResults` 100%. **Swift gate shows 47% = the WHOLE untagged M5 `TapAnalysisResultsView.swift` now attributed here (file-level M3 limitation); `guitarAnalysisSummary` itself is doc'd — full M5 file tagging deferred.** Python `—` = section inline in the view/main monolith |
| `view/comparison-results` | ✓ | ✓ | ✓ | all 3 READ. Swift + web clean (Air/Top/Back grid, color dot + label, `—` for missing). **VCR-1**: Python had a dead `bold`/filled-rectangle "averaged row" path copy-pasted from `MultiTapComparisonResultsView` (never triggered here; no caller sets `bold`) with comments misattributing it to Swift `ComparisonResultsView` (which is circle-only) — removed; Python now matches Swift/web. Dedup example logged in RESTRUCTURE-NOTES |
| `view/help` | ✓ | ✓ | ✓ | **Detailed content parity review** (extracted+diffed all 3, ~1700 lines). Content well-synced (same 10 sections + technical facts). VHELP-1: Swift class-doc section table was stale (listed non-sections Ring-Out/Tap-Ratio/Material-Properties, omitted Controls/Tap Controls/Settings/Glossary) — corrected. Measurement-type enumeration order aligned to canonical **Generic, Acoustic, Classical, Flamenco, Plate, Brace** in all mentions (Swift ×2, Python ×3, web ×3; Swift Settings-ref was already correct; web dropped "Classical **Guitar**"→"Classical"). Decisions (user): tap↔click kept **per-platform** (intentional, not drift); menu-bar/toolbar content differs correctly per platform. Left as-is: minor "Tap OK" drop + cosmetic (≈ vs "approximately") |
| `view/main` | ✓ | ✓ | ✓ | **DEEP-DIVED** (Swift 6-file split, Python 6868-line monolith [split "pending" per its own doc], web App.tsx + components + hooks). Traced 6 feature areas across all 3: controls bar (Taps 1–10/1, Threshold −80…−20/−40, Peak Min −100…−20/−60, labels, buttons), toolbar (order+labels), status bar (messages, "Phase 1/2 · Tap 3/5", exit hints), Peak Min enable (disabled plate/brace+comparison), dynamic material prompts ("Step 1: Longitudinal (L) Mode"…"Measures shear stiffness" — identical), loaded-settings banner — **all at parity**. Only finding: **VMAIN-1** Python `_build_controls_bar` docstring listed a non-existent "Hysteresis" control (removed). Key takeaway: **content is tightly synced despite the structural divergence** — divergence is structure-only. Layout is inherently platform-specific (not a parity target) |
| `view/multi-tap-results` | ✓ | ✓ | ✓ | all 3 READ. **Structure/behavior/labels at full parity** (header `Tap\|Air\|Top\|Back`, `Tap N` rows w/ palette dots, bold `Averaged` row w/ **square** indicator, `resolved_mode_peaks`, `—` for missing, `%.1f Hz`). Averaged color identical everywhere (**#FFD900** = Swift `Color(1.0,0.85,0.0)`). **PY-MTC-1**: palette comment named non-existent `TapToneAnalyzer.comparisonPalette` → `multiTapPalette`. **PY-MTC-2**: removed duplicate "Mirrors Swift…" line in module docstring. **WEB-MTC-1**: web was below the doc bar (only a file header) though it's a clean **1:1** component (not a restructure fan-out) → added TSDoc on the component, both interfaces, and the two palette constants. **Palette colors → THEME-SPEC §3.5** (added): the 5-color palette is another appearance-adaptive system-color set (Swift `.blue….teal`, Python froze light, web froze dark/brightened) — same gap as mode colors; RGB unification deferred (lockstep). Swift & web code clean, no code changes |
| `view/peak-card` | ✓ | ✓ | ✓ | all 3 READ (full review). Feature/label/color/value parity confirmed (star, mode glyph+badge, freq, pitch, Q/BW, magnitude ramp, freeform teal+tag, mode menu). **Fixed 2 Python visual-parity gaps vs Swift+web:** (1) added the ✎ pencil glyph on manual override (was italic-only); (2) range badge now keyed off the AUTO mode (`self._auto_mode`) with the Unknown/Upper guard (was: effective mode, no guard → showed ⚠ for upper/unknown/plate-brace). **Map fix:** `@parity view/peak-card` was only on the re-export shim `combined_peak_mode_row_view.py`; added it to the real impl `peak_card_widget.py`. Doc-parity: Swift 4 undoc inputs + Python 16 public-method docstrings + web component/props TSDoc → 100/100/100 |
| `view/save-sheet` | ✓ | ✓ | ✓ | all 3 READ (full review). Swift+Python content agreed; **fixed web content drift vs canonical:** field label "Name"→"Measurement Name", placeholder "e.g. Contreras Classical"→"e.g. Martin 000-28, Spruce Top", "Notes"→"Notes (Optional)", added missing help text "Add any observations about this measurement" (as textarea placeholder, matching Python). Doc-parity: Python `measurement_name`/`notes` getter docstrings + web `SaveSheetProps` TSDoc → 100/100/100 |
| `view/settings` | ✓ | ✓ | ✓ | all 3 READ (full review; Swift 4-file split + Python inline `_show_settings` + web SettingsPanel). **Python UI is a faithful, complete port of Swift** (measurement type incl. Gore, display, analysis, audio all match) — the sibling stub's "Gore not rendered (item #10)" claim was **stale/false**; fixed. **Map fix:** `@parity view/settings` was mis-tagged on `AppSettings` (the QSettings STORE = Swift TapDisplaySettings) → symbol-tagged the real UI `_show_settings()` in the monolith; store de-tagged (awaits its own settings-store slug). **Swift:** stale DocC "max peaks; hysteresis margin" ×2 → actual analysis controls; +isCompact/init `///`. **Web (the divergent one):** aligned content to canonical — measurement-type description + footer, "Mode Frequency Ranges" (dropped extra Upper row), "Sample Dimensions", FLC label+desc, "Gore Target Thickness — Body Dimensions"+desc, "Body Length (a)/Lower Bout Width (b)", "Plate Vibrational Stiffness (f_vs)"/"Panel Type", brace "Height (tap direction)"+desc/"Width (breadth)", title "Tap Settings", "None (Uncalibrated)", "Audio Input Device"; + reordered plate to canonical (dims→FLC→Gore→f_vs); + SettingsPanelProps/component TSDoc. 5/5 · — · 2/2 |
| `view/spectrum-chart` | ✓ | ✓ | ✓ | all 3 READ (full review; the largest slug — Swift `SpectrumView.swift` 1322 + extensions / Python `fft_canvas.py` 1831 / web `SpectrumChart.tsx` 528). **Map+parity lens** (rendering internals are inherently platform-specific: Swift Charts vs pyqtgraph vs canvas). **No content drift** — Hz/kHz axis convention (threshold 1000), crosshair readout (freq+dB, THEME-SPEC colors), bounds/ranges, Zoom&Pan help text, title/legend/mode labels all faithfully mirror Swift. **Deeper label/title/legend/badge pass (post-doc-parity) confirmed parity:** axis titles "Frequency (Hz)"/"FFT Magnitude (dB)" identical; mode boundaries all 6 modes w/ label at lower bound; on-chart peak badge = 4 rows (mode+override glyph / pitch ♪note±cents / freq / mag dB) matching Swift `DraggablePeakAnnotation` + Python `PeaksModel.annotation_html`. Doc-parity → **100/100/100**: web `SpectrumChartProps`/component TSDoc; Python 9 getter/`resizeEvent` docstrings; Swift sample* were `#Preview` locals (tool now skips `#Preview` blocks). Log-freq render paths left **as-is (pending removal per LOG-FREQ-REMOVAL.md)** — not polished |
| `view/spectrum-gestures` | ✓ | ✓ | ✓(sym) | all 3 READ (full review). **Web gestures are a faithful, complete port of Swift** — region-aware wheel/drag/pinch, modifier semantics (Shift=pan-freq, Alt/Opt=pan-dB, Cmd/Ctrl=zoom-both), pan sensitivities (÷400/÷300), bounds (5000/−120/+20), min spans (50/10) all match. **Map fix:** web had "—" because gestures are co-located inline in `SpectrumChart.tsx` (Swift splits to a file; Python inlines in `FftCanvas`, stub documents it) → added symbol-level `@parity view/spectrum-gestures` tag (RESTRUCTURE-NOTES row added). **Withdrew false "log-mode gap"** — log frequency is unreachable on ALL platforms (web `logFreq` defaults false w/ no toggle; Swift `isLogarithmic` always `.constant(false)`); the log branches are dead scaffolding at parity. Swift: doc'd applyFrequency/MagnitudeZoom; tool now skips `#if/#else` when finding doc comments (16/17 = a platform-pair sharing one doc). Web tag is symbol-level (file's first tag = spectrum-chart, so gate shows web `—` for this slug) |
| `view/threshold-slider` | ✓ | ✓ | ✓ | all 3 READ (full review). **Full content/behavior parity** — constants (peak-hold 0.5s, decay 20 dB/s, clip 10%, groove 14, handle 4×22), gradient (102,204,255→0,102,204→0,30,80), tick (61,140,61@0.7), amber peak dot (255,200,0 r3.5), red handle, click/drag-to-jump all match; web dark groove bg = THEME-SPEC convention (not drift). Swift: fixed stale path comment `views/widgets/`→`views/shared/`. Doc-parity: Python `paintEvent` docstring + web `ThresholdMeterProps`/component TSDoc → 100/100/100 |
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

## Deferred / untagged tail — PLAN (2026-07-07)

Files not yet in the `@parity` map. **Lighter accuracy-only pass** (tag + verify comments match
code; no full doc-parity back-fill unless drift is found). Counterparts confirmed; agreed order
is **1 → 2 → 3, then 5**; **4 is deferred to Task 3**. Each slug done Swift→Python→web, present
findings, pause between slugs.

| # | NEW slug | Web | Swift | Python | notes / status |
|---|---|---|---|---|---|
| 1 | `state/settings-store` | `src/settings.ts` | `Models/TapDisplaySettings.swift` | `models/tap_display_settings.py` | **✓ DONE (2026-07-07)** all 3 tagged + read. Every default VALUE + clamp logic matches (plate 500/200/3/100, brace 300/6/12/8, gore 490/390, stiffness 75/55/60/50, freq 75-350/20-200/30-1000, dB -100/0, analysis 30/2000, peakMin -60, tapDetect -40, freq clamp [20,20000]/10Hz, dB [-120,20]/10dB). **WEB-SS-1 (real, cat-1):** web `showUnknownModes` default was `false` vs Swift+Python `true` → fixed web→true. **SS-1/PY-SS-1 (doc):** Swift class/module doc + Python module docstring listed "max peaks"/"hysteresis" as store settings — neither exists (hysteresisMargin=3.0 is a hard-coded `TapToneAnalyzer` const; no max-peaks feature) → reworded to peak-min + tap-detection. **PY-SS-2 (dead code):** removed unused `DEFAULT_MAX_PEAKS`/`DEFAULT_HYSTERESIS_MARGIN` consts (referenced nowhere; Swift has none). **WEB-SS-2 (strict-parity label):** web conflated Swift's `shortName` "SS Top (75)" (picker) and `rawValue` "Steel String Top" (results) into one `STIFFNESS_LABEL` → split: `STIFFNESS_LABEL`→shortName, new `STIFFNESS_RAW_NAME`→rawValue; repointed MaterialResults + measurementImage results line (output unchanged "Steel String Top"). tsc 0 · typedoc 0/0 · py parses |
| 2 | `dsp/analysis-quality` | `src/dsp/analysisQuality.ts` | `Views/Utilities/Extensions.swift` (`decayQuality`/`tapToneRatioQuality`+colors) + `GuitarType.decayThresholds` + `TapToneMeasurement.tapToneRatio` | `models/guitar_type.py` (`decay_quality`) + view files | **✓ DONE (2026-07-07) — clean slug, NO drift.** All 3 tagged (web file-level; Swift symbol on `Extensions.swift`; Python symbol on `guitar_type.py`). Decay thresholds (gen/ac 0.10/0.25/0.45/0.75, cl 0.15/0.35/0.60/1.0, fl 0.08/0.20/0.35/0.55), decay labels (Very Short…Excellent), ratio labels + boundaries (`<1.7`/`<1.9`/`≤2.1`/`<2.3`), ratio math (`top/air` from first classified air/top peaks) — all identical. Colors = THEME-SPEC tuned hexes of Swift `.gray/.orange/.yellow/.green/.blue` + ratio red/orange/green (not reconciled inline). **Structural note (M-map):** web consolidates in one file; Swift splits quality→Extensions, ratio→TapToneMeasurement, thresholds→GuitarType; Python splits decay→guitar_type.py, ratio-quality **inline & DUPLICATED in 2 views** (`tap_analysis_results_view._ratio_quality` + `tap_tone_analysis_view`) → dedup candidate for view/guitar-summary/restructure. Full symbol-tagging of scattered members deferred to M-map cleanup. |
| 3 | `dsp/wav` (web-primitive) | `src/dsp/wav.ts` | `AVAudioFile`/`AVAudioPCMBuffer` (no custom decoder) | `soundfile`/`wave` | **✓ DONE (2026-07-07) — web-primitive (M2-style), no drift.** `wav.ts` tagged `@parity dsp/wav`; code accurate to comments (RIFF/WAVE decode, mono ch-0 or `downmix`, no resampling; `encodeWavFloat32` matches Swift `dumpCaptureWAV`/Python capture-dump). Header note expanded: it stands in for the native libs (Swift `AVAudioFile`, Python `soundfile`/`wave`); no line-by-line native mirror — the native call sites are the file-playback readers already reviewed under the audio slugs (`TapToneAnalyzer+SpectrumCapture` / `RealtimeFFTAnalyzer+FFTProcessing` / `realtime_fft_analyzer_engine_control.py`). Doc-accuracy nit fixed: header now notes the decoder tolerates 24/32-bit PCM + float64 (not just the app's float32/int16). Formal native call-site tagging deferred to M-map cleanup (same as `dsp/fft`). tsc clean. |
| 5 | material/measurements panels → **4 sub-slugs** | `MeasurementsPanel.tsx`, `MeasurementDetail.tsx`, `MaterialResults.tsx`, `MaterialInstructionPanel.tsx` | material result views / measurements list | `views/measurements/*` | IN PROGRESS (order: list→detail→instructions→results). Map+parity lens, light on doc-polish (restructure). **Sub-slugs:** ① `view/measurements-list` **✓ DONE** · ② `view/measurement-detail` **✓ DONE** · ③ `view/material-instructions` **✓ DONE (real fix)** · ④ `view/material-results` **✓ DONE** → **spun out a rework spec** (see Separate efforts). **✅ item 5 (all 4 sub-slugs) complete.** |
| ④`view/material-results` | `MaterialResults.tsx` (+ `fromLive.ts`, `pdfReport.ts`) | `platePropertiesSection`/`MaterialPeakRowView` (`TapAnalysisResultsView.swift`) | material section (`tap_tone_analysis_view.py`) | **✓ DONE (2026-07-07)** 3 tagged. Property labels/values/quality tiers+colors all match; **peaks are auto-only, display-only on ALL three** (Swift `MaterialPeakRowView` star "informational in plate/brace", badges "display only"; Python `QLabel`; web static) — no manual-assign feature anywhere → **no interactivity divergence** (my earlier "web-specific" framing was wrong). **Typography:** normalized ratio ranges to en-dash, no spaces, everywhere user-visible — Swift on-screen was hyphen (821/834→en-dash), PDF paths (Swift/Python/web) were spaced en-dash → de-spaced (material "0.04–0.08"/"12–25" + tap-ratio "Ideal: 1.9–2.1"). **fromLive dedupe** (carried from item 1): imported store `STIFFNESS_RAW_NAME`, dropped local `STIFFNESS_TO_RAW`, derived `STIFFNESS_FROM_RAW` by inversion. **Option-A wording DROPPED** — absorbed by the rework spec below (Properties hidden until complete removes the "Select peaks" placeholder). tsc0/py-parses. |
| ③`view/material-instructions` | `MaterialInstructionPanel.tsx` (+ `useMaterialSession.ts`, `App.tsx`) | `materialInstructionsView` (`TapToneAnalysisView+SpectrumViews.swift`) | `_update_plate_phase_ui` (`tap_tone_analysis_view.py`) | **✓ DONE (2026-07-07)** all 3 tagged. Titles/descriptions/shortStatus/colors/icons verbatim-match. **VMI-1 — REAL behavioral divergence fixed (not just docs):** web lacked the canonical `waitingForFlcTap` state (Swift+Python both have it). Ported it: after accepting the C tap (live), web now shows the reposition prompt ("C Captured — Prepare for Step 3" / "Cross-grain mode captured! Now hold plate… for FLC" / shortStatus "Tap for FLC", purple, step 3, rotate icon) for a **0.5 s cooldown with FLC detection DISARMED** (Swift `tapCooldown`), then arms `capturingFlc` — so the plate-repositioning bump can't false-trigger the FLC tap. Added to `MatPhase` + `acceptMaterial` (`setTimeout(500)` guarded by `matPhaseRef`), `MaterialInstructionPanel` (color/status/icon/step/title/desc), `App.materialBarStatus`. File **playback** correctly skips it (engine auto-advance → `capturingFlc`, matches Swift). tsc 0 (exhaustive switches) · py parses. **Live-verify TODO:** exercise a real 3-tap plate FLC measurement (mic + taps) — headless playback skips this state by design. |
| ②`view/measurement-detail` | `MeasurementDetail.tsx` | `MeasurementDetailView.swift` | `measurement_detail_view.py` | **✓ DONE (2026-07-07)** all 3 tagged. Strong parity (Details-Consistency unified): read-only inspector, "Measurement Info" (Name/Date/Type/Number of Taps/Microphone/Calibration/Notes), "Compared Spectra (N)" / "Identified Peaks" / "No identified peaks", material L/Cross-grain/FLC labels, Close only. **WEB-MD-1:** removed straggler dev-doc ref `MEASUREMENT-DETAILS-CONSISTENCY.md §7` (only occurrence across 3 repos; step-(a) cleanup missed it). **PY-MD-1 (dead-code chain removed):** the Python "load from the detail dialog" path was dead (Swift/web have none — you load from the row menu). Removed detail's `measurementSelected` signal + `_on_load`/`_on_export_json`/`_on_export_pdf`/`_compute_tap_tone_ratio` (441→372 lines) + now-unused `os`/`M` imports, and in the list view the `dlg.measurementSelected.connect(...)` line + dead `_load_from_detail` (list's OWN `measurementSelected` + `_load_and_close` are live, untouched). tsc 0 · py parses. |
| ①`view/measurements-list` | `MeasurementsPanel.tsx` | `MeasurementsListView.swift` + `MeasurementRowView.swift` | `measurements_list_view.py` + `measurement_row_view.py` | **✓ DONE (2026-07-07)** all 5 tagged. Strong parity: title, "Total: N", meta line "N peaks • Ratio: X.XX • Decay: X.XXs", compare mode, import/export-all/delete-all, ⋯ menu (Load·View Details·Edit·Export Measurement·Export Spectrum·Export PDF·Delete) all match. **WEB-ML-1:** rewrote stale phased-plan header comment (4b/4c/4d/Phase-5 — all now implemented). **WEB-ML-2 (strict parity):** empty-state "No saved measurements yet. Capture a tap, then Save." → canonical "No Saved Measurements. Tap the guitar and click Save to store measurements for comparison." Row content is separate `MeasurementRowView`/`measurement_row_view.py` but inlined in web. tsc 0 · py parses. |
| 4 | → fold into `test/gated-fft` | `src/dsp/signal.ts` (`makeToneSignal`/two-tone) | `GatedFFTParityTests.swift` (`makeTwoToneSignal`) | `tests/test_gated_fft_parity.py` (`_make_two_tone_signal`) | **DEFERRED to Task 3** (user-approved 2026-07-07). `signal.ts` lives in `src/dsp` but is a TEST-only helper; its real counterparts are the parity *tests*. Tag it to `test/gated-fft` and review WITH Task 3, not in this tail. |

## Separate efforts (feature work, not `@parity` comment-doc review)

### Material Results — Phased (Stable) Display

Spec: `MATERIAL-RESULTS-PHASED-DISPLAY.md` (**PROPOSED**). Surfaced during the `view/material-results`
review (item 5 ④, 2026-07-07). During a **live** plate/brace multi-phase capture the Analysis Results
panel churns (live peak list) and the Measurement Process won't hold still — unreadable until complete.
**Target:** fixed L/C/(FLC) slot rows (dashes until each phase's peak is captured, layout identical to
final), **Measurement Process always visible** beneath, **Plate/Brace Properties hidden until complete**.
No change to loaded measurements or the PDF report. Cross-platform, **Swift canonical, lock-step**, no
DSP/oracle impact. Effort: Swift M / Python M / Web S. **Status: IMPLEMENTED all 3, UNCOMMITTED (2026-07-08).** Swift `TapAnalysisResultsView` reviewed-GOOD; web (`MaterialResults`+`App`+CSS) + Python (`MaterialPeakListWidget` `_complete` flag) ported, compile-verified, awaiting user run-review. Design: live→fixed dashed L/C/(FLC or fL) slots; complete/loaded→existing layout; Properties hidden until complete; Process always shown. **Rode-along side-fixes (uncommitted):** Swift-only plate↔brace reset bug in `applySettings` (was `crossesBoundary`, missed material↔material; Python/web already correct); "Adjust"→"Redo" wording (all 3, peaks are auto-only). See memory `project_material_results_phased_display` for the 3-commit plan.

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

### Log-frequency axis removal

Spec: `LOG-FREQ-REMOVAL.md` (**PROPOSED**). Remove all logarithmic-frequency-axis support
across Swift/Python/web — it's leftover dead code (unreachable everywhere: web `logFreq` never
set true, Swift `isLogarithmic` always `.constant(false)`, Python live chart has no flag) and has
repeatedly generated false review findings. **Two layers:** (A) the interactive/render log branches
— delete on all three; (B) the `SpectrumSnapshot.isLogarithmic` **serialized format field** —
decide **B1** keep pinned `false` (no format change, recommended) vs **B2** drop it (coordinated
format change, tolerant reader + re-pin oracle). **Status: not started — blocked on the B1/B2
decision + the Swift `AxisTickGenerator.logarithmic` audit.** No DSP/oracle impact. Effort: Swift
Small, Python Small, Web Small.
