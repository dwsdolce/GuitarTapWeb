# Web chart-interaction bugs (3) — behaviour missing vs Swift/Python

_Logged 2026-07-21 from run-review. These are **behavioural defects**, not the view-layer
architectural-parity item (that one is about structure). Swift and Python behave identically and
correctly in all three cases; only the web diverges. Web-only fixes — no native changes._

**STATUS 2026-07-25: ✅ ALL THREE DONE.** Bugs 1 + 2 were fixed during the peak-lifecycle
annotation-offsets (RB) work; Bug 3 (the dot ↔ results-row cross-highlight) shipped in `084599f`.

Shared native predicates the web lacks but can derive from `annotationOffsets` (keyed by `annoKey`):

| Predicate | Swift | Python | Web equivalent |
|---|---|---|---|
| this label moved | `isMoved` | `has_moved` | `annotationOffsets.has(annoKey)` |
| any label moved  | `hasLabelsToReset` | `has_moved_annotations` | `annotationOffsets.size > 0` |

---

## Bug 1 — Per-annotation "Reset Position" (right-click a moved label) — ✅ DONE

_Fixed in the RB work: `SpectrumChart.tsx` right-click hit-tests the badge rects (`badgeRectsRef`) and
opens a per-label menu with **Reset Position** (`onContextMenu`, `:452-457`), disabled unless that label
has moved; `App.tsx:1316` wires `onResetAnnotation` → `analyzer.resetAnnotationOffset`. The QuickStart
claim is now accurate. Original report below._

**Native behaviour:** right-clicking a peak label shows a context menu with **Reset Position**. The
item is ALWAYS present and is **disabled unless that label has been moved** (disable-don't-hide).

- Swift `Views/PeakAnnotations.swift:422` — `.contextMenu { Button("Reset Position") }` +
  `.disabled(!isMoved)`; model reset is `TapToneAnalyzer+AnnotationManagement.swift:73`
  `resetAnnotationOffset(for:)`.
- Python `views/peak_annotations.py:147-153` — `menu.addAction("Reset Position")` +
  `reset_action.setEnabled(has_moved)`.

**Web:** no per-annotation context menu at all. Only the chart-level "Reset Labels" exists.

**Also wrong because of this:** `src/components/QuickStartGuide.tsx:293` already tells the user
*"To reset an individual label: right-click it and choose 'Reset Position'."* — the web documents a
feature it does not have.

**Feasible cheaply:** `spectrumRender` already emits badge hit-rects (`badgeRectsOut`) for drag
hit-testing; right-click hit-testing can reuse them.

**Touch note:** Swift also resets a label on **double-tap**, but only `#if os(iOS)`
(`PeakAnnotations.swift:412-418`) — macOS is right-click. Python is desktop-only. So for the web,
right-click covers desktop; a double-tap path would only be needed for the phone/tablet PWA, to
match Swift's iOS behaviour. **Open decision.**

---

## Bug 2 — "Reset Labels" enablement — ✅ DONE

_Fixed: `SpectrumChart.tsx:574` renders the menu item `disabled={!hasMovedLabels}`, fed by
`hasMovedLabels={annotationOffsets.size > 0}` (`App.tsx:1317`). Original report below._

**Native behaviour:** the chart context menu's **Reset Labels** is disabled when no label has moved.

- Swift `Views/SpectrumView.swift:713` (macOS context menu) and `:1272` (iOS options sheet) —
  `.disabled(!hasLabelsToReset)`.
- Python `views/fft_canvas.py:1282-1283` — `act = menu.addAction("Reset Labels", ...)` +
  `act.setEnabled(self.annotations.has_moved_annotations)`.

**Web:** `src/components/SpectrumChart.tsx:524` renders it whenever the callback exists, with no
enablement check — so it is always enabled.

---

## Bug 3 — Clicking a peak dot does nothing — ✅ DONE (`084599f`, 2026-07-25)

_Fixed: `highlightedPeakId` on the analyzer (toggled by clicking a dot or its results card — same id
clears); `spectrumRender` emits dot hit-points (30px radius, matching Swift's `nearestPeak`) and draws
the highlighted dot as a red star; `PeakCard` gets a ring + `scrollIntoView` + the reverse click. Gated
to guitar + desktop (off on touch, matching Swift's macOS-only behaviour). Original report below._

**Native behaviour:** clicking/tapping a peak dot **highlights** that peak (this is the highlight,
NOT the selection star) and the results list scrolls the matching row into view. Bidirectional —
tapping the row highlights the dot. Tapping the same dot again clears the highlight.

- Swift `Views/SpectrumView.swift:792-798` — `.onTapGesture` toggles `highlightedPeakID`;
  `Views/SpectrumView+ChartContent.swift:97+` renders the highlighted peak larger with a ring;
  `Views/TapAnalysisResultsView.swift:319-322` — `.onChange(of: highlightedPeakID)` →
  `scrollProxy.scrollTo("peak-row-\(id)", anchor: .center)`; `:588` gives the row a stroked border;
  `:597` the row tap sets the highlight (reverse direction).
- Python `views/fft_canvas.py:1161-1171` — `point_picked()` → `peakSelected.emit(freq)`;
  `views/tap_tone_analysis_view.py:2127` — `canvas.peakSelected.connect(peak_widget.select_row)`;
  reverse at `:2150` `peak_widget.peakSelected.connect(self._on_peak_selected)`.

**Web:** no highlighted-peak concept exists at all — no `highlightedPeakID`, no dot hit-testing, no
`scrollIntoView`. Clicking a dot does nothing.

**Larger than Bugs 1–2.** Needs: highlight state, dot hit-testing (dots have no hit-rects today —
only badges do), the chart ring/enlarged-dot rendering, `PeakCard` highlight styling +
`scrollIntoView`, and the reverse card→dot direction. Carries UI decisions (highlight visual,
mobile behaviour).

---

**Order:** all three done — Bugs 1 + 2 (RB work), Bug 3 (`084599f`, 2026-07-25).