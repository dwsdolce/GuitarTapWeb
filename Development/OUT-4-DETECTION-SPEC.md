# OUT-4 — Material tap detection: give the web the relative noise-floor model

**Status: SPEC for review. No code written.** Detail doc for STATUS item 4 (the last open OUT-*).

**Decision (user):** port Swift/Python's **relative noise-floor** detection to the web. The deciding
argument is **field evidence, not canonicality** — the relative path has had beta testing and real use;
the web's absolute-dBFS path has had none.

---

## 1. The canonical algorithm

From `TapToneAnalyzer+TapDetection.swift:135-170` (Python `tap_tone_analyzer_tap_detection.py:88-110`
mirrors it exactly).

```swift
useRelativeDetection = (measurementType == .plate || measurementType == .brace)   // guitar stays ABSOLUTE

// EMA the noise floor from every below-threshold chunk (tap energy must not inflate it).
// Runs during warm-up too — "the most valuable time, since no taps have occurred yet".
if useRelativeDetection && !isAboveThreshold {
    noiseFloorEstimate = α * peakMagnitude + (1 - α) * noiseFloorEstimate
}

if useRelativeDetection {
    headroom      = max(tapDetectionThreshold - noiseFloorEstimate, 10.0)
    risingThresh  = noiseFloorEstimate + headroom
    fallingThresh = noiseFloorEstimate + max(headroom - hysteresisMargin, 4.0)
} else {
    risingThresh  = tapDetectionThreshold                    // guitar
    fallingThresh = tapDetectionThreshold - hysteresisMargin
}
```

**Constants:** `noiseFloorEstimate` initial **−60 dBFS** · `noiseFloorAlpha = 0.05` ·
`warmupPeriod = 0.5 s` · default `tapDetectionThreshold = −45 dBFS`.

### The identity that matters

The relative rising threshold reduces algebraically to:

> **`rising = max(tapDetectionThreshold, noiseFloor + 10 dB)`**

So **the relative model IS the absolute model** until the noise floor climbs within 10 dB of the
threshold. It is not a different detector — it is a *floor* under the detector. This single fact
explains everything below, including why no test has ever been able to see this divergence.

### Which detector the rule governs

Swift has two tap paths, and only one of them is relative:

| path | threshold | role |
|---|---|---|
| **main-thread `detectTap`** (FFT `peakMagnitude`) | **relative** for material | **decides detection** → `handleTapDetection` → `handlePlateTapDetection` |
| audio-queue **level-crossing** (`levelCrossingThreshold = tapDetectionThreshold`) | **absolute** | snapshots the **pre-roll** so the gated window has pre-onset audio. For material it is armed **only during file playback** (`isFilePlateBrace = isPlayingFile && phase != nil`) |

So the web must put the relative rule in its **detection decision**, not in a pre-roll mechanism. The
comment at `TapToneAnalyzer.swift:308` ("so the pre-roll snapshot fires at the same level as the
main-thread detector") is **stale** — for material the two deliberately differ. Fix it in this change.

### ⚠ `detectTap(peakMagnitude:)` is MISNAMED — rename it

```swift
func detectTap(peakMagnitude: Float, magnitudes: [Float], frequencies: [Float])   // the name
func onRmsLevelChanged(_ levelDB: Float) { detectTap(peakMagnitude: levelDB, …) } // what material passes
```

For **plate/brace** the parameter is fed the **RMS input level** (`inputLevelDB`, the ~43 Hz fast path),
NOT an FFT peak magnitude. Only the *guitar* path (`analyzeMagnitudes`, ~0.7 Hz) passes a true FFT peak.
The name cost real time during this spec — it looked like Swift and the web were detecting on entirely
different signals (FFT-peak vs RMS), which would have been a far larger divergence than OUT-4. They are
not: **for material, all three detect on the same quantity — the chunk RMS level.**

**Rename it to `level` / `levelDB`** (and rename the local `peakMagnitude` uses inside `detectTap`),
so the next reader is not sent down the same blind alley. Python mirrors the same naming and should be
renamed with it.

**Confirmed same across all three** (so the comparison is apples-to-apples):
- signal: chunk **RMS** dBFS — web `20*log10(rms)`; Swift `inputLevelDB` → `detectTap`
- default threshold: **−40.0** (`defaultTapDetectionThreshold` / `DEFAULT_TAP_DETECTION_THRESHOLD` / web config)
- rate: web 1024 samples @48 k = 21.3 ms; Swift RMS path ≈ 43 Hz = 23 ms

---

## 2. What the web has, and what is missing

`realtimeFFTAnalyzer.ts:843` — the entire current detector:

```ts
private detectTap(levelDb: number): void {
  const above = levelDb > this.config.tapDetectionThreshold   // ONE absolute threshold, all modes
  ...2-chunk confirmation via prevAbove / consecutive...
}
```

Missing, in order of importance:

1. **No noise-floor EMA** — nothing tracks the ambient level.
2. **No relative threshold for material** — plate/brace use the same absolute compare as guitar.
3. **No hysteresis at all — FOLDED INTO OUT-4 (user decision).** Swift and Python both carry a
   *falling* threshold; the web carries none.

   | | value |
   |---|---|
   | Swift | `let hysteresisMargin: Float = 3.0` |
   | Python | `self.hysteresis_margin: float = 3.0` |
   | **Web** | **absent** — only `CONFIRM_CHUNKS = 2` |

   Falling threshold is `tapDetectionThreshold − 3.0` (guitar) and
   `noiseFloor + max(headroom − 3.0, 4.0)` (material). The web's single `levelDb > threshold` compare
   has no rising/falling separation at all, so it has **no hysteresis in GUITAR mode either** — this is
   not a material-only gap. It was once user-settable and was fixed to a constant; the fossil is still
   visible in `encode.ts` ("no hysteresisMargin/maxPeaks" — the `.guitartap` format used to persist it).
   **The web needs it. Folded into this change.**
4. **No settling window.** Swift's warm-up (0.5 s) suppresses detection while the EMA converges.
   *(Note: Swift SKIPS warm-up during file playback — "deterministic file audio" — so the settling
   window is a LIVE-use concern and must not change file-playback behaviour.)*

---

## 3. Proposed web design

**The EMA lives on the device** (`RealtimeFFTAnalyzer`), not the analyzer: it must see *every* audio
chunk, including those the analyzer never hears, and that is exactly where Swift computes it (inside
`detectTap`, off the FFT frame). The device already owns `detectTap`.

- Add `noiseFloorEstimate` (init −60) + `NOISE_FLOOR_ALPHA = 0.05` to the device.
- Add `HYSTERESIS_MARGIN = 3.0` and **`isAboveThreshold` hysteresis state**. The web's `prevAbove` is
  NOT this: `prevAbove` is edge-detection state (last chunk's compare), whereas Swift's
  `isAboveThreshold` is *latched* — it goes true on the rising threshold and false only on the (lower)
  falling threshold. Both are needed, and they are different variables.
- Hysteresis applies to **guitar as well as material** (see §2 item 3) — guitar's falling threshold is
  `tapDetectionThreshold − 3.0`. Do not scope this to material.
- `detectTap` computes `rising`/`falling` per the formulas above, keyed on measurement type
  (the device already knows the mode via `captureKind` / `materialSearch`).
- Keep the existing 2-chunk confirmation (`CONFIRM_CHUNKS`) — that is already canonical.
- **Settling window:** suppress detection for `warmupPeriod` after arming, while still running the EMA.
  Must be **silent** (no `statusMessage` writes) — that is the OUT-1 lesson, and it is why the OUT-1
  coupling is defused: the warm-up exists, it just no longer owns the status.
- **Skip the settling window during file playback**, as Swift does, or file-playback results change.

**Guitar keeps the ABSOLUTE rising threshold** (unchanged, canonical) — but it **does** gain the falling
threshold / hysteresis, which it never had. That is a behaviour change in guitar mode and must be
run-reviewed as such.

---

## 4. Validation — ⚠ REWRITTEN AFTER EMPIRICAL TESTING. READ THIS FIRST.

**The headline: file playback runs ABSOLUTE detection on all three platforms, deliberately. The
relative noise-floor model has NEVER been exercised by any regression test, on any platform.**

`TapToneAnalyzer+Control.swift:186` (and Python `control.py:651`):

```swift
// ... mic ambient noise must not influence file playback.
// For live mic, seed from the current ambient level.
noiseFloorEstimate = skipWarmup ? -100.0 : fftAnalyzer.inputLevelDB
```

`skipWarmup` **is** file playback. And pinning the floor to −100 makes the relative rule *degenerate
into the absolute one*:

```
headroom = max(T − (−100), 10) = T + 100
rising   = −100 + (T + 100)   = T          ← identically tapDetectionThreshold
```

So during playback Swift and Python ARE the web. That — not quiet fixtures — is the real reason no test
has ever been able to tell the two models apart.

### What was tried, and what it proved (all against the REAL engines, not simulation)

1. **A noisy fixture DOES break the web.** Mixing broadband noise into `plate-umik-1-swift-mac` to lift
   the floor to −52 dBFS (above the −53.34 threshold) makes the web's absolute detector **saturate**:
   `above` is permanently true → `prevAbove` never falls → `consecutive` never seeds → **0 of 3 phases
   captured** (clean control: 3/3). The web doesn't mis-count in a noisy room — it goes *blind*.
2. **But the canonical model fails the same fixture** (Python: 1/3), for the reason above — in playback
   its floor is pinned to −100, so it is running the same absolute detector.
3. Guarding the −100 sentinel in the EMA/re-anchor does **not** help: the value is set deliberately in
   `startTapSequence(skipWarmup:)`, not accumulated by accident.

**Conclusion: the file-playback harness cannot validate OUT-4 as the canonical code stands.** The
earlier claim in this spec that it could was wrong, and is left above only as history.

### Measurements worth keeping (real detection domain: per-1024-chunk RMS dBFS)

| | floor | taps (chunk-RMS) | usable noise window |
|---|---|---|---|
| **plate** (3 real taps: L, C, FLC) | −77.5 | −26.9 / −24.0 / −27.3 (2nd chunks −36.0 / −32.6 / −32.6) | **17.3 dB** — viable |
| **brace** (1 tap) | −76.6 | −47.8, and it clears −52 for only **one** chunk | **0.8 dB** — NOT viable |

Brace is the realistic low-headroom case, but its tap decays so fast that `CONFIRM_CHUNKS = 2` pins the
rising threshold at ≤ −52.5, which collides with the divergence boundary. **Plate is the only viable
fixture.** (REG-B1 today passes with exactly two chunks of margin — it is already on the edge.)

Also worth knowing: stationary broadband noise has a chunk-RMS standard deviation of only **0.19 dB**
(σ = 8.686/√2N), so it is effectively a constant and can never *false-trigger* a threshold above its
mean. The failure mode is **saturation**, not spurious triggering.

### ✅ RESOLVED — playback must run the LIVE detection path (user's call)

**The root cause was a test-fixture limitation driving an implementation decision.** `skipWarmup` exists
because the **guitar** fixtures have only **0.15–0.26 s** of pre-tap lead-in and a 0.5 s warm-up would
swallow the tap (Swift's own doc says exactly this). Pinning `noiseFloorEstimate = -100` was dragged
along with it — and that silently disabled the relative model for **material**, the only mode that uses
it, and the mode whose recordings all have **2.3–2.9 s** of clean lead-in. The workaround broke a mode
it was never needed for.

User: *"the playback should capture the noise floor and work identical to the live case — otherwise how
do we tell if the live case and the playback are the same?"*

**The fix (user's proposal): let the MEASUREMENT TYPE decide.**

| mode | playback warm-up | detector | why |
|---|---|---|---|
| **guitar** | **skip** (as today) | absolute | lead-in is 0.15–0.26 s; a 0.5 s warm-up eats the tap. Guitar never uses the noise floor. |
| **material** (plate/brace) | **RUN it** | relative | lead-in is 2.3–2.9 s — ample. The warm-up establishes the noise floor and fires the re-anchor, so **playback ≡ live**. |

**Verified in Python** (one-line change: `skip_warmup = not is_material`):

| fixture | phases captured | converged noise floor |
|---|---|---|
| clean plate | **3/3** ✓ | −71.6 (the true floor) |
| **noisy plate** (floor −52) | **3/3** ✓ | **−50.3** — the relative model actually runs |
| clean brace | **1/1** ✓ | −72.4 |

No regression, and the relative model finally works in playback. Contrast the web (absolute) on the same
noisy fixture: **0/3**. **That is the 3-way discriminator.**

### ✅ VERIFIED: a saved session WAV always contains the warm-up

The design above only holds if the recording actually *has* the pre-tap audio the warm-up needs. It does,
**by construction**. In Swift `startTapSequence`:

```
174:  sessionRecordingBuffer = []
176:  isSessionRecording = true      <- the session WAV starts HERE
 ...
212:  analyzerStartTime = ...        <- the warm-up clock starts HERE
215:  isDetecting = true
```

The session WAV begins **before** the warm-up clock, in the same synchronous call. And because live
detection is *suppressed* during the warm-up, **no accepted tap can ever land in the first 0.5 s of a
session WAV** — so ≥ 0.5 s of pre-tap audio is guaranteed, not lucky. Replaying a session WAV therefore
feeds the warm-up exactly the audio it consumed live.

**This also explains the guitar fixtures.** `Recording.wav` / `Recording 5.wav` have only 0.26 s / 0.15 s
of lead-in — which is *impossible* for an app session WAV (the tap would have been suppressed and never
recorded). They are **externally recorded files**, not session dumps; the app's session WAVs follow the
`<type>-<mic>-<platform>-<timestamp>` convention (`plate-umik-1-swift-mac-…`), and those all carry
2.3–2.9 s of lead-in.

So the history is: `skipWarmup` was added for **externally-recorded guitar fixtures with no lead-in**, was
applied to **all** playback, and dragged the `-100` noise-floor pin along with it — disabling the relative
model for **material**, whose fixtures are real session WAVs that never needed the workaround. Gating on
measurement type is what the code should have said originally.


### 🛡 Lead-in guard on playback (user request)

A saved **session** WAV always contains the warm-up (verified above). An **externally recorded** file
need not — the two guitar fixtures have only 0.15–0.26 s of lead-in. If someone replays an external
plate/brace file with no room before the first tap, material playback would run a warm-up against audio
that has no noise floor in it, and could swallow the first tap.

**Add a guard at the start of file playback (all three platforms):**

- Measure the lead-in — the audio before the first level excursion that would cross the tap threshold.
- If it is **shorter than the warm-up period** (0.5 s), do not silently proceed. **Tell the user and let
  them choose:**
  - **continue without noise capture** — fall back to the absolute threshold for this playback (today's
    behaviour, which is a legitimate choice for a file that simply has no ambient to measure); or
  - **re-record** the session so it carries the lead-in.
- Never fail silently, and never quietly degrade the relative model to absolute without saying so —
  that silent degradation is the exact bug this whole effort uncovered.

This also gives the fixtures a stated constraint: **material fixtures must carry ≥ 0.5 s of pre-tap
audio.** App session WAVs satisfy it by construction; imported recordings must be checked.

### ⚠ Consequence: the WEB's playback tests must run in REAL TIME

Swift and Python pace playback in real time (`time.sleep(chunk_duration)` / Swift `Thread.sleep` —
"Mirrors Swift processFileData"). The **web alone** runs `pace: false` (as fast as it can) in tests.

If the three don't play back the same way, the web isn't running the same thing, and anything
wall-clock-dependent (the warm-up) cannot be validated there. **The web's file-playback tests must switch
to `pace: true`** (3 sites in `test/file-playback.test.ts`).

**Runtime:** the web suite goes from ~1.5 s to ~2 min of playback (89.7 s of fixture audio, some replayed
by the session tests) — alongside Python's existing 117 s. **Not a concern** (user): *"The cost is
irrelevant. We can afford the time in the test suite. We already do for python and swift."* Correctness of
the three running the same thing is the point.

*(Alternative considered and rejected: seed the noise floor from the file's first audio frame. It works,
but it is a playback-only special case. Running the real warm-up is simpler and structurally identical to
live, which is the whole point.)*

---

## 5. Decisions (settled with the user)

1. **Hysteresis — FOLD IT IN.** Python has it (3.0 dB constant; it was once user-settable and was fixed
   to a constant). The web has none, in *either* mode. *"I am surprised that the web does not have it.
   It needs it. Fold it in."* → in scope for this change, guitar **and** material.
2. **Fixture = BRACE.** *"Brace is a much better test since tapping brace wood produces far less
   amplitude than the plates do."* Confirmed by measurement: brace taps peak −35 dBFS vs plate −10.
   Brace is the low-headroom, realistic case.
3. **Noise level — not a decision, a build step.** The requirement is simply that the fixture is *valid*
   and *captures a real failure*: the relative model must detect every real tap, and the absolute model
   must demonstrably fail. See the success criteria in §4 — verified before the fixture is committed.
4. **Swift's stale comment** at `TapToneAnalyzer.swift:308` (claims the level-crossing fires "at the same
   level as the main-thread detector" — untrue for material, where the main path is relative) — fix in
   the same change.
5. **Playback runs the live detection path**, keyed on measurement type (see §4). Canonical Swift+Python
   change. **The web's playback tests move to real-time pacing** so all three play back identically.
6. **Validation is the noisy plate fixture** (built + verified): canonical 3/3, web 0/3. The unit-test
   option (A) is no longer needed as the primary — the full-pipeline harness CAN host this once playback
   runs the live path, which is what the user wanted all along.

---

## 6. Steps (after review)

0. **Canonical first — make playback run the live detection path.** Swift + Python:
   `skipWarmup = !isMaterial` in the file-playback entry point, so material playback runs the warm-up
   (establishing the noise floor + re-anchor) while guitar keeps skipping it. **Verified in Python.**
   Also rename the misleading `detectTap(peakMagnitude:)` (§1) and fix the stale comment (§5.4).
1. **Web playback tests → real-time** (`pace: true`, 3 sites). Suite time goes ~1.5 s → ~2 min.
2. **Commit the noisy plate fixture.** Regenerate with `python3 tooling/make-noisy-fixture.py`
   (deterministic, fixed seed, documents its own provenance and the -52 dBFS reasoning). Plate, not
   brace — brace's usable window is 0.8 dB, plate's is 17.3 dB. Copy the same bytes into all three repos.
3. **Add the 3-way test.** Swift + Python must pass it **immediately** (3/3) once step 0 lands; the web
   must **FAIL** it (0/3) until step 4. That failure is the acceptance bar — do not proceed past it.
4. **Port to the web device** (`realtimeFFTAnalyzer.ts`): noise-floor EMA (−60 init, α = 0.05),
   `isAboveThreshold` hysteresis state + `HYSTERESIS_MARGIN = 3.0` (guitar **and** material), relative
   rising/falling for material, silent settling window (skipped during file playback).
5. **Add the lead-in guard** (see §4): on file playback, if the pre-tap lead-in is shorter than the
   warm-up, tell the user and let them choose — continue with absolute detection, or re-record. Never
   degrade the relative model silently.
6. **Re-run everything.** The web's noisy-fixture test now passes; the **clean** fixtures' REG-* peak
   values must be **unchanged** on all three — that is the no-regression gate.
7. **Run-review.** Two things need a human: material detection in a noisy room (the point of the change),
   and **guitar detection**, which gains hysteresis it never had — a behaviour change in the most-used
   mode.
8. Regenerate the parity map; `--check` green.