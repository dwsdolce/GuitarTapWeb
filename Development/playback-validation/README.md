# Playback validation harness (manual — NOT part of any test suite)

Automates a **run-review**: replay each captured guitar WAV through the full capture→analysis
pipeline on its own platform and compare the computed analysis to the values saved in that
measurement's `.guitartap`. Built during the peak-finding duplicate fix
([PEAK-FINDING-DUPLICATE-PEAKS.md](../PEAK-FINDING-DUPLICATE-PEAKS.md)) to validate it end-to-end
from real audio, and to characterise the live-vs-replay bit-identity gap
([PLAYBACK-BIT-IDENTITY.md](../PLAYBACK-BIT-IDENTITY.md)).

**These are deliberately kept out of the vitest/pytest/XCTest suites** — they are slow, need the
WAV corpus, and are diagnostics, not regressions. Run them by hand when revalidating.

## Corpus (source of truth — not copied here)

All WAV + `.guitartap` pairs live in `/Users/dws/src/GuitarTap/Tests/All Platforms/`. Every script
reads from there directly, so nothing here duplicates the audio. Ten guitar files: 6 Swift
(mac/iPad/iPhone × single+3-tap), 2 Python, 2 web. Each is replayed with the calibration named in
its own file (`7108913` for eight; the two iPhone files were captured **uncalibrated** — cal=None).

## Files

| file | platform | what it does |
|---|---|---|
| `corpus_python.py` | Python | replay all python files, report Air/Top/Back winner Δ vs saved + duplicate check |
| `corpus_web.ts` | web | same, web files |
| `swift/PeakPlaybackReportTests.swift` | Swift | same, all 6 swift files (needs bundle setup — see below) |
| `fingerprint_python.py` / `spectrum_fingerprint.ts` | Py / web | fingerprint the replayed spectrum (proof it is independent of the findPeaks change) |
| `swift/PeakSpectrumFingerprintTests.swift` | Swift | same, Swift |
| `replay_determinism.ts` | web | replay-vs-replay (deterministic, 0.000 dB) vs replay-vs-saved-live |
| `floor_char.ts` | web | characterises the live-vs-replay difference by dB region |
| `ref_winners.json` | — | saved Air/Top/Back winners + per-file settings; regenerate with the snippet in this README |

## Running

**Python** (from the `guitar_tap` repo, venv active):
```
./.venv/bin/python <path>/corpus_python.py
./.venv/bin/python <path>/fingerprint_python.py
```

**Web** (from the `GuitarTapWeb` repo):
```
npx vite-node Development/playback-validation/corpus_web.ts
npx vite-node Development/playback-validation/spectrum_fingerprint.ts
```

**Swift** — `playFileForTesting` is `@testable`, so the Swift diagnostics must run inside the test
target. To run them:
1. Copy `swift/PeakPlaybackReportTests.swift` (and/or `PeakSpectrumFingerprintTests.swift`) and
   `ref_winners.json` into `GuitarTap/GuitarTapTests/`.
2. Copy the 6 swift WAVs from `Tests/All Platforms/` into `GuitarTapTests/` (bundle resources), plus
   `7108913.txt` from `Tests/` if not already present.
3. `xcodebuild test -scheme guitar_tap -destination 'platform=macOS' -only-testing:GuitarTapTests/PeakPlaybackReportTests`
4. **Remove those copies afterwards** so they don't join the suite.

## Regenerating `ref_winners.json`

Run against the Python classifier over the saved peaks (from the `guitar_tap` repo):
```python
# classify each saved file's peaks, take the strongest per named mode → {stem: {cal,taps,peakMin,tapThr,winners,savedPeaks}}
# see PEAK-FINDING-DUPLICATE-PEAKS.md history; the generator is a ~20-line loop over Tests/All Platforms.
```

## What it established (2026-07-19)

- **Duplicate fix validated end-to-end on all 10 files, all 3 platforms**: no duplicate peaks, every
  named resonance reproduced to ≤0.003 dB.
- **Replay is deterministic** run-to-run (0.000 dB).
- **Replay does NOT bit-reproduce the original live capture** (mean ~0.02 dB across the ≥−100 dB
  range, 0 exact bins) — a pre-existing capture/gating issue, [PLAYBACK-BIT-IDENTITY.md](../PLAYBACK-BIT-IDENTITY.md).
- The spectrum is **byte-identical with and without the findPeaks change** (proven by stash-and-fingerprint
  on all 3), so the fix is decoupled from that gap.
- The two **iPhone captures are uncalibrated** (cal=None with the same UMIK-1 the mac/iPad calibrated) —
  to be recaptured.