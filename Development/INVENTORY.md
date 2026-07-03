# Phase 1 Inventory — Spec Extracted From Swift

The contract the web port is measured against. Every value below is sourced
from the **canonical Swift** code at `/Users/dws/src/GuitarTap`, cross-checked
against the **Python mirror** at `/Users/dws/src/guitar_tap`. Citations are
`path:line` relative to each repo's root. The parity bar (see `PLAN.md`):
numeric outputs to 2–3 dp, categorical outputs exact, `.guitartap` round-trip
preserving both.

> **Status:** Phase 1 complete (2026-06-21); completeness audit 2026-06-22 added
> the **Mode Classification**, **Pitch**, and **Material Property Formulas**
> sections (categorical/numeric specs that were referenced but not pinned) and
> folded the `.guitartap` serialization details (float32 scalars, top-level-only
> `modeLabel`, annotation nil-vs-empty) into the File Format section. Confirmed
> against current Swift. Swift/Python divergences are flagged inline as
> **⚠ DIVERGENCE** — places the web port must make a deliberate choice (default:
> match Swift).

---

## Audio Capture Pipeline

- **[x] Sample rate — device-dependent, read at runtime. Never hardcode.**
  The analyzer reads the hardware rate after the engine starts:
  `actualSampleRate = hardwareFormat.sampleRate`
  (`GuitarTap/Models/RealtimeFFTAnalyzer+EngineControl.swift:262`). On macOS it
  forces the AUHAL to the input device's *native* nominal rate via
  `kAudioDevicePropertyNominalSampleRate` to stop the aggregate device
  resampling to the output rate (`…+EngineControl.swift:194-227`). Rates seen in
  practice: **48000 Hz** (modern default, UMIK-1) and **44100 Hz** (older
  built-in mics). `mpmSampleRate` defaults to 48000 when unset
  (`TapToneAnalyzer.swift:1030`). Python reads `int(stream.samplerate)` at
  runtime (`realtime_fft_analyzer_device_management.py:102`).
  → Web: treat as a runtime value from the live `AudioContext`/track, per
  `PLAN.md` risk #1.
- **[x] Channel count — always mono (channel 0 only).** Tap forced to 1 channel:
  `effectiveChannelCount: AVAudioChannelCount = 1`
  (`…+EngineControl.swift:287`). Only `channelData[0]` is ever read
  (`RealtimeFFTAnalyzer+FFTProcessing.swift:98-100`). Rationale in code: some
  MacBooks report 3-channel arrays that make a multi-channel tap silently fail.
  Python opens the stream with `channels=1`
  (`realtime_fft_analyzer_device_management.py:394`).
- **[x] Engine buffer size — 1024 frames per callback.**
  `requestedBufferSize = min(fftSize, 1024)` → 1024
  (`…+EngineControl.swift:307-308`, `installTap(bufferSize:)` at `:388`).
  ≈21 ms/chunk at 48 kHz (≈23 ms at 44.1 kHz). This 1024-sample granularity
  drives RMS/level metering and the level-crossing detector. Python uses
  PortAudio `blocksize=1024` for the live stream
  (`realtime_fft_analyzer_device_management.py:397`).
- **[x] Hop size between FFT analysis frames — equals fftSize (65536), 0%
  overlap.** `let hopSize = fftSize`, then `inputBuffer.removeFirst(hopSize)`
  after each `fftSize` chunk (`…+FFTProcessing.swift:229,239-242`). Continuous
  frame rate = `sampleRate / fftSize`. This is distinct from the 1024-sample
  audio-callback hop used for metering.
- **[x] Pre-processing — NONE.** No high-pass, no DC removal, no normalization.
  Samples flow raw into the FFT buffer (`…+FFTProcessing.swift:112-226`); the
  only per-chunk math is RMS metering (`vDSP_rmsqv`), peak-abs clip detection,
  and level-crossing. Mic-calibration corrections are added in the **dB domain
  after** the FFT, not as pre-processing (`…+FFTProcessing.swift:341-343`).
- **[x] Input format — Float32, non-interleaved.** Tap format
  `.pcmFormatFloat32, interleaved: false` (`…+EngineControl.swift:289-294`);
  samples read directly as `Float`. File playback also reads mono Float32
  (`mBitsPerChannel: 32`, `kAudioFormatFlagIsFloat`, `…+EngineControl.swift:746`).

---

## Tap Detection State Machine

Two parallel rising-edge detectors run per audio chunk (~43 Hz). They apply
identical confirmation logic but **do not share cleanup state**.

- **Path 1 — audio-queue level-crossing** (on `audioProcessingQueue` inside
  `RealtimeFFTAnalyzer.processRawSamples`). Snapshots pre-roll and seeds/starts
  the gated capture *immediately* at the crossing, removing the Combine dispatch
  delay; auto-disarms after firing, re-armed by `TapToneAnalyzer`
  (`RealtimeFFTAnalyzer+FFTProcessing.swift:161-195`).
- **Path 2 — main-thread RMS** (`onRmsLevelChanged` → `detectTap` →
  `handleTapDetection`, driven by `$inputLevelDB`). Runs the hysteresis state
  machine, fires the tap event, drives status/decay/sequence logic
  (`TapToneAnalyzer+TapDetection.swift:101-355`).
- **Shared capture state** (`gatedCaptureActive`, `gatedAccumBuffer`,
  `lastLevelCrossingCaptureID`, clearing `isDetecting`) is reconciled in
  `finishGuitarGatedCapture`, **not** `handleTapDetection`
  (`TapToneAnalyzer+SpectrumCapture.swift:609-619`). The audio-queue path never
  touches `isDetecting`. (Matches memory `project_two_path_tap_detection.md`.)

- **[x] Threshold values (dBFS):**
  - Level-crossing threshold `levelCrossingThreshold = -40`, kept synced to
    `tapDetectionThreshold` (`RealtimeFFTAnalyzer.swift:394`; sync at
    `TapToneAnalyzer.swift:1345`).
  - User-adjustable detection threshold default `-40.0`, range −80…−20
    (`TapDisplaySettings.swift:550`).
  - **Guitar (absolute):** rising = `tapDetectionThreshold`; falling =
    `tapDetectionThreshold − 3.0` (`…+TapDetection.swift:172-173`).
  - **Plate/Brace (relative to noise-floor EMA):**
    `headroom = max(threshold − noiseFloor, 10.0)`; rising = `noiseFloor +
    headroom`; falling = `noiseFloor + max(headroom − 3.0, 4.0)`. EMA
    `noiseFloorAlpha = 0.05` (τ ≈ 190 ms), updated only while below threshold
    (`…+TapDetection.swift:144-167`; `TapToneAnalyzer.swift:1111`).
- **[x] Confirmation window — 2 consecutive above-threshold chunks (~43 ms),
  NOT 3.** `levelCrossingConfirmationChunks: Int = 2`
  (`RealtimeFFTAnalyzer.swift:453`); chunk = 1024 samples ≈ 21 ms at 48 kHz, so
  2 chunks ≈ 43 ms. Code comment: the brace fixture's real tap drops below
  threshold by chunk 3, so requiring 3 would reject it; the plate noise bump is
  single-chunk so 2 still rejects it. Both paths use this constant
  (`…+FFTProcessing.swift:164-186`; `…+TapDetection.swift:248,266-273`).
  Confirmed by `GuitarTapTests/TapDetectionTests.swift:78-94`.
  > ⚠ **Memory was wrong:** `project_level_crossing_confirmation.md` said
  > "3 consecutive (~64 ms)". Corrected to 2 (~43 ms).
- **[x] Warm-up — 0.5 s** after start/resume; detection suppressed
  (`TapToneAnalyzer.swift:1152`; `…+TapDetection.swift:180-185`). First frame
  after warm-up re-anchors `noiseFloorEstimate` and returns without detecting
  (`…+TapDetection.swift:192-210`).
- **[x] Debounce / refractory — `tapCooldown = 0.5 s`** between detected taps
  (vs `lastTapTime`) (`TapToneAnalyzer.swift:1142`; `…+TapDetection.swift:213`).
  Confirmed `TapDetectionTests.swift:129`.
- **[x] Onset re-alignment (`alignCaptureToOnset`,
  `TapToneAnalyzer+SpectrumCapture.swift:742-808`):**
  1. Noise RMS from first `onsetNoiseEstimateSamples = 2048` samples
     (`TapToneAnalyzer.swift:988`).
  2. Threshold = `max(noiseRMS × 10.0, 0.001)`
     (`onsetThresholdMultiplier=10.0`, `onsetMinThreshold=0.001`,
     `TapToneAnalyzer.swift:993,997`).
  3. Scan forward for first `|sample| > threshold` = onset.
  4. Back up `onsetBackupSamples = 32` (`TapToneAnalyzer.swift:1001`).
  5. Extract a `windowSize` window with onset placed at `preOnsetSamples =
     sampleRate × 0.100 s` of pre-onset silence (`preOnsetDuration=0.100`,
     `TapToneAnalyzer.swift:984`); zero-pad as needed. If no onset found, return
     the buffer unchanged.
  This makes the FFT input invariant to chunk-boundary alignment — which is why
  the 2-chunk trigger delay is invisible downstream (matches memory
  `project_level_crossing_confirmation.md`'s re-alignment claim).
- **[x] Hysteresis state machine (`detectTap`, `…+TapDetection.swift:250-298`):**
  latched `isAboveThreshold`. Below→ requires `>= confirmTarget` consecutive
  above-rising to fire (sets `tapDetected`, `lastTapTime`, `tapPeakLevel`, calls
  `handleTapDetection`); falling below rising before confirm cancels the run.
- **[x] Tap-sequence grouping.** `numberOfTaps` default 1 (guitar,
  `TapToneAnalyzer.swift:236`). Each confirmed tap →
  `startGuitarGatedCapture()` → `finishGuitarGatedCapture` appends
  `(magnitudes, frequencies)` to `capturedTaps`, increments `currentTapCount`,
  re-arms via `scheduleGuitarReEnable` after `tapCooldown` until count reached;
  then `processMultipleTaps()` after `captureWindow = 0.2 s`
  (`…+SpectrumCapture.swift:678-692`). Multi-tap averaging is **linear power
  domain**: `dB_avg = 10·log10(mean(10^(dB/10)))` bin-by-bin (`averageSpectra`
  `…+SpectrumCapture.swift:1442-1482`), then a single peak-find on the average.

---

## Gated FFT Window

There are **two** gated paths: plate/brace (500 ms / 400 ms scheme) and guitar
gated capture (full `fftSize`).

- **[x] Capture buffer (plate/brace) — 500 ms.**
  `gatedCaptureDuration = 0.500` (`TapToneAnalyzer.swift:968`);
  `gatedCaptureSamples = Int(sampleRate × 0.500)` → 24000 @ 48 kHz
  (`…+SpectrumCapture.swift:439`). Larger than the window to give onset-align
  headroom.
- **[x] Aligned analysis window (plate/brace) — 400 ms.**
  `gatedFFTWindowDuration = 0.400` (`TapToneAnalyzer.swift:975`);
  `fftWindowSize = Int(sampleRate × 0.400)` → 19200 @ 48 kHz
  (`…+SpectrumCapture.swift:835`). This is the actual input to `computeGatedFFT`.
  (Matches memory `project_gated_fft_algorithm_change.md`: 500 ms buffer /
  400 ms aligned window, current since 2026-05-14.)
- **[x] Pre-roll ring buffer — 200 ms.** `preRollDuration = 0.200`
  (`TapToneAnalyzer.swift:1082`) → 9600 @ 48 kHz; seeds the capture so the tap
  attack (which precedes the trigger) is included
  (`…+SpectrumCapture.swift:217-221`).
- **[x] Alignment rule — onset placed at `preOnsetSamples` (= 100 ms of
  pre-onset) inside the window.** Same `alignCaptureToOnset` as above; the
  400 ms window is extracted from the 500 ms capture so alignment never needs
  back-padding (`…+SpectrumCapture.swift:835-840`).
- **[x] Window function:**
  - **Plate/brace gated:** Hann, **`vDSP_HANN_DENORM`** (unit-peak,
    `w[n]=0.5(1−cos(2πn/N))`, peak 1.0 — matches numpy `np.hanning`; DENORM
    chosen deliberately to avoid a +4.26 dB inflation)
    (`RealtimeFFTAnalyzer+FFTProcessing.swift:441-448`).
  - **Continuous/display AND guitar gated:** **rectangular** (all ones,
    `vDSP_vfill 1.0`) (`RealtimeFFTAnalyzer.swift:639-647`).
- **[x] FFT size:**
  - **Plate/brace gated:** next power-of-two ≥ sample count, **capped at
    32768**, zero-padded. `nextPowerOfTwo(19200) = 32768`, so paddedSize = 32768,
    bin width = `sampleRate/32768` = 1.46484 Hz/bin @ 48 kHz
    (`…+FFTProcessing.swift:415-416,486`). A fresh
    `vDSP_DFT_zrop_CreateSetup` is created/destroyed per call.
  - **Guitar gated & continuous:** fixed **65536**, rectangular window;
    truncate/zero-pad to `fftSize` for bin-compatibility with live frames
    (`…+SpectrumCapture.swift:634-649`; `RealtimeFFTAnalyzer.swift:188`).
- **[x] Normalization — 1/N magnitude scaling, then dB re 1.0.** Real and imag
  parts scaled by `1.0/N` (N = padded or fftSize) before `vDSP_zvabs`, then
  `vDSP_vdbcon` ref=1.0 (amplitude dB = `20·log10(mag)`). dB floor differs:
  continuous initialized to −100, gated to −160 (`…+FFTProcessing.swift:302-311,
  474-483`).

> ⚠ **DIVERGENCE:** Swift's **continuous** path runs a 65536-point rectangular
> FFT; Python's continuous capture extracts a 400 ms window (matching its gated
> path). Both gated paths agree (Hann, ≤32768, 1/N). For Phase-2 the web port
> mirrors **Swift continuous = 65536 rectangular**.

---

## FFT & Spectral Analysis

- **[x] Library — Apple Accelerate vDSP real-to-complex DFT
  (`vDSP_DFT_zrop`).** Setup once via `vDSP_DFT_zrop_CreateSetup(.FORWARD)`,
  reused, destroyed in `deinit` (`RealtimeFFTAnalyzer.swift:192,628-632`);
  executed with `vDSP_DFT_Execute` on split-complex buffers
  (`…+FFTProcessing.swift:289`). Gated path makes a separate temporary setup
  per call (`…+FFTProcessing.swift:418-426`).
  → Web (`PLAN.md` open Q): a JS FFT will diverge in the last bits; parity bar
  is categorical-exact, not bit-exact.
- **[x] Real vs complex — real input, packed `zrop`.** Input length `fftSize`
  deinterleaved: even idx → real, odd → imag, each length `fftSize/2`
  (`…+FFTProcessing.swift:277-284`). Output magnitude/freq arrays length
  `fftSize/2`.
- **[x] Magnitude (not power) convention.** `1/N`-scaled split-complex →
  `vDSP_zvabs` modulus (`…+FFTProcessing.swift:302-305`).
- **[x] dB reference & floor.** `vDSP_vdbcon` ref = **1.0** (dBFS, amplitude
  `20·log10`). Floor: continuous −100, gated −160
  (`…+FFTProcessing.swift:309,481`). Display default range −100…0 dB
  (`TapDisplaySettings.swift:414,417`). Mic-calibration added in dB after
  conversion.
- **[x] Bin → Hz mapping.** `frequency[i] = i · (sampleRate / fftSize)`, length
  `fftSize/2`; DC = bin 0. Nyquist not emitted as a separate bin (loop is
  `0..<fftSize/2`). Sub-bin accuracy for peaks only, via parabolic interpolation
  (below) (`…+FFTProcessing.swift:17-25`).
- **[x] Peak-picking (`findPeaks`, `TapToneAnalyzer+PeakAnalysis.swift:364-541`).**
  Local-max window **±5 bins** (`windowSize = 5`); a bin must strictly exceed
  all 10 neighbors and be `> threshold` (`peakMinOverride ?? peakMinThreshold`;
  plate/brace pass an adaptive override = **median** of in-range magnitudes,
  `…+PeakAnalysis.swift:95-105`). Algorithm:
  - **Pass 1 — known guitar modes** (Air/Top/Back/Dipole/Ring/Upper), scanned
    low→high; per mode keep the strongest in-range local max; de-dupe winners
    within `peakProximityHz = 2.0 Hz` of an already-claimed mode.
  - **Pass 2 — inter-mode / unknown peaks** outside all known mode ranges.
  - **Assemble:** one slot per detected mode + all remaining candidates by
    descending magnitude, **no count limit**; return sorted by magnitude DESC.
  - **Parabolic interpolation** (`…+PeakAnalysis.swift:794-812`):
    `δ = 0.5(α−γ)/(α−2β+γ)`, `f = f_bin + δ·Δf`, `A = β − 0.25(α−γ)δ`;
    guards: raw bin at array edges or `|denom| ≤ 1e-6` (flat top); δ ∈ (−0.5,0.5).
  - **Q / −3 dB bandwidth** (`…+PeakAnalysis.swift:834-863`): walk outward until
    mag ≤ `peakMag − 3.0 dB`; `Q = f_center / (f_upper − f_lower)`.
  - **Duplicate removal:** peaks within 2.0 Hz collapse to the louder one.
  - **Gated capture extra filter:** candidates with **Q < 3.0** (`minQ`)
    rejected as impact thuds (`…+SpectrumCapture.swift:1052-1060`).
  Confirmed by `PeakFindingTests.swift:79-88,143-151`, `DSPTests.swift:76-215`.

---

## Mode Classification (peak labeling)

How a detected peak frequency becomes a mode label (Air/Top/Back/…). Drives the
export `modeLabel` **and** which peaks Pass-1 peak-picking claims —
**categorical-parity-critical.** Swift `GuitarMode.swift` / `GuitarType.swift`;
Python `guitar_mode.py` / `guitar_type.py` (same bands, verified).

- **[x] Mode bands per guitar type** (`GuitarType.modeRanges`,
  `GuitarType.swift:65-105`). Inclusive `ClosedRange<Float>`, Hz. **Bands overlap
  by design** (Top vs Back especially) — that's why `classifyAll` exists instead
  of independent per-peak classification:

  | Mode   | Classical  | Flamenco   | Acoustic   | Generic    |
  |--------|------------|------------|------------|------------|
  | Air    | 80–110     | 85–115     | 90–120     | 70–135     |
  | Top    | 170–230    | 190–250    | 150–210    | 140–260    |
  | Back   | 190–280    | 180–240    | 210–290    | 180–300    |
  | Dipole | 330–430    | 350–450    | 360–460    | 310–460    |
  | Ring   | 580–820    | 600–850    | 620–880    | 580–880    |
  | Upper  | 820–20000  | 850–20000  | 880–20000  | 880–20000  |

  Mode display/raw names: `"Air (Helmholtz)"`, `"Top"`, `"Back"`, `"Dipole"`,
  `"Ring Mode"`, `"Upper Modes"`, `"Unknown"` (`GuitarMode.swift:51-73`).
  `currentCases` order = [air, top, back, dipole, ringMode, upperModes, unknown].
- **[x] `classify(frequency, guitarType)`** (`GuitarMode.swift:123-135`): switch
  testing bands in case order **Air→Top→Back→Dipole→Ring→Upper**; first
  containing band wins (so in a Top/Back overlap a bare lookup returns Top); no
  match → `.unknown`.
- **[x] `classifyAll(peaks, guitarType)` — the context-aware claimer used for
  export labels** (`GuitarMode.swift:160-217`):
  1. Sort modes by `lowerBound` for this guitar type, ascending.
  2. Per mode in that order, claim the **strongest (max-magnitude) not-yet-claimed
     peak** with `freq ∈ [effectiveLowerBound, band.upper]`. `effectiveLowerBound`
     = band lower bound, **except `back` uses `max(band.lower, claimedTopFreq + 1.0)`**
     so a peak already claimed as Top can't re-claim as Back in the overlap.
  3. Unclaimed peaks fall back to `classify(frequency:)`, with a Top/Back overlap
     fix-up (a peak above the claimed Top that lands in the Back band → Back).
     Peaks outside every band → `.unknown`.
  → Web: replicate the ascending-lowerBound claim order and the `topFreq + 1.0`
  Back guard exactly; a naive per-peak `classify` mislabels Top/Back overlaps and
  breaks categorical parity.

---

## Pitch (note / cents) — persisted per peak

12-tone equal temperament, **A4 = 440 Hz**, computed in **`Double`** (not Float).
Swift `Pitch.swift`; Python `pitch.py` (`Pitch(a4=440.0)`,
`tap_tone_analyzer.py:213`). Stored on each peak as
`pitchNote`/`pitchCents`/`pitchFrequency`.

- **[x] Anchor:** `c0 = a4 · 2^(−4.75)` (4 octaves + 9 semitones below A4)
  (`Pitch.swift:51`).
- **[x] Nearest note:** `h = Int(round(12 · log2(f / c0)))`; `octave = h / 12`,
  `note = h % 12` (`Pitch.swift:76-81`). Names
  `["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]`.
- **[x] Note frequency:** `f(note, octave) = c0 · 2^(note/12) · 2^octave`.
- **[x] Cents:** `cents = 1200 · log2(f_measured / f_nearestNote)` (negative = flat).
  → Web: float64 + A4=440; mirror `round()`-then-truncate-to-int for `h`.

---

## Settings That Used to Be Configurable (hardcoded constants)

- **[x] Hysteresis margin = `3.0` dB** — `hysteresisMargin: Float = 3.0`
  (`TapToneAnalyzer.swift:290`). This is a **tap-detection** parameter (not
  peak-picking): after a tap, level must fall ≥3 dB below the threshold before
  re-triggering. Code comment: "Hardcoded constant — no longer user-configurable."
  > Clarifies memory: the `=3` "hysteresis" is the **dB falling margin**, not a
  > peak count. Don't conflate with `levelCrossingConfirmationChunks = 2`.
- **[x] Max peaks = all (no limit)** — `findPeaks` appends all remaining
  candidates by descending magnitude with no cap
  (`…+PeakAnalysis.swift:533-540`).
- **[x] Other hardcoded DSP constants:**
  - Peak local-max window ±5 bins (`…+PeakAnalysis.swift:368`).
  - Peak proximity / dup tolerance `peakProximityHz = 2.0 Hz`
    (`TapToneAnalyzer.swift:1120`).
  - −3 dB bandwidth offset `3.0 dB` (`…+PeakAnalysis.swift:835`).
  - Minimum Q (gated) `minQ = 3.0` (`…+SpectrumCapture.swift:1057`).
  - Parabolic flat-top guard `1e-6` (`…+PeakAnalysis.swift:803`).
  - dB floors: continuous −100, gated −160 (`…+FFTProcessing.swift:309,481`).
  - Level-crossing confirmation = 2 chunks (`RealtimeFFTAnalyzer.swift:453`).
  - Clip hold 1.5 s; clip detect at sample `|x| ≥ 0.99` or RMS ≥ 0 dBFS
    (`RealtimeFFTAnalyzer.swift:257`; `…+FFTProcessing.swift:136`).
- **Still user-configurable** (defaults in `TapDisplaySettings.swift`): analysis
  range 30–2000 Hz, `peakMinThreshold = −60 dB`, `tapDetectionThreshold = −40
  dB`, per-type display ranges, dB range −100…0.

---

## Plate / Brace Pipeline

- **[x] State machine (`MaterialTapPhase.swift`):**
  - **Plate (2 or 3 taps):** `notStarted → capturingLongitudinal →
    reviewingLongitudinal → capturingCross → reviewingCross →
    [waitingForFlcTap → capturingFlc → reviewingFlc →] complete`. Each
    `reviewing*` allows **Accept** (advance) / **Redo** (re-capture, truncate
    session buffer). FLC only when `measureFlc == true` (default false)
    (`MaterialTapPhase.swift:16-31`; `TapToneAnalyzer+Control.swift:338-379`).
  - **Brace (1 tap):** `notStarted → capturingLongitudinal → complete`
    (`MaterialTapPhase.swift:33-39`).
  - `totalPlateTaps`: brace = `numberOfTaps`; plate = `numberOfTaps × 2` (no
    FLC) or `× 3` (FLC) (`…+TapDetection.swift:366-372`).
- **[x] Session WAV capture.** Continuous accumulation into
  `sessionRecordingBuffer` per chunk while `isSessionRecording`; pause stops
  accumulation, redo truncates to a `sessionCheckpoints` checkpoint
  (`…+SpectrumCapture.swift:227-229`; `…+Control.swift:235,342,443`). Saved via
  `finishSessionRecording(label:)` → `dumpCaptureWAV` **only when
  `TapDisplaySettings.dumpCaptureAudio` is on**. WAV: **mono, 32-bit IEEE float
  (fmt 3), hardware sample rate, 44-byte RIFF/WAVE header**
  (`…+SpectrumCapture.swift:89-161`). Labels: `Plate_LC`, `Plate_LCF`, `Brace`,
  `Guitar_Ntap`.
- **[x] Onset alignment.** Same `alignCaptureToOnset`, window =
  `gatedFFTWindowDuration` (400 ms) from the 500 ms capture, onset at 100 ms
  (`…+SpectrumCapture.swift:835-840`).
- **[x] N-chunk gate.** Capture seeded by pre-roll (200 ms) → fills to
  `gatedCaptureSamples` (500 ms) → `finishGatedFFTCapture` aligns → Hann-windowed
  zero-padded `computeGatedFFT`. Safety timeout 2.0 s flushes a partial buffer.
  Per-phase peak search windows (`…+SpectrumCapture.swift:857-889`): Brace
  100–1200 Hz; Plate L 20–100 Hz; Plate C 40–220 Hz; Plate FLC 15–100 Hz;
  `preferLowestSignificant = true` for L and FLC. Dominant-peak selection:
  local maxima above median, HPS order-3, Q filter `minQ=3.0`, parabolic
  interp (`findDominantPeak`). The old FFT-magnitude gate was removed (RMS
  rising-edge already confirms a strike).
- **[x] "Full-session regression."** `playFileForTesting(...)` plays one
  continuous WAV through the **exact production pipeline** at 1024-sample chunks
  and asserts detected peaks against reference fixtures
  (`FilePlaybackRegressionTests.swift:177-194`).
  > ✅ **VALID — verified 2026-06-22.** All four file-playback regressions
  > (REG-G1/G2 guitar, REG-B1 brace, REG-P1 plate) **pass in both Swift (Xcode)
  > and Python** against the same hardcoded constants, which reproduce to ~4 dp —
  > so Swift ↔ Python agree and the plate pipeline is deterministic. The earlier
  > "bogus" label was (a) in-flux-era caution recorded in
  > `feedback_plate_regression_tests.md`, and (b) an app-vs-test discrepancy that
  > turned out to be **calibration**: the tests play the WAV with the UMIK-1
  > profile (`7108913.txt`) applied, so an *uncalibrated* live app run shows
  > per-frequency magnitude offsets (and a ~1-bin fLC shift). The feared
  > gated-FFT staleness did **not** materialize — constants match current output
  > exactly. All four are usable as web parity oracles.

---

## Material Property Formulas (plate / brace results)

Numeric-parity-critical (`PLAN.md`: "material measurements" to 2–3 dp). Inputs:
dimensions (mm→m: `/1000`), mass (g→kg: `/1000`), and fundamental frequencies fL
(longitudinal), fC (cross), fLC (FLC/diagonal, optional). Swift
`MaterialProperties.swift`; Python `material_properties.py` (verified to mirror).
**Derived results are recomputed on load, not persisted** — only dims/mass/freqs
are in the file.

- **[x] Density:** `ρ = mass / (L·W·t)` kg/m³; `densityGPerCm3 = ρ / 1000`
  (`MaterialProperties.swift:114-130`).
- **[x] Beam Young's modulus (Euler–Bernoulli free-free, `PlateProperties`):**
  `E_L = 48·π²·ρ·fL²·L⁴ / (22.37·t)²`; `E_C` = same with width W and fC
  (`MaterialProperties.swift:202-226`). **βL² = 22.37 for PLATE.**
- **⚠ [x] Brace uses a DIFFERENT constant: 22.37332** (more precise βL²) —
  `BraceProperties.youngsModulusLong = 48·π²·ρ·fL²·L⁴ / (22.37332·t)²`
  (`MaterialProperties.swift:648-674`). **Swift and Python both** do plate=22.37 /
  brace=22.37332 (Python `material_properties.py:343,620`) — consistent across
  implementations; the web port must not collapse the two to one constant.
- **[x] Gore plate moduli (Poisson-coupled, `PlateProperties`)** with `ν_CL=0.05`,
  `ν_LC·ν_CL=0.02` (`MaterialProperties.swift:352-356`):
  - `Coef1 = (1 / ((π/2)²·(3/2)⁴))·12·(1−0.02)`
  - `E_L = Coef1·ρ·L⁴·fL²/t²`; `E_C = Coef1·ρ·W⁴·fC²/t²` (`…:395-414`)
  - `G_LC = (12/π²)·ρ·L²·W²·fLC²/t²` — **nil when FLC not tapped** (`…:422-432`)
- **[x] Gore target thickness (Eq. 4.5-7, mm)** (`MaterialProperties.swift:460-489`):
  `Coef2 = π·√(12·(1−0.02)/126)`, `Coef3 = 4·0.05/7`, `Coef4 = 4·12·(1−0.02)/42`;
  body length `a`, width `b` (mm→m); moduli in GPa:
  - numerator = `Coef2 · f_vs · a² · √ρ`
  - denominator(GPa) = `E_L + (a/b)⁴·E_C + (a/b)²·(Coef3·E_L + Coef4·G_LC)`
    (G_LC→0 if no FLC; ≈5–7 % over-estimate)
  - `thickness_mm = numerator / √(denominator·1e9) · 1000`
  - `f_vs` presets: steel top 75, steel back 55, classical top 60, classical back 50.
- **[x] Derived metrics** (`MaterialProperties.swift:228-316`): speed of sound
  `c = √(E/ρ)`; `E_GPa = E/1e9`; specific modulus `= E_GPa / densityGPerCm3`;
  radiation ratio `= c/ρ`; anisotropy `E_C/E_L` and `E_L/E_C`.
- **[x] Wood-quality label (categorical — must match exactly)** from specific
  modulus (`WoodQuality.evaluate`, `MaterialProperties.swift:502-540`):
  - spruce long: ≥25 Excellent · ≥22 Very Good · ≥19 Good · ≥16 Fair · else Poor
  - spruce cross: ≥1.5 · ≥1.2 · ≥0.9 · ≥0.6
  - cedar long: ≥22 · ≥19 · ≥16 · ≥13 — cedar cross: ≥1.3 · ≥1.0 · ≥0.7 · ≥0.5
  - default (maple/rosewood/…): ≥20 · ≥16 · ≥12 · ≥8
  - overall = `0.7·long + 0.3·cross` numeric scores → ≥4.5 Excellent · ≥3.5 Very
    Good · ≥2.5 Good · ≥1.5 Fair · else Poor (`MaterialProperties.swift:337-348`).

---

## `.guitartap` File Format

**It is plain UTF-8 JSON — not binary, no magic bytes, no header.**

- **[x] Extension / type.** `.guitartap`; UTI
  `com.dolcesfogato.guitartap.measurement`, `exportedAs` in
  `MeasurementsListView.swift:51`, registered in `Info.plist:30-52`. Conforms to
  `public.json`; MIME `application/json`; importers accept `guitartap` + `json`.
  In-app bulk store is `saved_measurements.json`; a single export is
  `<name>.guitartap`.
- **[x] Encoding.** Swift `JSONEncoder`, `dateEncodingStrategy = .iso8601`,
  `outputFormatting = [.prettyPrinted, .sortedKeys]`
  (`TapToneAnalyzer+MeasurementManagement.swift:115-117`). **Top-level shape is a
  JSON array** `[TapToneMeasurement]` — an exported file is a one-element array
  (`…+MeasurementManagement.swift:777`). Dates = ISO-8601 strings.
- **[x] Spectrum float arrays are Base64 LE-float32, not JSON numbers.**
  `frequenciesData` / `magnitudesData` = raw little-endian IEEE-754 float32 bytes
  Base64'd into JSON strings (`SpectrumSnapshot.swift:64-93`). Legacy plaintext
  `frequencies`/`magnitudes` arrays accepted on decode only. Python packs
  identically with `struct.pack("<{n}f")` (`spectrum_snapshot.py:187`).
- **[x] What's persisted.** Processed FFT spectra (Base64 float32), detected
  peaks (freq/mag/Q/bw/pitch + resolved `modeLabel`), chart axis ranges &
  display flags, analysis settings (tap/peak thresholds, numberOfTaps),
  plate/brace material dims & masses + Gore params, annotation label positions
  (data-space Hz/dB offsets), peak selections (IDs + frequencies), per-peak mode
  overrides, mic/calibration provenance, comparison overlays, per-tap spectra.
  **Not persisted:** raw/time-domain audio, FFT phase, PNG/PDF artifacts
  (`TapToneMeasurement.swift:23-28`).
- **[x] Versioning.** No explicit version field. Forward/back-compat via
  additive optionals + legacy-key fallbacks on decode (`measurementName` ⇐
  `tapLocation`; `peakMinThreshold` ⇐ `peakThreshold`; unknown enum strings →
  safe defaults) (`TapToneMeasurement.swift:466-485`).
- **[x] `TapToneMeasurement` top-level keys** (custom `encode`/`init(from:)`,
  `TapToneMeasurement.swift:460-597`; `encodeIfPresent` ⇒ nil → key omitted):
  `id`(UUID str), `timestamp`(ISO-8601), `peaks`(array, see below),
  `decayTime`?, `measurementName`?, `notes`?, `spectrumSnapshot`?,
  `peakAnnotationOffsets`? (flat array `[uuidStr,{absFreqHz,absDB},…]`),
  `tapDetectionThreshold`?, `numberOfTaps`?, `peakMinThreshold`?,
  `selectedLongitudinalPeakID`?, `selectedCrossPeakID`?, `selectedFlcPeakID`?,
  `longitudinalSnapshot`?, `crossSnapshot`?, `flcSnapshot`?, `selectedPeakIDs`?,
  `selectedPeakFrequencies`?, `annotationVisibilityMode`?(`all`/`selected`/`none`),
  `peakModeOverrides`?(flat array `[uuidStr, UserAssignedMode, …]`; each value
  `{type:"auto"}` or `{type:"assigned",label}`), `microphoneName`?,
  `microphoneUID`?, `calibrationName`?, `comparisonEntries`?, `tapEntries`?,
  `measurementType`?/`guitarType`? (encode-only convenience, ignored on decode).
  *Swift serializes `[UUID:V]` dicts as a flat alternating array.*
- **[x] Peak export object** (`PeakExportCodingKeys`,
  `TapToneMeasurement.swift:567-596`): `id`, `frequency`, `magnitude`,
  `quality`(Q), `bandwidth`, `timestamp`, `pitchNote`?, `pitchCents`?,
  `pitchFrequency`?, `modeLabel` (**export-only** resolved label; ignored on
  decode). **`modeLabel` is injected ONLY into the top-level `peaks` array** — the
  peaks nested inside `tapEntries`/`comparisonEntries` use plain `ResonantPeak`
  Codable, which has no `modeLabel`. Python matches this via
  `ResonantPeak.to_dict(include_mode_label=False)` at those nested call sites
  (fixed 2026-06-21).
- **[x] `SpectrumSnapshot`** (`SpectrumSnapshot.swift:40-93`):
  `frequenciesData`/`magnitudesData` (Base64), `minFreq`/`maxFreq`/`minDB`/`maxDB`,
  `isLogarithmic`, `showUnknownModes`?, `guitarType`?, `measurementType`?,
  plate dims (`plateLength/Width/Thickness/Mass`), Gore body dims, plate stiffness
  preset + custom, `measureFlc`?, brace dims (`braceLength/Width/Thickness/Mass`).
  **Enum raw values are spelled-out display strings** (e.g. `"Material (Plate)"`,
  `"Steel String Top"`) — the web port must emit these exact strings.
- **[x] Scalar numeric precision — float32, not float64.** Swift stores most
  scalars as `Float` (IEEE-754 binary32); `JSONEncoder` writes the **shortest
  decimal that round-trips to that float32**, and integral values carry **no
  decimal point** (`-100`, not `-100.0`). Float32 fields: peak
  `frequency`/`magnitude`/`quality`/`bandwidth`; snapshot
  `minFreq`/`maxFreq`/`minDB`/`maxDB`; all plate/brace/Gore dimensions +
  `customPlateStiffness`; `decayTime`, `tapDetectionThreshold`,
  `peakMinThreshold`; `selectedPeakFrequencies[]`. **Float64** (`Double`) fields,
  left at full precision: `pitchCents`, `pitchFrequency`, comparison
  `colorComponents[]`, annotation `absFreqHz`/`absDB`. Python matches this via
  `utilities/json_float.py::f32()` — `float(str(np.float32(x)))`, integral→`int`
  (added 2026-06-21); all 53 `Tests/**` fixtures verified byte-equivalent to
  Swift afterward. → Web: JS numbers are float64. Categorical and 2–3 dp parity
  hold regardless, but for **byte-identical** files the writer must quantize the
  float32 fields (`Math.fround`) and emit shortest-round-trip-float32 text
  (integral without `.0`), leaving the Double fields as normal float64 output.
- **[x] `peakAnnotationOffsets` nil-vs-empty.** Swift `encodeIfPresent` semantics:
  nil ⇒ key omitted; a non-nil empty map ⇒ `[]`; non-empty ⇒ flat
  `[uuidStr,{absFreqHz,absDB},…]`. Python now mirrors this (omit when `None`, `[]`
  only for an explicit empty map) and preserves the distinction on decode
  (`[]`→`{}`, absent→`None`) — fixed 2026-06-21; earlier Python always wrote `[]`.
- **✅ RESOLVED 2026-06-21 — canonical format = Swift's actual on-disk form**
  (confirmed by running Swift's `JSONEncoder`; the manual `app-b-file-formats.md`
  was wrong and was corrected). Fixes landed in Python (release now) and Swift
  (release after the in-flight App Store build is approved). Both readers now
  accept *both* the canonical and the released-1.0.x shapes, so files written by
  the currently-released code remain loadable on both sides.
  1. **`peakMinThreshold` key.** Canonical key is **`peakMinThreshold`** (Swift +
     manual). Python now writes `peakMinThreshold` and reads it with a
     `peakThreshold` legacy fallback (`tap_tone_measurement.py`). Swift already
     read both.
  2. **`peakAnnotationOffsets` shape.** Was never an interop bug — both sides
     already emit/accept the flat alternating array (`absFreqHz`/`absDB`). Only
     the *manual* was wrong (said object `{x,y}`); manual corrected.
  3. **`peakModeOverrides`.** Canonical = flat alternating array of
     `[uuid, {type,label}]`. Python now writes that (was a `{uuid:{…}}` object) and
     reads both forms; Swift now also decodes the legacy object form instead of
     throwing `typeMismatch`. Pinned by `MeasurementCodableTests` D9/D10 (Swift)
     and `test_measurement_codable.py` + cross-checks (Python).
  4. `modeLabel`, top-level `measurementType`/`guitarType` remain export-only on
     both sides, ignored on decode (unchanged).
  - **Note for the web port:** write the canonical flat-array + `peakMinThreshold`;
    read both the canonical and legacy-object/`peakThreshold` shapes.

---

## UI Flows (for Phase 3)

All views bind to a single `TapToneAnalyzer` `ObservableObject`. Authoritative
gates: `displayMode` (`.live`/`.frozen`/`.comparison`), `isDetecting`,
`isMeasurementComplete`, `isDetectionPaused`, `materialTapPhase`, `numberOfTaps`,
`tapProgress`, `savedMeasurements` (`TapToneAnalyzer.swift:334,635,643,874,881`).
`MeasurementType` is the top mode: guitar (generic/acoustic/classical/flamenco,
`.isGuitar`) vs material (plate/brace).

- **[x] Live tap analysis view** (`TapToneAnalysisView*.swift`).
  - **Toolbar:** Auto-dB, Crosshair (iOS), Annotations (cycle; disabled if no
    peaks or in comparison), Save (disabled if no peaks & not comparison),
    Measurements, Results, Metrics, Settings, Play File
    (`+Controls.swift:40-195`).
  - **Tap controls (dual-purpose during material review):** **New Tap** →
    `startTapSequence()`. **Pause/Resume** → during review = **Accept**
    (`acceptCurrentPhase`), else toggle pause. **Cancel** → during review =
    **Redo** (`redoCurrentPhase`), else `cancelTapSequence`. **Taps** stepper
    (1–10, disabled while a tap is in progress). **Threshold** −80…−20,
    **Peak Min** −100…−20 (guitar only) (`+Controls.swift:620-727`).
  - **Button-enablement rules (parity-pinned — port verbatim,
    `TapToneAnalysisView.swift:196-232`):** *New Tap* disabled in comparison /
    FFT not running; guitar also disabled while detecting or no prior
    measurement; plate/brace otherwise always enabled. *Pause/Resume* enabled
    during review (=Accept) or if detecting/paused. *Cancel* enabled during
    review (=Redo); guitar multi-tap if detecting & `currentTapCount <
    numberOfTaps`; plate/brace during any active sequence. *Save* disabled if no
    peaks & not comparison. *Annotations* disabled if no peaks or comparison.
    (Pinned by `ButtonEnablementTests.swift`.)
  - **Spectrum gating** (`+SpectrumViews.swift:65-89`): not-complete → live FFT;
    complete → frozen magnitudes; comparison → overlays only; material review →
    frozen phase overlays + annotations, live hidden.
  - **Exports** (`+Actions.swift`, `+Export.swift`): Spectrum PNG (off-screen
    `ImageRenderer`); Save Measurement; PDF (single / comparison / multi-tap);
    Play File loads WAV + optional calibration through the live pipeline.
- **[x] Layout variants** (`+Layouts.swift`, selected at
  `TapToneAnalysisView.swift:142-194`). **Breakpoints are SwiftUI size classes,
  not pixel widths** → web: map *regular* → desktop/wide-tablet, *compact* →
  phone.
  - Desktop (macOS): `HSplitView` header → [spectrum+decay | results pane (if
    shown)] → status bar; header uses `ViewThatFits` (wide 1 labeled row →
    medium 2 rows → narrow 2 icon rows).
  - iPad regular: HStack spectrum + inline results (360–480 pt). iPad compact:
    portrait, results as sheet.
  - Phone landscape (`vSizeClass == .compact`): 200 pt scroll controls column +
    spectrum. Phone portrait: VStack header → spectrum → decay → status;
    secondary panels as sheets.
- **[x] Settings** (`TapSettingsView*.swift` ↔ `TapDisplaySettings.swift`,
  UserDefaults). Sections: **Audio Input & Calibration** (device picker,
  read-only sample rate, calibration import/delete — *device/calibration changes
  apply immediately, not reverted by Cancel*); **Measurement Type** picker with
  type-conditional inputs (plate: dims/mass/density, Measure-FLC toggle, Gore
  body dims, stiffness preset; brace: dims/mass; guitar: read-only mode-range
  table); **Advanced** (display freq/dB ranges, Show Unknown Modes [guitar],
  analysis range, Peak Detection Minimum [guitar only], Dump Capture Audio);
  **About & Help**. **Apply contract** (`+Actions.swift:33-173`): "Done"
  validates/clamps (≥10 Hz / ≥10 dB separation), persists, returns one
  `measurementChanged` bool that triggers an analyzer reset **iff the type
  change crosses the guitar↔material boundary OR `measureFlc` changed**.
- **[x] Session history / file management** (`Views/Measurements/*`,
  `SaveMeasurementSheet.swift`, `PlayFileSheet.swift`).
  - **MeasurementsListView:** list bound to `savedMeasurements`; double-tap /
    "Load into View" loads (deferred to next runloop); context menu View /
    Edit / Export JSON / Save to Disk / Export PNG / Export PDF / Delete
    (confirm); swipe-delete on iOS. **Compare mode** toggle enabled only with ≥2
    *comparable* (snapshot-bearing) measurements; "Compare (n)" enabled at ≥2
    selected → `openComparison()`. Import via file picker (auto-loads if exactly
    1).
  - **MeasurementDetailView:** read-only metadata + peaks (selected vs unselected
    at 0.4 opacity).
  - **EditMeasurementView:** edit name + notes (empty → nil).
  - **ExportView:** show JSON; Copy / Save File / Share.
  - **SaveMeasurementSheet:** name + notes → `onSave()`.
  - **PlayFileSheet:** audio file (required, Play disabled until selected) +
    optional calibration.
- **[x] Plate/brace measurement flow.** Drives `materialTapPhase` (above).
  Each `reviewing*` freezes the spectrum and offers Accept (Pause/Resume) / Redo
  (Cancel). Status bar: "Phase X/Y · Tap N/M" with animated `tapProgress`. Phase
  colors L=blue, C=orange, FLC=purple, complete=green
  (`+SpectrumViews.swift:338-346`).
- **[x] Supporting views.**
  - **SpectrumView** (`SpectrumView*.swift`): interactive FFT chart, linear/log
    freq, axis ranges persist across taps. Zoom (pinch by region / macOS
    scroll-wheel; +Cmd/Ctrl = both axes; clamps freq ≥1.1× log / 50 Hz linear,
    mag ≥10 dB), Pan (drag / scroll+Shift freq / scroll+Option mag), cursor
    readout (hover / long-press, snaps to nearest point), peak select (tap dot →
    star, linked to results panel), context-menu axis resets (Saved/Defaults) +
    Reset Labels. `SpectrumScrollWheel.swift` is a macOS AppKit bridge — web
    replaces with native wheel + modifier handling.
  - **PeakAnnotations:** draggable mode-colored badges; offset stored data-space
    (Hz,dB) in `annotationOffsets[peak.id]`; double-tap/right-click resets one.
    Mode colors: Air=cyan, Top=green, Back=orange, Dipole=red, Ring=purple,
    Upper=gray, user-defined=teal; plate/brace L=blue/C=orange/FLC=purple.
  - **ComparisonResultsView / MultiTapComparisonResultsView:** read-only tables
    of Air/Top/Back per spectrum (≤5) / per tap + bold gold "Averaged" row.

---

## Test Fixtures

WAV/calibration files are the only on-disk fixtures the suites load; expected
values are **hardcoded inline** in both Swift and Python test files (transcribed
by hand from the matching `.guitartap` + the running app), not read at runtime.

| Fixture | Used by | Status |
|---|---|---|
| `Recording 5.wav` (generic guitar, single-tap, 48 kHz) | REG-G1 | ✅ valid |
| `Recording.wav` (generic guitar, 8-tap) | REG-G2 | ✅ valid |
| `brace-umik-1-swift-mac-1778816093.wav` (brace, UMIK-1, full session) | REG-B1 | ✅ valid (passes Swift+Python 2026-06-22) |
| `plate-umik-1-swift-mac-1778816330.wav` (plate L→C→FLC) | REG-P1 | ✅ valid (passes Swift+Python 2026-06-22) |
| `7108913.txt` (UMIK-1 calibration) | REG-B1, REG-P1 | calibration input |

Swift: `GuitarTapTests/<file>`; Python mirror: `guitar_tap/tests/<file>` (same
recordings). `DSPTests`, `PeakFindingTests`, `TapDetectionTests`,
`ButtonEnablementTests`, `GatedFFTParityTests` use **synthetic in-memory
signals**, not WAVs. A large `.guitartap` corpus under
`GuitarTap/Tests/` (O'Brien/, Plate/, Brace/, …) is **provenance only — not
loaded by tests**.

**[x] Expected-value oracle (the Phase-2 parity targets):** hardcoded inline,
identical across Swift/Python.
- REG-G1 (`Recording 5.wav`): Air/Top/Back freq+mag,
  `FilePlaybackRegressionTests.swift:231-236` / `test_file_playback_regression.py:102`.
  Settings: `peakMinThreshold=-76`, `tapThreshold=-40`, FFT 65536.
- REG-G2 (`Recording.wav`): averaged + per-tap table (8 taps),
  `…:301-318`.
- REG-B1 (`brace-…wav`): 512.68880 Hz / −70.93484 dB / Q 87.5; tap threshold
  −53.33838 dB (`…:44-50`).
- REG-P1 (`plate-…wav`): fL 67.11537/−60.36113/Q15.333, fC
  116.27016/−52.80130/Q26.333, fLC 35.35375/−58.28925/Q6.000 (`…:64-76`) —
  ✅ valid; **plays with UMIK-1 calibration (`7108913.txt`) applied** — the web
  oracle must apply the same calibration or the magnitudes (and the weak fLC
  pick) will differ.
- Tolerances both sides: ±1.0 Hz, ±1.0 dB, ±1.0 Q.

**[x] Caveats to carry forward:**
- **All four regressions verified 2026-06-22** — REG-G1/G2/B1/P1 pass in **both**
  Swift (Xcode) and Python against the same constants (reproduce to ~4 dp). The
  earlier "plate is bogus" caution is **superseded**; the feared gated-FFT
  staleness did not materialize (constants match current output).
- **Calibration matters for REG-B1/REG-P1:** both play with the UMIK-1 profile
  applied. An uncalibrated run yields per-frequency magnitude offsets — this was
  the entire app-vs-test discrepancy. The web port must apply the same `.txt`
  calibration in the dB domain to match.
- **If the gated algorithm changes again**, regenerate + re-sync constants in
  BOTH `FilePlaybackRegressionTests.swift` and `test_file_playback_regression.py`
  (memory `project_gated_fft_algorithm_change.md`); the WAV samples are unchanged,
  only derived freq/mag/Q.

---

## Cross-Implementation Parity Notes

**No live cross-process harness exists.** Parity = both repos carry **paired
test files** with the **same fixtures and the same hardcoded expected values**;
divergence shows up as a one-sided failure. Every Swift test has a Python twin
(`GatedFFTParityTests`↔`test_gated_fft_parity`,
`FilePlaybackRegressionTests`↔`test_file_playback_regression`,
`ScenarioStateTraceTests`↔`test_scenario_state_trace`,
`StateInvariantTests`↔`test_state_invariants`, plus DSP/peak/tap/button twins).
**Adding the web port = adding a third copy of these constants and keeping all
three in sync.**

The three harnesses the web port must plug into:
- **[x] DSP magnitude parity** (`GatedFFTParityTests` / `test_gated_fft_parity`):
  identical synthetic two-tone signals (48 kHz, 0.4 s) → `computeGatedFFT` →
  compare dB at the closest bin. GFFT1–5 (single/two-tone/bin-centered/silence/
  Hann-normalization). **✅ RESOLVED 2026-06-21:** Python's loose bounds were
  tightened to Swift's exact dB targets within ±1 dB (−15.72; −49.74/−29.55;
  −49.70/−29.51; Δ20.19) and the missing **GFFT5** (Hann DENORM) was added, so
  both suites now pin the same numbers. Confirmed Python already produces those
  exact values. Web should match the same dB targets within 1 dB.
- **[x] State-evolution parity** (`ScenarioStateTraceTests` /
  `test_scenario_state_trace`): records `(isDetecting, isDetectionPaused,
  isMeasurementComplete, currentTapCount, capturedTapsCount)` at each checkpoint
  across S1–S4 (clean tap / spurious-tap-on-type-change / multi-tap pause-resume
  / multi-tap cancel); asserts equality vs a canonical trace hardcoded in both.
  Setup: threshold −40, `analyzerStartTime = now−2s`, `justExitedWarmup=false`,
  type `.generic`.
- **[x] Invariant parity** (`StateInvariantTests` / `test_state_invariants`):
  shared checker I1–I6 — I1 guitar `isDetecting && isMeasurementComplete`
  illegal; I2 `isDetectionPaused && isMeasurementComplete` illegal; I3
  `capturedTaps.count ≤ numberOfTaps`; I4 guitar `currentTapCount ==
  capturedTaps.count`; I5 `tapProgress ∈ [0,1]`; I6 during plate/brace review
  `isDetecting` must be false. (Matches memory `project_parity_test_suite.md`.)

**[x] Known divergences before adding a third implementation:**
- ~~Loose-vs-tight FFT assertions~~ — fixed; Python now pins Swift's exact dB.
- ~~GFFT5 Swift-only~~ — fixed; GFFT5 added to Python.
- Concurrency model differs but is normalized in the trace tests (Swift
  `Task.sleep(50ms)`; Python pumps a real `QApplication` loop). The web port
  needs its own "drain async work" step; the traces themselves are identical.
- `.guitartap` field divergences (`peakMinThreshold` key, dict serialization) —
  see the File Format section.
- ~~**Plate (REG-P1) parity is not trustworthy**~~ — **resolved 2026-06-22:**
  REG-P1 passes in both Swift and Python against identical constants. (Old
  concern was that both suites carried stale numbers and passed against a stale
  oracle — disproven; the constants reproduce current output to ~4 dp.)

---

## Open Questions Resolved in Phase 1

- **Swift capture sample rate:** device-dependent (mic-native), 44.1/48 kHz in
  practice; no code path hardcodes a rate. ✅
- **FFT library:** Accelerate vDSP `vDSP_DFT_zrop`. Exact numerics are **not**
  reproducible bit-for-bit in JS; parity bar is categorical-exact. ✅
- **`.guitartap` format:** documented above — plain JSON, no reverse-engineering
  needed beyond the field schema. ✅
- **Does Python solve the parity problems?** It carries the same hardcoded
  oracle. Two real defects found during Phase 1 were fixed 2026-06-21: Python's
  loose gated-FFT assertions (now tightened to Swift's exact targets + GFFT5
  added) and two `.guitartap` interop bugs (`peakMinThreshold` key and
  `peakModeOverrides` object-vs-array — the latter made Python override-files
  fail to load in Swift entirely). Both readers are now tolerant of both shapes.
  Still: mine Swift, not Python, for the tight numeric targets. ✅
