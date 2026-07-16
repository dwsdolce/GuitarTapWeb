# Material multi-tap — three discrepancies found in the 3-tap brace set

**Status:** 📋 OPEN — analysed 2026-07-16 during 1.0.2 real-build testing. **No code written.**
Found by comparing `~/Documents/GuitarTap/brace-umik-1-3-tap-{python,swift,web}-mac-*.guitartap`
(same room, same UMIK-1, three apps recording the **same physical taps simultaneously** — so the
three files are a controlled experiment, not three separate captures).

⚠ The `.guitartap` evidence files are **transient** and will be overwritten. The numbers below are
the record.

## The measured data

| | numberOfTaps | peak Hz | peak dB | noise floor (median) |
|---|---|---|---|---|
| Python | 3 | 512.8797 | −54.027 | −124.036 |
| Swift | 3 | **512.8569** | **−56.049** | **−128.556** |
| Web | **1** ← bug | 512.8797 | −54.027 | −124.036 |

Full-spectrum comparison (`longitudinalSnapshot.magnitudesData`, 16384 bins):

```
python vs web   : max|Δ| = 0.000000   mean|Δ| = 0.000000   ← BIT-IDENTICAL
python vs swift : max|Δ| = 40.735897  mean|Δ| = 4.294666
swift  vs web   : max|Δ| = 40.735897  mean|Δ| = 4.294666
```

---

## 1. Web saves `numberOfTaps: 1` after a 3-tap capture — ✅ FIXED + USER-VERIFIED

**Fixed 2026-07-16. Web-only — Swift untouched, so it can be amended into the existing commit.**

**Run-review (user, 2026-07-16): PASSED.** The user replayed the same WAV and saved a second brace
measurement; the two files were diffed:

| | numberOfTaps | peak | floor |
|---|---|---|---|
| before (14:41) | **1** ← bug | 512.6953 Hz / −54.0268 dB | −124.036 dB |
| after (15:33) | **3** ✅ | 512.6953 Hz / −54.0268 dB | −124.036 dB |

Spectra **bit-identical** (`max|Δ| = 0.000000` over 16384 bins), and `numberOfTaps` was the **only**
differing top-level field (excluding `id`/`timestamp`/spectrum). Capture and averaging provably
untouched — the count was the whole bug.

**Bonus: this validated the WAV-replay method** that §3 / STATUS item 9 depends on — the same recorded
file through the same app reproduced a bit-identical spectrum, confirming the determinism that
approach needs.

**Root cause: `fromLive.ts:546` hardcoded `numberOfTaps: 1`** in `buildMaterialMeasurement`, while
`buildGuitarMeasurement` (line 179) correctly passed `a.numberOfTaps`. The value was already in scope
at the App.tsx call site and simply never passed. **Swift has no such split** — one save path
(`TapToneAnalyzer+MeasurementManagement.swift:319`) passes the analyzer's `numberOfTaps` for guitar and
material alike. The web's two-builder structure is where the bug got in: *the same divergence-at-the-
view/build-layer story as every other web defect this cycle* (see STATUS view-layer restructure).

**The fix:**
1. `numberOfTaps: number` added to `BuildMaterialArgs` as a **required** key — not optional. The
   compiler then located every call site, including two in tests I'd have missed.
2. `fromLive.ts` uses `a.numberOfTaps`; `App.tsx` passes the in-scope `numberOfTaps`.

**Why the test suite never caught it — worth internalising.** `g8-material-load.test.ts:147` asserted
`expect(built.numberOfTaps).toBe(1)`. **The test pinned the bug.** It could never fail, because the
builder ignored its caller: no argument the test passed could change the output. A test that asserts a
hardcoded literal against a function that hardcodes it tests nothing. The **required key** is what
actually caught this class of bug — same as the `calibrationName` fix earlier this cycle. **The type
system found two bugs the tests could not.**

Now asserts `toBe(3)` from a real 3-tap build, plus a file-round-trip check. Web: build exit 0,
258 tests pass, parity `--check` clean.

**To run-review:** capture a 3-tap plate or brace on the web, save, and check Measurement Info /
the PDF report show **3**. Guitar was never affected (its file already recorded 3 correctly).

**Confirmed in the file, not just the UI.** The user reports the web UI *showed 3 taps being
captured in the status bar*, and the web's spectrum **is** a correct 3-tap average (see §3) — yet
the saved file records `1`.

So: capture correct, average correct, **count wrong at save time**. Because it is in the file, the
wrong count follows the measurement into the PDF, the Measurement Info panel, and any reload.
Web-only (Swift and Python both write `3`).

**Do not chase this in the capture path** — the spectrum proves 3 taps were captured and averaged.
Look at where `numberOfTaps` is populated on the material save path (`src/measurement/fromLive.ts`
and its material caller). Suspect: reading a per-phase/current-tap counter that has already been
reset, or defaulting to 1 for material where the guitar path passes the real count.

## 2. Python's Details shows Measurement Type as "—" — ✅ FIXED + USER-VERIFIED

**Fixed 2026-07-16. Python-only — Swift's and the web's application code are untouched.**
**Run-review (user, 2026-07-16): PASSED** — "Python is verified".

**It was rendering an em-dash, not omitting the row** — user screenshot, kept as the only record of a
now-fixed bug: [`images/measurement-details-python-type-emdash-2026-07-16.png`](images/measurement-details-python-type-emdash-2026-07-16.png)
(`Measurement Type: —`, on a brace saved that session; note `Number of Taps: 3` alongside it, correct).
That single detail cracked it: `—` is the *fallback value*, so the row was fine and the lookup was
failing.

### Root cause — the view read a field that is None by design

The type is stored **only inside the SpectrumSnapshot**, never as a top-level measurement field.
`TapToneMeasurement.create(...)` deliberately does not set `measurement_type`
(`tap_tone_analyzer_measurement_management.py:316` says so outright), and `to_dict()` resolves it from
the snapshot at save time so the JSON matches Swift byte-for-byte.

Python's `_type_name` read that top-level field anyway → `None` → `MeasurementType(None)` raises →
except branch → `"—"`.

**Canonical Swift resolves from the snapshot** (`MeasurementDetailView.swift:71-76`):

```swift
private var measurementTypeName: String {
    if measurement.isComparison { return "Comparison" }
    let mt = measurement.spectrumSnapshot?.measurementType
        ?? measurement.longitudinalSnapshot?.measurementType
    return mt?.shortName ?? "—"          // ← the em-dash seen in the screenshot
}
```

**The web already did it right** (`fromLive.ts:199`), so this was a Python-only divergence.

### Why it survived this long — the bug was SESSION-SCOPED

The em-dash appeared **only for measurements saved in the current session**. After an app restart
`from_dict` populates the top-level field from the file, and the same measurement renders `Brace`
correctly. So it was invisible to anyone who reopened the app, and invisible to tests: **a round-trip
test loads from a dict, which populates the field, so it can never fail.** Only an *in-memory*
measurement (snapshot-only) exposes it — which is the shape the new tests use.

This also explains why my first investigation "proved" every layer worked: I traced the **file** path
(`from_dict` → `_type_name` → `'Brace'` ✅) when the dialog renders **in-memory** objects from
`analyzer.savedMeasurements`. Right answer, wrong object.

### The fix

`_type_name` now mirrors Swift's `??` chain: `spectrum_snapshot or longitudinal_snapshot`, then
`MeasurementType(snapshot.measurement_type).short_name`, falling back to `"—"` (Swift's own fallback)
and catching `AttributeError` for the no-snapshot case. The old
`m.guitar_type or m.measurement_type or "—"` fallback is gone — Swift has no such fallback.

Verified against the user's real file: in-memory brace → `Brace` (was `—`); loaded-from-file → `Brace`
(unchanged); guitar in-memory → `Generic`; no snapshot → `—`, no raise.

**To run-review:** capture and save a plate/brace, then open Details **without restarting** —
Measurement Type must read `Brace`/`Plate`, not `—`.

### ⚠ OPEN: the Swift test case does not exist — see STATUS

New tests: Python `tests/test_measurement_type_name.py` (9) + web `test/measurement-type-name.test.ts`
(6), parity group **`test/measurement-type-name`**. **Swift's slot is `—` in PARITY-MAP.md:63.**

**Why Swift has no test:** `measurementTypeName` is `private` inside the `MeasurementDetailView`
struct. Swift's `private` is unreachable from a test even with `@testable import` (which exposes only
`internal`), so the test needs either dropping `private` or extracting the resolver — **an application
change, which the 1.0.2 candidate on TestFlight must not take**.

**This is a testability defect, not just a missing test.** The canonical implementation of a rule that
Python and the web are both now tested against cannot itself be tested. That is precisely the
view-layer coupling the restructure item targets ([[project_architectural_restructure]]) — consider
extracting the resolver there rather than as a one-off.

Related: [[project_measurement_details_consistency]] — the Details pane diverged across all three
before and was spec'd/fixed 2026-06-25; that spec is the authority if the wording is ever revisited.

### Noted, NOT changed: an unknown-type edge case diverges

For an *unrecognised* type string, Swift returns `"—"` (the enum parse fails → nil) but the web returns
the **raw string** (`fromLive.ts:201`: `t != null ? MEASUREMENT_SHORT_NAME[t] : (raw ?? '—')`). My
Python fix follows Swift (`"—"`). Unreachable with any valid file, so it is **not** touched before the
release; the web test deliberately does not assert that case. Flagged for the post-release pass.

## 3. Swift's magnitude is ~2 dB lower — 🔶 REAL, NEEDS FIXING **AFTER** THE RELEASE

**Decided 2026-07-16 (user): does NOT hold up 1.0.2, but must be resolved after it.**

> "I do not think 3 should hold up the release. The frequency value is what is important and the test
> shows them all 3 to be the same (within the precision reported). The magnitude really does not matter
> in this case but it needs resolved after the release."

**Why it can ship:** **frequency is the product** — fL is what a luthier acts on, and all three agree
(513.0 Hz brace; 197.7539 Hz guitar) within the reported precision. Every derived property (speed of
sound, Young's modulus, specific modulus, radiation ratio) follows frequency and dimensions, not this
level. The magnitude difference changes no decision a user makes.

**Why it still needs fixing:** three platforms that record the same tap should report the same level.
Whatever causes it is a genuine divergence in the capture path, and "the number that happens not to
matter here" is not a reason to leave the mechanism broken. Same disposition as
`AUDIO-BUFFER-SIZE.md` (0.1 Hz immaterial to lutherie, still tracked) — and **likely the same root
cause**, so consider resolving them together.

### ⭐ The recorded WAV files are the test bed (user's point, 2026-07-16)

**This does not need live re-taps.** The apps record session WAVs, so the *same audio* can be replayed
through all three offline. That converts §3 from "re-record and hope it reproduces" into a **repeatable
experiment**:

- Feed one WAV to all three, compare per-tap gated windows — a **deterministic** input removes the
  onset-timing variable that live taps introduce.
- It directly tests the buffer hypothesis: if Swift's window start offset differs on *identical
  samples*, the chunk granularity is confirmed as the cause.
- ⚠ Cross-check `OUT-4-DETECTION-SPEC.md` first: **file playback historically did not exercise the
  same detection path as live** (`skipWarmup` pinned the noise floor). That was fixed by making the
  measurement type decide, so material playback ≡ live — but verify that still holds before trusting a
  playback result.

### The evidence

**All three DO average.** This was nearly mis-diagnosed twice, so the reasoning is recorded:

- First wrong turn: "Python isn't averaging, because its 3-tap result is bit-identical to the web's
  1-tap result." **Refuted** — the web's `taps=1` is itself bug §1; the web really captured 3.
- Second wrong turn: "Swift's −4.5 dB noise floor ≈ 10·log₁₀(3) = −4.77 dB proves Swift is the only
  one averaging." **Refuted by the code** — `tap_tone_analyzer_spectrum_capture.py`
  `_handle_longitudinal_gated_progress` plainly calls `average_spectra(from_taps=self.captured_taps)`
  and re-runs `find_dominant_peak` on the average. Both Swift and Python document linear-power-domain
  averaging. And the numeric coincidence is weak: averaging N power spectra reduces the *variance* of
  the noise floor, it does **not** lower its mean by 10·log₁₀(N).

**Bit-identity is the strong evidence.** Python ≡ Web to the last float32 bit across 16384 bins is
what two *correct* implementations of the same averaging algorithm produce on identical audio: they
agree to ~1e-12 in float64, and the float32 storage quantisation erases the difference. Two
*different* algorithms could not do that. So Python and the web agree, and **Swift is the outlier**.

**Suspected cause — the known 4800-frame buffer item** (`Development/AUDIO-BUFFER-SIZE.md`):

- Swift's peak lands at **512.8569 Hz** vs **512.8797 Hz** for both others — the *same* sub-bin
  shift signature already documented for that item.
- `installTap(bufferSize:)` is only a hint; macOS delivers **4800 frames = 100 ms** chunks, against
  the web/Python's ~21 ms. With level-crossing needing 2 consecutive chunks, Swift's gated 400 ms
  window can sit up to ~100 ms differently relative to the tap onset.
- A window that catches less of the tap transient lowers the peak **and** the broadband floor, and
  by *different* amounts — which matches (peak −2.02 dB, floor −4.52 dB). A pure scale error would
  move both equally; averaging-vs-not would not shift the peak *frequency*.

### Averaging is now PROVEN correct on all three — stop suspecting it

The 3-tap **guitar** files carry `tapEntries` (per-tap snapshots; plate/brace do **not** — see §5), so
each file can be checked against **itself**: does the stored average equal the power-domain mean of its
own taps?

```
python  vs POWER-domain mean: max|Δ| = 0.0000    vs LOG-domain mean: max|Δ| = 16.86
swift   vs POWER-domain mean: max|Δ| = 0.0000    vs LOG-domain mean: max|Δ| = 15.83
web     vs POWER-domain mean: max|Δ| = 0.0000    vs LOG-domain mean: max|Δ| = 17.89
```

**All three average in the linear power domain, exactly**, and their guitar averages agree across apps
(197.7539 Hz on all three; −41.543 / −41.544 / −41.543 dB; floors within 0.06 dB). This also kills an
earlier theory that the −56/−54 split was **log- vs linear-domain averaging** (Jensen's inequality) —
the direction fitted, the data does not. **Averaging is not the suspect on any platform.**

### Why the guitar result does NOT refute the buffer hypothesis

Guitar and material use **different capture paths**, and the per-tap data shows it:

- **Guitar = RMS/chunk-triggered.** Python vs web per-tap differs by up to **26 dB in the noise bins**
  while the peak matches exactly — slightly different windows over the same tap.
- **Material = gated FFT re-aligned to the detected onset sample.** Python and web therefore capture the
  *identical* 400 ms → bit-identical output. Swift, on 100 ms chunks, cannot land on that same sample.

That is consistent with every number in this document. Still a hypothesis.

**To confirm before acting:** compare the per-tap window start offsets (Swift vs Python) for the same
onset, or re-run the 3-tap brace with Swift's buffer forced small. **Do not "fix" Swift's averaging** —
the averaging is not the suspect. Note the guitar path is *unaffected* (all three agree to 0.001 dB), so
any fix must not disturb it.

### ⭐ NARROWED by the first plate test (2026-07-16): it is the SESSION'S FIRST TAP

The plate is the decisive experiment, because unlike the brace it has **three** phases — so it can
separate "Swift's gated path is wrong" from "Swift's *first tap* is wrong". Peaks, three apps, same taps:

| peak | Python | Swift | Web |
|---|---|---|---|
| **fL** | 67.034660 Hz / −50.5370 dB | **66.947420 Hz / −49.5903 dB** ← only divergence | 67.034660 Hz / −50.5370 dB |
| **fC** | 117.331500 Hz / −55.4257 dB | 117.331500 Hz / −55.4259 dB | 117.331500 Hz / −55.4257 dB |
| **fFLC** | 35.860146 Hz / −58.9537 dB | 35.860600 Hz / −58.9514 dB | 35.860603 Hz / −58.9512 dB |

**fC is identical on all three** (to 6 dp, magnitudes within 0.0002 dB) and fFLC agrees to ~0.0005 Hz.
Python ≡ web on fL to the last digit. Q and bandwidth match everywhere. **Only fL diverges** — so
Swift's *later* taps re-align to the onset perfectly, and only the first misses.

**Three independent cases now agree:**

1. **Plate** — L wrong; C and FLC right.
2. **Brace** (this document) — a **single-phase, L-only** measurement, and Swift diverged. **100% of a
   brace sits in the one phase that's broken**, which is why the brace read like a whole-measurement
   2 dB error while the plate reads like one bad peak among three good ones. *Same cause, different
   exposure.*
3. **Guitar** — all three agree to 0.001 dB, and guitar uses a fixed **65536-sample non-gated** window,
   not the gated one.

**Working hypothesis:** at session start the pre-roll ring buffer isn't deep enough for Swift to
re-align the onset when chunks arrive **4800 samples (100 ms)** at a time; by the second tap it is full
and alignment succeeds. This turns fix **C** in `AUDIO-BUFFER-SIZE.md` (anchor the gated window to the
detected onset sample) from "somewhere in the gated path" into one specific question: **pre-roll depth
at session start.**

**Settles a loose end — the offset is RANDOM per tap, not a bias.** Swift is 2.02 dB *lower* on brace-L
but 0.95 dB *higher* on plate-L. The sign flips. So "Swift reads low" was the wrong framing and **no
constant correction exists** — exactly what buffer quantization predicts.

**Impact:** 0.087 Hz on 67 Hz = 0.13% → ~0.26% on Young's modulus (E ∝ f²). Immaterial per the standing
call, but Swift's plate numbers *will* differ slightly from the other two in the PDF.

### ✅ Gore Target Thickness 2.80 vs 2.81 — NOT a material difference; it VALIDATED the algorithms

**User, 2026-07-16 (accounting sense):** *"The difference is not a material difference… Just used to
validate that things are correct in the algorithms."* Read this section as a **validation result**, not
a defect report.

The user spotted a **2.80 vs 2.81 mm** target-thickness split and proposed the fL deviation as the
cause. **Confirmed by computation** — reproduced through Python's shipping
`calculate_gore_target_thickness` with every other input held identical (plate 557.5 × 220.5 × 4.85,
mass 208, body 490 × 368, Classical Top **f_vs = 60**; note `customPlateStiffness: 75` in the snapshot
is *inert* unless the preset is Custom):

| | fL | target thickness | displayed |
|---|---|---|---|
| Python | 67.034660 Hz | 2.802376 mm | **2.80** |
| Swift | 66.947420 Hz | **2.805110 mm** | **2.81** |
| Web | 67.034660 Hz | 2.802373 mm | **2.80** |

Chain: fL → E_L (∝ fL²) → thickness (∝ 1/√E_L). The fL deviation is the **sole** cause.

**The real disagreement is 2.7 MICRONS** (2.802376 vs 2.805110 mm). The rounding boundary is 2.805 and
Swift lands **0.11 µm past it** — a sub-micron margin flips the displayed digit. It *looks* like a
0.01 mm split; physically it is ~1/20th the thickness of a sheet of paper, far below what sandpaper can
resolve.

### ⭐ What this actually bought us: evidence the algorithms are CORRECT

The finding is not "the key result is wrong" — it is **the whole derived chain behaving exactly as
theory says it must**:

1. **The split is precisely what the fL deviation predicts.** Computed independently through
   fL → E_L (∝ fL²) → thickness (∝ 1/√E_L), from the saved peaks, it lands on 2.80 / 2.81. Nothing
   unexplained remains — no second effect is hiding in the plate maths.
2. **Python vs web agree to 3 NANOMETRES** (2.802376 vs 2.802373 mm). Two independent implementations
   of the entire Gore chain — moduli, shear modulus, anisotropic denominator, target thickness —
   landing that close is strong evidence **the algorithms are right on all three**.
3. **The only variable is Swift's first-tap fL.** Every other input was identical, so this isolates the
   defect to one place rather than leaving "the plate maths might differ" open.

**Do not "fix" this by changing the rounding or the thickness formula** — both are correct and identical
on all three. The defect is upstream, in Swift's first-tap gated window (item 4), and 2.7 µm is far
below what any luthier can act on.

⚠ Swift is canonical ([[project_swift_canonical]]). If this is confirmed, it is Swift that needs the
fix, and per [[feedback_improvements_all_three_platforms]] the outcome must be re-verified on all
three — not a case of bending Python/web toward Swift's number.

## 4. Guitar snapshots: Swift writes 32768 bins, Python/web write 32769 — ✅ CLOSED, WON'T FIX

**CLOSED 2026-07-16 by the user — this had been decided before and is being re-affirmed here so it
stops getting re-discovered.** I found it fresh, unaware of the prior decision.

**Reason (user):** the **Apple (vDSP) FFT algorithm and the Python/web FFT algorithm are not
identical**. Each output is **accurate for its own algorithm** — this is not a bug in either. The
bin-count difference is a consequence of that, and it has **no practical consequence**.

**Do not re-open** to make the counts match, and do not treat it as a canonical-format violation.

The evidence, kept only so a future reader recognises it on sight and stops:

```
python   per-tap=[32769, 32769, 32769]   averaged=32769   axis ends at 24000.0000 Hz  (= Nyquist)
swift    per-tap=[32768, 32768, 32768]   averaged=32768   axis ends at 23999.2676 Hz
web      per-tap=[32769, 32769, 32769]   averaged=32769   axis ends at 24000.0000 Hz
```

All three start at DC (0 Hz) with identical 0.732422 Hz spacing. **Swift omits the final Nyquist bin**;
Python and the web include it (N/2+1).

**Guitar-only — the material path is consistent.** All three write **16384** bins for
`longitudinalSnapshot`, all ending at 23998.5352 Hz (1.464844 Hz spacing). So this is not a
general snapshot-encoding difference.

**Why it doesn't matter:** one bin at 24 kHz, three orders of magnitude above a guitar peak (~198 Hz).
It cannot move peak detection or any derived value.

**The one real consequence** (worth knowing, not worth fixing): any consumer that zips the three
platforms' axes together hits a shape mismatch. The analysis script in this document crashed on exactly
that. Truncate to the shorter axis when comparing across platforms.

⚠ **Do not "resolve" this by reasoning from first principles.** A real FFT of 65536 samples has 32769
bins (0…N/2 inclusive), which makes Python/web *look* more defensible and Swift *look* wrong — that
argument is what makes this keep coming back. It is answered above: **different algorithms, each
correct for itself.** Canonical-format parity ([[project_guitartap_file_format_parity]]) does not apply
to a bin the FFT libraries themselves disagree about.

## 5. Confirmed: plate/brace do NOT store individual taps (by design)

Asked during this investigation ("the measurement file contains all the taps that were averaged — does
it for plate and brace too?"). **No.** [`TapToneMeasurement.swift:44`] documents `tapEntries` as *"Only
populated for guitar-mode measurements with `numberOfTaps > 1`; `nil` for single-tap, plate, and
brace."* The files confirm: the 3-tap brace files carry no `tapEntries` on any platform; all three 3-tap
guitar files do.

**Consequence for §3:** the brace discrepancy **cannot** be settled from the saved files — the
constituent taps are gone. The guitar files were the only available per-tap evidence.

**Consequence for §1:** the web's *guitar* file records `numberOfTaps: 3` correctly, so the wrong count
is **material-only**, not a general save bug. That narrows the search.

## 6. Session WAV: web ~8 MB vs Swift/Python ~12 MB — ✅ NOT A BUG, DON'T RE-CHASE

**Investigated 2026-07-16** on the user's concern that *"the waveform that is being saved is not
correct when redos occur"* (the first plate test included redos). **The waveform is correct on all
three. The web's file is smaller only because it holds less silence.**

Expect this to look alarming again on the next test — hence this note.

### The proof: the same three physical taps are in all three files

Cross-correlating each tap across platforms, and comparing per-tap levels:

```
tap 1:  swift vs python  xcorr 0.999794     swift vs web  xcorr 0.999823
tap 2:  swift vs python  xcorr 0.999999     swift vs web  xcorr 0.999989
tap 3:  swift vs python  xcorr 0.999959     swift vs web  xcorr 0.999978
```

| tap | swift | python | web |
|---|---|---|---|
| 1 | rms −35.72 / pk −9.40 | rms −35.72 / pk −9.40 | rms −35.72 / pk −9.40 |
| 2 | rms −37.80 / pk −11.08 | rms −37.80 / pk −11.08 | rms −37.80 / pk −11.08 |
| 3 | rms −33.15 / pk −9.38 | rms −33.15 / pk −9.38 | rms −33.15 / pk −9.38 |

Every file holds **exactly 3 taps** (the accepted L, C, FLC) with identical levels. **The rejected
takes were correctly removed on all three** — a rejected tap would be ≈ −10 dBFS against a −69 dB
floor, so it could not hide from the detector.

### Why the sizes differ: dead air, and it is OPERATOR timing, not platform behaviour

| | duration | tap times | gaps | tail |
|---|---|---|---|---|
| Python | 63.141 s | 1.96, 28.62, 53.69 | 26.66, 25.07 | 9.45 s |
| Swift | 65.900 s | 1.83, 23.99, 59.69 | 22.16, 35.70 | 6.21 s |
| Web | 41.829 s | 1.96, 17.69, 29.64 | 15.73, 11.95 | 12.19 s |

**The tell: the gaps differ between Swift and Python too.** Accept/Redo is pressed per-app at
different wall-clock moments (three apps, one mic, one operator), so each truncates a different amount
of dead air. Nothing about it is platform-specific.

**Also confirms the bounded pre-roll works on all three** — the first tap lands at 1.83–1.96 s in every
file, the ~2 s lead-in the spec (§6) calls for.

### The redo code matches, too

The web's `redoSession()` (`realtimeFFTAnalyzer.ts:455`) faithfully mirrors Swift's
`redoCurrentPhase()` (`TapToneAnalyzer+Control.swift:465`): **peek** the last checkpoint rather than pop
it (so a second redo of the same phase truncates to the same anchor, not the previous phase's start),
truncate to it, and re-arm the bounded pre-roll when `cp === 0`. Checkpoints are pushed on Accept in
both (`checkpointSession()` / `sessionCheckpoints.append`).

⚠ **A smaller session WAV is not evidence of lost audio.** Check the tap *count and levels*, not the
file size.

## Release impact

**None of these is a wrong measurement of the wood.** §1 is a metadata count, §2 a missing label, §3 a
~2 dB level difference that does not change the reported fL (513.0 Hz on all three) or any derived
property, §4 one inaudible bin at 24 kHz. Scope for 1.0.2 is the user's call.

- **§1 (web tap count)** and **§2 (Python type label)** — small, platform-local, each in one repo.
  Candidates to ride along with the parked material-PDF-layout pass (`WEB-PDF-MATERIAL-LAYOUT.md`).
- **§3 (Swift −2 dB)** — an **investigation**, not a patch. Belongs with the existing
  `AUDIO-BUFFER-SIZE.md` item, which already concluded 0.1 Hz is immaterial to lutherie. Same call
  likely applies to 2 dB on a *level*, since fL and every derived property agree.
- **§4 (bin count)** — needs a *decision* (which output is canonical) before any code.