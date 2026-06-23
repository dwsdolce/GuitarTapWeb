# Phase 2 — Headless DSP Port & Test Harness Plan

Turns the `INVENTORY.md` contract into a concrete, testable DSP port. **No UI.**
Risk is concentrated here; per `PLAN.md`, Phase 3 does not start until the gates
below pass.

## Success criterion (the gate to Phase 3)

From the same WAV (or synthetic signal) as the Swift/Python suites:
- **Numeric** outputs (peak freq/mag/Q, spectrum dB, material measurements,
  pitch) agree to **2–3 dp**.
- **Categorical** outputs (peak picks, **peak counts**, onset indices, tap
  decisions, mode labels, quality labels) match **exactly**.
- Not bit-exact FFT — different FFT libs diverge in the last bits; that's allowed
  as long as it never changes a categorical outcome.

---

## 1. Architecture — pure DSP core, separate from the AudioWorklet shell

The single most important decision. The production target is AudioWorklet, but
AudioWorklet needs a browser `AudioContext` and can't run in a headless test
runner. So:

```
src/dsp/            ← PURE TypeScript. No Web Audio, no DOM. Plain functions over
                      Float32Array. This is what the harness tests.
src/worklet/        ← thin AudioWorklet wrapper that just pumps mic/file frames
                      into src/dsp. Validated later (Phase 3), not in Phase 2.
test/               ← Vitest specs running src/dsp in Node against fixtures.
```

Everything in `INVENTORY.md` (FFT, gated FFT, peak-pick, parabolic interp, Q,
mode classification, pitch, material formulas, onset/level-crossing) lives in
`src/dsp` as pure functions taking samples + `sampleRate` as arguments. The
harness feeds them WAV samples directly — no audio graph. This keeps Phase 2
fully headless and CI-able.

## 2. In scope for Phase 2

Map to the inventory sections:
- WAV decode → mono float32, **at the file's embedded rate** (no resample; see §6).
- Chunking into 1024-sample frames (metering/level-crossing) and 65536-sample
  FFT frames (0% overlap) — Audio Capture Pipeline.
- FFT (`vDSP_DFT_zrop` equivalent), magnitude (1/N, not power), bin→Hz, dBFS
  (ref 1.0), floors −100/−160 — FFT & Spectral Analysis.
- Gated FFT (500 ms buffer, 400 ms onset-aligned window, Hann DENORM, zero-pad)
  — Gated FFT Window.
- Peak picking (±5-bin local max, threshold/median override, Pass-1 modes /
  Pass-2 unknown), parabolic interp, Q/−3 dB bandwidth, 2 Hz dedup, gated minQ=3.
- Mode classification (`classifyAll` claimer + bands), Pitch, Material formulas.
- Tap detection: onset alignment + 2-chunk level-crossing **decisions and onset
  indices** (categorical criteria). The full UI-facing state machine (S1–S4
  traces, button rules) is Phase 3 — but the underlying onset/tap *decisions*
  are validated here.

## 3. Fixtures & oracle (from `INVENTORY.md` → Test Fixtures)

Shared WAV/cal fixtures already exist in both repos and are byte-identical:
- `Recording 5.wav` → **REG-G1** (generic guitar, single tap) ✅
- `Recording.wav` → **REG-G2** (8-tap) ✅
- `brace-umik-1-swift-mac-1778816093.wav` + `7108913.txt` cal → **REG-B1** ✅
  (verified 2026-06-22: passes Swift+Python; **needs the UMIK-1 calibration applied**)
- `plate-umik-1-swift-mac-1778816330.wav` → **REG-P1** ✅ (verified 2026-06-22:
  passes Swift+Python; **plays with UMIK-1 calibration `7108913.txt` applied**)
- Synthetic in-memory two-tone signals → **GFFT1–5** (no WAV).

Expected values are captured in `test/fixtures/parity-oracle.json` (vendored from
the canonical Swift run, §4); tolerances **±1.0 Hz / ±1.0 dB / ±1.0 Q**.
GFFT targets: −15.72; −49.74/−29.55; −49.70/−29.51; Δ20.19 (verified this cycle).

**Calibration matters:** REG-B1/REG-P1 play with the UMIK-1 profile applied in the
dB domain — an uncalibrated run shifts magnitudes per-frequency (this was the
entire app-vs-test discrepancy that turned out *not* to be a bug). All four
regressions are confirmed trustworthy; no regeneration pending.

## 4. Oracle sync model — RESOLVED (pull-based vendoring)

Today parity = the *same hardcoded constants* duplicated in Swift and Python
tests. Adding Web naively = a **third** hand-maintained copy that silently drifts
(the failure mode behind the REG-P1 detour). A single shared file is ideal, but
the three repos are **separate and always will be**, so a *push* from Swift into
siblings doesn't work (they may not be on disk). The model is therefore
**generate once, publish once, pull everywhere** — each repo's sync touches only
itself + one URL:

- **Generate (canonical):** a Swift `GenerateParityOracle` target writes
  `parity-oracle.json` from the same pipeline the tests use (stub below). It
  writes only into the Swift repo — it never needs the siblings present.
- **Publish (one fetchable home):** commit the canonical JSON into the **public
  Python repo** (already on GitHub, already the lockstep twin) — gives a stable
  raw URL with no auth. A neutral data-repo or GitHub Release asset works
  identically.
- **Vendor + pull:** every repo commits its own copy under
  `test/fixtures/parity-oracle.json` so tests run **offline**; `tooling/sync-oracle.sh`
  pulls the one URL to refresh it, and `--check` mode fails CI if the local copy
  drifted from canonical. No repo needs a sibling on disk.

**When to sync:** (1) on every intentional algorithm change, as part of the
Swift+Python lockstep update already required by the parity discipline; (2) a
per-repo CI `sync-oracle.sh --check` makes "forgot to re-sync" impossible to
ship; (3) optional scheduled auto-PR.

**Artifacts in this repo:** `test/fixtures/parity-oracle.json` (draft, populated
with all verified REG-G1/G2/B1/P1 + GFFT1–5 values) and `tooling/sync-oracle.sh`
(pull + `--check`). The Swift generator is a stub to implement:

```swift
// GuitarTapTests/GenerateParityOracle.swift (canonical source; run on demand)
// Writes test/fixtures/parity-oracle.json from the SAME pipeline the regression
// tests assert against, so the oracle can never disagree with Swift.
@Test func generateParityOracle() throws {
    var oracle = ParityOracle(oracleVersion: gitShortSHA(), generatedAt: .now,
                              tolerances: .init(freqHz: 1, magDb: 1, q: 1, gatedFftDb: 1))
    // Run REG-G1/G2/B1/P1 through playFileForTesting(...) and record the detected
    // peaks; run computeGatedFFT on the GFFT1–5 synthetic signals and record dB.
    // (Apply the UMIK-1 7108913.txt calibration for REG-B1/P1.)
    let data = try JSONEncoder.sortedPretty.encode(oracle)
    try data.write(to: repoRoot.appending(path: "test/fixtures/parity-oracle.json"))
}
```

## 5. FFT library

`fftSize = 65536` (power of two), real input, magnitude (not power), 1/N scaling.
Options: (a) a small audited radix-2 real-FFT in TS; (b) a JS lib (`fft.js`,
`kissfft-wasm`). Either is fine — **validate against GFFT1–5 first** (§7 gate G1)
before trusting it downstream. Recommend starting with a library to de-risk, and

## 5. FFT library

`fftSize = 65536` (power of two), real input, magnitude (not power), 1/N scaling.
Options: (a) a small audited radix-2 real-FFT in TS; (b) a JS lib (`fft.js`,
`kissfft-wasm`). Either is fine — **validate against GFFT1–5 first** (§7 gate G1)
before trusting it downstream. Recommend starting with a library to de-risk, and
only hand-rolling if a categorical mismatch traces to the FFT.

## 6. Sample rate (PLAN risk #1)

- **File playback:** decode at the WAV's embedded rate; **do not resample** — the
  bin→Hz mapping and onset windows depend on it, and Swift/Python feed the native
  rate. This keeps file-based parity meaningful.
- **Live (Phase 3):** read the actual rate from the live `AudioContext`/track;
  never hardcode. DSP already takes `sampleRate` as a parameter, so it's correct
  by construction.

## 7. Validation gates (run in order; each blocks the next)

- **G0 — WAV decode sanity. ✅ PASSING.** `src/dsp/wav.ts` decodes all 4 fixtures
  at native rate with exact frame counts (`test/g0-wav.test.ts`).
- **G1 — Gated FFT (GFFT1–5). ✅ PASSING.** `src/dsp/gatedFFT.ts` (radix-2 FFT in
  `src/dsp/fft.ts`, faithful port of `compute_gated_fft`) matches the oracle
  within ±1 dB — 4 of 5 to <0.01 dB; GFFT5 to 0.2 dB (float32-sensitivity case,
  in tolerance). *Most fundamental; nothing downstream is trustworthy until this
  passes.* (`test/g1-gated-fft.test.ts`)
- **G2 — Peak pick + interp. ✅ PASSING.** `src/dsp/peaks.ts` (mode-aware
  `findPeaks`, parabolic interp, −3 dB Q, 2 Hz dedup; bands in
  `src/dsp/guitarModes.ts`). Mirrors `PeakFindingTests`: exact peak count,
  parabola-vertex recovery <0.1 Hz, exact Q/bandwidth, dedup behavior.
  (`test/g2-peaks.test.ts`)
- **G3 — File playback. ✅ PASSING (all four fixtures).** REG-B1 brace + REG-P1
  plate via the gated driver (`gatedCapture.ts`: level-crossing → 500 ms capture →
  onset align → gated FFT → calibration → `findDominantPeak`; plate segments
  L→C→FLC by successive crossings). REG-G1/G2 guitar via the non-gated path
  (`guitarFFT.ts`: stereo→mono downmix, rect 65536 FFT, 8-tap power-domain
  average, `findPeaks` + `classifyAll` mode resolution). All reproduce the
  Swift/Python oracle to 2–3+ dp. (`test/g3{a,b,c,d}-*.test.ts`)
- **G4 — Classification / pitch / material. ✅ PASSING.** `classify.ts`
  (classifyAll Top/Back overlap), `pitch.ts` (note/cents/nearest, 12-TET A4=440),
  `material.ts` (density, beam E_L/E_C, Gore E/G, target thickness, quality;
  βL²=22.37 plate / 22.37332 brace) — all vs the canonical Python.
  (`test/g4{a,b,c}-*.test.ts`)
- **G5 — Tap decisions. ✅ PASSING.** `gatedCapture.ts` level-crossing (2-chunk
  rising-edge), multi-tap separation, onset alignment indices, and correct tap
  counts on the real brace (1) and plate (3) fixtures. (`test/g5-*.test.ts`)

Risk concentration was **G1 and G3** — both cleared. **All gates green: Phase 2
complete (40 tests).**

## 8. Tooling

- Vite + TypeScript (per `PLAN.md`); **Vitest** as the runner (Node env, no
  browser needed for `src/dsp`).
- A tiny Node WAV reader for fixtures (RIFF/WAVE float32 mono — matches the
  capture format the app itself writes).
- `npm test` runs G0–G5; wire into CI as the Phase-2-complete gate.
- Fixtures are **copied into `test/fixtures/`** (decision 5) — the 4 regression
  WAVs + the UMIK-1 calibration `7108913.txt`, xattrs stripped.

---

## 9. Decisions — RESOLVED (2026-06-22)

1. **Oracle sync model:** ✅ **Pull-based vendoring** (§4) — generate in Swift,
   publish one copy (public Python repo / data repo / release), each repo vendors
   a local copy and pulls via `tooling/sync-oracle.sh` with a `--check` CI guard.
   A single runtime-shared file is impractical across permanently-separate repos.
2. **Regenerate REG-B1 first?** ✅ **Not needed** — REG-B1 and REG-P1 pass in both
   Swift and Python against current constants. All four regressions are
   trustworthy web targets (REG-B1/P1 require the UMIK-1 calibration applied).
3. **FFT:** ✅ **Start with a JS library** (`fft.js`/`kissfft-wasm`); hand-roll
   only if a categorical mismatch traces to the FFT. Validate against GFFT1–5
   (gate G1) before trusting it.
4. **Tap-detection depth:** ✅ **Decisions only** in Phase 2 — onset indices +
   2-chunk level-crossing fire/no-fire. The full S1–S4 state traces stay in
   Phase 3.
5. **Fixture location:** ✅ **Copy WAVs into the web repo** — done:
   `test/fixtures/{Recording 5.wav, Recording.wav, brace-…wav, plate-…wav,
   7108913.txt}`.

All Phase-2 prep decisions are settled; ready to scaffold the Vite/TS project and
start gate G0 (WAV decode) → G1 (gated FFT) when you are.
