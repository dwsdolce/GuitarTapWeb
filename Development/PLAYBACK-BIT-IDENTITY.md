# Replay does not bit-reproduce the original live capture

**Status: 📋 OPEN — characterised, cause not yet identified. Pre-existing; NOT caused by the
peak-finding fix (proven).**
_Opened 2026-07-19, from the peak-finding run-review automation._

Requirement (user): **replay of a WAV must produce the exact same results as the live capture that
generated it.** It currently does not, by a small amount. Re-run harness:
[playback-validation/](playback-validation/).

## The finding

Replaying a captured guitar WAV on the same platform reproduces the saved measurement **closely but
not bit-for-bit**:

| comparison | result |
|---|---|
| replay vs replay (same WAV, twice) | **0.000 dB — deterministic** |
| replay vs saved **live** capture, at the resonances (Air/Top/Back) | ≤0.003 dB |
| replay vs saved live capture, mean over the ≥−100 dB range | **~0.02 dB, 0 of 3702 bins exact** |
| replay vs saved live capture, deep noise floor (~19 kHz) | up to ~29 dB (near-silence bins) |

So the pipeline is deterministic run-to-run, and the **signal** reproduces to f32 precision, but
**every bin differs by a small amount** — the spectrum is shifted, not identical. Since the WAV
should contain the exact samples the live capture processed, identical samples through a
deterministic pipeline must give an identical spectrum. They don't — so the replay is not processing
the identical gated window the live capture did.

## Not caused by the peak-finding fix — PROVEN

The replayed spectrum (`frozenMagnitudes`, produced upstream of `findPeaks`) is **byte-identical with
and without the duplicate fix**, on all three platforms — verified by stash-and-fingerprint:

| platform | fingerprint sum | with vs without fix |
|---|---|---|
| Web | −3.954870332583e6 | identical to full float64 |
| Python | −3.954938892872e6 | identical |
| Swift | −3.956456521702e6 | identical |

`findPeaks` consumes the spectrum; it does not produce it, and our change provably does not alter it.
So this gap lives entirely in the capture/gating/averaging path we did not touch, and is safe to
treat as independent of the peak-finding work.

## Hypothesis (NOT confirmed — do not treat as fact)

The gated 400 ms FFT window lands on a slightly different **sample range** between the real-time live
path and the file-replay path — even though both anchor to the sample-level onset
(`TapToneAnalyzer+SpectrumCapture.swift`, "align the capture window to the sample-level tap onset").
Candidates to test:

- the dumped WAV is not bit-exact to the samples the live capture processed (extra content /
  re-encoding), so re-gating extracts a shifted window;
- the onset **detection** lands on a different sample between streaming (live) and whole-file (replay)
  input, shifting the window;
- an averaging-window count / boundary difference between the two paths.

Definitive check: compare the actual gated-window sample ranges (live vs replay), or verify the
dumped WAV is bit-exact to the captured samples.

## Related (do NOT edit that doc yet — user)

`MATERIAL-MULTITAP-DISCREPANCIES.md` §3 discusses the same *family* — FFT window position relative to
tap onset driving magnitude — for the Swift-vs-others material discrepancy (STATUS item, the
4800-frame buffer). That doc's line describing the **guitar** path as "chunk-triggered" looks stale
against the current sample-onset-aligned code, but **the user has asked to leave it untouched until
we review it together.** This item and that one are likely the same underlying window-alignment
question seen from two directions; confirm before merging them.

## Notes

- The two **iPhone captures are uncalibrated** (`calibrationName: None`, same UMIK-1 the mac/iPad
  calibrated with `7108913`) — a data-collection gap; to be recaptured. Not part of this item.
- Practical impact today is small: ~0.02 dB, harmless to the analysis. The one visible consequence is
  a near-threshold noise peak occasionally crossing the Peak Min gate between capture and replay
  (e.g. Swift single-tap replaying 48 peaks where the saved distinct set was 49).