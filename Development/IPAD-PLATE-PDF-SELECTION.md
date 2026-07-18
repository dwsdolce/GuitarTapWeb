# iPad Swift — plate PDF drops fL/fFLC (only fC annotated + tabled)

**Status:** 🔴 OPEN — reported 2026-07-16 (user, iPad device sweep). **SWIFT / iPad — SERIOUS, possible
release blocker.** **Decision (user, 2026-07-16): FIND THE ROOT CAUSE BEFORE ANY CODE — no churn.** The
fix will be a **commit (not amend) on all three, version stays 1.0.2, new build number**
(TestFlight accepts same version + new build). Root cause is **Release-only** and needs an on-device
**Release-config** trace to pin (see "Instrumentation" and "Traces" below). Instrumentation is in the
working tree, uncommitted; build 398 untouched.

**⭐ Why root cause first, not the defensive fix alone (verified 2026-07-16):** the per-phase-id heal
protects plate + brace but **cannot protect guitar** — guitar has no per-phase ids and its load path
trusts the saved `selectedPeakIDs` verbatim (no re-derivation; a *partial* corruption does not
self-heal). Only fixing the actual source bug protects all three types uniformly. See "Blast radius"
below.

## ▶ HOW TO RUN THE RELEASE TRACE (do this next)

Instrumentation is **already in the working tree** — nothing to add. Reproduce on the iPad:

1. **Xcode → Product → Scheme → Edit Scheme → Run → Info → Build Configuration → `Release`.**
2. Build & run on the iPad, **attached to Xcode** (so `gtLog` prints to the console).
3. **Reproduce the ORIGINAL SWEEP CONDITIONS, not just back-to-back plates.** ⚠ **6 clean captures
   (2 Debug + 4 Release), including a redo, proved fresh plate capture is NOT the trigger.** The
   original broken files came from a sweep that went **guitar → brace → plate**. So in one session,
   without relaunching: either **capture guitar → brace → plate in that order**, OR **load a saved
   measurement, then capture a plate** (cross-type stale state / load-before-capture are the live
   candidates). Repeat — it's intermittent.
4. A **bad** run shows `selectedPeakIDs` that **STAYS 1 through finalise/save** (a `SET …→1` that does
   NOT climb back to 3, or a `finalisePlateWithFLC`/`saveMeasurement` snapshot with `selectedPeakIDs=1`).
   **Paste that log.** ⚠ **`SET 3→1 phase=capturingLongitudinal` at the START of each measurement is
   NORMAL** (L resets to `{L}`, then climbs 1→2→3) — NOT the bug.
5. If the console is quiet under Release: **Xcode → Window → Devices and Simulators → select the app →
   Download Container**, then read `GuitarTap-debug.log` inside it.

**Prime suspect to watch for** (the "no-FLC" fingerprint): a `SET …→1 phase=capturingCross` with
`handleCrossGatedProgress` in its stack, and whether the FLC/finalise writes fire *after* it (they should
push it back to 3) or go missing. Thread Sanitizer is **not available** for this config.

## Symptom (user)

iPad plate PDF report: **all 3 waveforms render, but the peak annotations show only fC, and the
Detected Peaks table lists only fC.** fL (Longitudinal) and fFLC (Diagonal) are missing from both.

## Diagnosis — it is a DATA bug in the iPad-saved file, and the data is RECOVERABLE

Compared the iPad `.guitartap` against the known-good macOS one:

| field | macOS (correct) | **iPad (broken)** |
|---|---|---|
| `selectedLongitudinalPeakID` | set | **set ✓** |
| `selectedCrossPeakID` | set | **set ✓** |
| `selectedFlcPeakID` | set | **set ✓** |
| `peaks[]` | 3 | **3 ✓** |
| `longitudinal/cross/flcSnapshot` | present | **present ✓** |
| **`selectedPeakIDs`** | **[L, C, FLC]** | **[C only]** ← the bug |
| **`selectedPeakFrequencies`** | [67.4, 117.4, 36.3] | **[117.2] — fC only** |

**Both iPad files have it** — the single-tap plate (`…-swift-ipad-1784314741`) AND the 3-tap
(`…-swift-ipad-1784314709`). So it is iPad-**plate in general**, not multi-tap specific, and it is
**systematic**, not a stray user selection.

**The per-phase ids are all intact**, so the file loads correctly: the user confirmed *"Looking at the
iPad file in the mac version of the app the peaks are all there and correct."* The macOS load path
rebuilds material selection from the per-phase ids
(`selectedLongitudinal/Cross/FlcPeakID`), not from the aggregate `selectedPeakIDs`. **The data is
recoverable — only the aggregate `selectedPeakIDs`/`selectedPeakFrequencies` is corrupt.**

**Why the PDF is wrong:** the material PDF's annotations + Detected Peaks table are driven by
`selectedPeakIDs` (Swift `visiblePeaks` filters `currentPeaks` by `selectedPeakIDs`). The iPad PDF was
generated from the live state where `selectedPeakIDs == {C}`, so only fC survived into both. macOS is
correct because its `selectedPeakIDs == {L,C,FLC}`.

## ⚠ Likely a HEISENBUG — instrumentation suppresses it (2026-07-16)

**6 instrumented captures are all clean** (2 Debug + 4 local Release, incl. a redo, back-to-back), while
the **un-instrumented TestFlight build corrupts 2 for 2.** Original captures were **plates only, after a
restart** (user) — i.e. the *same conditions* as the clean traces. The only difference between "corrupts"
and "clean" is the **tracer itself**: the `didSet` on every write + three `resolvedPlatePeaks` snapshots
per measurement + synchronous file logging shift the timing, and for an intermittent, Release-only,
optimizer/timing-sensitive bug that perturbation appears to make it vanish. Classic observer effect.

**Consequence:** the trace hunt may be self-defeating. An **Archive/distribution build** (matches
TestFlight optimization more exactly than local Release) with the tracer *might* still show it, but we
are fighting the observer effect for a single line.

**But the mechanism CLASS is already characterized** (enough to satisfy "find it first"): intermittent,
Release-only, corrupts **only the re-derived mutable aggregate** `selectedPeakIDs`, **per-phase ids always
intact**, all writes main-serialized (not a plain race — an optimizer reorder/elision of one of the
repeated re-derivations). **The one-source-of-truth redesign is the ROOT-CAUSE fix for this class**, not a
band-aid: deriving `selectedPeakIDs` from the durable per-phase ids removes the fragile re-derived
aggregate that the optimizer corrupts — robust without pinning the exact line.

## Blast radius — which measurement types are exposed (verified 2026-07-16)

Checked the actual iPad (TestFlight-build) `.guitartap` files, and traced each type's load path:

| type | file check | per-phase id backup? | load re-derives selection? | exposure |
|---|---|---|---|---|
| **Plate** | 2 files CORRUPT (`selectedPeakIDs`={C}, 1 of 3) | ✅ yes | — | **hit; fixable via per-phase heal** |
| **Brace** | 2 files CLEAN (1/1/1) | ✅ yes | — | **low — single-phase (one write, not 4 re-derivations) + backup** |
| **Guitar** | 2 files look NORMAL (5–6 of 26–37 selected = the correct mode subset, not corruption) | ❌ **none** | ❌ **no** | **theoretically exposed, NO recovery** |

**⚠ Guitar is the concern, and it is why we fix the SOURCE, not just add the heal.** Verified in
`TapToneAnalyzer+MeasurementManagement.swift:685-688`:
```swift
if let saved = measurement.selectedPeakIDs { selectedPeakIDs = Set(saved) }   // trusts saved verbatim
else { selectedPeakIDs = Set(measurement.peaks.map { $0.id }) }               // nil/empty → all peaks
userHasModifiedPeakSelection = true                                            // BLOCKS auto-reselection
```
`reclassifyPeaks()` (the "Reclassified N modes after load" step) rebuilds mode **classification**, NOT
selection. So:
- **Empty** corruption self-heals (stored as `nil` → `else` → all peaks). ✓
- **Partial** corruption loads verbatim, no heal (guitar has no per-phase ids, and re-deriving from
  classification would clobber legitimate user peak-selections). ✗

**Consequences for the plan:** the defensive per-phase heal covers plate + brace but leaves **guitar**
exposed. Only fixing the root cause protects all three uniformly — hence "root cause first." Guitar's
*actual* risk is LOW (far fewer re-derivations than plate; likely failure mode is empty-which-self-heals;
no evidence any guitar file has been hit), but "low risk + no recovery + the headline data type" is not
something to assume away.

## Source-bug trace (iOS) — narrowed to the WRITE + the required state; trigger is RUNTIME

**The write that produces `{C}`:** `finalisePlateWithFLC()` (`Control.swift:451`) →
`selectedPeakIDs = Set(resolvedPlatePeaks(...).map(id))`. For a full plate it runs on **Accept of the
FLC review** (`Control.swift:409`) — a *user-interaction* moment on the main thread, later than the
gated-FFT handler.

**`resolvedPlatePeaks` (`SpectrumCapture.swift:1305`) returns ONLY cross iff:**
```
selectedLongitudinalPeak == nil  &&  longitudinalPeaks.isEmpty      // L skipped
&&  selectedFlcPeak == nil        &&  flcPeaks.isEmpty               // FLC skipped
&&  (selectedCrossPeak ?? crossPeaks.first) != nil                  // C survives
```
It reads the peak **objects/lists**, NOT the effective ids. The saved per-phase **ids** come from the
`autoSelected…PeakID`s (via `effective…PeakID`), which persist independently — **so the file shows
correct per-phase ids AND `selectedPeakIDs = {C}` simultaneously. That is the exact iPad signature.**

**The puzzle — statically, `{C}` should NOT happen.** The per-phase lists are populated at each phase
completion (`:1229` L, `:1364` C, `:1448` FLC) and cleared **only** in `redoCurrentPhase` and
`loadMeasurement`. In a clean L→C→FLC flow nothing clears `longitudinalPeaks`/`flcPeaks`, so at Accept
time all three lists should be populated and `resolvedPlatePeaks` should return `{L,C,FLC}` — which is
what macOS produces. **So the iPad `{C}` is a RUNTIME anomaly, not a static logic error I can point to.**
Leading suspects, all runtime and iOS-specific:
- **Threading / `@Published` visibility:** the lists are written from the FFT-processing thread (gated
  handlers); `finalisePlateWithFLC` reads them from the main thread on the Accept tap. An iOS
  concurrency/visibility difference could make the main-thread read see empty `longitudinalPeaks`/
  `flcPeaks` while `crossPeaks` (most-recently-written) is visible.
- **View lifecycle:** iPad presents Results as a **sheet** (`Layouts.swift`); a sheet dismiss/rebuild
  around Accept could reset state macOS (inline panel) never touches.
- **An async between capture and Accept** (`Control.swift:393` FLC-cooldown `asyncAfter`) reordering
  relative to iOS timing.

**This needs the on-device instrument-and-run method** (the one that cracked item 14). User has offered
("we can instrument if we need to"). See the instrumentation plan below.

### ⚠ Second iPad trace (2026-07-16) — writes are ALL on MAIN; simple race RULED OUT; still not reproduced

`didSet` write-tracer, fresh Debug plate capture. `selectedPeakIDs` went **0→1→2→3** via the three
phase handlers, and **every write's stack bottoms out in `_dispatch_main_queue_drain` with
`main=true`** — the gated-capture completion (`accumulateGatedSamples` closure → `finishGatedFFTCapture`
→ the handlers) is dispatched to the **main queue**, so the writes are **serialized on main.** Saved
with 3 peaks — correct again (2nd clean Debug capture).

**This rules out the cross-thread race on `selectedPeakIDs`** I had promoted (writes aren't on the FFT
thread; they're on main). Also killed the `:1372` candidate — the C handler wrote `1→2` (`{L,C}`), so
`autoSelectedLongitudinalPeakID` was present, not nil.

**So in Debug the capture path is clean and single-threaded.** The corruption is therefore either:
- **Release-only** — an optimization/timing/state difference in the build the broken files came from
  (still possible even with main-queue writes: e.g. a Release-only reorder, or a different code path), or
- **A different operation/sequence** than a straight capture (load-then-capture, multiple measurements
  per session, an audio-route-change / background-foreground re-analysis firing a stray write).

**✅ ANSWERED (user, 2026-07-16): the broken files came from the TESTFLIGHT (Release) build.** So this
is **Release-only** — the two clean Debug captures are explained (Debug timing masks it), and Debug
will keep coming up clean no matter how many captures. To catch the culprit write with the tracer, a
**Release configuration** must be built on the iPad. **⚠ NOT a race (earlier framing corrected — user, 2026-07-16).** The writes are main-queue-serialized,
so a classic data race doesn't fit. The coherent explanation is structural: **`selectedPeakIDs` is the
only recomputed value.** The peaks + per-phase ids are written ONCE per phase and never re-derived
(durable) — which is why they're always correct. `selectedPeakIDs` is *re-derived* several times (L, C,
FLC handlers + finalise) via `resolvedPlatePeaks`, which reads the transient peak **objects**
(`selectedLongitudinalPeak`) and per-phase **lists** (`longitudinalPeaks`) — **not** the durable ids. If
one recomputation reads a momentarily-empty object/list, `resolvedPlatePeaks` skips L and FLC and
returns `{C}`, while `effectiveLongitudinalPeakID` (which reads the auto id) stays correct — exactly the
observed signature. Release-only/intermittent = under optimization a transient input is in a different
state at one recomputation than Debug's timing produces (object released early / `@Published`+`didSet`
reordered). **Which transient input, and why, is still unpinned** (needs the Release trace); the
structural "why aggregate, not peaks" is settled. This is also precisely why the fix is sound without
the last detail: resolve from the durable ids, stop re-deriving the cache from transient objects.

**⭐ But the root cause does NOT block the fix.** The per-phase ids are ALWAYS intact (even in the broken
files); only the redundant aggregate `selectedPeakIDs` is corrupt. The "one source of truth" fix
(resolve rendering from the per-phase ids + heal the aggregate on import — see FIX DESIGN below) makes a
corrupt aggregate **harmless**, whatever Release-only quirk produces it. So: **the defensive fix is the
release path; catching the exact root cause (Release-config + tracer) is an opportunistic parallel, not
a blocker.** The tracer stays in as a passive net.

### First iPad trace (2026-07-16) — the finalise hypothesis is FALSIFIED; bug did NOT reproduce

Instrumented `handleFlcGatedProgress`/`finalisePlateWithFLC`/`saveMeasurement` and did a fresh **Debug**-build
plate capture (L with 2 redos → C → FLC → Accept → Save). Every snapshot:
```
handleFlcGatedProgress AFTER   selectedPeakIDs=3  resolved=[67.3,117.2,36.1]  Llist=111 Clist=84 FLClist=102  main=true
finalisePlateWithFLC   ENTRY   selectedPeakIDs=3  (same)
finalisePlateWithFLC   AFTER   selectedPeakIDs=3  (same)
saveMeasurement        ENTRY   selectedPeakIDs=3  → "Saved measurement with 3 peaks"
```
**`resolvedPlatePeaks` returns all three, `selectedPeakIDs=3` throughout, the saved file is CORRECT.** So
`finalisePlateWithFLC`/`resolvedPlatePeaks` is NOT the culprit, and a clean capture does not reproduce
the bug. The two known-broken iPad files came from the **same source commit** (TestFlight build 398),
so the difference is one of:
1. **⭐ Release-only RACE — now the leading hypothesis.** The broken files are from the optimized
   TestFlight (Release) build; the clean capture is Debug. `selectedPeakIDs` is written on the **FFT
   thread** during capture (gated handlers) and read/written on **main** (finalise); intermittent +
   timing-dependent + cross-thread is the textbook signature of a data race that Release's tighter
   scheduling exposes and Debug's slower timing hides.
2. Some *other* interaction (multiple measurements per session, background/foreground). ⚠ **Two
   candidates ELIMINATED by the user (2026-07-16):** orientation is NOT it — iPad uses the **inline**
   results layout in BOTH orientations (`isIPadHorizontal = !isPhone && horizontalSizeClass == .regular`,
   true for iPad either way; the "iPad portrait: sheet" code comment is stale, the sheet is
   iPhone-only); and **L/C/FLC cannot be reassigned in the Results panel**, so a manual peak-tap is not
   the trigger.

**Next tool (added 2026-07-16):** a `didSet` write-tracer on `TapToneAnalyzer.selectedPeakIDs`
(`TapToneAnalyzer.swift:552`) — logs `oldCount→newCount`, thread, phase, and the **call stack** of every
material write. Whenever the errant `{C}` write fires, however it's triggered, it is caught red-handed.

### ⭐ "no-FLC" fingerprint → the cross-grain handler is the prime suspect (user's clue)

The corrupt value is `{C}` — cross only, **L and FLC both absent**. Of the writes to `selectedPeakIDs`,
the cross handler (`SpectrumCapture.swift:1372`) is the **only** one that is L+C-only by construction:
```swift
selectedPeakIDs = Set([autoSelectedLongitudinalPeakID, autoSelectedCrossPeakID].compactMap { $0 })
```
It **never** includes FLC, and yields `{C}` alone if `autoSelectedLongitudinalPeakID` is nil at that
instant. Every other writer (FLC handler `:1461`, finalise `:451`) goes through `resolvedPlatePeaks`,
which **would include FLC** when FLC state is present. So a final value of `{C}` with FLC specifically
missing fingerprints **the cross-handler write as the one that stuck** — meaning the later FLC/finalise
writes of `{L,C,FLC}` either didn't run or were lost/reordered under Release optimization. **Watch the
Release trace for a `SET …→1 phase=capturingCross` with `handleCrossGatedProgress` in its stack, and
whether the FLC/finalise writes fire after it.** (Lead, not proven.)

### ⚠ Reproduction requires a RELEASE build (confirmed Release-only)

Two Debug captures came out clean, and the broken files came from the TestFlight (Release) build — so
Debug will not reproduce it. To catch the culprit write: **Xcode → Edit Scheme → Run → Build
Configuration → Release**, run on iPad **attached to Xcode**, capture several plates until one goes bad
(intermittent), read the trace in the console or the sandbox `GuitarTap-debug.log` (Xcode → Devices and
Simulators → Download Container). Thread Sanitizer is **not available** for this configuration.

## Instrumentation plan (iOS, to CONFIRM — one iPad run pins it)

Add `gtLog` snapshots (temporary, `#if DEBUG` or a debug flag; a Swift source edit → a debug build, NOT
the TestFlight build) at three points, each logging **thread + the full resolver inputs**:

1. **`handleFlcGatedProgress` @ `:1461`** (FLC completion, FFT thread):
   `Thread.isMainThread`, `selectedLongitudinalPeak==nil?`, `longitudinalPeaks.count`,
   `selectedCrossPeak==nil?`, `crossPeaks.count`, `selectedFlcPeak==nil?`, `flcPeaks.count`,
   `effectiveL/C/FlcPeakID`, `resolvedPlatePeaks().map(freq)`, `selectedPeakIDs`.
2. **`finalisePlateWithFLC` @ `:451`** (Accept, main thread): the **same** snapshot — the diff between
   points 1 and 2 shows what emptied between FLC-completion and Accept.
3. **The material SAVE point** (`MeasurementManagement:328`): `selectedPeakIDs` as written to the file.

Expected discriminator: if at point 2 `longitudinalPeaks.count == 0`/`flcPeaks.count == 0` while point
1 had them populated → **state emptied between capture and Accept** (threading/lifecycle); if point 1
*already* shows them empty → the gated thread never saw them (write-visibility). Either way it names the
mechanism. Run once on iPad with a plate measurement; read `guitar_tap-debug.log` from the app sandbox.

## Why it collapses to {C} — earlier notes (superseded by the trace above)

Swift's phase handlers build `selectedPeakIDs` **cumulatively and correctly**
(`TapToneAnalyzer+SpectrumCapture.swift`):
- L handler `:1237` → `Set([avgPeak.id])` = `{L}`
- C handler `:1372` → `Set([autoSelectedLongitudinalPeakID, autoSelectedCrossPeakID])` = `{L, C}`
- FLC handler `:1461` → `Set(resolvedPlatePeaks(...).map(id))` = `{L, C, FLC}`

**`{C}` matches none of these.** So on iPad something resets `selectedPeakIDs` to just the Cross peak
**after** the FLC handler runs — an iPad/iOS-specific path (view interaction, annotation propagation,
or timing) that macOS doesn't hit. Static reading can't pin it; needs an **on-device trace** (same
method that cracked the Python one — item 14: instrument the selectedPeakIDs writes, run on iPad,
find which write lands last with `{C}`).

## ⚠ Why do the platforms resolve peaks *differently*? (user: "the divergence itself is frightening")

**It is NOT a DSP-algorithm divergence.** Peak detection and per-phase selection are identical across
all three. The divergence is which **stored field** the material PDF reads the *final* selection from:

- **Swift** reads the aggregate `measurement.selectedPeakIDs`.
- **Web + Python** read the three per-phase ids (`selectedLongitudinal/Cross/FlcPeakID`).

**These are two copies of the same fact — denormalized storage.** By construction Swift *builds*
`selectedPeakIDs` to equal the per-phase set (the FLC handler `SpectrumCapture.swift:1461` sets
`selectedPeakIDs = Set(resolvedPlatePeaks(...))` = `{L,C,FLC}`). So for **every correctly-saved
measurement the two are identical**, and Swift-aggregate vs web/Python-per-phase produce **byte-identical
PDFs**. That is exactly why parity tests never caught it: **all fixtures were well-formed, so the two
code paths always agreed.**

**They can only diverge when the invariant `selectedPeakIDs == {per-phase ids}` breaks — and nothing
enforces it.** The iPad bug breaks it (`selectedPeakIDs = {C}` while the per-phase ids stay `{L,C,FLC}`),
which is what *surfaced* the latent divergence. The iPad bug did not create the divergence; it revealed
one that had been dormant since the port.

**Why it is legitimately worrying (and the lesson of this whole cycle):** the same fact is stored twice
with no enforced consistency, and different editions read different copies. Green parity suites on clean
fixtures hide it; malformed/edge data exposes it. This is the recurring pattern — *parity holds on the
data we test, the implementations differ, and the difference only shows on data we didn't think to
test.* The structural remedy is (a) read from ONE authoritative source everywhere, and (b) test the
field **invariant** explicitly, not just well-formed round-trips.

**Which source is "right"?** The per-phase ids are the **authoritative** selection; `selectedPeakIDs` is
a denormalized cache that *can* (and did) desync. So web/Python are accidentally the more robust here,
and Swift — nominal canon — is the one that should adopt the per-phase resolution (a
[[feedback_what_does_swift_do]]-corollary "the better alternative becomes the cross-platform standard"
case). Aligning all three on the per-phase source removes the second copy as a divergence surface.

## Related — this is the SAME FAMILY as STATUS item 12(R), but WORSE

12(R): on **macOS**, plate chart **annotations** don't refresh live during capture (waveform + peak
table do; the SAVED file is still correct). On **iPad** the same material-selection-state weakness
**corrupts the saved `selectedPeakIDs` and the PDF** — not just the live display. Investigate together;
they likely share a cause in Swift's material `selectedPeakIDs` maintenance.

## ⚠ THE CORRUPTION IS IN THE DATA AND IS CONTAGIOUS — recovery is render-only, not a heal

**User, 2026-07-16 — the decisive experiment:** iPad file → import to web → **export the MEASUREMENT
from web** → load that into Mac Swift → generate PDF → **still wrong (only fC).** *"The export of the
measurement from the web propagated the error."*

**Why:** the web's "Export Measurement" (`MeasurementsPanel.tsx:246` `serializeGuitarTapFile([m])`)
re-serializes the stored model **verbatim** — it keeps `selectedPeakIDs = {C}` from the imported file.
The web reads the per-phase ids only for **its own** rendering; it does **not** rewrite the aggregate on
export. So the bad field survives the round-trip and re-poisons any Swift consumer.

**This reframes the whole thing — the user's instinct is right, it is worse than a rendering bug:**
- The corruption lives in the **saved `.guitartap` data**, and it is **sticky**: faithful round-trip
  through any edition preserves it.
- The web/Python "recovery" is **render-only** — it produces a correct *PDF*, but does **not** clean the
  *file*. A user who exports a correct PDF from the web might wrongly assume the measurement is fixed and
  hand off a `.guitartap` that is still poison for Swift.
- Redundant, desyncable storage (`selectedPeakIDs` **and** the per-phase ids) with **no normalization on
  import** anywhere. That is a **data-model / format** fragility, not just a renderer divergence.

### ✅ What DOES recover (render-only) — and what does NOT

- ✅ **USER-VERIFIED:** import the iPad file into the web and **export the PDF directly** → all three
  render. Use for a correct **PDF** now.
- ❌ **Does NOT heal the file:** re-exporting the **measurement** from web/Python carries
  `selectedPeakIDs = {C}` forward. Any Swift PDF of that re-exported file is still wrong. Do **not**
  treat a web/Python `.guitartap` re-export as a repaired file.

### The real fix has to touch the DATA, not just renderers

1. **Stop producing it** — the iPad Swift save (root cause, §"Why it collapses to {C}").
2. **Heal on import/read, everywhere** — for a material measurement, if `selectedPeakIDs` ≠ the set of
   per-phase ids, **rebuild it from the per-phase ids** (the authoritative source) at parse time. Do it
   in all three editions. Then importing a poisoned file **cleans** it, and a web/Python re-export
   becomes a genuine repair tool (not just a correct-PDF tool). This is the cross-platform version of
   the item-14 lesson.
3. **Best: remove the redundant surface** — treat the per-phase ids as the single source of truth for
   material and *derive* `selectedPeakIDs` from them (the web's fresh-capture `buildMaterialMeasurement`
   already does this; only the import passthrough doesn't). Then the two copies cannot disagree.

**Verified 2026-07-16, two ways:**

- **Swift's PDF path reads the aggregate** `measurement.selectedPeakIDs`
  (`MeasurementsListView.swift:481`, `MeasurementDetailView.swift:179/297`:
  `Set(measurement.selectedPeakIDs ?? measurement.peaks.map { $0.id })`). For the iPad file that is
  `[C]` → only fC. **User confirmed re-exporting through the Mac Swift app ALSO fails** — same field,
  same result. (Note the `?? all peaks` fallback: a *nil* field would show all 3; the iPad bug wrote a
  *wrong non-nil* value, which is worse than absence.)
- **Web AND Python resolve from the PER-PHASE ids**, never the aggregate:
  - Web `fromLive.ts:433` `longitudinal: toMatPeak(m.selectedLongitudinalPeakID)` → `byId.get(id)`.
  - Python `tap_analysis_results_view.py:364-366` `next(p for p in m.peaks if p.id == selected_longitudinal_peak_id)`.
  - Simulated on the actual iPad file: all three per-phase ids resolve — **L 67.22 · C 117.22 ·
    FLC 36.31 Hz.** So a web/Python PDF of the iPad measurement shows all three.

**Stopgap for users:** import the iPad `.guitartap` into the web or Python edition and export the PDF
there. This also **confirms the diagnosis** (Swift's PDF uses the corrupted aggregate; web/Python use
the correct per-phase ids) **and points at the fix.**

## Two fix angles (both Swift, post-decision)

1. **The real fix:** stop `selectedPeakIDs` collapsing to `{C}` on iPad (root cause above).
2. **Defensive/robustness (RECOMMENDED — web/Python already do exactly this):** the Swift material PDF
   should resolve its peak set from the **authoritative per-phase ids** (`selectedLongitudinal/Cross/
   FlcPeakID`), not the aggregate `selectedPeakIDs`. It would make the PDF correct even when the
   aggregate is wrong — including every already-saved iPad file — and mirrors the item-14 lesson
   (resolve material from persistent per-phase state, not a transient aggregate). Note this makes the
   material PDF robust but does NOT fix the corrupted saved `selectedPeakIDs` itself (angle 1), which
   still affects on-chart annotations that key off the aggregate.

## 🛠 FIX DESIGN — one source of truth + import heal (FOR REVIEW; not implemented)

**Decision (user, 2026-07-16):** fix with a **COMMIT (not amend) on all three** → rolls the build
number, new build to Apple, release notes + version bump. Swift is fair game now (a new build is going
out regardless). Goal: **one state of truth**, and — critically — **existing user-created files must
render correctly**, so the fix must **heal on import**, not just make new saves correct.

**Principle: the per-phase ids (`selectedLongitudinal/Cross/FlcPeakID`) are the SINGLE SOURCE OF TRUTH
for material selection.** `selectedPeakIDs` becomes a *derived, backward-compat* field for material —
never independently authored. (Guitar is untouched: there, `selectedPeakIDs` **is** the authoritative
user selection and there are no per-phase ids. Everything below gates strictly on material type.)

### A. Rendering — resolve material selection from the per-phase ids, everywhere
PDF + chart annotations + results table read the per-phase ids. Web/Python PDF+table already do; **Swift's
PDF must switch to it** (align Swift → web/Python — the user agrees). Removes the "which field" divergence
so rendering is immune to a bad aggregate.

### B. Import heal — makes EXISTING files work (the user's explicit ask)
On parse of a **material** measurement, recompute from the authoritative per-phase ids:
- `selectedPeakIDs := [ id for id in (selectedLongitudinalPeakID, selectedCrossPeakID, selectedFlcPeakID) if id and id ∈ peaks[] ]`
- `selectedPeakFrequencies := the frequencies of those peaks`

Applied in **all three** parse paths. Properties:
- **Repairs the iPad `{C}` → `{L,C,FLC}` on load** → correct PDF from the existing file.
- **Idempotent:** a correctly-saved macOS file (`selectedPeakIDs` already = the per-phase set) is
  unchanged. A brace (L only) → `{L}`. A plate without FLC → `{L,C}`.
- **Heals the file, not just the render:** after import the model holds the corrected aggregate, so a
  subsequent re-export writes a *clean* `.guitartap` — turning web/Python re-export into a genuine
  repair tool (fixes the "contagious data" problem above).
- **Defensive:** a per-phase id pointing at no peak in `peaks[]` is dropped.

### C. Save — derive `selectedPeakIDs` from the per-phase ids for material
So fresh captures can't desync either (the web's `buildMaterialMeasurement` already does this; ensure
Swift + Python do). With A+B+C the two copies can never disagree.

### D. The live Swift `{C}` bug still needs attention
With B/C the *saved* aggregate is derived-correct, but the **live** `selectedPeakIDs` during capture
(what the on-chart annotations key off — item 12(R)) still collapses to `{C}` on iPad. Resolve the live
annotation path from per-phase ids too, or fix the reset. Fold 12(R) into this work.

### Verification — the fixture the well-formed suite never had
The gap that hid this: **all parity fixtures were internally consistent**, so aggregate-vs-per-phase
never diverged. Add a **"poisoned" fixture** — `selectedPeakIDs` deliberately disagreeing with the
per-phase ids — and assert all three heal it to `{L,C,FLC}` and render three peaks. The existing iPad
files are ready-made real-world fixtures. This tests the **invariant**, not just a round-trip.

### Which delayed Swift fixes to fold into this build (recommendation)
Since a new Swift build ships anyway, the "don't touch Swift" bar is lifted for *this* build:
- ✅ **15** (this) — the driver · **12(M)** plate chart chips show guitar-mode names · **12(N)** legend
  role suffixes — M/N share the chart-export path, both plate-PDF correctness, natural to bundle ·
  **12(R)** live plate annotations — related to D, likely shares the fix · **the uncommitted
  `@parity model/quality-colors` comment** — commit it now (build rolls regardless).
- 🔶 **DEFER item 4** (the 4800-frame buffer) — large, risky, its own testing burden, repeatedly judged
  immaterial to lutherie. Bundling it into a *correctness* release dilutes the test focus and expands
  the blast radius. Recommend a separate later build. **User's call.**

## ⚠ Release decision (USER)

**This is in the shipping iPad TestFlight build (398).** A plate PDF that drops 2 of 3 peaks is serious
for a plate-focused tool. Fixing it means a Swift change → new build number → re-upload → re-test.
Mitigations: (a) the saved `.guitartap` is recoverable and loads/exports correctly on macOS/(likely
web/Python); (b) it is display/export, not a wrong measurement. **Blocker vs known-issue-ship is the
user's call.** Do NOT touch Swift until that decision — build 398 is on TestFlight.

## Evidence

`~/Documents/GuitarTap/plate-umik-1-{3-tap-,}swift-ipad-*.guitartap` (2026-07-16). Transient — the
table above holds the finding.