# Platform Parity Gaps — cross-platform behavior/UI differences to reconcile

Backlog of behavior/UI differences between **Swift** (canonical), **Python**, and the **web** that must be
reconciled across all three. These are NOT part of any single feature effort — they surface during run-reviews and
are collected here so they don't get lost.

**Status: open backlog — a SEPARATE cross-platform parity effort, to be done AFTER Phase 6** (these are not
test-normalization or 3c-consolidation work). Found during the 6-3c run-review (2026-07-12).

**How to resolve each (the decision framework):** read **Swift first** (then Python) and match it — never reason
from the web's current behavior, which is often the divergence. If the web/Python alternative is genuinely
*better*, it is not a web-only change: it's a cross-platform improvement designed once and applied to Swift +
Python + web together (get buy-in first). See the memory rule *"What does Swift do?"* + its corollary.

Maintain `@parity` tags + regenerate PARITY-MAP.md on any code change.

---

## ✅ OUT-2 + OUT-3 — DONE, USER RUN-REVIEWED (2026-07-13)

User verified the Metrics panel (Bin Count), the tap count, and the progress bar **on all three
platforms**. Committed.
Suites: Swift 342 · Python 403 · Web 224, all green.

### The run-review found 6 bugs the green suites missed. This is the root cause:

> **The same value was computed three different ways, and two of them were wrong — in opposite
> directions.** Swift keeps a cumulative counter (`currentTapCount += 1`) SEPARATE from the
> within-phase buffer (`materialCapturedTaps`, cleared each phase). The **web** reset the counter at
> every phase advance. **Python** derived the counter FROM the buffer (`len(captured_taps)`), so it
> restarted whenever the buffer was cleared. Neither port was structurally identical to Swift, and no
> test drove the material capture path on ANY platform — so all three sailed through green suites.
> *(This is the argument for structural identity, stated by the user, demonstrated by the bug.)*

1. **Python bar blinked / stuck hidden.** Its gate was copied from Swift's **iOS `compactStatusBar`**
   (which gates the bar on `isDetecting`) instead of the **macOS `fullStatusBar`** (which gates it on
   `currentTapCount > 0`). `isDetecting` drops for the 0.5 s per-tap cooldown; worse, `set_tap_count`
   only runs on `tapCountChanged`, so the re-arm never re-evaluated visibility and the hide stuck.
2. **Python bar reset to 0 on every phase change** — the `len(captured_taps)` bug above. It also made
   the plate label compute `max(0, 1 - 2)` → **"Tap 0/N" from phase 2 onward**.
3. **Web had no bar at all** — same wrong gate, plus a native `<progress>` element that needs vendor
   pseudo-elements to render. Rebuilt as a full-width track+fill div on its own row (Swift's VStack).
4. **Swift iOS `compactStatusBar` blinked too** (user-flagged): its bar shared one `if` with the
   label. Split so the bar is gated on `currentTapCount > 0`, matching `fullStatusBar`.
5. **Python's tap-count label froze at "0/3"** (round-2 run-review). Two causes, both structural:
   its text was only written when `show` was true, and `show` samples `is_detecting` — which is False
   at every tap completion, so the label kept its armed value forever. Deeper: Python's `is_detecting`
   had a Swift-style `didSet` setter but **no signal**, so the view was *structurally unable* to react
   to it — it could only sample it inside `set_tap_count` (driven by `tapCountChanged`). Swift gets
   this free (`@Published` → the status bar re-renders); React gets it free (snapshot). Python alone
   had no binding. **Fix:** add `detectionStateChanged` to the analyzer (emitted from the
   `is_detecting` setter), bridge it through `FftCanvas`, and re-run `set_tap_count` on it; and always
   write the label's text, gating only its visibility (as Swift does — it computes `phaseLabel` from
   current values and merely wraps it in an `if`, so its text can never be stale).

6. **The status-bar blues never matched — there were FIVE of them.** Nothing stated the colour; each
   toolkit inherited a different one. Swift's untinted `ProgressView` took the user's **macOS accent**
   (so it drifted with a System Settings preference); Qt took `palette(highlight)`; the web used
   `--accent`. Python was inconsistent *with itself* — its bar (`palette(highlight)`, light blue) and
   its labels (`rgb(40,100,210)`, dark blue) were different colours; and the web's Peak readout was a
   fourth blue (`#6fb6ff`). Swift renders the bar, the phase/tap label, and the Peak readout as ONE
   colour (`.blue`). **Fix (user chose: pin one colour now):** all three pin **Apple systemBlue** —
   Swift `.tint(.blue)`; Python `_system_blue()`; web `--system-blue`. Kept as a **named token** per
   platform (not a literal at the use site) because the **Light/Dark/System theme work owns this
   token** when it lands — user: *"the bar color (and associated label) should be a style which
   changes on dark/light/user defined styles."* systemBlue is itself light/dark adaptive
   (#007AFF / #0A84FF).

**The rule now, on all three:** BAR gates on `currentTapCount > 0` (never `isDetecting`) — so it
appears on the first tap and stays up for the whole measurement; New Tap / Cancel zero the count and
clear it. LABEL keeps `isDetecting && (isPlateOrBrace || currentTapCount > 0)`.

### Verified by the user (2026-07-13) — Metrics panel, tap count, and progress bar on ALL THREE

> **Label `isDetecting` gate — CONFIRMED CORRECT, leave it.** The tap-count LABEL (not the bar) is
> gated on `isDetecting` on all three, so it drops out during the 0.5 s cooldown. This is *not* a
> blink into empty space: the status message occupies that slot while detection is disarmed, then the
> count returns. User-confirmed on Swift ("replaced with a message then comes back. Seems ok").
> Python matches. No change wanted.

**The lesson, for the next parity item.** Six bugs, none caught by the suites, all found by *running
the apps*. The suites were green because every platform tested its own behaviour, and no test drove
the material capture path anywhere. The new 3-way `test/tap-progress` closes that specific hole (it
was verified to FAIL on the old Python code), but the general rule stands: **a green suite is not a
run-review**, and **structural identity across the three is what prevents this class of bug** — the
same value was being computed three different ways, so two of them could be wrong without anything
noticing.

---

## OUT-1 — Phase-guidance-through-warmup (Swift + Python) — ✅ FIXED

**Resolved by the status state-machine alignment ([STATUS-STATE-MACHINE.md](STATUS-STATE-MACHINE.md)):** the
Swift/Python warm-up is now **silent** (it suppresses detection but no longer writes `statusMessage`), so the
phase-guidance set at each transition survives — exactly as the web shows it. Verified by the "survives the
warm-up" reveal tests added to StatusMessageTests (Swift + Python), which feed a warm-up frame and assert the
guidance persists (they fail on the pre-alignment code). Original write-up below for history.



The material phase status strings the web shows — `capturingC` → "Rotate 90° and tap for C", redo →
"Ready for L/C/FLC tap — tap again", and the FLC prompt — are the **intended** canonical messages
(Swift `Control.swift:344-347` / Python `control.py:830-833` SET them), but they are **dead in Swift/Python**: the
phase-arm **restarts the warm-up** (`analyzerStartTime = Date()`, purposeful — it suppresses false triggers while
the plate is repositioned), and the detection loop then overwrites the message with "Initializing… (Ns)" →
"Tap the guitar…", so the user never sees them (confirmed on current Swift build 374 + run-review). Swift and
Python AGREE (no canonical inconsistency); the web was the outlier only because it has no warm-up to overwrite them.

**DECISION (user, run-review 2026-07-12) — Option B: make the phase guidance VISIBLE in all three** (rather than
hide it). A canonical detection-loop change: Swift + Python show the phase message *through* the phase-arm warm-up
(keeping the warm-up for false-trigger suppression); the **web is already conformant** (3c-C4 shows them, NOT
reverted). Requires a **Swift release**; the parity tests are updated **lock-step**. **Design-for-review before
editing canonical.**

**The full dead-string set the fix must make visible** (each set right before a warm-up restart that overwrites it):
- Accept L→C: `"Rotate 90° and tap for C"` (Swift Control:344 restart + :347 msg).
- Accept C→FLC: `"Set up for FLC tap, then tap"` — shows during the disarmed cooldown, but does the armed
  `capturingFlc` keep it or go generic? (verify; Swift Control:353 + :360 restart).
- Redo L / C / FLC: `"Ready for L/C/FLC tap — tap again"` (Swift Control:454/473/492 restart + :457/476/495 msg) —
  **confirmed on current Swift: goes to "Tap the guitar…"**.
- (Also the resume strings Control:278-282 "Ready for fL/L/C/FLC tap" if resume restarts warm-up — verify.)

---

## OUT-2 — Status-bar progress bar + `sbProgress` text — ✅ DONE (user run-reviewed 2026-07-13)

**What it actually was — the original write-up below was wrong in two ways, and the real bug was bigger:**

1. **"Python has neither" is false.** Python already had BOTH the `_sb_progress` QProgressBar *and* the
   "Phase N/M · Tap p/q" text, with Swift's exact visibility gate. **But its bar was broken:** the view
   recomputed a percentage from `tapCountChanged(current_tap_count, number_of_taps)` — i.e. it divided the
   **cumulative** count by `number_of_taps` instead of `total_plate_taps`. For a 2-tap plate the bar hit
   **100% at the end of phase L** and `min(captured, total)` pinned it there through C and FLC.
   **Fix:** the view now renders the analyzer's `tap_progress` (Swift's structure — the model already
   computed it correctly), deleting the duplicated wrong math.
2. **The web needed a MODEL fix, not just a bar.** The web's material `currentTapCount` **reset at every
   phase advance**; Swift/Python count **cumulatively** across L→C→FLC. The status text agreed only by
   coincidence (web printed its per-phase count directly; Swift subtracts `(step-1)×numberOfTaps` from its
   cumulative one), so nothing caught it — but `tapProgress` did *not* agree, and the bar would have
   refilled 0→100% **every phase**. **Fix (user chose Option A — align the model, not patch the bar):**
   added `totalPlateTaps`; made material `currentTapCount` cumulative incl. Swift's redo rebasing
   (`lCount`/`lcCount`); `tapProgress` = `currentTapCount / totalPlateTaps`; the status text now derives the
   within-phase count via Swift's expression (**same displayed text as before**). Surgical, because the web's
   phase machinery keys on `materialBuffer.length`, never on `currentTapCount`.

**New 3-way test slug `test/tap-progress`** (Swift `TapProgressTests` · Python `test_tap_progress` · web
`tap-progress.test.ts`, 9/9/10 green) pins `totalPlateTaps`, `tapProgress`, the cumulative count, and the redo
rebasing. It passes immediately on Swift/Python (they were canonical) — which is exactly what proves the web
now agrees. Linked as evidence: `audio/tap-analyzer tests=test/tap-decisions,test/tap-progress`.

Original write-up follows.

(a) **Progress bar is Swift-only.** Swift renders a visual tap/phase progress **bar**
(`ProgressView(value: tapProgress)`, Controls:420) in the bottom status bar; the **web shows only the text** and
**Python has neither** → add the bar to **Python + web**.

(b) **`sbProgress` TEXT diverges** from Swift (Controls:405-413, verified in the 3c-D run-review): the web GUITAR
branch shows a provisional `currentTapCount + (capturing ? 1 : 0)` — Swift shows raw `currentTapCount` (no +1); and
the web gates guitar on `numberOfTaps > 1` while Swift gates on `currentTapCount > 0`. (Plate/brace text matches
Swift; the two-branch structure IS canonical — Swift branches plate vs brace/guitar too.)

**DECISION (user, 2026-07-13) — SWIFT WINS: the count means "taps COMPLETED", not "tap being worked on".**
The semantic question is whether `n/N` names the tap you're *striking* (1-3) or the taps you've *finished* (0-2).
Canonical = **completed**, which is exactly what the progress **bar** measures — so the text and the bar stay in
sync (that coherence with OUT-2a is the reason, not mere deference to Swift). **Align the web to Swift:** drop the
provisional `+1`, and gate guitar on `currentTapCount > 0` (not `numberOfTaps > 1`).

Cross-platform UI-parity item, independent of the statusMessage work.

---

## OUT-3 — Metrics "Bin Count" blank for plate/brace (web-only) — ✅ DONE (user run-reviewed 2026-07-13)

**Fix:** `binCount` now reads the LIVE FFT (`sp.frequencies.length`, where `sp = liveSpectrum`), mirroring Swift
`analyzer.frequencies.isEmpty ? "—" : analyzer.frequencies.count` (Python: static `fft_size // 2`). Bin Count is
**Analysis *Configuration*** — a property of the continuous FFT, not of a capture — which is why Swift/Python show
it in every mode. The web had gated it on `!material && captured`, so it was blank in material mode **and** blank
before any tap; both are now fixed by the one change. (Same class of bug as the RF-1 fix directly above it in
App.tsx: live telemetry must read `liveSpectrum`, not the capture.) Subtitle already matched all three.

Original write-up follows.

The Metrics panel shows a blank ("-") **Bin Count** for plate/brace in the web; Swift + Python show **32,768**.
Web-only: the App `metrics` useMemo gates `binCount: !material && captured ? captured.frequencies.length : null`,
so material → null. Fix = show the FFT bin count for material too (from the live/continuous FFT — `GUITAR_FFT_SIZE`
-based, the ~32,768 bins Swift/Python report). Swift/Python already correct.

---

## OUT-4 — Material tap-detection model — ✅ DONE (user run-reviewed 2026-07-13)

**Task 4 is now COMPLETE — OUT-1/2/3/4/5 all done.** User confirmed guitar hysteresis on the web with a
live mic (the one behaviour change the tests could not see), twice.

**What shipped.** The web gained the relative noise-floor detector (EMA α=0.05, `rising =
max(threshold, noiseFloor + 10 dB)`), **hysteresis in BOTH modes** (margin 3.0 — it had none, guitar
included), and a silent audio-clock warm-up. Swift + Python were fixed too: see the two bugs below.

**Two canonical bugs found on the way — both meant the relative model had NEVER run in playback, on any
platform, which is why no test could ever separate the two detection models:**

1. **`skipWarmup` pinned `noiseFloorEstimate = -100`** for all file playback, which makes `rising`
   compute to exactly `tapDetectionThreshold` — the relative rule collapses onto the absolute one.
   `skipWarmup` was only ever needed for the *guitar* fixtures (external recordings, 0.15–0.26 s of
   lead-in); it got applied to everything and broke *material*, the one mode that uses the floor.
   **Fix: key it on the MEASUREMENT TYPE.** Material playback runs the warm-up → playback ≡ live.
2. **The warm-up was on the WALL clock but must cover the first 0.5 s of AUDIO.** In playback the file
   read + engine reconfigure outlast it, so it expired before any audio arrived — it never ran, the
   re-anchor never fired, the EMA latched near its seed, and the file's opening noise fired a FALSE tap.
   **Fix: an audio clock — and the timestamp TRAVELS WITH THE CHUNK.** Reading `audioElapsed` at the
   consumer is not enough: the handler hops to the main thread while the audio thread races ahead, so
   the clock read there belongs to a *later* chunk. That reproduced the identical bug. `rmsLevelHandler`
   now emits `(level, audioTime)` and `detectTap` takes it.

**The test that proves it** (3-way, `test/file-playback`): `plate-umik-1-noisy-52.wav` — the plate
session with its floor raised to −52 dBFS, above the −53.34 threshold. An absolute detector **saturates**
there (the level never drops below threshold, so no rising edge can be confirmed) and captures **0 of 3**
phases; the relative one floats to floor+10 and captures **3 of 3**. Verified to fail on the web's
pre-port code. Regenerate: `tooling/make-noisy-fixture.py`.

Also: `detectTap(peakMagnitude:)` renamed to `detectTap(level:)` on Swift+Python — it is fed the per-chunk
RMS level, never an FFT peak. The old name cost real time (it looked as though the platforms detected on
different signals; they do not).

**Lead-in guard: deliberately NOT built.** It could only fire on an *externally recorded* file replayed in
plate/brace mode — app session WAVs carry ≥0.5 s of lead-in **by construction** (session recording starts
before the warm-up clock, and live suppresses detection during it, so no tap can exist in the first 0.5 s).
The failure it would prevent is mild (first tap missed → nothing captured → visible no-op, not a wrong
number). Not worth a 3-platform modal. **Documented instead** in the Play File help entry on all three and
in the manual (§10.3 + a Common Problems row).

**Open nit (not worth doing now, per user):** Python's help rows lack the separators Swift/web have, so the
Play File entry reads less cleanly than the others.

Original write-up follows.

## OUT-4 (original) — relative noise-floor EMA (Swift/Python) vs absolute dBFS (web)

For **plate/brace** detection, Swift (`TapToneAnalyzer+TapDetection.swift:135-167`) and Python
(`tap_tone_analyzer_tap_detection.py:88-110`) trigger **relative to an EMA-tracked noise floor**:
`rising = noiseFloorEstimate + max(tapDetectionThreshold − noiseFloorEstimate, 10 dB)`, the floor updated by an
EMA (`α = 0.05`) from every below-threshold chunk and re-anchored to the current level at warm-up exit — so
detection adapts to ambient noise ("keeps detection working when ambient noise is elevated"; material taps are
quiet). The **web** (`realtimeFFTAnalyzer.ts`) uses a **fixed absolute dBFS level-crossing** for all modes.
`useRelativeDetection` is scoped to plate/brace on both native platforms (Swift :135-138 / Python :88);
**guitar mode already matches** (all three absolute).

**Masked in the regression tests** (REG-B1/REG-P1 pass on all three): `alignCaptureToOnset` re-anchors the FFT
window to the sample-level onset, so a slightly different crossing point still yields the same peaks. The
divergence bites in **live material-tap sensitivity** under elevated/varying ambient noise — which taps register
at all — not in the computed peak values.

**Couples with OUT-1.** On the canonical side the relative floor and the warm-up are entangled: warm-up *exit*
re-anchors `noiseFloorEstimate` (`TapDetection:192-208`). So giving the web relative material detection also
implies a **noise-floor settling window** — the timed warm-up the web currently lacks. OUT-1 (Swift/Python keep
the warm-up but stop it owning the status) and OUT-4 (web gains the relative floor + a settling window) converge
the three toward one detection architecture; tackle them together.

**DECISION (user, 2026-07-13) — PORT THE SWIFT/PYTHON RELATIVE MODEL TO THE WEB. In scope; it does NOT get
deferred past the release.** The deciding argument is **field evidence, not canonicality**: the Swift/Python
relative-EMA path has had **beta testing and real use**; the web's absolute-dBFS path has had **none**. Prefer the
model that has been exercised in anger.

**The OUT-1 coupling is defused** (user): the crux of OUT-1 was the warm-up *clobbering the status message*, and
that was fixed by making the warm-up **silent** — the warm-up itself still exists (it suppresses detection and
re-anchors `noiseFloorEstimate` at exit). So giving the web a **silent settling window** buys the relative floor
without reintroducing the message problem. Scope = **material (plate/brace) only**; guitar stays absolute on all
three (already matching).

Found during the 6-TEST Phase-4 (4b) status-message extraction.

---

## OUT-5 — Reduce-tap-count-mid-sequence — ✅ DONE (user run-reviewed + committed 2026-07-13)

> User confirmed guitar and plate sequences still work; reachable behaviour unchanged, as intended.
> Suites: Swift 345 · Python 406 · Web 227.

**Resolution: the branch was DEAD CODE. Deleted from Swift and Python; the web never had it.**

The Taps stepper is disabled the moment a sequence has a tap — `.disabled(currentTapCount > 0 &&
!isMeasurementComplete)` in Swift (both stepper sites), `setEnabled(not (captured > 0 and not
complete))` in Python, `tapsLocked` in the web. **The count cannot be changed mid-sequence on any
platform; you must cancel first.** User confirmed by testing Swift directly. So the
"reduce-the-count → finalise with what you have" branch could never fire from the UI.

And because it was unreachable, it had silently drifted **three ways**:

| | behaviour |
|---|---|
| **Swift** | deferred `processMultipleTaps()` by `captureWindow`, showed "All taps captured. Processing…", and averaged **ALL** captured taps (reduce 5→3 → averaged 5) |
| **Python** | finalised **synchronously** and **truncated**: `del captured_taps[new_num:]` (reduce 5→3 → averaged 3) |
| **Web** | no branch at all |

Three implementations of an unreachable feature, producing three different measurements. Deleted
rather than reconciled — **no reachable behaviour changes.** It was also a latent trap:
`loadMeasurement` writes `numberOfTaps`, so a load during a live sequence would have kicked off
`processMultipleTaps()` mid-load, guarded only by call ordering.

**What stays** (live, and tested): the prompt refresh when the count changes while armed *before* any
tap (`currentTapCount == 0` → "Tap the guitar N times…"). That is the legitimate use of the stepper,
and exactly when it is enabled.

**Superseded ideas, recorded so they are not re-proposed:** *(a)* reconcile the branch (truncate +
union guard + sync finalise) — unnecessary, the code is unreachable; *(b)* make a mid-sequence count
change **cancel and restart** the sequence — rejected: it is destructive (silently discards captured
taps, in both the raise and reduce directions), and it only takes effect if the stepper is *unlocked*,
which is the very thing we do not want. The lock already expresses the intent.

**Pinned 3-way** in `test/tap-count-change` (`NoImplicitFinaliseTests` / `TestNoImplicitFinalise` /
`describe('OUT-5 …')`): a count change with taps in hand must not complete the measurement, must not
truncate `capturedTaps`, and must not stop detection.

**Follow-up worth tracking (NOT done):** the stepper-lock rule itself lives in the **view** on all
three (`App.tsx`'s `tapsLocked`, Swift's `.disabled(...)`, Python's `_update_tap_buttons`) — it is
**not** in the canonical `buttonEnablement` rule module and is not pinned 3-way. It is load-bearing
(it is what makes the branch unreachable), so it belongs in the rule module.

Original write-up follows.

## OUT-5 (original) — Swift defers with "Processing…", Python completes synchronously

When the user reduces the tap count to at-or-below the taps already captured mid-sequence, Swift
(`numberOfTaps.didSet`, TapToneAnalyzer.swift:245-251) sets `statusMessage = "All taps captured. Processing…"`,
stops detection, and **defers** `processMultipleTaps()` by `captureWindow` (async). Python's `set_tap_num`
(control.py:746-752) instead calls `process_multiple_taps()` **synchronously** — straight to "Analysis
complete!", with no "Processing…" intermediate. Both finalise the same measurement; the difference is the brief
intermediate status + the defer. Minor edge case (manual count reduction mid-capture is rare). **Which is
canonical is genuinely open** — Python's synchronous finalise is arguably *better* here (no pending gated
capture to wait for; Swift's defer is copy-pasted from the normal last-tap path that *does* need the window).

**DECISION (user, 2026-07-13) — PYTHON'S SYNCHRONOUS FINALISE WINS; align all three (Swift changes).** There is
genuinely no pending gated capture to wait for on this path, so the `captureWindow` defer + the "Processing…"
intermediate buy nothing; Swift's defer is an artifact of copy-pasting the normal last-tap path (which *does*
need the window). This is a **deliberate cross-platform improvement that edits canonical Swift** — user gave
buy-in explicitly. Then pin the branch 3-way in `test/tap-count-change`. Found during 6-TEST 4c.