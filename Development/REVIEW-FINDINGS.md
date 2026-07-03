# Review Findings

Behavioural gaps surfaced during the comment/doc review (see `DEV-DOC-STANDARD.md`).
Category 1 (clear canonical drift — two platforms agree, one differs) is fixed in the
same pass and recorded here as an audit trail. Category 3 (ambiguous, or a real
behavioural decision) is logged for a decision before any change.

## Fixed — category 1 (clear drift; the outlier corrected)

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

## Open — category 3 (needs a decision)

- **dsp/calibration — `referenceLevel` (SESSION REF / SPL) not parsed on web.**
  Swift and Python parse and store the header's reference SPL (`referenceLevel`); the
  web `Calibration` type omits it. It is **provenance only** — never applied to the
  DSP — so results are unaffected. Options: (a) add it to the web for strict data
  parity, or (b) accept the omission as an intentional web simplification and note it.
  Low priority.

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