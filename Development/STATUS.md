# STATUS — What's Left

**Single source of truth for open work.** If it isn't listed under "Open work" it's done or out of
scope. This file is a **status index, not a log** — one line per item: state, next action, pointer.
The detail lives in each item's linked doc.

_Last updated: 2026-07-20 — **1.0.2 RESPIN at Step 8 (ship)**, all holds off (user). Master plan =
[RESPIN-1.0.2-PLAN.md](RESPIN-1.0.2-PLAN.md) (Steps 0–7 done; resume at Step 8)._

## Open work

Status key: 🔴 blocker · 📋 open/queued · ⏳ code-written-not-verified · 🔶 deferred (not blocking).

| # | Item | State — next action | Detail |
|---|---|---|---|
| 1 | **1.0.2 release (respin)** | 🔴 **In progress.** Steps 0–7 DONE (Swift instrumentation stripped · material-selection fix all 3 · chart M/N/R · `@parity` commit · **Step 7 poisoned-fixture 3-way test** — `model/material-selection` + `test/material-selection` slugs, real corrupt iPad plate heals to all three L/C/FLC on Swift/Python/web; `--check` clean, 76 groups). **Step 6 (docs) DONE** — in-app Help/Quick-Start material note (all 3) + release notes + **User Manual** (ch06 §6.7 material Annotations detail); ⏳ user regenerates manual HTML/PDF via pandoc. **BLOCKED on the peak-finding duplicate item** — user: fixed before any release. **NEXT = Step 8 ship** (full re-test sweep macOS·iPad·iPhone·PC·Linux → TestFlight · installers · redeploy), once that lands. Commit-not-amend all 3; version 1.0.2; build numbers roll. | [RESPIN-1.0.2-PLAN.md](RESPIN-1.0.2-PLAN.md) |
| 2 | **Architectural-parity restructure** (view layer) | 📋 Write the **spec first** to size it; no code yet. Lands the 2 parked test items (frozen-peak-recalc selection half + `annotation-state` 3-way). | [RESTRUCTURE-NOTES.md](RESTRUCTURE-NOTES.md) |
| 3 | **Theme — Light/Dark/System** | 📋 Blocked on THEME-SPEC §8 (light gradient + chrome hexes). The systemBlue token (all 3) is this work's seam. Also owns the deferred colour-value work: the `WoodQuality.color`/mode-colour layer violation (colour hung off the model enum on Swift/Python) and any cross-platform hue reconciliation. | [THEME-SPEC.md](THEME-SPEC.md) |
| 4 | **Swift audio buffer size** (4800 frames, not the 1024 requested) | 🔶 NOT blocking (immaterial to lutherie). One cause → ring-out/peak-freq/WAV-length divergence. The 3-tap plate FALSIFIED the "first-tap only" narrowing → it's **per-tap**. **NEXT = iPad `buffer.frameLength` experiment** (may confirm root cause outright); do fix A first. | [AUDIO-BUFFER-SIZE.md](AUDIO-BUFFER-SIZE.md) · MATERIAL-MULTITAP §3 |
| 5 | **Audio watchdog blind to a SILENT stream** | 🔶 NOT blocking (self-recovers). "Alive" = chunks arriving, not chunks *containing audio*. Fix needs a signal-level criterion + design (false-positive risk). | [AUDIO-WATCHDOG-SILENT-STREAM.md](AUDIO-WATCHDOG-SILENT-STREAM.md) |
| 6 | **Project hub repo** (docs + cross-repo bug tracking) | 📋 IDEA, needs a spec; no action yet. Enabler = Swift going open source. | [PROJECT-HUB-REPO.md](PROJECT-HUB-REPO.md) |
| 7 | **Material multi-tap: Swift ~2 dB / sub-bin below Python/web** | 🔶 NOT blocking (fL agrees; derived props follow frequency). **Same 4800-buffer cause as the Swift audio-buffer-size item** — resolve there, don't chase separately. | MATERIAL-MULTITAP §3 |
| 8 | **Results panel cross-platform consistency** | 📋 Post-release; presentation only (numbers correct). 7 divergences pointing 3 ways (order · Showing-row · nesting · boxing · labels · title-colour · spacing) — this **includes** the Python Gore-box **nesting** (§3) and vertical **spacing** (§7) once mis-filed as separate "P/Q" items. Overall-Quality colour already fixed. Spec against Swift first. | [RESULTS-PANEL-CONSISTENCY.md](RESULTS-PANEL-CONSISTENCY.md) |
| 9 | **Replay does not bit-reproduce live capture** | 📋 Open — found in the peak-finding run-review automation 2026-07-19. Same-platform WAV replay reproduces the saved measurement *closely but not bit-for-bit*: replay-vs-replay is deterministic (0.000 dB) and resonances reproduce to ≤0.003 dB, but **every spectrum bin differs by ~0.02 dB mean** (0/3702 exact in the ≥−100 dB range) — the gated FFT window lands on a slightly different sample range live-vs-replay. **PROVEN not caused by the peak-finding fix** (replayed spectrum byte-identical with/without the change on all 3, via stash-and-fingerprint). Requirement (user): replay must exactly reproduce live capture. Likely same window-alignment family as the **Material multi-tap / Swift audio-buffer** items — **confirm before merging; MATERIAL-MULTITAP doc left untouched per user.** Re-run harness: `Development/playback-validation/`. | [PLAYBACK-BIT-IDENTITY.md](PLAYBACK-BIT-IDENTITY.md) |
| 10 | **Peak lifecycle — durability of per-peak state** | 🟡 In progress. Swift Phases 0–2 done, committed and user-verified; **next = Phase 3**. Ports (Python, then web) are Phase 9 and gated on Phase 8. | [PEAK-LIFECYCLE-PLAN-SWIFT.md](PEAK-LIFECYCLE-PLAN-SWIFT.md) |
| 11 | **Web chart-interaction bugs (3)** | 📋 Open, found in run-review 2026-07-21. Web-only behavioural gaps vs Swift/Python: no per-annotation "Reset Position"; "Reset Labels" never disabled; clicking a peak dot does nothing (no highlight/scroll-to-row). Bugs 1–2 small, Bug 3 a real feature. | [WEB-CHART-INTERACTION-BUGS.md](WEB-CHART-INTERACTION-BUGS.md) |
| 12 | **Python: progress bar lingers after load-guitar-following-material** | ⏸ PARKED 2026-07-17 (user) — may just be reset-timing differing across platforms, not a real bug. **Confirm it reproduces before acting.** Progress bar = `_sb_progress` (`tap_tone_analysis_view.py`), visibility at `:2358`/`:3276`. | *(this row)* |

## Done (for reference)

Audit trail, not a to-do list.

**1.0.2 respin sub-work** (all committed; only *shipping* remains — the 1.0.2 respin item):

- **iPad Swift plate/brace selection corruption** ✅ fix done + user-verified incl. the iPad DEVICE (2026-07-17). Material has no per-peak selection; the saved aggregate is ignored on read + healed on load, so the corruption is inert; corrupt files now render all three peaks everywhere. Visibility UI: 3-state button on every type, material All==Selected, no coercion (verified all 3, 2026-07-18). | [IPAD-PLATE-PDF-SELECTION.md](IPAD-PLATE-PDF-SELECTION.md)
- **Swift/Python material chart/report defects (M/N/O/R)** ✅ done: **M** plate chips use L/C/FLC role labels; **N** legend `(L)`/`(C)` suffixes; **O** date format → comma (Swift/web separate date+time join, list + compact variants; Python already comma); **R** live material annotations show accumulated identified peaks progressively (both natives). | [WEB-PDF-MATERIAL-LAYOUT.md](WEB-PDF-MATERIAL-LAYOUT.md) §M–O
- **Web PDF material report (fixes A–L) + Python fix K** ✅ done + user-verified 2026-07-16.
- **Web saved multi-tap guitar PDF missing 2nd page** ✅ fixed + verified 2026-07-16 (wiring gap — saved-export site lacked the multi-tap gate App.tsx had).
- **Python multi-tap material results one-phase lag** ✅ fixed + verified 2026-07-16 (resolve from the persistent per-phase lists, not transient `current_peaks`). | [PYTHON-MULTITAP-MATERIAL-RESULTS.md](PYTHON-MULTITAP-MATERIAL-RESULTS.md)

**Other completed this cycle:**

- **Peak finding emitted a duplicate peak (CORE, all 3)** ✅ fixed + committed 2026-07-20. `findPeaks` interleaved detection with classification, so an overlapping Top/Back bin minted two peaks reconciled by id — every guitar capture saved one duplicate. Now a single mode-blind sweep (one peak per bin; Swift 211→77 lines); classification stays in `classifyAll`; existing files healed at decode (incl. `tapEntries`) with the library force-saved. Also fixed en route: Python card layer used frequency as identity in 3 places; Python `test/peaks` was mis-tagged + tested reimplementations; a pre-existing **flamenco band inversion** (→ top 180–220 / back 200–250); the false "non-overlapping bands" doc comment. Suites green (Swift 403 · Python 522 · web 305), parity clean (77 groups), **end-to-end playback validation passed on all 10 capture WAVs** (no dupes; resonances to ≤0.003 dB). Surfaced two new open items (Peak Min semantics; playback bit-identity). | [PEAK-FINDING-DUPLICATE-PEAKS.md](PEAK-FINDING-DUPLICATE-PEAKS.md)

- **Dot list vs annotation list (items 1–2)** ✅ done + user-verified 2026-07-21. Web chart dots moved off the assigned-mode set onto the shared `isKnown ∩ view-range` rule (Swift/Python already used it); new `view/dot-layer` parity group pins the dot list on all 3 (DL1–DL7). | [DOT-ANNOTATION-PARITY.md](DOT-ANNOTATION-PARITY.md)
- **Peak Min filtered material peaks (loaded plate lost fL)** ✅ fixed + user-verified 2026-07-21. Peak Min is guitar-only, but Python's loaded path filtered material peaks too, dropping fL (−62.41 dB vs Peak Min −60) from the peak table *and* annotations. Guarded in Python; Swift given the matching explicit guard (it was immune only by the accident of an empty frozen spectrum) + a plate/brace regression test. Swift 416 · Python 535. | [RESTRUCTURE-NOTES.md](RESTRUCTURE-NOTES.md) (Stage 1 prevention)
- **Peak Min: full-set save + selection persistence + docs (all 3)** ✅ done 2026-07-20, committed all 3 (lands with the 1.0.2 respin). **Option 4** — a live guitar capture now saves every peak down to the **−100 dB** slider floor, so lowering Peak Min on a **loaded** measurement reveals sub-Peak-Min peaks (e.g. a low Air) exactly as live; `currentPeaks` / display / Taps table unchanged, guitar + live-capture only, loaded files keep authoritative peaks. **Option 1** — the manual/auto selection flag (`userModifiedSelection`) now persists (backward-compatible; legacy files with no field default to manual), so a reloaded auto measurement re-selects revealed winners. Tested against the real swift-mac fixture (Air −64.21 dB excluded at −60, recovered at −70) on all 3; suites green; parity clean. **Manual corrected** — ch02 §2.7, ch03 §3.6, ch08 §8 now describe the full-set save / reveal-on-loaded and distinguish the **wand** (`resetToAutoSelection`, re-select visible) from **Re-analyze** (`reanalyzePeaks`, re-detect from spectrum); PEAK-MIN-SEMANTICS §6's own wand misattribution fixed. Release notes updated (−100 dB, all 3). | [PEAK-MIN-SEMANTICS.md](PEAK-MIN-SEMANTICS.md)
- **Web loaded-measurement peak display diverged from native** ✅ fixed + user-verified 2026-07-20 (web-only, committed `c1f760a`). Surfaced by the full-set-save change (a loaded file now carries every peak to −100 dB): the web Analysis Results panel listed peaks outside the 75–350 display range, and the chart dotted only the *selected* peaks. Swift/Python were correct. Root cause was purely view-layer (DSP identical). Fix mirrors Swift's structure exactly — panel = `sortedPeaksWithModes` (display-range filter, `App.tsx` `displayPeaksInRange`); chart dots = `allPeaksInRange` (every in-range peak, `spectrumRender.ts` Layer 1, annotation-independent); badges = `visiblePeaks` (Layer 2, unchanged). No `guitarType` branch — material still shows only fL/fC/fLC (separate `materialMarkers`). Also corrected a latent material None-mode dot divergence, the stale annotation-state test comments, and the 1.0.2 release note (which described the superseded "dots = selected" behavior). tsc + 311 web tests green.
- **Python playback test flake: `C++ object already deleted`** ✅ root-caused + fixed 2026-07-20 (Python-only, committed `1fec338`). A QObject reference cycle — `RealtimeFFTAnalyzer.proc_thread → _FftProcessingThread._mic → analyzer` — was freed non-deterministically by Python **cyclic GC**, intermittently deleting the analyzer's C++ object mid-test (was ~1-in-3 playback runs). Fixed structurally: the thread now holds a `weakref` to its owning analyzer, so it is reclaimed by deterministic refcounting; `run()` / `reset_state()` resolve and no-op if it is gone. Python-only (no Swift/parity impact). Verified: playback regression **3/3** green, full Python suite **528** green.
- **Missing-test parity slugs** ✅ committed 2026-07-18. `measurementTypeName` resolver extracted (non-private) + tested; the 3 untested `@parity` slugs (analysis-quality, mode-colors, quality-colors) now have tests on all 3; Python analysis-quality consolidated to one source (`extensions.py`); Swift annotation colour de-duped to `GuitarMode.color`. Parity `--check` fully clean (74 groups). | [ANALYSIS-QUALITY-MODECOLOR-CLEANUP.md](ANALYSIS-QUALITY-MODECOLOR-CLEANUP.md)
- **Web ⋯ menu clipped by window bottom** ✅ fixed + verified 2026-07-18 (web-only, `@parity none`). `menuPlacement()` measures real height + flips/clamps; 14-test guard. | `test/menu-placement.test.ts`
- **Loaded measurement could be silently overwritten / New Tap dead** ✅ fixed + user-verified + committed 2026-07-19 (web; found in Step-8 testing). `onLoadMeasurement` never disarmed the engine, so `isDetecting` stayed true alongside `isMeasurementComplete` (invariant **I1**): New Tap was disabled on a measurement whose own status bar says to press it, and — the serious half — ambient noise could complete a capture that **silently replaced the loaded measurement** (`onGuitarCapture` clears loadedPeaks/Name/View). Both natives document disarm-on-load (Swift "Tap detection is disabled"; Python `is_detecting = False`), so this was a **parity gap**, fixed in BOTH guitar + material branches. Was masked in dev by the old StrictMode ghost engine (its spurious `idle` re-enabled the button).
- **Mic-identity warning: stop asserting what we can't verify** ✅ decided + implemented + committed all 3, 2026-07-19 (found on Windows in Step-8 testing). The web's `normMic` stripped **all** parentheticals, so Chrome's `Microphone (Umik-1  Gain: 18dB)` collapsed to `microphone` and every cross-platform load warned; Swift/Python hit the same false positive with a stronger, worse sentence ("not currently connected" about a mic that is connected **and selected**). **Decision:** safe normalisation only (trim/whitespace/case — an exact match still silences the common same-platform reload), and report a mismatch as **UNKNOWN** with its real impact — peak frequencies are essentially mic-independent; input levels, the tap threshold, peak **selection** in marginal ranges and faint peaks (FLC) are not. Two variants (natives can say "no connected microphone matches that name"; the web only knows the selected input), **shared impact sentence**. Auto-select-on-load **rejected** — the web already auto-selects on attach, so it would only mis-report "not connected".
- **Threshold meter reads high on web during playback** ✅ root-caused + fixed + user-verified 2026-07-18, committed `c732a04` (web-only, `@parity none`). **DEV-ONLY** — React StrictMode's dev double-mount raced the async `engine.start()` and leaked a 2nd live-mic engine (the web level math was exact all along); hardened `useAudioEngine.start()` to stop the orphaned engine. Production was never affected. | [MATERIAL-LIVE-ANNOTATION-DISPLAY.md](MATERIAL-LIVE-ANNOTATION-DISPLAY.md)

**Older completed epics:**

- **File paths & names audit → 1.0.2** ✅ all 8 steps committed 2026-07-15 (one commit per repo). Unified
  save-location / naming / required-name / WAV-folder+sandbox across all three. Run-review bundled in the
  disarmed-idle **button-enablement** fix and the **audio-clock ring-out** fix
  ([DECAY-AUDIO-CLOCK-FIX.md](DECAY-AUDIO-CLOCK-FIX.md)). Spec: [FILE-PATHS-AND-NAMES-SPEC.md](FILE-PATHS-AND-NAMES-SPEC.md).
- **Re-analyze enablement (`canReanalyze`)** ✅ all 3, run-reviewed 2026-07-13. Enabled when it *could*
  help (a reset), not only when provably stale; predicate moved onto the analyzer so all 3 views bind to it.
- **Web in-app Release Notes** ✅ Help gains a third entry (TSX; `@parity none` — the web is always current).
- **Task 3 / 6-TEST** ✅ test-suite normalization across the 3 repos (Phases 1–6); 0 parity orphans;
  living coverage = `GuitarTap/TEST-COVERAGE.md`.
- **Task 4 / Platform parity gaps** ✅ OUT-1…OUT-5 shipped + run-reviewed (2026-07-13). OUT-4 found the
  relative noise-floor detector had never run in file playback; OUT-5 resolved by deletion.
- **Phases 2–5 + all of Phase 6**; Task 1/2 comment-&-doc-parity review; Material Results phased display
  (2026-07-08).

## Doc map — what each file in `Development/` is

**Open-work detail docs**
| Doc | Item | Purpose |
|---|---|---|
| [RESPIN-1.0.2-PLAN.md](RESPIN-1.0.2-PLAN.md) | 1.0.2 release | master plan for the 1.0.2 respin (resume at Step 8) |
| [PEAK-FINDING-DUPLICATE-PEAKS.md](PEAK-FINDING-DUPLICATE-PEAKS.md) | Peak finding duplicates | core `findPeaks` defect: duplicate peak per capture, all 3; evidence, root cause, red-first test plan, tracking |
| [RESTRUCTURE-NOTES.md](RESTRUCTURE-NOTES.md) | Architectural-parity restructure | view-layer restructure — raw material; spec still to be written |
| [THEME-SPEC.md](THEME-SPEC.md) | Theme | Light/Dark/System theme spec — blocked on §8 |
| [AUDIO-BUFFER-SIZE.md](AUDIO-BUFFER-SIZE.md) | Swift audio buffer size | Swift's 4800-frame buffer (not 1024) → 3 symptoms; fixes A/B/C |
| [AUDIO-WATCHDOG-SILENT-STREAM.md](AUDIO-WATCHDOG-SILENT-STREAM.md) | Audio watchdog | watchdog blind to a stream of digital silence |
| [PROJECT-HUB-REPO.md](PROJECT-HUB-REPO.md) | Project hub repo | idea: a repo for project docs + cross-repo issue tracking |
| [MATERIAL-MULTITAP-DISCREPANCIES.md](MATERIAL-MULTITAP-DISCREPANCIES.md) | Swift audio buffer size, Material multi-tap | multi-tap material analysis: buffer per-tap divergence, Gore-thickness validation |
| [PLAYBACK-BIT-IDENTITY.md](PLAYBACK-BIT-IDENTITY.md) | Playback bit-identity | replay ≠ live capture by ~0.02 dB (pre-existing capture-path gap); proven independent of the peak fix; re-run harness in playback-validation/ |
| [WEB-CHART-INTERACTION-BUGS.md](WEB-CHART-INTERACTION-BUGS.md) | Web chart-interaction bugs | 3 web-only behavioural gaps: per-annotation Reset Position, Reset Labels enablement, dot-click highlight + scroll-to-row |
| [PEAK-LIFECYCLE-SPEC.md](PEAK-LIFECYCLE-SPEC.md) | Peak lifecycle | **the spec** — detect/classify/display separated; per-peak state durable; selection model |
| [PEAK-LIFECYCLE-GAP-SWIFT.md](PEAK-LIFECYCLE-GAP-SWIFT.md) | Peak lifecycle | Swift current-state audit vs the spec: 13 gaps, 3 newly-found bugs, test impact |
| [PEAK-LIFECYCLE-PLAN-SWIFT.md](PEAK-LIFECYCLE-PLAN-SWIFT.md) | Peak lifecycle | sequenced implementation plan, Swift Phases 0–8 + Phase 9 ports; per-phase port ledgers + cross-platform anchor map |
| [PEAK-SELECTION-SURVIVES-SLIDER.md](PEAK-SELECTION-SURVIVES-SLIDER.md) | Deselect vs Peak Min | the originating bug report; superseded by the lifecycle spec — kept for the root-cause trail |
| [RESULTS-PANEL-CONSISTENCY.md](RESULTS-PANEL-CONSISTENCY.md) | Results panel consistency | live Analysis Results panel — cross-platform divergences (screenshots in `images/`); §3 Gore nesting, §7 spacing |

**Reference** (living — consult, don't complete)
| Doc | Purpose |
|---|---|
| [INVENTORY.md](INVENTORY.md) | the spec extracted from canonical Swift — the contract the port is measured against |
| [PLAN.md](PLAN.md) | overall migration plan & parity bar |
| [DEV-DOC-STANDARD.md](DEV-DOC-STANDARD.md) | comment/doc conventions |
| [WEB-UI-GUIDELINES.md](WEB-UI-GUIDELINES.md) | how the desktop/mobile UI translates to the web |
| `GuitarTap/TEST-COVERAGE.md` *(canonical repo)* | living cross-platform test-coverage reference (with the parity tooling + `PARITY-MAP.md`) |
| [PARITY-MAP.md](PARITY-MAP.md) | pointer — the generated coverage matrix lives in the Swift repo |

**History** (done — audit trail)
| Doc | Purpose |
|---|---|
| [PEAK-MIN-SEMANTICS.md](PEAK-MIN-SEMANTICS.md) | Peak Min semantics — full-set save (Option 4) + selection persistence (Option 1) + manual/doc correction; wand vs Re-analyze clarified — ✅ done (ships with the respin) |
| [DOT-ANNOTATION-PARITY.md](DOT-ANNOTATION-PARITY.md) | dot vs annotation lists — items 1–2 ✅ done + user-verified (web dots onto the shared rule; `view/dot-layer` group all 3); item 3 absorbed into the peak-lifecycle item |
| [IPAD-PLATE-PDF-SELECTION.md](IPAD-PLATE-PDF-SELECTION.md) | the iPad selection-corruption bug: investigation, Heisenbug, fix (✅ done; ships with the respin) |
| [WEB-PDF-MATERIAL-LAYOUT.md](WEB-PDF-MATERIAL-LAYOUT.md) | web material PDF fixes A–L + the Swift/Python chart defects M–O (✅ done) |
| [PYTHON-MULTITAP-MATERIAL-RESULTS.md](PYTHON-MULTITAP-MATERIAL-RESULTS.md) | Python results one-phase-lag bug + fix (✅ done) |
| [ANALYSIS-QUALITY-MODECOLOR-CLEANUP.md](ANALYSIS-QUALITY-MODECOLOR-CLEANUP.md) | analysis-quality/mode-colour/quality-colour parity + tests (✅ done) |
| [MATERIAL-LIVE-ANNOTATION-DISPLAY.md](MATERIAL-LIVE-ANNOTATION-DISPLAY.md) | live material annotation display (item 12R) + the web threshold-meter finding — both ✅ done (the latter a dev-only StrictMode engine leak) |
| [FILE-PATHS-AND-NAMES-SPEC.md](FILE-PATHS-AND-NAMES-SPEC.md) | file-paths/names audit → 1.0.2 — ✅ all 8 steps committed |
| [DECAY-AUDIO-CLOCK-FIX.md](DECAY-AUDIO-CLOCK-FIX.md) | ring-out measured in audio time — ✅ done |
| [PLATFORM-PARITY-GAPS.md](PLATFORM-PARITY-GAPS.md) | Task 4 OUT-1…OUT-5 — ✅ all done |
| [OUT-4-DETECTION-SPEC.md](OUT-4-DETECTION-SPEC.md) | OUT-4 spec + noisy-fixture design — ✅ done |
| [PHASE6-PARITY.md](PHASE6-PARITY.md) | Phase 6 parity backlog — ✅ complete |
| [6-TEST-NORMALIZATION.md](6-TEST-NORMALIZATION.md) | 6-TEST normalization — ✅ complete (Phases 1–6) |
| [LOG-FREQ-REMOVAL.md](LOG-FREQ-REMOVAL.md) | removed the dead log-frequency axis — ✅ done |
| [TAPTONEANALYZER-CONSOLIDATION.md](TAPTONEANALYZER-CONSOLIDATION.md) | Phase 6-3c analyzer/device split — ✅ done |
| [STATUS-STATE-MACHINE.md](STATUS-STATE-MACHINE.md) | status state-machine alignment — ✅ done |
| [REVIEW-TRACKER.md](REVIEW-TRACKER.md) | Task 1/2 doc-review tracker (done) + spun-out effort specs |
| [REVIEW-FINDINGS.md](REVIEW-FINDINGS.md) | behavioural gaps found during the doc review |
| [PHASE2-DSP-HARNESS.md](PHASE2-DSP-HARNESS.md) · [PHASE3-UI.md](PHASE3-UI.md) · [PHASE4-PERSISTENCE.md](PHASE4-PERSISTENCE.md) | phase specs — done |
| [MATERIAL-RESULTS-PHASED-DISPLAY.md](MATERIAL-RESULTS-PHASED-DISPLAY.md) · [MEASUREMENT-DETAILS-CONSISTENCY.md](MEASUREMENT-DETAILS-CONSISTENCY.md) · [DATE-TIME-FORMAT-CONSISTENCY.md](DATE-TIME-FORMAT-CONSISTENCY.md) | consistency specs — implemented all 3 |
| [SAMPLE-RATE-PLAN.md](SAMPLE-RATE-PLAN.md) | capture sample-rate recording — ✅ complete |