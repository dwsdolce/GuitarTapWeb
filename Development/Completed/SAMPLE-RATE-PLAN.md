# Plan: record & check capture sample rate (all 3 platforms)

**Status: ✅ COMPLETE all three (verified 2026-07-08).** Swift ✅ · Python ✅ (368 tests pass) ·
Web ✅ — `sampleRate` `.guitartap` I/O + the tiered load-time warning (mic → calibration/rate) are
implemented, and the orphaned `EXPECTED_SAMPLE_RATE` constant (+ its two stale comments) has been
removed from `src/audio/engine.ts`. Transient working doc — lives in GuitarTapWeb but the work spans
**Swift (canonical) → Python (mirror) → web**.

### Done in Swift + Python
- `sampleRate` (Double/`float|None`) added to the measurement model next to mic
  provenance; JSON key **`sampleRate`**; encoded only when present; missing → nil/None
  (backward compatible). Round-trip + missing-field tests added both sides.
- Save populates it from the analyzer's actual rate (Swift `fft.actualSampleRate`;
  Python `analyzer.mic.rate`).
- **Tiered load warning** (reuses the single `microphoneWarning` path): mic mismatch →
  mic-only message; same mic → reports differing **calibration** and/or **sample rate**
  (added the calibration check that didn't exist before).
- **Bonus bug fix (found while testing):** loading a guitar measurement while the prior
  type was plate/brace left the spectrum blank. Cause: the guitar load branch never set
  `materialTapPhase = .complete`, so a display race-guard stayed armed. Fixed in both
  Swift and Python (set complete on guitar load).
- **Python harness fix:** `test_file_playback_regression` fixtures now derive the rate
  from the WAV (`_wav_rate(...)`) instead of hardcoding `48000` (Swift already did via
  `forTesting()` + the played file).

### Docs — done
Manual (shared, in Swift `Documentation/Manual/`): ch08 §8.2 gained a **Capture
sample rate** subsection (how to set it — macOS Audio MIDI Setup / Windows / Linux —
and why it matters); Appendix B documents the `sampleRate` field; ch10 §10.7 adds
troubleshooting rows for the load-time calibration/sample-rate warning and "a fresh
tap doesn't match a saved measurement."

### Remaining
- ~~**Web Phase 4:** `sampleRate` in `.guitartap` I/O + the tiered load warning; remove the
  orphaned `EXPECTED_SAMPLE_RATE` constant.~~ **✅ DONE (2026-07-08).**
- Swift tiered-warning unit test (needs a mock input device — approach TBD; **optional**, not blocking).

## Problem

A `.guitartap` measurement records the microphone used, but **not the sample rate**.
If a user loads a measurement and then takes a *new* tap at a different rate (or with
a different mic/calibration), the new result won't match the saved one even with an
identical physical setup — a **confusion** issue, not an accuracy/error one. Fix:
record the rate, and warn at load time when the current setup differs.

## Confirmed decisions

1. **One sample rate per measurement** (not per snapshot/phase) — measurement-level
   provenance.
2. **Where it lives & how matching works:** alongside the existing microphone
   provenance on `TapToneMeasurement` (`microphoneName`, `microphoneUID`,
   `calibrationName`). Today the mic is matched **by UID, fallback to name**; there is
   **no calibration check** (add one — name is sufficient) and no rate check (add).
3. **Tiered, tailored warning, reusing the existing alert** (the single
   `microphoneWarning` path — one place to test and to compose the message):
   - **Microphone doesn't match** (UID, then name) → message names the microphone
     only; nothing else is mentioned.
   - **Microphone matches** → check **calibration name** and **sample rate**; message
     lists whichever differ (**calibration, sample rate, or both**).
4. **Live capture:** no warning — use whatever the system delivers (already the case).
   **No global expected/preferred rate** anywhere.
5. **Backward compatible:** missing rate (and the existing optional mic fields) → load
   succeeds, no warning. Uses the existing optional/legacy-decode pattern.
6. **Tests never hardcode 48 kHz** — derive the rate from the source (WAV/measurement).

## Grounding (verified in the Swift sources)

- `TapToneMeasurement` already has a Microphone Provenance block (all optional):
  `microphoneName`, `microphoneUID`, `calibrationName` (`TapToneMeasurement.swift`
  ~229-238; CodingKeys ~276; `decodeIfPresent`/`encodeIfPresent` ~508-561). Add
  `sampleRate` here.
- Existing match + warning: `TapToneAnalyzer+MeasurementManagement.swift` ~375-397
  (import) and the `loadMeasurement` path ~715-722 set `microphoneWarning`
  ("…not currently connected…"). This is the single place to extend into the tiered
  message above.
- Backward-compat decode pattern already tested:
  `MeasurementCodableTests.snapshot_legacyArrayFormat_decodesCorrectly` /
  `test_measurement_codable.test_legacy_plain_array_format_decoded`.
- **Test-harness divergence to fix:** file-playback regression derives its rate
  differently — Swift `TapToneAnalyzer.forTesting()` takes it from the WAV; **Python**
  hardcodes `for_testing(sample_rate=48000)`; web reads `wav.sampleRate`. Python is the
  outlier → switch Python to WAV-derived.
- Confirmed **no current test** pairs a loaded `.guitartap` with new capture at a
  different rate (ComparisonMode is saved-vs-saved; FrozenPeakRecalculation is dB/Hz on
  the frozen spectrum), so existing processing tests are unaffected by the new field.

---

## Per-platform work

### 1. Swift — `/Users/dws/src/GuitarTap` (canonical, first)
- **Model:** add `sampleRate: Double?` to `TapToneMeasurement` provenance block;
  CodingKeys + `decodeIfPresent`/`encodeIfPresent` (canonical JSON shape).
- **Save:** populate from the analyzer's actual capture rate.
- **Load/match (the one place):** in the `microphoneWarning`-generating code, implement
  the tiered check — mic (UID→name); if matched, compare `calibrationName` and
  `sampleRate`; compose a message naming exactly the mismatched item(s). Also add the
  **calibration** comparison that doesn't exist today.
- **Tests:** `MeasurementCodableTests` — round-trip `sampleRate` + a missing-field case;
  new paired test(s) for the tiered warning (mic-only / calibration / rate / both).
  FilePlayback unchanged (already WAV-derived).
- **Docs/manual:** macOS Audio MIDI Setup + *why it matters* (results match the
  reference apps / intended resolution at the recorded rate).

### 2. Python — `/Users/dws/src/guitar_tap` (mirror)
- **Model + serialization:** mirror the field, matching Swift's JSON encoding
  (numeric; respect the f32/int conventions already used for floats).
- **Load/match:** mirror the tiered warning (+ calibration check).
- **Tests:** mirror codable round-trip + missing-field + tiered-warning tests;
  **fix the harness** — FilePlaybackRegression derives the rate from the WAV instead of
  `for_testing(sample_rate=48000)`.
- **Docs:** mirror.

### 3. Web — `/Users/dws/src/GuitarTapWeb` (Phase 4, last)
- When `.guitartap` read/write lands: include `sampleRate` in the model +
  (de)serialization (parity with Swift JSON; missing → `undefined`).
- Implement the same tiered load-time warning (mic → calibration/rate) in the load flow.
- Port the codable + tiered-warning tests; playback harness already WAV-derived.
- **Now (small, web-only cleanup, safe):** remove the orphaned `EXPECTED_SAMPLE_RATE`
  constant in `src/audio/engine.ts`.
- Manual/README note.

## Sequencing
Swift (model → save → load-warning + calibration check → tests → docs) → Python mirror
(incl. harness fix) → Web Phase 4. Update the `.guitartap` format-parity record so all
three stay in lockstep.

## Tiered warning message (shared spec for all 3)

```
match mic by UID, else by name:
  if no mic match:
     warn: "<recorded mic> … (not the current microphone)"   // mic only
  else (same mic):
     diffs = []
     if recorded.calibrationName != current.calibrationName: diffs += "calibration"
     if recorded.sampleRate      != current.sampleRate:      diffs += "sample rate"
     if diffs not empty:
        warn: "Recorded with a different <join(diffs, " and ")> …"
```
(Existing "mic not connected" wording stays for the not-available case; the new
same-mic branch adds calibration/rate.)