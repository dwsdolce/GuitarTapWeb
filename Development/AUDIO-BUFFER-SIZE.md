# Audio buffer size — Swift's 4800-frame buffers leak into three measurements

**Status:** 📋 OPEN — analysed 2026-07-16 (two 3-app runs), **not blocking 1.0.2**. No code written.
**Why it's not a release blocker, and why it still matters (user, 2026-07-16):** a 0.1 Hz difference is
**not material in guitar making** — it changes no lutherie decision. It matters for **accuracy and
cross-platform trust**: the three editions must agree, and this is the one place they don't.
**Parity:** `@parity dsp/decay tests=test/decay-tracking` + the gated-capture / peak path.
**Related:** [DECAY-AUDIO-CLOCK-FIX.md](DECAY-AUDIO-CLOCK-FIX.md) — the audio-clock fix that *exposed*
this (it did not cause it).

## Root cause — one fact

**Swift's live audio buffers are 4800 frames (0.1 s @ 48 kHz), not the 1024 it requests.**
`installTap(bufferSize:)` is only a *hint* — CoreAudio decides, and 4800 is the macOS default. Python
(`chunksize=1024`) and web (AudioWorklet, `CHUNK = 1024`) genuinely get 1024.

Swift's own comment at `RealtimeFFTAnalyzer+EngineControl.swift:320-322` names the exact symptom:

> *"Using 1024 samples … This improves decay measurement precision from **~100ms** to ~23ms"*

…and the measured ring-out is **exactly 100 ms**, i.e. the request is not being honoured.

Everything downstream keys off the buffer grid: `audioElapsed += samples.count / actualSampleRate`
(`+FFTProcessing.swift:126`) advances by the **actual** size, the tap trigger fires on a buffer
boundary, and the session recording accumulates whole buffers.

## Three symptoms, one cause

| # | Symptom | Swift | Python / web |
|---|---|---|---|
| 1 | **Ring-out quantized** — level envelope sampled once per buffer | exactly **0.100 s** (1 × 4800) | 21.3 ms grid (n × 1024) |
| 2 | **Sub-bin peak shifts** — gated FFT window starts at *(trigger − preRollSamples)*; trigger is buffer-quantized | Air **97.262** → displays **97.3** | Air **97.223 / 97.224** → **97.2** |
| 3 | **WAV length quantized** — session recording accumulates whole buffers | **163200 = exactly 34 × 4800** | 1024-grid (n.75 × 1024) |

**The window mechanism (symptom 2).** The guitar window is seeded either from the level-crossing
pre-roll snapshot taken *at the crossing buffer* (fast-start) or from the live pre-roll (fallback,
`+SpectrumCapture.swift:583`), then the ring buffer is trimmed to a **fixed** `preRollSamples`
(`:261-264`). So the window is onset-**inclusive**, not onset-**anchored at sample resolution** —
despite the doc comment saying "aligned to the tap onset". Measured on the fixture: a 1024-grid trigger
fires at onset+151, a 4800-grid at onset+3287 → a **3136-sample window shift** → different samples in
the FFT → the parabolic interpolation moves a few hundredths of a Hz. A sensitivity probe puts a
few-thousand-sample shift at ~0.1–0.2 Hz of Air-peak movement — the right order for the observed
+0.039 Hz. *(Order-of-magnitude support, not proof — the probe could not pin the direction.)*

## Evidence — two 3-app simultaneous live captures (2026-07-16)

Swift, Python and web run **at once on the same Mac, same UMIK-1 tap**, so CoreAudio hands all three
the *identical* stream. **Proven identical**: pairwise normalised cross-correlation **1.000000**,
**lag 0**, same peak sample value. Every difference below is therefore algorithmic.

**Run 2** (matched settings + calibration — the good comparison):

| selected peak | python | swift | web | sw−py | displayed |
|---|---|---|---|---|---|
| Air | 97.22325 | **97.26205** | 97.22376 | **+0.039** | 97.2 / **97.3** / 97.2 |
| | 197.89697 | 197.90298 | 197.89694 | +0.006 | all 197.9 |
| | 409.54636 | 409.53574 | 409.54620 | −0.011 | all 409.5 |
| | 1180.60530 | **1180.67480** | 1180.60560 | **+0.070** | 1180.6 / **1180.7** / 1180.6 |
| **decay** | 0.08533 (4×1024) | **0.100 (4800)** | 0.064 (3×1024) | | |

**Web ↔ python agree to <0.001 Hz** — the control proving the method is sound and the audio identical.
Swift is the sole outlier.

**Run 1** (archived; mismatched settings) shows the *same* Swift offset — **this is not new**:
Air python 97.45350 / swift 97.55444 / web 97.51052 → sw−py **+0.101**, already displaying
97.5 / **97.6** / 97.5. It simply went unnoticed.

**Bonus finding — calibration shifts interpolated peaks.** In run 1 web was uncalibrated and sat
+0.057 Hz off python on Air; with calibration matched in run 2 web collapsed onto python (+0.0005 Hz).
Frequency-dependent bin gains tilt the parabola, so **calibration must match for any peak comparison**.
(It still cannot move ring-out — decay rides `levelDB`, a raw time-domain RMS that no platform
calibrates.)

**Ruled out:** physical tap variation (audio bit-identical); calibration as a decay factor; WAV
*format* (all three identical — 32-bit float, mono, 48 kHz; only length differs); the audio-clock fix
(it *exposed* the quantization by making timestamps exact instead of wall-clock-smeared).

## The fixes — three options, not interchangeable

**A. Re-chunk Swift's tap into fixed 1024-sample sub-chunks.** You cannot force CoreAudio, but you can
accumulate what it delivers and emit a fixed grid downstream. **One small change that retires all three
divergences** (ring-out onto the same 21 ms grid, trigger onto the same 1024 boundary so windows align,
WAV quantized alike). It does **not** improve resolution — it makes all three *consistently* coarse.
Worth doing on its own merits anyway: a 100 ms buffer is sluggish for tap detection and level metering.

**B. Compute ring-out from raw samples** (sliding-window RMS ~1 ms hop, or an exponential fit over the
post-tap region). Fixes decay **accuracy** (±21 ms → sub-ms) and is cadence-independent *by
construction* — even a 4800-buffer Swift agrees. Does not touch the FFT window.

**C. Anchor the gated FFT window to the detected onset _sample_**, not the crossing buffer. Fixes peak
alignment by construction, buffer-independent. Does not touch decay.

**B and C share the principle — _derive the measurement from the raw sample timeline, never the buffer
grid_ — but they are different code in different places. A is neither: it makes the grid uniform so the
divergence disappears without fixing either resolution.**

Suggested order: **A first** (small, low-risk, retires all three divergences + fixes input latency),
then **B** if ±21 ms on ring-out matters. **C** is optional once A lands — worth it only to stay robust
against a future buffer change.

Whatever lands must be 3-way with the `dsp/decay` tests, and REG_G's golden re-derived (the value will
change — and should finally become platform-independent).

**First step, cheap:** log `buffer.frameLength` in Swift's tap (and the gated window's start sample).
If it reads 4800, all three symptoms are confirmed as one bug.

## Verifying a fix — what a recording CAN and CANNOT do

**No new recording is needed for the algorithm work.** The dumped WAV *is* what the decay path consumes
— raw 32-bit-float PCM (calibration is FFT-bin only, so the time-domain samples the RMS sees are
exactly these). Tap onset ~1.83 s in a 3.4 s file leaves ~1.5 s of tail, far more than the ~40–100 ms
being measured.

| Question | Recording enough? |
|---|---|
| Does the new algorithm compute the right ring-out? | ✅ yes — compute a high-resolution ground truth from the raw samples |
| Is it **cadence-independent** (the real fix)? | ✅ yes — feed the *same* samples chunked at 1024 / 4800 / 512 / 777; a correct algorithm returns the **same number every time**. Decisive. |
| Does CoreAudio hand Swift 4800-frame buffers? | ❌ **no — live-only fact** |

**⚠ The trap:** the recording **cannot reproduce the live 4800 behaviour**. Swift's file playback
hardcodes `chunkSize = 1024` (`processFileData`), bypassing CoreAudio — so replaying the WAV makes the
0.100 s quantization (and the window shift) **disappear**. Don't conclude "fixed" from a playback run.

**Proof this is already happening:** a *shared cross-platform ring-out golden* already exists — Swift
REG_G and web `decay-tracking.test.ts` both assert `Recording 5.wav` decays in **~0.085 s**, and they
agree. That agreement is an **artifact of playback pinning both to 1024**, not evidence of a
cadence-independent algorithm. Green playback tests and a wrong live number coexist happily today.

## The fixture

**The 2026-07-16 files in `~/Documents/GuitarTap` are TRANSIENT** (run 1 is under `ARCHIVE/`) and will
disappear — the numbers above are recorded here precisely because the files won't survive.

**The recording to use is run 2** (matched settings + calibration). The user saves the final sets to
**`/Users/dws/src/GuitarTap/Tests/`** — that folder is **not** fixture storage, just where saved
measurement sets live. **Fixture storage is per implementation**, and a recording only moves there once
a regression test consumes it, copied under the *same filename* in all three (cf. `Recording 5.wav`):

| | fixture storage (only once a regression uses it) |
|---|---|
| Swift | `/Users/dws/src/GuitarTap/GuitarTapTests/` |
| Python | `/Users/dws/src/guitar_tap/tests/` |
| web | `/Users/dws/src/GuitarTapWeb/test/fixtures/` |