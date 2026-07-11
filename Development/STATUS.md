# STATUS — What's Left

**This is the single source of truth for open work.** If it isn't listed under
"Open work" below, it's done or out of scope. Every other doc in `Development/`
is either a detail doc for one of these items, living reference, or history —
see the doc map at the bottom. Detail docs keep their own granular checkboxes;
this file just points at them.

_Last updated: 2026-07-10._

## Open work

| # | Item | Status | Detail doc |
|---|---|---|---|
| 1 | **Task 3 / 6-TEST** — cross-platform test-suite normalization (major) | **In progress** — Phases 1-2 done; **Phase 3: PC-1..PC-4 ALL done + validated + committed** (2026-07-09). PC-1 Cancel=restart + button rule (all 3) + web fallout (arming, status, taps-lock); PC-2 web `statusMessage.ts` extraction; PC-3 Python brace "Tap X/N"; PC-4 web `setConfig` progress re-fire (Python/Swift already correct). **3c consolidation UNDERWAY** (spec [TAPTONEANALYZER-CONSOLIDATION.md](TAPTONEANALYZER-CONSOLIDATION.md); goal = align web arch to canonical, names+responsibilities): 3c-0/A/A2/B/C1/C2a ✅ committed 2026-07-10. **C2b implemented 2026-07-11 but NOT committed — folded into the new Peak-analysis effort** (user 2026-07-11: "do what Swift does"): Swift's per-tap `TapEntry` carries peaks, so the web analyzer must own peak analysis, not the view. **Peak-analysis P1 + P1b + P2 IMPLEMENTED + green 2026-07-11 (tsc · 205 tests · build), NOT yet committed:** P1 = main peaks + classification into the analyzer (absorbs C2b); P1b = live peaks track the spectrum while waiting for a tap (Swift `analyzeMagnitudes`); P2 = `tapEntries` carrying peaks (`recalculateTapEntryPeaks`), superseding `tapSpectra` (name+content alignment). P1 & P1b user-run-reviewed OK; **P2 run-review pending**. Per plan (b) commit **C2b + P1 + P1b + P2 together** after P2 review, so `tapSpectra` never lands. **NEXT after commit = resume 3c-C3** (absorb material, del useMaterialSession) → C4 (imperative statusMessage + EG-1) → C5 (shrink useAudioEngine) → 3c-D (collapse rules). **P3** (selection/overrides/annotation offsets → analyzer) captured in [RESTRUCTURE-NOTES.md](RESTRUCTURE-NOTES.md). **EG-3** (Peak Min chart line) deferred. Spec: [TAPTONEANALYZER-CONSOLIDATION.md](TAPTONEANALYZER-CONSOLIDATION.md) §10. Then pure gaps + orphan back-ports; PC-1 docs + EG-2 pending | [6-TEST-NORMALIZATION.md](6-TEST-NORMALIZATION.md) (plan + PC-1..4 + EG) · [TAPTONEANALYZER-CONSOLIDATION.md](TAPTONEANALYZER-CONSOLIDATION.md) |
| 2 | **Architectural-parity restructure** (view layer) | Planned post-review — needs its own spec before any code moves | [RESTRUCTURE-NOTES.md](RESTRUCTURE-NOTES.md) |
| 3 | **Theme — Light / Dark / System** | Blocked on THEME-SPEC § 8 decisions (light gradient + chrome hexes) | [THEME-SPEC.md](THEME-SPEC.md) |

Notes:
- **Parity gaps EG-1 / EG-2 / EG-3 (web-only, tracked in [6-TEST-NORMALIZATION.md](6-TEST-NORMALIZATION.md) § EG):**
  **EG-1** — the web gated capture has no empty/no-peak failure path (a no-resonance material tap is silently
  accepted with a null peak instead of re-arming + "No signal/resonance detected — tap again"); EG-1 folds
  into the 3c consolidation (3c-C). **EG-2** — material mode never shows the LIVE spectrum during capture
  (guitar does; the material chart paints only captured phases), pre-existing view gap; fix separately.
  **EG-3 (OPEN, deferred — user 2026-07-11)** — Swift/Python draw a horizontal **Peak Min threshold line** on the
  spectrum chart; the web doesn't. Small independent view/chart feature (a reference line at `peakMin` dB on
  `SpectrumChart`), not part of the analyzer/peak refactor; do it after the peak effort.
  _(A related pre-existing gap — guitar peak list/annotations not updating on the LIVE spectrum while waiting for
  a tap — was **fixed in 3c §10 P1b**, 2026-07-11: `recalculatePeaks` now runs on the live spectrum during detection.)_
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