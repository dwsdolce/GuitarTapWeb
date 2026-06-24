# Parity Map — GuitarTapWeb ↔ Swift ↔ Python

GuitarTapWeb is a long-term parallel port of **GuitarTap** (Swift, the **canonical
reference** for both algorithm and UX) and **guitar_tap** (Python, the mirror). The
three repos keep **separate, idiomatic source trees** — the web app deliberately
splits pure DSP (`src/dsp`, no DOM/audio, unit-tested against a shared oracle) from
the audio engine and React UI, which does not map 1:1 onto Swift's class-centric
layout or Python's PySide views.

**The binding parity contract is the oracle, not the file layout.** Expected values
live in `test/fixtures/parity-oracle.json` (generated from Swift, vendored here),
checked by `tooling/sync-oracle.sh --check` in CI. Parity bar: numeric outputs to
**2–3 dp**, categorical outputs **exact**, `.guitartap` round-trips preserving both.

This document maps each web module to its Swift and Python counterparts so a change
in one repo can be located in the others. **When you change an algorithm, update all
three implementations and the oracle together.** Function/module names intentionally
echo the canonical names (e.g. `classify.ts` ↔ `GuitarMode.classify`).

Repo roots:
- Web: `/Users/dws/src/GuitarTapWeb`
- Swift: `/Users/dws/src/GuitarTap` (`GuitarTap/Models`, `GuitarTap/Views`)
- Python: `/Users/dws/src/guitar_tap` (`src/guitar_tap/models`, `.../views`)

---

## DSP core (`src/dsp/`) — pure, oracle-validated

| Web module | Swift | Python | Oracle case |
|---|---|---|---|
| `wav.ts` | WAV load (file playback path) | soundfile read in `tap_tone_analyzer.py` | G0 (WAV decode) |
| `fft.ts` (radix-2) | Accelerate/vDSP FFT | numpy FFT | underlies G1 |
| `gatedFFT.ts` | gated FFT (500 ms buf / 400 ms aligned window) | `tap_tone_analyzer_spectrum_capture.py` | G1 / GFFT1–5 |
| `guitarFFT.ts` (non-gated `dftAnalRect`) | realtime FFT analyzer | `realtime_fft_analyzer_fft_processing.py` (`dft_anal`) | REG-G1, REG-G2 |
| `signal.ts` (windowing/helpers) | inline window/normalize | inline window/normalize | (supports G1/G3) |
| `peaks.ts` (`findPeaks`, Q/BW) | `ResonantPeak` + peak finding | `find_peaks` | G2 |
| `guitarModes.ts` (mode bands per type) | `GuitarMode` ranges, `MeasurementType` | guitar mode ranges | (supports G2/G4) |
| `classify.ts` (`classifyAll`, Top/Back guard) | `GuitarMode.classify` / `classifyAll` | classify in analyzer | G4 (classify) |
| `pitch.ts` (12-TET, A4=440) | pitch on `ResonantPeak` | pitch helper | G4 (pitch) |
| `material.ts` (density, plate/brace Young's, Gore E/G, target thickness, quality) | `MaterialProperties.swift` | `material_properties.py` | REG-P1, REG-B1, G4 |
| `calibration.ts` (UMIK-1) | `MicrophoneCalibration` | `microphone_calibration.py` | applied in G3 |
| `gatedCapture.ts` (level-crossing + onset align) | `TapToneAnalyzer` gated capture / `alignCaptureToOnset` | `tap_tone_analyzer_spectrum_capture.py` (`align_capture_to_onset`) | G5, REG-P1/B1 |
| `spectrumAverage.ts` (power average) | `TapToneAnalyzer.averageSpectra(from:)` | `average_spectra` in `tap_tone_analyzer_spectrum_capture.py` | spectrumAverage tests |

---

## Audio engine & UI — parity to Swift Views / Python views

These have no DSP oracle (they orchestrate the DSP and render); parity is by behavior
and layout against the canonical Swift views. Key UX rule learned in Phase 3: **match
the native app exactly — section/control order, naming, no invented controls.**

| Web file | Swift | Python |
|---|---|---|
| `src/audio/engine.ts` (tap detect, capture, clipping, multi-tap) | `TapToneAnalyzer*.swift` + realtime analyzer | `tap_tone_analyzer.py` + `realtime_fft_analyzer.py` |
| `public/spectrum-processor.js` (mic → 1024 chunks + RMS) | audio-queue input callback | sounddevice input callback |
| `src/App.tsx` (live view, toolbar, status bar) | `TapToneAnalysisView*.swift` (`+Controls`, `+Layouts`, `+SpectrumViews`) | main tap-tone view |
| `components/ThresholdMeter.tsx` | `Views/Shared/ThresholdSlider.swift` | `views/shared/threshold_slider.py` |
| `components/SpectrumChart.tsx` | `Views/SpectrumView.swift` | `views/fft_canvas.py` |
| `components/PeakCard.tsx` | `Views/Shared/CombinedPeakModeRowView.swift` | `views/shared/peak_card_widget.py` |
| `components/modeColors.ts` (color/label/display-name/icon) | `GuitarMode` (color/icon/displayName) | guitar mode color/label maps |
| `components/SettingsPanel.tsx` | `Views/Utilities/TapSettingsView*.swift` | settings view |
| `src/settings.ts` (persisted via localStorage) | `Models/TapDisplaySettings.swift`, `MeasurementType.swift`, `PlateStiffnessPreset.swift` (UserDefaults) | settings model |

---

## Maintenance workflow

1. **Algorithm change** → edit the Swift implementation (canonical), regenerate
   `parity-oracle.json`, vendor it here (`tooling/sync-oracle.sh`), then update
   `src/dsp` + Python to match. CI's `--check` guards drift.
2. **UI change** → match the Swift view's layout, naming, control order, and
   enablement rules; mirror in Python where applicable.
3. **New module** → name it after its canonical counterpart and add a row here.
4. The oracle — not this file — is the source of truth for *behavior*; this map is
   the source of truth for *where the corresponding code lives*.