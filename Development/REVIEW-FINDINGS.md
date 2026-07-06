# Review Findings

Behavioural gaps surfaced during the comment/doc review (see `DEV-DOC-STANDARD.md`).
Category 1 (clear canonical drift — two platforms agree, one differs) is fixed in the
same pass and recorded here as an audit trail. Category 3 (ambiguous, or a real
behavioural decision) is logged for a decision before any change.

## Fixed — category 1 (clear drift; the outlier corrected)

- **[FIXED] view/help — detailed content-parity review.** Extracted + normalized + diffed the help
  text across all three (~1700 lines). Content is well-synced (same 10 sections, same technical facts).
  VHELP-1: the Swift class-doc "Content Sections" table was stale (listed Ring-Out Time / Tap Tone Ratio
  / Material Properties as sections — they aren't — and omitted Controls Reference / Tap Controls /
  Settings Reference / Glossary) → corrected. **Measurement-type enumeration order** was inconsistent
  (even between Swift's own two mentions) → aligned to the canonical Settings order **Generic, Acoustic,
  Classical, Flamenco, Material (Plate), Material (Brace)** in every mention (Swift ×2 + already-correct
  Settings-ref, Python ×3, web ×3; web "Classical Guitar"→"Classical"). **Decisions (user):** the pervasive
  **tap (mobile) ↔ click (desktop/web)** verb difference is kept **per-platform** — intentional adaptation,
  not drift; menu-bar (SwiftUI 5) vs Qt (4) vs web ("no menu bar, two toolbars") content correctly differs
  per platform. Left as-is: a trivial "Tap OK" drop and cosmetic `≈` vs "approximately". Note: the automated
  web extractor under-counted (mixed quote styles), so the web was hand-verified + spot-checked.


- **[FIXED] audio/realtime-analyzer + audio/tap-analyzer — stale cadence/window figures + a Python
  doc-depth gap.** Swift `RealtimeFFTAnalyzer.swift` ARA-1/2/3: three "~10 Hz" for the audio-buffer
  callback → ~43 Hz (1024-sample buffer, verified via `maxSafeBufferSize=1024`); continuous FFT window
  "~400 ms" → ~1.4 s (fftSize=65536); publish "~2 Hz" → ~0.7 Hz (the metrics panel shows 0.7 Hz — a
  doc-only bug). Swift `TapToneAnalyzer.swift` TT-1..8: gatedCaptureDuration "400 ms"→500 ms (×2),
  inputLevelDB "~10 Hz"→~43 Hz (×2, one missed by decay finding #4), peakMagnitude "~1 Hz"→~0.7 Hz,
  FLC "diagonal/shear"→"torsional/twist" (×2), noise-floor EMA "~10 ms/τ≈190 ms"→"~23 ms/τ≈450 ms",
  onset "~9600"→"~4800" (**ran the real `align_capture_to_onset`: onset lands at preOnsetSamples ≈4800,
  not the 200 ms pre-roll length 9600**), route-change settle "2 s"→3 s (code=3.0). Python: PY-TT-7
  (onset 9600→4800) + a **doc-parity pass** porting Swift's DocC to ~28 bare/under-documented properties
  (the plate/brace three-layer peak-selection block + scalar config/state like `noise_floor_alpha` — the
  EMA τ rationale was entirely missing). Python `chunksize` default 16384→1024 aligned. Web `engine.ts`
  verified clean; `guitarFFT.ts` trio got @param/@returns. All comment-only except the two default/one-line
  tidies. py_compile + tsc + 4 tests green.

- **[FIXED — retroactive, caught by cross-check] audio/realtime-analyzer — PY-RA-1.** Python
  `recent_peak_level_db` docstring said "over the last **0.5 s**" but the window is 2.0 s
  (`_recent_peak_window = 2.0`; the file's own comment at line 502 already noted "the old 0.5 s came
  from a stale Swift comment", and Swift `peakHoldDuration = 2.0`). Missed when realtime-analyzer was
  first marked done; surfaced while cross-checking the web engine's `PEAK_HOLD_SECONDS = 2.0` comment.
  Fixed to "2.0 s".

- **[FIXED] dsp/guitar-modes + model/guitar-mode-classify + model/mode-colors (one file each,
  three slugs).** GM-1: the Swift + Python Mode Map tables omitted the **Generic** guitar type (the
  *default*) — added it (Air 70–135, Top 140–260, Back 180–300, Dipole 310–460, Ring 580–880, Upper
  880+); web already had all 4. GM-CLASSIFY-1: `classifyAll` DocC in Swift + Python omitted the
  "Back must be strictly above the claimed Top" guard (code has it in both the claiming and
  remaining-peaks loops), and Python additionally carried a **stale** "Swift uses only a Set of
  claimed UUIDs — no frequency cursor or 2 Hz guard" line contradicting the code — both fixed; web
  `classifyAll` doc enriched to the same 3-step description. Stale `INVENTORY.md`→`Development/INVENTORY.md`
  refs fixed in web `guitarModes.ts` + `classify.ts`.

- **[FIXED — CODE, user-directed] model/guitar-mode-classify — Python `_classify_all_tuples` missing
  the overlap guard (PY-CLASSIFY-3).** The Python-only index-keyed helper (live numpy peaks, no UUIDs)
  had the *claiming-loop* Top<Back guard but not the *remaining-peaks* Back special case that
  `classify_all` / Swift / web all have — so an overlap-zone peak could land on Top via the tuples path
  but Back via the UUID path. User: "make the python code the same as swift — add the guard." Added the
  remaining-peaks Back guard; `test_guitar_mode.py` 35/35 pass.

- **[FIXED — visual parity, user-approved] model/mode-colors — web dipole/ring hues were wrong
  (WEB-COLORS-1).** Web `MODE_COLOR` had dipole = purple (`#b07ad8`) and ring = yellow (`#e0c84a`),
  but canonical (Swift/Python) is dipole = **red**, ring = **purple** — a visible cross-platform
  mismatch (the file even said "loosely matching GuitarMode"). Root cause: the web palette is
  systematically *brightened* for the dark chart background (a legitimate per-platform adaptation),
  but dipole/ring were also the wrong hue (not just a brightness variant). Fixed the two hues
  (dipole→`#e0584a` red, ring→`#b07ad8` purple), kept the intentional brightening, and documented the
  palette. WEB-COLORS-2: `MODE_LABEL` aligned to Swift `abbreviation` (dipole "Dipole"→"DP", unknown
  "—"→"?"). tsc clean.

- **[DOC-PARITY + documented gap] dsp/spectrum-average.** Swift `averageSpectra` doc was already
  accurate (rationale + per-bin power formula + edge cases) — no change. PY-SA-1: Python
  `average_spectra` code matched Swift but its docstring lacked the rationale/formula — enriched to
  mirror Swift. WEB-SA-1: web `averagePowerDb` (in `guitarFFT.ts`) was a one-liner — enriched.
  WEB-SA-2 (category-3, **documented not fixed**, user's call): web `averagePowerDb` omits the
  Swift/Python length-mismatch guard (they return the first spectrum if bin counts differ). It's
  **unreachable** in the web — the only caller feeds per-tap spectra all from `dftAnalRect(GUITAR_FFT_SIZE)`,
  so inputs are always equal length. Documented the omission in the TSDoc rather than adding an
  unreachable guard.

- **[FIXED] dsp/gated-fft — `computeGatedFFT` doc number/wording bugs + handler docs + Hann clause.**
  Swift: GFFT-1 the summary said "return **linear** magnitudes" but the code returns dB (and the
  `- Returns` line already said dB); GFFT-2 "~0.74 Hz/bin at 44.1 kHz" → 1.35 Hz/bin (0.74 is the
  window duration / bins-per-Hz; the inline comment already had 1.35); GFFT-3 `handleLongitudinalGatedProgress`
  was missing the DocC its two siblings have (added); GFFT-4 the cross/FLC handler docs named
  `.waitingForFlcTap` / "marks complete" but the methods set `.reviewingCross`/`.reviewingFlc` (live,
  await Accept) or auto-advance during file playback (tightened); GFFT-5 FLC called "shear/diagonal"
  but fLC is the **twist** mode (shear is the *modulus* Glc, Gore notation) → "torsional/twist".
  Python mirror: PY-GFFT-A enriched the bare `compute_gated_fft` docstring to the Swift DocC level,
  PY-GFFT-B FLC "shear/diagonal"→"torsional/twist", PY-GFFT-C enriched the 3 handler docstrings. Web:
  `computeGatedFFT` doc already full; `findDominantPeak` enriched (was a one-liner). All comment-only.

- **[FIXED — measured, not assumed] dsp/gated-fft — GFFT-6 Hann-window: Swift comment overclaimed
  "matches np.hanning".** Ran `vDSP_hann_window(…, HANN_DENORM)` directly: it is the **periodic** Hann
  `0.5·(1 − cos(2πn/N))` (endpoints don't reach 0), whereas `np.hanning` (Python/web) is the
  **symmetric** form `0.5·(1 − cos(2πn/(N−1)))` (endpoints = 0). They are *different windows*. Then
  measured the impact on the quantity that matters — the parabolic-interpolated **peak frequency** —
  across 67–987 Hz, fast/slow ring-out: **~1e-7 Hz difference** (≈1e-7 of a 1.46 Hz bin), ~6 orders
  below display precision. **Decision (user):** the code stays as-is on each platform (Swift vDSP,
  Python/web `np.hanning`) — a documented sub-precision platform difference, not worth switching two
  ports for ~1e-7 Hz. Fixed only the Swift comment to state the periodic-vs-symmetric distinction
  accurately instead of claiming exact equality. Scripts in the session scratchpad.

- **[FIXED] dsp/gated-capture — stale gated-window numbers in BOTH Swift and Python arch docs.**
  Constants are `gatedCaptureDuration`=500 ms (accumulation buffer, *includes* the 200 ms pre-roll
  seed), `gatedFFTWindowDuration`=400 ms (post-alignment FFT window), continuous FFT = `fftSize`
  (65536 ≈ 1.36 s). Swift GC-1: header said "continuous FFT ... ≈400 ms at gatedCaptureDuration"
  (wrong constant + wrong window) and the ASCII diagram implied pre-roll + 400 ms were additive.
  GC-3: `startGatedCapture` inline "400 ms capture window" → 500 ms. Python PY-1/PY-2/PY-3 mirror
  all three. Also GC-2: Swift `accumulateGatedSamples` doc named only one of the two dispatch
  branches. Comment-only; corrected diagrams recomputed for alignment. Found the GC-3 Swift instance
  via the Python cross-check (I'd missed it on the Swift-first pass — the reason we read all three).

- **[FIXED] dsp/gated-capture — Python stale "No Swift counterpart yet" (PY-4).** The
  `start_guitar_gated_capture`/`finish_guitar_gated_capture` section comment claimed "no Swift
  counterpart — this is the new design path," but Swift now has both (and the method's own docstring
  already said "mirrors Swift"). Updated to "Mirrors Swift startGuitarGatedCapture / finishGuitarGatedCapture".

- **[DOCUMENTED — intentional divergence, not drift] dsp/gated-capture — guitar/plate dispatch
  branch location differs by design.** Swift branches at the dispatch site (GCD closure can hold
  logic → `finishGatedFFTCapture` vs `finishGuitarGatedCapture`); Python emits one Qt signal
  (`gatedCaptureComplete`) to a single slot and branches inside `finish_gated_fft_capture`. Same
  inputs → same handler → same result; only the branch LOCATION differs, forced by the concurrency
  primitive (GCD closure + @Published vs Qt signal/slot). Added a cross-referencing **PLATFORM
  PLUMBING** comment at both sites (+ a pointer at the Python branch) so the "why do they diverge?"
  question is answered inline. No code change — this is the correct, required platform difference.

- **[FIXED] dsp/gated-fft (opportunistic) — Swift `findDominantPeak` DocC said "15 dB", code uses
  6 dB (GF-1).** Two DocC lines (the Step-2 summary and the `preferLowestSignificant` param) said the
  lowest-frequency candidate is chosen "within 15 dB of the strongest," but the code (`strongest.magnitude
  - 6.0`), its own inline comment, Python's docstring/code, and the web all use **6 dB**. Fixed both to
  6 dB. Surfaced while cross-checking the web's `- 6.0` during gated-capture. Full gated-fft review still
  pending; web `findDominantPeak` tagged `@parity dsp/gated-fft` (M3) so that pass finds it in `gatedCapture.ts`.

- **[FIXED] dsp/peak-analysis — `reanalyzePeaks()` DocC (Swift) had stale "older builds"
  wording.** The function doc still framed re-analyze as "upgrade a measurement saved by an
  older build whose peak-finding algorithm missed some peaks" — the misleading wording we
  corrected everywhere else this session (HelpView, tooltip, button comment, Quick Start,
  manual, Python `reanalyze_peaks`) but missed on this DocC. Updated to "current analysis
  settings (Peak Min, analysis range, guitar type)". Swift comment-only change; Python was
  already correct.

- **[FIXED] dsp/decay — stale "~10 Hz / recentPeakLevelDB polling" cadence in BOTH Swift and
  Python.** Both docs described decay sampling as ~10 Hz via a `recentPeakLevelDB` polling
  subscription, but the actual code feeds `trackDecayFast` **once per audio buffer (~43 Hz)** —
  Swift via a `$inputLevelDB` Combine subscription (`TapToneAnalyzer.swift:1395`), Python via
  `_on_rms_level_changed` (every ~23 ms). The **web comment was already accurate**. Fixed 3 Swift
  spots (DecayTracking DocC architecture + `trackDecayFast` doc + `TapToneAnalyzer.swift:1394`
  inline) and 1 Python docstring. Comment-only; no behaviour change. Stale from an old refactor.

- **[FIXED] dsp/calibration — import frequency filter.** Web `parseCalibration`
  accepted any finite point, but Swift (`MicrophoneCalibration.swift` ~line 333) and
  Python (`microphone_calibration.py` ~line 162) both keep only `1 ≤ freq ≤ 24000` Hz.
  A stray out-of-range line could shift the interpolation edges. Added the same filter
  to `src/dsp/calibration.ts`. Latent (the oracle fixture is in-range); tests green.

## Open — category 3

- **#5 [RESOLVED] calibration — reference-SPL / Sens Factor precedence (Python aligned to Swift).**
  When a header carries BOTH `SESSION REF=…dBSPL` and `SPL … dB`: **Swift** sets SESSION REF then
  unconditionally overwrites with SPL → **SPL / last-occurrence wins** (no `nil` guard). **Python**
  uses `if reference is None:` + `else` → **SESSION REF / first-occurrence wins**. The same
  first-vs-last split applies to `Sens Factor` (Python guards with `if sensitivity is None`, Swift
  overwrites). The new web `parseCalibration` matches **Swift** (canonical). Practically unreachable
  — UMIK-1 files use SESSION REF, REW files use SPL, never both — so no oracle/real-world impact.
  **RESOLVED (user, 2026-07-02): align Python to Swift.** Changed `microphone_calibration.py` to
  overwrite unconditionally (dropped the `if ... is None` guards / `else`), so SPL / last-occurrence
  now wins in Python too. Verified: both present → 88.0 (SPL), SESSION REF only → 94.0, SPL only →
  93.5 — matches Swift/web. Single-format files (the real case) are unchanged; py_compile OK.

## Resolved — category 3

- **[RESOLVED → added] dsp/calibration — `referenceLevel` (SESSION REF / SPL).** Decision
  (user, 2026-07-02): strict parity — **add it to the web**. Added `referenceLevel: number | null`
  to the web `Calibration` type and the `SESSION REF` (UMIK-1) / `SPL` (REW) regexes to
  `parseCalibration` (mirrors Swift/Python; SPL overrides if both present). It round-trips through
  `StoredCalibration` automatically (spread + JSON). Provenance only — no DSP or oracle impact.
  Added a parse test for both header formats. tsc + 144 tests green.

## Map refinements (re-tag + regenerate `parity-index.json` as a batch)

`@parity` mapping gaps (not code bugs) found during the review — the file-level tag
doesn't point at the right canonical file. Fix by adjusting the tag(s) and rerunning
`Tooling/parity/gen_parity_map.py`.

- **M1 — dsp/find-peaks tag is on the model, not the algorithm.** The slug tags Swift
  `ResonantPeak.swift` (the peak *struct*), but the peak-finding *algorithm* lives in
  `TapToneAnalyzer+PeakAnalysis.swift` (Python `tap_tone_analyzer_peak_analysis.py`).
  Web `peaks.ts` holds both. **Decision:** keep `dsp/find-peaks` for the model
  (`ResonantPeak.swift` ↔ `resonant_peak.py` ↔ web `Peak`), and add a separate group
  **`dsp/peak-analysis`** for the algorithm (`TapToneAnalyzer+PeakAnalysis.swift` ↔
  `tap_tone_analyzer_peak_analysis.py` ↔ web `findPeaks` in `peaks.ts`). When the map
  is re-tagged, add `@parity dsp/peak-analysis` to those two files (web `peaks.ts`
  already carries a slug — it hosts both, so it keeps `dsp/find-peaks` and the tracker
  notes the dual role). Then validate the algorithm comments in Swift/Python.

- **M4 — view/analysis-metrics was mis-tagged on the web; + new `view/guitar-summary` slug.** The web
  file tagged `@parity view/analysis-metrics` was `AnalysisResults.tsx` — but that is the live Ring-Out +
  Tap-Ratio **guitar-summary** bar, not the FFT-metrics diagnostics panel. The real counterpart of
  `FFTAnalysisMetricsView` is **`MetricsPanel.tsx`** (was untagged; header already accurate). **Done:**
  tagged `MetricsPanel.tsx` → `view/analysis-metrics`; retagged `AnalysisResults.tsx` → a **new
  `view/guitar-summary`** slug. That slug's Swift/Python members are *sections* of larger files (the
  Ring-Out/Tap-Ratio block of `TapAnalysisResultsView.swift`, ~L586–630, and the guitar-summary section
  of `tap_tone_analysis_view.py`) — symbol-level tags to add during the batched map regen.
  **Related M5 (broader):** `TapAnalysisResultsView.swift` (1291 lines: peaks table + Ring-Out + Tap Ratio
  + Plate/Brace properties + export) is an untagged **broad results panel that the web decomposed** into
  several components (`AnalysisResults`, `PeakCard`, material panels, export bar). It needs a mapping pass
  of its own — its sections map to `view/guitar-summary` / `view/peak-card` / material-properties display /
  export, not one slug.

- **M2 — dsp/fft is a web-only primitive; the group has no Swift/Python function counterpart.**
  Web `fft.ts` (`fftInPlace`) is a hand-rolled radix-2 FFT the browser needs because it has no
  built-in FFT. Swift uses Accelerate/vDSP and Python uses `numpy.fft`, so neither has a
  hand-written FFT to mirror — the `@parity dsp/fft` tag on
  `RealtimeFFTAnalyzer+FFTProcessing.swift` / `realtime_fft_analyzer_fft_processing.py` marks the
  library call sites for reference only. The real 3-way algorithmic parity (window → FFT →
  magnitude → dB) is **`dsp/guitar-fft`** (`computeFFT` / `dft_anal` / `guitarFFT.ts`). Map
  improvement: mark `dsp/fft` as an intentional **web-primitive** group (not a 3-way algorithm
  mirror) so the generated map/reader doesn't imply a missing Swift/Python function.

- **M3 — file-level `@parity` tagging is too coarse; move to symbol (function) level.** A single
  file can host functions from several parity groups, and a file-level tag then hides the extra
  members: when a later group's pass consults the map, it lands on that group's Swift/Python files
  and never learns the web counterpart is buried in an unrelated file, so it is **silently skipped**
  (only the deferred/untagged tail backstop would ever eyeball it — not a real 3-way cross-check).
  **Exemplar: `src/dsp/guitarFFT.ts`** hosts three groups — `dftAnalRect` = `dsp/guitar-fft`,
  `averagePowerDb` = `dsp/spectrum-average`, and the orchestration trio (`guitarModePeaks`,
  `modePeaksFromSpectrum`, `guitarMultiTapModePeaks`) = `audio/tap-analyzer` (the web has no
  analyzer class, so the per-tap/multi-tap flow lives here as free functions). **Done now:** added
  a per-symbol `// @parity <slug>` tag above each of those functions (the file-level
  `@parity dsp/guitar-fft` on line 1 is kept as the primary so nothing drops out before the
  generator is upgraded); only `dftAnalRect` (this group) was doc-enriched — the others are
  tagged/routed and will be doc-enriched under their own group with the canonical open. **Batch
  TODO (with M1/M2 regen):** (a) confirm/upgrade `Tooling/parity/gen_parity_map.py` to record each
  tag's *symbol* (line/name), not just the file, so the map/reader can point a reviewer at the exact
  function; (b) migrate the line-1 file tag to an adjacent `dftAnalRect` tag once the generator is
  symbol-aware; (c) sweep the other multi-function DSP files for the same coarse-tag problem.