# STATUS — What's Left

**Single source of truth for open work.** If it isn't listed under "Open work" it's done or out of
scope. This file is a **status index, not a log** — one line per item: state, next action, pointer.
The detail lives in each item's linked doc.

_Last updated: 2026-07-17 — **1.0.2 RESPIN, all holds off** (user). Master plan =
[RESPIN-1.0.2-PLAN.md](RESPIN-1.0.2-PLAN.md) (start at Step 0)._

## Open work

Status key: 🔴 blocker · 📋 open/queued · ⏳ code-written-not-verified · 🔶 deferred (not blocking) · ✅ done this cycle.

| # | Item | State — next action | Detail |
|---|---|---|---|
| 1 | **1.0.2 release** | 🔴 **RESPIN in progress, all holds off.** Fix item 15 properly + fold in delayed Swift fixes (12 M/N/R + the `@parity` comment) + remove instrumentation. **NEXT = execute the plan (Step 0 = strip Swift MTDBG), then full re-test sweep (macOS·iPad·iPhone·PC·Linux) → ship.** Commit-not-amend all 3; version stays 1.0.2; build numbers roll. | [RESPIN-1.0.2-PLAN.md](RESPIN-1.0.2-PLAN.md) |
| 2 | **Architectural-parity restructure** (view layer) | 📋 Write the **spec first** to size it; no code yet. Lands the 2 parked test items (frozen-peak-recalc selection half + `annotation-state` 3-way). | [RESTRUCTURE-NOTES.md](RESTRUCTURE-NOTES.md) |
| 3 | **Theme — Light/Dark/System** | 📋 Blocked on THEME-SPEC §8 (light gradient + chrome hexes). The systemBlue token (all 3) is this work's seam. | [THEME-SPEC.md](THEME-SPEC.md) |
| 4 | **Swift audio buffer size** (4800 frames, not the 1024 requested) | 🔶 NOT blocking (immaterial to lutherie). One cause → ring-out/peak-freq/WAV-length divergence. The 3-tap plate FALSIFIED the "first-tap only" narrowing → it's **per-tap**. **NEXT = iPad `buffer.frameLength` experiment** (may confirm root cause outright); do fix A first. | [AUDIO-BUFFER-SIZE.md](AUDIO-BUFFER-SIZE.md) · MATERIAL-MULTITAP §3 |
| 5 | **Audio watchdog blind to a SILENT stream** | 🔶 NOT blocking (self-recovers). "Alive" = chunks arriving, not chunks *containing audio*. Fix needs a signal-level criterion + design (false-positive risk). | [AUDIO-WATCHDOG-SILENT-STREAM.md](AUDIO-WATCHDOG-SILENT-STREAM.md) |
| 6 | **Project hub repo** (docs + cross-repo bug tracking) | 📋 IDEA, needs a spec; no action yet. Enabler = Swift going open source. | [PROJECT-HUB-REPO.md](PROJECT-HUB-REPO.md) |
| 7 | **Web PDF material report** (fixes A–L) | ✅ DONE + user-verified 2026-07-16 (web). ⚠ Python got fix K too — needs run-review, **rides the respin**. | [WEB-PDF-MATERIAL-LAYOUT.md](WEB-PDF-MATERIAL-LAYOUT.md) |
| 8 | **Swift `measurementTypeName` test missing** | 📋 Post-release. Swift's parity slot is `—`; the resolver is `private` → untestable without an app change (extract it / drop `private`). Consider folding into item 2. | MATERIAL-MULTITAP §2 |
| 9 | **Material multi-tap: Swift ~2 dB / sub-bin below Python/web** | 🔶 NOT blocking (fL agrees; derived props follow frequency). **Same 4800-buffer cause as item 4** — resolve there, don't chase separately. | MATERIAL-MULTITAP §3 |
| 10 | **Web ⋯ menu clipped by window bottom** | ✅ FIXED + user-verified 2026-07-18 (web-only, `@parity none`). `menuPlacement()` measures real height + flips/clamps; 14-test guard. | `test/menu-placement.test.ts` |
| 11 | **Results panel cross-platform consistency** | 📋 Post-release; presentation only (numbers correct). 7 divergences pointing 3 ways (order · Showing-row · nesting · boxing · labels · title-colour · spacing); #8 (Overall Quality colour) already fixed. Spec against Swift first. | [RESULTS-PANEL-CONSISTENCY.md](RESULTS-PANEL-CONSISTENCY.md) |
| 12 | **Swift/Python non-web defects (index)** | ✅ **M/N/R DONE + user-verified 2026-07-17** (respin Step 2): M plate chips role labels; N legend `(L)`/`(C)` suffixes; R live material annotations now show the accumulated identified peaks on both natives (progressive, no flicker). 📋 **O/P/Q (Python: date format · panel spacing · Gore nesting) = still open, post-respin.** | [WEB-PDF-MATERIAL-LAYOUT.md](WEB-PDF-MATERIAL-LAYOUT.md) §M–O · [MATERIAL-LIVE-ANNOTATION-DISPLAY.md](MATERIAL-LIVE-ANNOTATION-DISPLAY.md) (R) · [RESULTS-PANEL-CONSISTENCY.md](RESULTS-PANEL-CONSISTENCY.md) §3,§7 |
| 13 | **Web SAVED multi-tap guitar PDF missing 2nd page** | ✅ FIXED + user-verified 2026-07-16 (web). Wiring gap — the saved-export site lacked the multi-tap gate `App.tsx` already had. | *(done — in the web working tree)* |
| 14 | **Python multi-tap material results one-phase lag** | ✅ FIXED + user-verified 2026-07-16 (Python, committed). Resolve from the persistent per-phase lists, not transient `current_peaks`. | [PYTHON-MULTITAP-MATERIAL-RESULTS.md](PYTHON-MULTITAP-MATERIAL-RESULTS.md) |
| 15 | **iPad Swift: plate/brace selection corrupted (only fC saved)** | ✅ **FIX DONE + USER-VERIFIED incl. iPad DEVICE (2026-07-17)** — the respin's Step 1 (all 3 platforms). Material has no per-peak selection; the aggregate is ignored on read + healed on load, so the corruption is inert. (Visibility-UI refined + user-verified all 3 on 2026-07-18: 3-state button kept on all types, material All==Selected, no coercion.) Corrupt iPad files now render all three peaks everywhere. **Respin not yet shipped** (Steps 3/6/7/8 remain). | [IPAD-PLATE-PDF-SELECTION.md](IPAD-PLATE-PDF-SELECTION.md) · RESPIN-1.0.2-PLAN |
| 16 | **Threshold input-level meter reads high on web** vs Swift/Python | 📋 OPEN, found 2026-07-17 during the plate-playback R testing. Same file → the web's Threshold meter shows a much higher input level than the natives. Detection still succeeds on all three (final peaks correct) → a level-**display** scaling difference (calibration/dBFS reference on the meter), NOT a detection defect and NOT caused by the respin. Needs its own investigation; possibly item-4 family but distinct. | [MATERIAL-LIVE-ANNOTATION-DISPLAY.md](MATERIAL-LIVE-ANNOTATION-DISPLAY.md) §Still-open |
| 17 | **Python: progress bar lingers after load-guitar-following-material** | ⏸ PARKED 2026-07-17 (user) — may just be reset-timing differing across platforms, not a real bug. **Confirm it reproduces before acting.** Progress bar = `_sb_progress` (`tap_tone_analysis_view.py`), visibility at `:2358`/`:3276`. | *(this row)* |

### ⚠ Uncommitted Swift working-tree state (lands in the respin)

The Swift tree (build 398, on TestFlight) holds two uncommitted things: **(a)** the MTDBG debug
instrumentation, and **(b)** the `@parity model/quality-colors` comment in `MaterialProperties.swift`.
The respin **removes (a) in Step 0** and **commits (b) in Step 3**. Until the respin commits, build 398
is unchanged. **`git status` each repo before committing** — the RESPIN plan has the full expected list.

## Done (for reference)

Older completed epics (audit trail, not a to-do list):

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
| [RESPIN-1.0.2-PLAN.md](RESPIN-1.0.2-PLAN.md) | 1 | master plan for the 1.0.2 respin (start at Step 0) |
| [IPAD-PLATE-PDF-SELECTION.md](IPAD-PLATE-PDF-SELECTION.md) | 15 | the selection-corruption bug: investigation, Heisenbug, fix design |
| [RESTRUCTURE-NOTES.md](RESTRUCTURE-NOTES.md) | 2 | view-layer restructure — raw material; spec still to be written |
| [THEME-SPEC.md](THEME-SPEC.md) | 3 | Light/Dark/System theme spec — blocked on §8 |
| [AUDIO-BUFFER-SIZE.md](AUDIO-BUFFER-SIZE.md) | 4 | Swift's 4800-frame buffer (not 1024) → 3 symptoms; fixes A/B/C |
| [AUDIO-WATCHDOG-SILENT-STREAM.md](AUDIO-WATCHDOG-SILENT-STREAM.md) | 5 | watchdog blind to a stream of digital silence |
| [PROJECT-HUB-REPO.md](PROJECT-HUB-REPO.md) | 6 | idea: a repo for project docs + cross-repo issue tracking |
| [WEB-PDF-MATERIAL-LAYOUT.md](WEB-PDF-MATERIAL-LAYOUT.md) | 7, 12 M–O | web material PDF fixes A–L (done) + the Swift/Python chart defects |
| [MATERIAL-MULTITAP-DISCREPANCIES.md](MATERIAL-MULTITAP-DISCREPANCIES.md) | 4, 8, 9 | multi-tap material analysis: buffer per-tap divergence, Gore-thickness validation, the Details `—` fix |
| [RESULTS-PANEL-CONSISTENCY.md](RESULTS-PANEL-CONSISTENCY.md) | 11, 12 P/Q | live Analysis Results panel — cross-platform divergences (screenshots in `images/`) |
| [MATERIAL-LIVE-ANNOTATION-DISPLAY.md](MATERIAL-LIVE-ANNOTATION-DISPLAY.md) | 12 R, 16 | live material annotation fix (both natives) + the web threshold-meter finding |
| [PYTHON-MULTITAP-MATERIAL-RESULTS.md](PYTHON-MULTITAP-MATERIAL-RESULTS.md) | 14 | Python results one-phase-lag bug + fix (done) |

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