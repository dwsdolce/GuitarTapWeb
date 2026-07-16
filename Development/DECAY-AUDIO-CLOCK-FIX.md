# Ring-out decay: audio-clock timestamps (load-invariant)

**Status: ✅ CODE COMPLETE on all 3 platforms, all suites green. NOT yet USER run-reviewed. NOT committed.**
2026-07-15. Suites: Swift 372/372 (under load, REG_G stable) · Python 479/479 · web decay 10/10.
Golden unchanged (0.0853). Next: USER run-review (live-capture a tap on a busy machine → ring-out
stable), then commit. Commit spans Swift + Python (web needed no change).

## Why (the real product bug, not a test flake)

Ring-out/decay time was measured in **wall-clock** time: `trackDecayFast` stamped each level
sample with `Date()` at the moment the main-thread `$inputLevelDB` sink consumed it, and
`measureDecayTime` returned the wall-clock gap between the post-tap peak sample and the
peak−`decayThreshold` crossing sample.

The audio itself is fine; only the *timestamps* were taken at the consumer. On a heavily loaded
machine the main queue is preempted, so those stamps jitter relative to the true audio timeline →
the **displayed decay number is wrong for a real user**, not just the test. This runs in live mic
capture, not only file playback. `REG_G_genericGuitarRingOut_matchesGolden` (a real-time file
playback test) surfaces it: passes in isolation (~0.085 s), fails under full-suite load (~0.1 s vs
tol 0.03). Everything else the user sees (peaks, freqs, spectrum, tap detection) already rides the
audio-clock path and is unaffected — only ring-out was exposed.

This is the OUT-4 lesson again: **the timestamp must travel with the sample.**

## The fix

Route decay tracking off the main-thread `$inputLevelDB` Combine sink and onto the audio-thread
`rmsLevelHandler` callback — the SAME one that drives tap detection, which already carries each
buffer's `audioTime` across the hop to the main queue (see the OUT-4 comment there). Measure the
ring-out in **audio time**. Threading is unchanged (decay still mutates on the main thread, safe
for `@Published`); only the timestamp source changes from `Date()` to the carried `audioTime`, so
delivery jitter can no longer distort the measurement. Decay stays OUTSIDE `onRmsLevelChanged`'s
`isDetecting` guard (via its own `isTrackingDecay` self-gate) because the ring-out continues past
measurement completion.

`@parity dsp/decay tests=test/decay-tracking` — 3-way group (Swift canonical, Python, web). No file
adds/moves/renames → no slug/PARITY-MAP changes.

## Swift — DONE (pending build/test confirmation)

- `TapToneAnalyzer.swift`: `peakMagnitudeHistory` time field `Date`→`Double` (audio secs); new
  `var decayTapAudioTime: Double?`; removed the `$inputLevelDB`→`trackDecayFast` sink; added
  `trackDecayFast(inputLevel:audioTime:)` to the `rmsLevelHandler` main.async block; updated the
  setupSubscriptions doc block.
- `TapToneAnalyzer+DecayTracking.swift`: `startDecayTracking(tapAudioTime:)` (seeds history +
  `decayTapAudioTime`); `trackDecayFast(inputLevel:audioTime:)` (audio-time window filter, keys off
  `decayTapAudioTime`); `measureDecayTime(tapTime: Double)`; architecture doc rewritten.
- `TapToneAnalyzer+TapDetection.swift`: `handleTapDetection(...,audioTime:)`; call site passes
  `audioTime`; `startDecayTracking(tapAudioTime: audioTime)`.
- `GuitarTapTests/DecayTrackingTests.swift`: `makeHistory` + DK1–DK7 to `Double` audio time;
  DK6/DK7 `trackDecayFast(...,audioTime:)`; DK7 `lastTapTime`→`decayTapAudioTime`.
- `FilePlaybackRegressionTests.swift` REG_G golden: **UNCHANGED (0.0853, tol 0.03)** — the fixed
  run passes it as-is; the audio-time measurement equals the old wall-clock value in a quiet run
  (that's why isolation always matched), and is now *also* stable under load. No re-derivation.

**Swift verify: ✅ COMPLETE.** DecayTracking 7/7; FilePlaybackRegression 7/7; and the **FULL suite
372/372 passed under load** — REG_G stable (0.888 s), no longer flakes. (Before the fix the same
full-suite run was 372 with 1 failure = REG_G.) The audio-clock measurement is load-invariant.

## Python — DONE (full-suite verify pending)

Python already called `track_decay_fast` from `_on_rms_level_changed` (which has `audio_time`), so
it was structurally ahead — it just used `time.monotonic()`. Changes:
- `tap_tone_analyzer.py`: `peak_magnitude_history` doc → audio time; new `self.decay_tap_audio_time`.
- `tap_tone_analyzer_decay_tracking.py`: `start_decay_tracking(tap_audio_time)`,
  `track_decay_fast(input_level, audio_time)` (audio-time window + keys off `decay_tap_audio_time`),
  `measure_decay_time` doc, module doc, dropped unused `import time`.
- `tap_tone_analyzer_tap_detection.py`: `_handle_tap_detection(..., audio_time)`; caller passes it;
  `start_decay_tracking(tap_audio_time=audio_time)`; `track_decay_fast(..., audio_time)` in
  `_on_rms_level_changed`.
- Tests: `test_decay_tracking.py` (DK1–DK7 → audio-time doubles, new signatures,
  `decay_tap_audio_time`); `test_wi10_qtimer_slots.py` (5 `start_decay_tracking(100.0)` call sites).
- `last_tap_time` stays wall-clock for the COOLDOWN only (mirrors Swift) — untouched.

Verify: decay + qtimer + tap-detection tests 28/28 ✅. Full Python suite: ⏳ running.

## Web — NO CHANGE NEEDED (already correct)

`src/dsp/decay.ts` `DecayTracker` was already audio-clock based: `start(t, peakDb)` / `track(t, db)`
take audio time, and the caller feeds `this.audioElapsed` (sample-count ÷ rate) at
`realtimeFFTAnalyzer.ts:776,1014` — NOT `performance.now()` (that's only the liveness watchdog). So
the web already matches the fixed Swift/Python. `test/decay-tracking.test.ts` 10/10 ✅.

## Verify

- Swift: DecayTrackingTests green; REG_G green with new golden; hammer REG_G under full-suite load
  a few times to confirm it no longer flakes.
- Python + web decay tests green.
- USER run-review: live-capture a tap on a busy machine, confirm the ring-out number is stable.
