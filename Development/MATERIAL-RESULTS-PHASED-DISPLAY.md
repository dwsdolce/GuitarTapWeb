# Material Results — Phased (Stable) Display

**Status: PROPOSED (not started).** Cross-platform UX rework, **Swift canonical**, implement
**lock-step on all three** (Swift → Python → web) after review. Surfaced during the
`view/material-results` review (item 5 ④), 2026-07-07.

## Problem

During a **live** plate/brace multi-phase capture, the Analysis Results panel is unreadable
and unhelpful:

- **While capturing a tap** the peak list churns with the live spectrum peaks; the
  *Plate/Brace Properties* and *Measurement Process* sections shift around with it and can't be read.
- **In review** (tap found, pre-Accept) it's briefly readable — but the instructions are moot,
  the tap is already taken.
- **After Accept** it churns again until the next phase's tap.
- Only at **complete** is any of it stable and useful.

So the live peak list is noise during the exact window (positioning for the next tap) when the
**Measurement Process** is what the user needs — and that section won't hold still.

## Target behavior (live capture)

The Results panel becomes **positionally stable** from the first phase to complete: the same rows
sit in the same place, filling in as taps are accepted.

| Section | During capture (notStarted … reviewingFlc) | At complete |
|---|---|---|
| **Peak rows** | A **fixed** set of slot rows — plate: **2** rows (L, C) or **3** when FLC is enabled (L, C, FLC); brace: **1** row (fL). Same row layout as the final display, but **frequency + magnitude are dashes (`—`)** until that phase's peak is captured; once captured/accepted the slot shows the identified peak's freq + mag. Never the live spectrum churn. | Same rows, all filled (as today). |
| **Measurement Process** | **Always visible**, directly beneath the peak rows. | As today. |
| **Plate/Brace Properties** | **Hidden** (not rendered) until all phases complete. | Shown (as today). |

Result: while tapping, the user sees a steady L/C/(FLC) scaffold (dashes → values) plus the
**Measurement Process** — nothing flickers, no premature Properties, and the old "Select peaks
above…" / "Tip:" placeholder disappears entirely (it's obsoleted by this layout).

Row fill order (plate, FLC): capture L → L row fills; capture C → C row fills; capture FLC → FLC
row fills. A slot shows the value from the moment its phase is **captured** (review phase onward),
including the just-captured peak during review.

## Scope / non-goals

- **Live multi-phase capture only.** A **loaded / saved** measurement is always `complete`, so it
  is **unchanged** (renders the full final layout exactly as today).
- **No change to the PDF report.**
- No change to guitar-mode results, and no change to the below-graph `MaterialInstructionPanel`
  (the current-phase card) — this is only the **Results** panel (peak rows + Properties + Process).
- No DSP/oracle impact — presentation only.

## Per-platform (current → change)

- **Swift** `Views/TapAnalysisResultsView.swift` (the broad M5 results view): peak section currently
  renders `sortedPeaksWithModes` (all live peaks) via `MaterialPeakRowView`, and
  `platePropertiesSection`/brace shows the "Select peaks…"/"Tip:" placeholder when no props. →
  Render **fixed L/C/(FLC) slot rows** (dashes until captured); **gate the properties section on
  `isMeasurementComplete`** (hide until complete); keep the measurement-process view always visible
  beneath the rows. Effort: **Medium**.
- **Python** `views/tap_tone_analysis_view.py` (monolith): same current behavior + the
  `_plate_placeholder` / `_brace_placeholder` widgets. → Same change; drop the placeholders; fixed
  slot rows with dashes; gate properties widgets on complete; keep the process section shown. Effort: **Medium**.
- **Web** `src/components/MaterialResults.tsx`: closest already — `rows` are the identified
  `matPeaks` (0–3, variable) and Properties are omitted when `fL`/`fC` are null. → Render the
  **fixed 2/3 (brace 1) slot rows** with dashes until filled; keep `ProcessSection` always; keep
  Properties gated on complete (already ~there). Effort: **Small**. (`MaterialInstructionPanel` = ③,
  unaffected.)

## Open questions (resolve before implementing)

- Exact dash glyph for empty freq/mag (`—` em-dash vs `–`), and whether the badge/star still shows
  in an empty slot (proposed: yes — the slot's L/C/FLC identity is always visible).
- Brace: confirm the single fL row follows the same dashed-slot rule.

## Tracking

Listed under REVIEW-TRACKER.md "Separate efforts". Lock-step parity — design once, ship all three
together. Related: [[project_architectural_restructure]] (these are restructure-adjacent view
components), and the `view/material-results` review row (item 5 ④).