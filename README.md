# GuitarTap Web

Web port of the Swift GuitarTap app — third implementation alongside Swift
(canonical) and Python. See `PLAN.md` (overall plan), `INVENTORY.md` (the spec
extracted from Swift), and `PHASE2-DSP-HARNESS.md` (the headless DSP test plan).

## Status — Phase 2 (headless DSP) ✅ COMPLETE

Pure-TypeScript DSP core in `src/dsp/`, validated headlessly against the parity
oracle (40 tests). No UI yet (Phase 3).

| Gate | What | Status |
|---|---|---|
| G0 | WAV decode (native rate, no resample) | ✅ 4/4 fixtures |
| G1 | Gated FFT (GFFT1–5) | ✅ within ±1 dB (4 of 5 match Python <0.01 dB) |
| G2 | Peak pick + parabolic interp | ✅ count/vertex/Q exact |
| G3 | File playback (REG-G1/G2/B1/P1) | ✅ all 4 fixtures match (2–3+ dp) |
| G4 | Classification · pitch · material | ✅ classify (Top/Back overlap), pitch (note/cents), moduli/Gore/quality — all vs Python |
| G5 | Tap-detection decisions | ✅ level-crossing rules + onset indices + fixture tap counts |

Every numeric output meets the `PLAN.md` parity bar (2–3 dp) and every categorical
output (peak counts, mode labels, tap decisions, note names) matches exactly.

## Run

Requires Node ≥ 22.

```sh
npm install
npm test          # runs all gates (vitest)
npm run typecheck # tsc --noEmit
```

## Layout

```
src/dsp/        pure DSP (no Web Audio / DOM) — fft, gatedFFT, signal, wav
test/           vitest specs, one per gate
test/fixtures/  WAVs + UMIK-1 calibration + parity-oracle.json (vendored)
tooling/        sync-oracle.sh (pull the canonical oracle; --check for CI)
```

## Parity oracle

Expected values live in `test/fixtures/parity-oracle.json`, generated from the
canonical Swift run and **vendored** here. Refresh / verify with:

```sh
./tooling/sync-oracle.sh          # pull latest canonical
./tooling/sync-oracle.sh --check  # CI: fail if drifted from canonical
```

The web build never needs the Swift or Python repos on disk. See
`PHASE2-DSP-HARNESS.md` §4 for the sync model.
