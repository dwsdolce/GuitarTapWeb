# Material live-annotation display during capture/playback (the live material-annotation display + related)

**Found 2026-07-17, root-caused + FIXED 2026-07-17 (user-verified same night; more testing tomorrow).**
Repro: play `/Users/dws/Documents/GuitarTap/plate-umik-1-swift-mac-1784242582.wav` (Play-File) on Swift /
Python / web. All three produce the correct final peaks + table — every issue here was live-display-only.

## The bug (as reported)
Web was correct (progressive, persistent annotations). On **Swift + Python** the on-chart peak
annotations did not show the identified L/C/FLC during capture — instead the whole live spectrum
appeared as raw "Peak" markers, settling to the correct 3 only at the end.

## Root cause — CONFIRMED by instrumentation (`🔬RDBG`)
The `rdbg` traces (both platforms, `thread=Main`) showed the annotation source churning
`currentPeaks = 87 → 126 → 3` (roleMatches `1 → 2 → 3`) while the identified peaks grew cleanly.
So: **not threading.** The natives annotated `currentPeaks` (all raw peaks from each phase's spectrum;
`combinePlatePeaks()` returns *all* per-phase peaks, not just the identified set), whereas the web
annotates the **accumulated identified peaks** (`matPeaks`) independently.

Two distinct Python-only sub-bugs surfaced while fixing (Swift's declarative SwiftUI view avoided both):
1. The live per-frame analyzer (`analyze_magnitudes`) re-emitted the raw live-spectrum peaks every FFT
   frame, repainting the "Peak" pile between phase completions.
2. The material table path used `PeaksModel.update_data()`, which — unlike the guitar
   `update_data_with_modes()` — **never emitted annotations** (its docstring wrongly claimed it did),
   so material annotations only appeared after a manual visibility cycle.
3. Emitting per frame also flickered the Analysis-Results table (rebuilt every FFT).

## Fix applied (both natives — annotate the accumulated identified peaks, like the web)
**Swift** (`TapToneAnalyzer.swift`, `TapToneAnalysisView+SpectrumViews.swift`):
- New `materialIdentifiedPeaks` = `[selectedLongitudinalPeak, selectedCrossPeak, selectedFlcPeak].compactMap`
  — stable + persistent, grows 0→1→2→3.
- `visiblePeaks` (annotations) and the chart `peaks:` param (dots) use it for material. `currentPeaks`
  untouched.

**Python** (`tap_tone_analyzer.py`, `tap_tone_analyzer_spectrum_capture.py`,
`tap_tone_analyzer_peak_analysis.py`, `tap_tone_analysis_view.py`):
- New `material_identified_peaks` property + `visible_peaks` uses it for material (export path).
- `_emit_peaks_array` (phase-completion emit) emits `material_identified_peaks` for material.
- `analyze_magnitudes` no longer emits per live frame for material (guitar still does) — kills the raw
  "Peak" repaint **and** the table flicker; the identified peaks change only at phase completion.
- `_refresh_results_peaks` calls `peak_widget.model.refresh_annotations()` after the material
  `update_data()` so annotations emit (the missing piece behind "only shows after cycling").

`current_peaks` is untouched on both — the model keeps it; only what the chart reads/receives changed
(the exact Swift↔Python parallel).

## Status: ✅ user-verified 2026-07-17 (annotations progressive + persistent, no flicker; matches web).
More testing tomorrow before stripping instrumentation.

## Still open / separate (NOT 12R)
- **Threshold meter reads high on web during file playback** — ✅ **ROOT-CAUSED + FIXED 2026-07-18,
  DEV-ONLY (production never affected).** It was NOT a level/display bug: instrumenting the web's `onLevel`
  during playback showed it emits the file's *exact* per-chunk RMS (−75/−85 floor), identical to Python.
  The real cause is **React StrictMode's dev double-mount**: `useAudioEngine.start()` is async, so the dev
  mount→unmount→remount races it and leaves a **second, orphaned engine** with a live mic (never gated by
  `playingFile`, since it never plays a file) whose room audio drives the meter. Proven by an instance-id
  probe (two `iid`s in `npm run dev`, **one** in `npm run preview`). Fixed by hardening
  `useAudioEngine.start()` to stop the orphaned engine (`engineRef.current !== engine → engine.stop()`).
  Lesson: the web level math was correct the whole time; the "high meter" was a leaked live mic, not a scale.
- **Progress bar** (Python: load guitar after material → bar lingers). **PARKED** — the user suspects it
  may just be reset-timing differing across platforms, not a real bug. Do not act without confirming.