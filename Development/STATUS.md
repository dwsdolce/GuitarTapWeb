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
| 1 | **Task 3 / 6-TEST** — cross-platform test-suite normalization (major) | **In progress** — Phases 1-2 done; **Phase 3: PC-1..PC-4 ALL done + validated + committed** (2026-07-09). PC-1 Cancel=restart + button rule (all 3) + web fallout (arming, status, taps-lock); PC-2 web `statusMessage.ts` extraction; PC-3 Python brace "Tap X/N"; PC-4 web `setConfig` progress re-fire (Python/Swift already correct). **3c consolidation UNDERWAY** (spec [TAPTONEANALYZER-CONSOLIDATION.md](TAPTONEANALYZER-CONSOLIDATION.md); goal = align web arch to canonical, names+responsibilities): 3c-0/A/A2/B/C1/C2a ✅ committed 2026-07-10. **Peak-analysis effort (§10, folds C2b) — C2b + P1 + P1b + P2 + selection-flicker fix ✅ committed 2026-07-11** (user "do what Swift does" — the analyzer owns peak analysis, not the view; run-reviewed "runs smoothly"): P1 = main peaks + classification into the analyzer (`recalculatePeaks`, loaded-authoritative filter); P1b = live peaks track the spectrum while waiting (Swift `analyzeMagnitudes`); P2 = `tapEntries` carrying peaks (`recalculateTapEntryPeaks`), replacing `tapSpectra`; selection fix = effective selection derived synchronously (`userModified ? selectedIds : autoIds`, matches Swift `applyFrozenPeakState`), no more "selected"-mode Peak-Min flicker. **3c-C3a ✅ committed 2026-07-12** — plate/brace phase machine moved onto the analyzer, **`useMaterialSession` deleted**, analyzer holds a device reference (`setDevice`) + owns matSpectra/matPeaks (snapshot) + all 6 transitions; calibration read from device, measureFlc mirrored; fixed a latent bug (analyzer.measurementType never synced + duplicated — reconciled to the single settings type). **3c-C3b ✅ committed 2026-07-12** — material averaging + peak-find moved up off the device (device emits raw per-phase gated taps via `onMaterialTap`/`onMaterialPhaseComplete`, analyzer accumulates+averages+findDominantPeak; device now a pure gated-capture emitter for guitar + material; REG-B1/P1/P2 oracles unchanged). **3c-C4 ✅ committed 2026-07-12 (`e98d4da`)** — imperative `statusMessage` field (D3, clipping override/restore) + EG-1 via **Option C** (per-tap material peak-gate + count + re-arm + L→C→FLC auto-advance move onto the analyzer; device is a pure gated-FFT emitter; "No resonance detected — tap again" re-tap); "Analysis complete!" set-once/frozen-N; `statusMessage.ts` deleted. **Run-reviewed** (step-by-step Swift↔web): RF-1 (Peak readout ← liveSpectrum) + RF-2 (level at FFT-rate, -100 until first frame) folded in; 3 parity gaps found → **spun out to their own backlog** (see Notes "Parity gaps found during 3c review" — NOT consolidation work, don't gate 3c). **NEXT = C5 (shrink useAudioEngine) → 3c-D (collapse rules) — to FINISH 3c.** **EG-2** (feed liveSpectrum into the material chart — pre-existing gap, NOT a regression) is **deferred until 3c is complete** (user 2026-07-12: keep 3c focused). **P3** (selection/overrides/annotation-offset ownership + by-frequency carry → analyzer) captured in [RESTRUCTURE-NOTES.md](RESTRUCTURE-NOTES.md). **EG-3** (Peak Min chart line) deferred. Spec: [TAPTONEANALYZER-CONSOLIDATION.md](TAPTONEANALYZER-CONSOLIDATION.md) §10. Then pure gaps + orphan back-ports; PC-1 docs + EG-2 pending | [6-TEST-NORMALIZATION.md](6-TEST-NORMALIZATION.md) (plan + PC-1..4 + EG) · [TAPTONEANALYZER-CONSOLIDATION.md](TAPTONEANALYZER-CONSOLIDATION.md) |
| 2 | **Architectural-parity restructure** (view layer) | Planned post-review — needs its own spec before any code moves | [RESTRUCTURE-NOTES.md](RESTRUCTURE-NOTES.md) |
| 3 | **Theme — Light / Dark / System** | Blocked on THEME-SPEC § 8 decisions (light gradient + chrome hexes) | [THEME-SPEC.md](THEME-SPEC.md) |

Notes:
- **Parity gaps EG-1 / EG-2 (web-only, open; tracked in [6-TEST-NORMALIZATION.md](6-TEST-NORMALIZATION.md) § EG):**
  **EG-1** — the web gated capture has no empty/no-peak failure path (a no-resonance material tap is silently
  accepted with a null peak instead of re-arming + "No signal/resonance detected — tap again"); EG-1 folds
  into the 3c consolidation (3c-C). **EG-2** — material mode never shows the LIVE spectrum during capture
  (guitar does; the material chart paints only captured phases), pre-existing view gap; fix separately.
  **EG-3 ✅ DONE + committed 2026-07-11** — the web now draws the **Peak Min threshold line** on `SpectrumChart`
  (horizontal dashed green "Peak: N dB", guitar-only, in-range, live chart only), matching Swift; Python was also
  aligned to Swift (dashed + right-aligned label). All three consistent.
  _(A related pre-existing gap — guitar peak list/annotations not updating on the LIVE spectrum while waiting for
  a tap — was **fixed in 3c §10 P1b**, 2026-07-11: `recalculatePeaks` now runs on the live spectrum during detection.)_
- The doc review's deferred `signal.ts` two-tone helper (item 4 of the `@parity`
  tail) **folds into #1** — it's a test-only helper reviewed with the parity tests.
- Of the three: **#1** can start now; **#2** needs a spec written first; **#3**
  is waiting on decisions, not implementation time.
- **Log-frequency axis removal — ✅ DONE (2026-07-08)** — removed lock-step all three (B1: kept the
  format field pinned false). See [LOG-FREQ-REMOVAL.md](LOG-FREQ-REMOVAL.md).
- **Parity gaps found during 3c review (2026-07-12) — OUT-1/2/3, their OWN backlog (not 3c work; do AFTER 3c
  finishes). Detail in [TAPTONEANALYZER-CONSOLIDATION.md](TAPTONEANALYZER-CONSOLIDATION.md) §12a:**
  **OUT-1** — phase-guidance-through-warmup (**Swift + Python**): the material phase status strings
  ("Rotate 90° and tap for C", redo "Ready for L/C/FLC tap — tap again", the FLC prompt) are set then
  immediately overwritten by the per-phase warm-up ("Initializing…" → "Tap the guitar…"), so they're never
  seen. **Decision (Option B): make them visible in all three** (canonical detection-loop change keeping the
  warm-up for false-trigger suppression; parity tests lock-step; Swift release). Web already shows them (C4).
  **OUT-2** — status-bar tap **progress bar** is Swift-only; add to **Python + web** (text-only today).
  **OUT-3** — Metrics **Bin Count** blank ("-") for plate/brace in the **web** (Swift/Python show 32,768);
  web-only. **Do these AFTER 3c finishes (C5 → 3c-D)** — OUT-1 designed-then-reviewed before editing canonical.

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