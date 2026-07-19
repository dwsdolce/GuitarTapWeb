# STATUS — What's Left

**Single source of truth for open work.** If it isn't listed under "Open work" it's done or out of
scope. This file is a **status index, not a log** — one line per item: state, next action, pointer.
The detail lives in each item's linked doc.

_Last updated: 2026-07-18 — **1.0.2 RESPIN, all holds off** (user). Master plan =
[RESPIN-1.0.2-PLAN.md](RESPIN-1.0.2-PLAN.md) (start at Step 7)._

## Open work

Status key: 🔴 blocker · 📋 open/queued · ⏳ code-written-not-verified · 🔶 deferred (not blocking).

| # | Item | State — next action | Detail |
|---|---|---|---|
| 1 | **1.0.2 release (respin)** | 🔴 **In progress.** Steps 0–6 DONE (Swift instrumentation stripped · material-selection fix all 3 · chart M/N/R · `@parity` commit · release-notes + help docs). **NEXT = Step 7** — the poisoned-fixture 3-way test (a new `test/material-selection` slug asserting a corrupt material `.guitartap` renders all three L/C/FLC on Swift/Python/web; **does not exist yet**). **Then Step 8 — ship:** full re-test sweep (macOS·iPad·iPhone·PC·Linux) → TestFlight upload · Python installers · web redeploy. Commit-not-amend all 3; version stays 1.0.2; build numbers roll. | [RESPIN-1.0.2-PLAN.md](RESPIN-1.0.2-PLAN.md) |
| 2 | **Architectural-parity restructure** (view layer) | 📋 Write the **spec first** to size it; no code yet. Lands the 2 parked test items (frozen-peak-recalc selection half + `annotation-state` 3-way). | [RESTRUCTURE-NOTES.md](RESTRUCTURE-NOTES.md) |
| 3 | **Theme — Light/Dark/System** | 📋 Blocked on THEME-SPEC §8 (light gradient + chrome hexes). The systemBlue token (all 3) is this work's seam. Also owns the deferred colour-value work: the `WoodQuality.color`/mode-colour layer violation (colour hung off the model enum on Swift/Python) and any cross-platform hue reconciliation. | [THEME-SPEC.md](THEME-SPEC.md) |
| 4 | **Swift audio buffer size** (4800 frames, not the 1024 requested) | 🔶 NOT blocking (immaterial to lutherie). One cause → ring-out/peak-freq/WAV-length divergence. The 3-tap plate FALSIFIED the "first-tap only" narrowing → it's **per-tap**. **NEXT = iPad `buffer.frameLength` experiment** (may confirm root cause outright); do fix A first. | [AUDIO-BUFFER-SIZE.md](AUDIO-BUFFER-SIZE.md) · MATERIAL-MULTITAP §3 |
| 5 | **Audio watchdog blind to a SILENT stream** | 🔶 NOT blocking (self-recovers). "Alive" = chunks arriving, not chunks *containing audio*. Fix needs a signal-level criterion + design (false-positive risk). | [AUDIO-WATCHDOG-SILENT-STREAM.md](AUDIO-WATCHDOG-SILENT-STREAM.md) |
| 6 | **Project hub repo** (docs + cross-repo bug tracking) | 📋 IDEA, needs a spec; no action yet. Enabler = Swift going open source. | [PROJECT-HUB-REPO.md](PROJECT-HUB-REPO.md) |
| 7 | **Material multi-tap: Swift ~2 dB / sub-bin below Python/web** | 🔶 NOT blocking (fL agrees; derived props follow frequency). **Same 4800-buffer cause as the Swift audio-buffer-size item** — resolve there, don't chase separately. | MATERIAL-MULTITAP §3 |
| 8 | **Results panel cross-platform consistency** | 📋 Post-release; presentation only (numbers correct). 7 divergences pointing 3 ways (order · Showing-row · nesting · boxing · labels · title-colour · spacing) — this **includes** the Python Gore-box **nesting** (§3) and vertical **spacing** (§7) once mis-filed as separate "P/Q" items. Overall-Quality colour already fixed. Spec against Swift first. | [RESULTS-PANEL-CONSISTENCY.md](RESULTS-PANEL-CONSISTENCY.md) |
| 9 | **Python: progress bar lingers after load-guitar-following-material** | ⏸ PARKED 2026-07-17 (user) — may just be reset-timing differing across platforms, not a real bug. **Confirm it reproduces before acting.** Progress bar = `_sb_progress` (`tap_tone_analysis_view.py`), visibility at `:2358`/`:3276`. | *(this row)* |

## Done (for reference)

Audit trail, not a to-do list.

**1.0.2 respin sub-work** (all committed; only *shipping* remains — the 1.0.2 respin item):

- **iPad Swift plate/brace selection corruption** ✅ fix done + user-verified incl. the iPad DEVICE (2026-07-17). Material has no per-peak selection; the saved aggregate is ignored on read + healed on load, so the corruption is inert; corrupt files now render all three peaks everywhere. Visibility UI: 3-state button on every type, material All==Selected, no coercion (verified all 3, 2026-07-18). | [IPAD-PLATE-PDF-SELECTION.md](IPAD-PLATE-PDF-SELECTION.md)
- **Swift/Python material chart/report defects (M/N/O/R)** ✅ done: **M** plate chips use L/C/FLC role labels; **N** legend `(L)`/`(C)` suffixes; **O** date format → comma (Swift/web separate date+time join, list + compact variants; Python already comma); **R** live material annotations show accumulated identified peaks progressively (both natives). | [WEB-PDF-MATERIAL-LAYOUT.md](WEB-PDF-MATERIAL-LAYOUT.md) §M–O
- **Web PDF material report (fixes A–L) + Python fix K** ✅ done + user-verified 2026-07-16.
- **Web saved multi-tap guitar PDF missing 2nd page** ✅ fixed + verified 2026-07-16 (wiring gap — saved-export site lacked the multi-tap gate App.tsx had).
- **Python multi-tap material results one-phase lag** ✅ fixed + verified 2026-07-16 (resolve from the persistent per-phase lists, not transient `current_peaks`). | [PYTHON-MULTITAP-MATERIAL-RESULTS.md](PYTHON-MULTITAP-MATERIAL-RESULTS.md)

**Other completed this cycle:**

- **Missing-test parity slugs** ✅ committed 2026-07-18. `measurementTypeName` resolver extracted (non-private) + tested; the 3 untested `@parity` slugs (analysis-quality, mode-colors, quality-colors) now have tests on all 3; Python analysis-quality consolidated to one source (`extensions.py`); Swift annotation colour de-duped to `GuitarMode.color`. Parity `--check` fully clean (74 groups). | [ANALYSIS-QUALITY-MODECOLOR-CLEANUP.md](ANALYSIS-QUALITY-MODECOLOR-CLEANUP.md)
- **Web ⋯ menu clipped by window bottom** ✅ fixed + verified 2026-07-18 (web-only, `@parity none`). `menuPlacement()` measures real height + flips/clamps; 14-test guard. | `test/menu-placement.test.ts`
- **Threshold meter reads high on web during playback** ✅ root-caused + fixed + user-verified 2026-07-18 (commit pending; web-only, `@parity none`). **DEV-ONLY** — React StrictMode's dev double-mount raced the async `engine.start()` and leaked a 2nd live-mic engine (the web level math was exact all along); hardened `useAudioEngine.start()` to stop the orphaned engine. Production was never affected. | [MATERIAL-LIVE-ANNOTATION-DISPLAY.md](MATERIAL-LIVE-ANNOTATION-DISPLAY.md)

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
| [RESPIN-1.0.2-PLAN.md](RESPIN-1.0.2-PLAN.md) | 1 | master plan for the 1.0.2 respin (resume at Step 7) |
| [RESTRUCTURE-NOTES.md](RESTRUCTURE-NOTES.md) | 2 | view-layer restructure — raw material; spec still to be written |
| [THEME-SPEC.md](THEME-SPEC.md) | 3 | Light/Dark/System theme spec — blocked on §8 |
| [AUDIO-BUFFER-SIZE.md](AUDIO-BUFFER-SIZE.md) | 4 | Swift's 4800-frame buffer (not 1024) → 3 symptoms; fixes A/B/C |
| [AUDIO-WATCHDOG-SILENT-STREAM.md](AUDIO-WATCHDOG-SILENT-STREAM.md) | 5 | watchdog blind to a stream of digital silence |
| [PROJECT-HUB-REPO.md](PROJECT-HUB-REPO.md) | 6 | idea: a repo for project docs + cross-repo issue tracking |
| [MATERIAL-MULTITAP-DISCREPANCIES.md](MATERIAL-MULTITAP-DISCREPANCIES.md) | 4, 7 | multi-tap material analysis: buffer per-tap divergence, Gore-thickness validation |
| [RESULTS-PANEL-CONSISTENCY.md](RESULTS-PANEL-CONSISTENCY.md) | 8 | live Analysis Results panel — cross-platform divergences (screenshots in `images/`); §3 Gore nesting, §7 spacing |

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