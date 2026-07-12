# Status State-Machine Alignment — Swift + Python → status derived from state (like the web)

**Goal.** Make Swift and Python handle `statusMessage` the way the web does: the **warm-up is silent**
(detector state only, never a status-writer) and the status is set at **state transitions**. This dissolves
**OUT-1** (phase-guidance hidden by the warm-up) at the root instead of patching it, removes the test hack
(`armAndSettle`, which fakes a warm-up-exit frame just to observe the resting prompt), and makes the
detection-loop status strings state-reachable (retiring the 4b "pipeline-progress transients" exclusion for the
loop strings).

**Status: ✅ IMPLEMENTED (Swift + Python; web was already conformant).** Both steps landed as one pass:
`tapPrompt()` + `guitarLoopStatus(capturing:)` helpers added (Swift `TapToneAnalyzer` / Python
`_tap_prompt`/`_guitar_loop_status`); the resting + loop-transient sites derive from them; the warm-up is now
**silent** (its three status writes removed, the noise-floor re-anchor kept). Behavior-preserving — full suites
green (Swift 330-test run; Python 393). OUT-1 fixed + pinned by the "survives the warm-up" reveal tests
(Swift + Python StatusMessageTests). **Superseded OUT-1 (now retired).** Did **not** touch OUT-4 (the detection
*algorithm* / noise-floor EMA is untouched — only the warm-up's *status-writing* role changed).

---

## The root cause (concrete)

On Swift, the detection loop's warm-up **writes the status field** and is **restarted per material phase**:

- `TapToneAnalyzer+TapDetection.swift:182` — during warm-up: `"Initializing... (Ns)"`
- `:208` — on warm-up exit: `"Tap the guitar..."` (also re-anchors the noise floor, `:192-206`)
- `:230` — cooldown fallback: replaces a lingering `"Initializing…"` with `"Tap the guitar…"`
- Phase-arm restarts warm-up **after** setting the guidance: `Control.swift:344/360/454/473/492` set
  `analyzerStartTime = Date()` right after `:347 "Rotate 90° and tap for C"`, `:353`, `:457/476/495`,
  `:219-226 "Ready for L tap…"`.

So the guidance IS set at the transition — then the warm-up's `:182/:208` immediately paints over it. That is
OUT-1. (Python mirrors all of this — `tap_tone_analyzer_tap_detection.py:158-163` is the `:208` twin, etc.)

## The web reference (what "same state machine" means)

The web is a **hybrid**, and only one property is the thing Swift/Python lack:

- **Warm-up is silent.** False-trigger suppression is detector state in the engine (`prevAbove`/`consecutive`
  counters); it never writes status.
- **Loop status is derived from an engine state.** `setEngineState('listening'|'capturing'|'paused')` →
  `setGuitarStatus` maps state → the guitar `"Tap the guitar…"` / `"Tap n/N capturing…"` / `"…captured. Tap
  again…"` / `"All taps captured. Processing…"` strings. Pause/resume handled there too.
- **Everything else stays imperative** — material phase guidance (recordMaterialTap/accept/redo), completion,
  clipping, device-change are set at their transition and simply *survive* because nothing overwrites them.

So "the same state machine" = **(a) silence the warm-up, and (b) derive the guitar-loop status from an explicit
state.** Material/completion/clipping/device stay imperative on all three.

## Current Swift status sites, categorized (Python mirrors 1:1)

| Category | Sites | Disposition |
|---|---|---|
| **Warm-up (the problem)** | TapDetection `:182` Initializing, `:208` exit-prompt, `:230` cooldown-prompt | **Silenced** (Step 2). Keep the noise-floor re-anchor at `:192-206`. |
| **Guitar loop transients** | TapDetection `:346` capturing, `:348` all-captured; SpectrumCapture `:702/:705` | **Derive from state** (Step 1) — mirror `setGuitarStatus`. |
| **Arm / pause / resume prompts** | Control `:219-229` arm, `:278-287` resume; `TapToneAnalyzer.swift:241/247` didSet | Set at transition; **survive** once warm-up is silent. (Step 1 may route via the state fn.) |
| **Material phase guidance** | Control `:347` Rotate, `:353` FLC, `:457/476/495` redo | Set at transition; **become visible** once warm-up is silent (Step 2 = the OUT-1 payoff). |
| **Material capture pipeline** | SpectrumCapture `:1176/1318/1402` per-tap, `:1244/1360` File:, `:1252/1373/1441` review, `:429/481/537/576/871/935` no-signal/no-resonance | **Stay imperative** (like the web). |
| **Completion / loaded / clipping / device** | Control `:399/419`; SpectrumCapture `:1220/1609`; TapToneAnalyzer `:1449-1471` clip, `:1522-1565` route; MeasurementManagement `:670` loaded | **Stay imperative.** |

## Plan — two steps, each gated + verified

### Step 1 — State-derivation refactor (behavior-preserving, strings UNCHANGED)
Introduce an explicit detection state on Swift/Python (mirroring the web's `EngineState` +
`setGuitarStatus`/`restingPrompt`), and route the **guitar-loop** status (resting / capturing / captured /
all-captured / pause / resume) through a single state→string function. **Same strings, including a `warmingUp`
state that still maps to `"Initializing… (Ns)"`** — so behavior is identical and the existing StatusMessage +
ScenarioStateTrace suites stay green with no edits. This is "the same state machine as the web," structurally.

### Step 2 — Reveal the guidance (the OUT-1 behavior change)
On the clean state-derived base, make the warm-up **silent**: drop the `warmingUp → "Initializing…"` mapping and
the warm-up-exit prompt, so the transition-set prompts (`"Ready for L tap"`, `"Rotate 90° and tap for C"`, …)
persist through the warm-up — exactly as the web shows them. Update the parity tests lock-step: add the
phase-guidance cases deferred in 4b to StatusMessageTests (Swift/Python/web) and drop the `armAndSettle` hack
(the resting prompt is now set at arm, reachable without faking a frame).

## What does NOT change
- The detection **algorithm** — the noise-floor EMA re-anchor at warm-up exit stays (that's OUT-4, separate).
- The warm-up's **detection-suppression** role — it still blocks false triggers for the same duration; it just
  stops writing the status field.
- Material/completion/clipping/device status — already set at the right transition; unchanged.

## Risks
- **Noise-floor re-anchor coupling.** `:192-206` (re-anchor) and `:208` (status) share the warm-up-exit block;
  Step 2 must remove only the status line, keeping the re-anchor. Verified by REG-P1/B1 (material regression).
- **"Initializing…" removal is a UX change.** The web shows no countdown; Step 2 drops it on Swift/Python to
  match. Confirm that's wanted (it is the OUT-1 direction).
- **Guitar "tap during warm-up" feel.** Post-Step-2 the status reads `"Tap the guitar…"` while the (silent)
  warm-up still rejects the very first tap — same as the web today. Acceptable per the web precedent.

## Test strategy
Step 1: existing StatusMessage (Swift 10 / Python 10 / web) + ScenarioStateTrace suites must stay green
unchanged (proves behavior-preservation). Step 2: add the phase-guidance cases (Rotate 90°, Ready-for-L,
Set-up-FLC, redo) to StatusMessage on all three; remove `armAndSettle`; re-run REG-P1/B1 for the noise-floor
re-anchor.

## Sequencing
Swift (canonical) → verify → Python (mirror) → verify → web reconcile (already conformant; expect only the
`setGuitarStatus` shape to line up + the 4b-deferred tests to add). All platforms release together (already
required by other in-flight changes — release timing is not a constraint here).

## Open decisions (my recommendations in **bold**)
1. **Do Step 1 then Step 2** (relocate → reveal), each verified green, rather than one combined change — safer,
   and Step 1 alone is a pure refactor the tests fully guard.
2. **Mirror the web's scope** — derive the guitar loop + pause/resume from state; leave material/completion
   imperative-but-surviving. (Going further — deriving material phases from state too — is possible later but not
   needed to fix OUT-1 or match the web.)
3. **Drop "Initializing… (Ns)"** in Step 2 to match the web (no countdown). Alternative: keep a silent countdown
   that doesn't overwrite guidance — but the web has none, so dropping it is the truer alignment.

## Relationship to the backlog
- **OUT-1** — *superseded.* This refactor's Step 2 IS the OUT-1 fix (done at the root). Retire OUT-1 when Step 2
  lands.
- **OUT-4** — *unaffected.* Detection algorithm; noise-floor EMA stays. Still open.
- **4b "pipeline-progress transients" follow-up** — *partly resolved.* The guitar-loop transients
  (capturing/captured/processing) become state-derived in Step 1 → state-reachable in tests. The material
  per-tap/review pipeline strings stay imperative (as on the web) → that part of the follow-up remains.