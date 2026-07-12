# STATUS — What's Left

**This is the single source of truth for open work.** If it isn't listed under
"Open work" below, it's done or out of scope. Every other doc in `Development/`
is either a detail doc for one of these items, living reference, or history —
see the doc map at the bottom. Detail docs keep their own granular checkboxes;
this file just points at them.

_Last updated: 2026-07-12._

## Open work

| # | Item | Status | Detail doc |
|---|---|---|---|
| 1 | **Task 3 / 6-TEST** — cross-platform test-suite normalization (major) | **✅ COMPLETE (Phases 1–6).** All test suites normalized to the Swift spine across the 3 repos; **0 parity orphans**, 2 documented coverage gaps (dsp/analysis-quality, model/mode-colors), 2 platform-only suites (`@parity none`). Phase 4 back-ports done, Phase 5 `tests=` links + coverage-gap report (`--gaps`), Phase 6 living coverage doc. Two deferred-but-tracked follow-ups: the pipeline-progress transients (4b) + `annotation-state`/frozen-peak-recalc's selection half → **P3** (item 2). The **living coverage reference is now `GuitarTap/TEST-COVERAGE.md`**; this row is done. | `GuitarTap/TEST-COVERAGE.md` · [6-TEST-NORMALIZATION.md](6-TEST-NORMALIZATION.md) |
| 2 | **Architectural-parity restructure** (view layer) | Planned post-review — needs its own spec before any code moves | [RESTRUCTURE-NOTES.md](RESTRUCTURE-NOTES.md) |
| 3 | **Theme — Light / Dark / System** | Blocked on THEME-SPEC § 8 decisions (light gradient + chrome hexes) | [THEME-SPEC.md](THEME-SPEC.md) |
| 4 | **Platform parity gaps** (Swift/Python/web behavior + UI) — **IN PROGRESS** | **2 open of 5.** ✅ **OUT-1** (phase-guidance-through-warmup) · ✅ **OUT-2** (status-bar progress bar + `sbProgress` text) · ✅ **OUT-3** (web Bin Count) — all user run-reviewed. **Open: OUT-4** (material tap-detection model — port Swift/Python's relative noise-floor EMA + a silent settling window to the web; user: the relative model is the beta-tested one) · **OUT-5** (reduce-count-mid-sequence — decided: adopt Python's synchronous finalise, which means editing canonical Swift). The OUT-2/3 run-review found **6 bugs the green suites missed**, incl. a 3-way divergence in the material tap count and 5 different blues in one status bar — see the doc. | [PLATFORM-PARITY-GAPS.md](PLATFORM-PARITY-GAPS.md) · [STATUS-STATE-MACHINE.md](STATUS-STATE-MACHINE.md) |

## Done (for reference)

Everything else is complete: Phases 2–5, all of Phase 6 **except** 6-TEST, and the
entire Task 1 / Task 2 comment-&-doc-parity review (all `@parity` slugs + map
cleanup). The Material Results phased display shipped 2026-07-08.

## Doc map — what each file in `Development/` is

**Index**
| Doc | Purpose |
|---|---|
| [STATUS.md](STATUS.md) | *(this file)* the only open-work list |
| [README.md](README.md) | repo overview, build, deploy |

**Open-work detail docs** (the open items above)
| Doc | Purpose |
|---|---|
| [RESTRUCTURE-NOTES.md](RESTRUCTURE-NOTES.md) | view-layer restructure — raw material; spec still to be written |
| [THEME-SPEC.md](THEME-SPEC.md) | Light/Dark/System theme spec — blocked on § 8 |
| [PLATFORM-PARITY-GAPS.md](PLATFORM-PARITY-GAPS.md) | cross-platform Swift/Python/web behavior+UI gaps (OUT-2/3/4/5) — separate effort, post-Phase-6 |

**Reference** (living — consult, don't complete)
| Doc | Purpose |
|---|---|
| [INVENTORY.md](INVENTORY.md) | the spec extracted from canonical Swift — the contract the port is measured against |
| [PLAN.md](PLAN.md) | overall migration plan & parity bar |
| [DEV-DOC-STANDARD.md](DEV-DOC-STANDARD.md) | comment/doc conventions for the review |
| [WEB-UI-GUIDELINES.md](WEB-UI-GUIDELINES.md) | how the desktop/mobile UI translates to the web |
| `GuitarTap/TEST-COVERAGE.md` *(canonical repo, not here)* | **living cross-platform test-coverage reference** — the `@parity` system, matrix + equivalence, the change-all-three rule, how to run the tools, current gaps/platform-only. Lives with the parity tooling + `PARITY-MAP.md` in canonical `GuitarTap`, not in this transient Development/ dir. |
| [PARITY-MAP.md](PARITY-MAP.md) | pointer — the generated coverage matrix lives in the Swift repo |

**History** (done — audit trail, not a to-do list)
| Doc | Purpose |
|---|---|
| [PHASE6-PARITY.md](PHASE6-PARITY.md) | Phase 6 parity backlog — ✅ COMPLETE (last item § 6-TEST done); coverage now lives in `GuitarTap/TEST-COVERAGE.md` |
| [6-TEST-NORMALIZATION.md](6-TEST-NORMALIZATION.md) | 6-TEST normalization — ✅ COMPLETE (Phases 1–6); project history, living reference is `GuitarTap/TEST-COVERAGE.md` |
| [LOG-FREQ-REMOVAL.md](LOG-FREQ-REMOVAL.md) | removed the dead log-frequency axis — ✅ done 2026-07-08 (B1) |
| [TAPTONEANALYZER-CONSOLIDATION.md](TAPTONEANALYZER-CONSOLIDATION.md) | Phase 6-3c consolidation spec — ✅ done 2026-07-12 (analyzer/device split); parity gaps it surfaced live in PLATFORM-PARITY-GAPS.md |
| [STATUS-STATE-MACHINE.md](STATUS-STATE-MACHINE.md) | Status state-machine alignment (silent warm-up + derived status) — ✅ done (Swift+Python; web already conformant); fixed OUT-1 at the root |
| [REVIEW-TRACKER.md](REVIEW-TRACKER.md) | Task 1/2 doc-review tracker (done) + the spun-out effort specs |
| [REVIEW-FINDINGS.md](REVIEW-FINDINGS.md) | behavioural gaps found during the doc review + fixes |
| [PHASE2-DSP-HARNESS.md](PHASE2-DSP-HARNESS.md) | headless DSP test plan — done |
| [PHASE3-UI.md](PHASE3-UI.md) | React UI + material-measurement build — done |
| [PHASE4-PERSISTENCE.md](PHASE4-PERSISTENCE.md) | `.guitartap` persistence — done |
| [MATERIAL-RESULTS-PHASED-DISPLAY.md](MATERIAL-RESULTS-PHASED-DISPLAY.md) | phased Analysis Results — done 2026-07-08 |
| [MEASUREMENT-DETAILS-CONSISTENCY.md](MEASUREMENT-DETAILS-CONSISTENCY.md) | Measurement Details pane — implemented all 3 |
| [DATE-TIME-FORMAT-CONSISTENCY.md](DATE-TIME-FORMAT-CONSISTENCY.md) | date/time display — implemented all 3 |
| [SAMPLE-RATE-PLAN.md](SAMPLE-RATE-PLAN.md) | capture sample-rate recording — ✅ complete all 3 (verified 2026-07-08); only an optional Swift mock-device unit test remains, non-blocking |