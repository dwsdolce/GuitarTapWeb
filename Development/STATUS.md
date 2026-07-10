# STATUS — What's Left

**This is the single source of truth for open work.** If it isn't listed under
"Open work" below, it's done or out of scope. Every other doc in `Development/`
is either a detail doc for one of these items, living reference, or history —
see the doc map at the bottom. Detail docs keep their own granular checkboxes;
this file just points at them.

_Last updated: 2026-07-09._

## Open work

| # | Item | Status | Detail doc |
|---|---|---|---|
| 1 | **Task 3 / 6-TEST** — cross-platform test-suite normalization (major) | **In progress** — Phases 1-2 done; **Phase 3 underway**: `TapSession` + 5 behavioral suites built; **PC-1 (Cancel = restart, New Tap only when complete) DONE + validated + committed all 3** (2026-07-09; Swift 317 · Python 378 · web 179), incl. the web fallout it exposed (unified arming, "Tap the guitar…" status + brace counter, taps-lock rule). **Next: PC-2 (statusMessage)** → PC-3/4 → `TapSession` state-ownership consolidation (useSyncExternalStore); PC-1 docs pending | [6-TEST-NORMALIZATION.md](6-TEST-NORMALIZATION.md) (plan + PC-1..4) · [PHASE6-PARITY.md](PHASE6-PARITY.md) § 6-TEST |
| 2 | **Architectural-parity restructure** (view layer) | Planned post-review — needs its own spec before any code moves | [RESTRUCTURE-NOTES.md](RESTRUCTURE-NOTES.md) |
| 3 | **Theme — Light / Dark / System** | Blocked on THEME-SPEC § 8 decisions (light gradient + chrome hexes) | [THEME-SPEC.md](THEME-SPEC.md) |

Notes:
- **Engine-parity gap EG-1 (web-only, found during PC-2):** the web gated capture has no empty/no-peak
  failure path — a material tap with no resonance is silently accepted with a null peak instead of re-arming
  + "No signal/resonance detected — tap again" like Swift/Python. Tracked in [6-TEST-NORMALIZATION.md](6-TEST-NORMALIZATION.md) § EG-1.
- The doc review's deferred `signal.ts` two-tone helper (item 4 of the `@parity`
  tail) **folds into #1** — it's a test-only helper reviewed with the parity tests.
- Of the three: **#1** can start now; **#2** needs a spec written first; **#3**
  is waiting on decisions, not implementation time.
- **Log-frequency axis removal — ✅ DONE (2026-07-08)** — removed lock-step all three (B1: kept the
  format field pinned false). See [LOG-FREQ-REMOVAL.md](LOG-FREQ-REMOVAL.md).

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
| [PHASE6-PARITY.md](PHASE6-PARITY.md) | Phase 6 parity backlog — all done **except § 6-TEST** |
| [6-TEST-NORMALIZATION.md](6-TEST-NORMALIZATION.md) | 6-TEST analysis + coverage matrix + phased plan + PC-1..4 parity cleanup (Phase 3 in progress) |
| [RESTRUCTURE-NOTES.md](RESTRUCTURE-NOTES.md) | view-layer restructure — raw material; spec still to be written |
| [THEME-SPEC.md](THEME-SPEC.md) | Light/Dark/System theme spec — blocked on § 8 |
| [LOG-FREQ-REMOVAL.md](LOG-FREQ-REMOVAL.md) | remove the dead log-frequency axis — ✅ done 2026-07-08 (B1) |

**Reference** (living — consult, don't complete)
| Doc | Purpose |
|---|---|
| [INVENTORY.md](INVENTORY.md) | the spec extracted from canonical Swift — the contract the port is measured against |
| [PLAN.md](PLAN.md) | overall migration plan & parity bar |
| [DEV-DOC-STANDARD.md](DEV-DOC-STANDARD.md) | comment/doc conventions for the review |
| [WEB-UI-GUIDELINES.md](WEB-UI-GUIDELINES.md) | how the desktop/mobile UI translates to the web |
| [PARITY-MAP.md](PARITY-MAP.md) | pointer — the map is now generated and lives in the Swift repo |

**History** (done — audit trail, not a to-do list)
| Doc | Purpose |
|---|---|
| [REVIEW-TRACKER.md](REVIEW-TRACKER.md) | Task 1/2 doc-review tracker (done) + the spun-out effort specs |
| [REVIEW-FINDINGS.md](REVIEW-FINDINGS.md) | behavioural gaps found during the doc review + fixes |
| [PHASE2-DSP-HARNESS.md](PHASE2-DSP-HARNESS.md) | headless DSP test plan — done |
| [PHASE3-UI.md](PHASE3-UI.md) | React UI + material-measurement build — done |
| [PHASE4-PERSISTENCE.md](PHASE4-PERSISTENCE.md) | `.guitartap` persistence — done |
| [MATERIAL-RESULTS-PHASED-DISPLAY.md](MATERIAL-RESULTS-PHASED-DISPLAY.md) | phased Analysis Results — done 2026-07-08 |
| [MEASUREMENT-DETAILS-CONSISTENCY.md](MEASUREMENT-DETAILS-CONSISTENCY.md) | Measurement Details pane — implemented all 3 |
| [DATE-TIME-FORMAT-CONSISTENCY.md](DATE-TIME-FORMAT-CONSISTENCY.md) | date/time display — implemented all 3 |
| [SAMPLE-RATE-PLAN.md](SAMPLE-RATE-PLAN.md) | capture sample-rate recording — ✅ complete all 3 (verified 2026-07-08); only an optional Swift mock-device unit test remains, non-blocking |