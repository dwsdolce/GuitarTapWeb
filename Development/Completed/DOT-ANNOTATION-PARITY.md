# Dot list vs Annotation list — web divergence + a 3-platform test structure

_Opened 2026-07-20. Grew out of the loaded-measurement peak-display fix (STATUS "Done" — web
panel/dot parity), which was verified correct in the auto path but surfaced a deeper view-layer
divergence._

**Progress (2026-07-21):**
- **Item 1 — ✅ DONE, user-verified.** Web dot layer moved onto `isKnown`.
- **Item 2 — ✅ DONE, user-verified.** `view/dot-layer` parity group added, all 3.
- **Item 3 — ⏳ CODE WRITTEN, NOT USER-VERIFIED.** `_refresh_peaks_for_viewport` now re-emits
  `current_peaks` unchanged instead of calling `recalculate_frozen_peaks_if_needed()`; the
  range-dependent `peaksChanged` consumers re-filter themselves. Python suite 535 green.
  **Correction to the original claim below:** the UUID churn only affected the **live/frozen**
  path (`find_peaks` re-run at `peak_analysis.py:226`); a **loaded** measurement took the filter
  branch (`:175`) and reused the same peak objects, so it never churned identity.
  **No test added** — nothing in the suite constructs `FftCanvas`, so pinning this would mean
  building canvas-level test infrastructure; and there is no Swift/web counterpart to pair with,
  because their correctness here is the *absence* of a call. Relies on run-review.

What landed for Items 1–2:

| | Shared rule | View delegates to it | Test (DL1–DL7) |
|---|---|---|---|
| Swift | `GuitarMode.peaksInDisplayRange(...)` (co-located with `isKnown`) | `SpectrumView.allPeaksInRange` | `GuitarTapTests/DotLayerTests.swift` |
| Python | `GuitarMode.peaks_in_display_range(...)` | `fft_canvas._on_peaks_changed_scatter` (**gains the range filter**) | `tests/test_dot_layer.py` |
| Web | `peaksInDisplayRange(...)` + **new** `isKnown(...)` in `dsp/guitarModes.ts` | chart markers memo in `App.tsx` | `test/dot-layer.test.ts` |

- Web fix: chart markers now derive from `peaksInDisplayRange(sortedPeaks, view.minHz, view.maxHz, …)`
  — the `isKnown` rule against the **live zoom range** — instead of the assigned-mode `displayPeaks`.
  The Results panel keeps `displayPeaksInRange` (assigned-mode), matching Swift's real two-filter
  split. The markers memo was relocated below `useChartView` so it can see the live view range
  (Swift's `minFreq`/`maxFreq` equivalent), which is what makes dots follow zoom.
- Python: the scatter previously applied **no** range filter, relying on pyqtgraph clipping, which
  left out-of-range peaks in `_current_peaks` — the click hit-test set — unlike Swift. Now filtered.
  Hit-testing stays correct because `_current_peaks` and `setData` are assigned together, so the
  scatter-index → peak mapping in `point_picked()` remains aligned.
- Suites: Swift **415** · Python **535** · web **318** (each +7). Parity `--check` clean, **79 groups**.
- Swift + Python source edits roll their build numbers; batch with the next native change.

**Known gap — the wiring is still untested.** DL1–DL7 pin the *rule*, and all three apps now call
that rule, so a regression *in the rule* fails everywhere. But nothing pins the *wiring*: if the web
markers were re-pointed at `displayPeaks`, every test would still pass. Closing that needs a
component-level test; the canvas render remains untestable in this harness.

Canonical reference is Swift. Two peak sets drive the guitar view; they are **different sets
with different rules**, and both matter:

| Set | Rule (Swift) | Drives |
|---|---|---|
| **Dot list** — `allPeaksInRange` (`SpectrumView.swift:~390`) | peaks in `[minFreq,maxFreq]`, then guitar+`!showUnknown` → `GuitarMode.isKnown(frequency:)` (`GuitarMode.swift:236`). **No** annotation-mode filter. | the always-visible chart **dots** |
| **Annotation / visible list** — `visiblePeaks` (`TapToneAnalyzer.swift:~682`) | `currentPeaks` → annotation mode (all / selected / none), then the same unknown filter. | the chart **badges** + the report/PDF summary |
| (panel list — `sortedPeaksWithModes`) | `currentPeaks` → range → **assigned mode** (`peakMode(for:) != .unknown`) | the Analysis Results **table** |

Key fact (from reading `classifyAll`): a peak's **assigned mode ≠ unknown** iff its **frequency is
in a band** iff `isKnown(frequency)` — so *assigned-mode* and *isKnown-frequency* pick the SAME
peaks for auto-classified measurements. They diverge **only under user mode overrides**.

---

## Item 1 — Functional divergence in the web (a hidden bug)

**Swift and Python both use `isKnown(frequency)` for the dot list. The web does not — it uses
*assigned mode*, and `isKnown` appears nowhere in the web.**

- Swift dots: `allPeaksInRange` → `isKnown(frequency)`.
- Python dots: `views/fft_canvas.py::_on_peaks_changed_scatter` filters `current_peaks` by
  `GuitarMode.is_known(frequency, guitar_type)`, no annotation filter — docstring says
  "mirroring Swift's SpectrumView.allPeaksInRange filter." (Annotation set = `visible_peaks`,
  `tap_tone_analyzer.py:1350`, which also uses `is_known`.)
- Web dots: `markers` are built from `displayPeaks` (`App.tsx`), which filters by **assigned mode**
  (`modeByPeak.get(id) !== 'unknown'`); the dot loop in `presentation/spectrumRender.ts` then
  range-filters. `isKnown`/frequency-band membership is never consulted.

**Why it is a hidden bug:** equivalent to `isKnown` in the normal auto path, so it looks correct
(and the just-shipped render fix — dots no longer gated on annotation — *is* correct and verified).
It diverges only when a user **override** separates assigned-mode from frequency-band:

1. Freeform text label on an **in-band** peak → its `modeByPeak` becomes `unknown` → web drops it
   from `displayPeaks` → **no dot**. Swift/Python still dot it (frequency is in a band).
2. A predefined mode assigned to an **out-of-band** peak → web keeps a dot (it has an assigned
   mode); Swift/Python draw **no dot** (`isKnown` false) — though it still gets a *badge* via the
   visible/annotation set.

**Fix direction (do NOT just swap a filter):** the web dot **candidate set** must stop being
`displayPeaks`. It needs to be `currentPeaks` filtered by `isKnown(frequency)` + range (mirroring
`allPeaksInRange`), independent of the assigned-mode map. That means a change to how markers are
built (`buildGuitarMarkers` / the `markers` memo in `App.tsx`), because today one assigned-mode set
feeds panel, dots, and badges. The **panel** stays on assigned mode (matches Swift
`sortedPeaksWithModes`); only the **dot** candidate set moves to `isKnown`. Port `isKnown` to the
web (mirror `GuitarMode.isKnown` / `is_known`, using `modeBands(guitarType)`).

Files: web `src/App.tsx` (displayPeaks / markers), `src/presentation/spectrumRender.ts` (dot loop),
`src/dsp/classify.ts` or a new `modeBands` helper for `isKnown`. Swift/Python unchanged (already
correct) — they serve as the two reference implementations.

---

## Item 2 — A test structure to prove consistency + surface divergence (all 3 platforms)

**Goal:** pin BOTH lists — the **dot list** and the **annotation/visible list** — as pure,
testable rules on Swift, Python, and web, so identical inputs must yield identical sets on all
three, and any future drift (like Item 1, or the shipped "dots follow selection" regression) fails
a test instead of shipping.

**Coverage today:** the annotation set has a partial parity group (`test/annotation-state`,
D4–D6: all/selected/none) on all 3. The **dot list has NO parity coverage anywhere** — that gap is
exactly why the web drift went unnoticed. And neither group exercises `isKnown` / `showUnknownModes`
or override cases.

**Seam to extract (one pure function per set per platform; view calls it):**
- `dotPeaks(peaks, minFreq, maxFreq, isGuitar, showUnknown, guitarType)` → mirrors `allPeaksInRange`.
  Swift: extract from `allPeaksInRange`. Python: extract from the `_on_peaks_changed_scatter` inline
  filter. Web: NEW — this is also where the Item-1 fix lands.
- `visiblePeaks(peaks, mode, selectedIds, isGuitar, showUnknown, guitarType)` → mirrors `visiblePeaks`.
  Swift: `visiblePeaks` (already ~model-level). Python: `visible_peaks` (exists). Web: `reportPeaks` /
  `buildGuitarMarkers` `annotated` flag (exists) — refactor to a comparable pure function.

**Shared oracle fixture** (one JSON, consumed by all 3, like the existing oracle-driven DSP tests):
peaks covering — in-range known-band peaks; an in-range peak **outside every band** (unknown); an
**out-of-range** peak; a selected subset; and the two **override** cases from Item 1 (freeform on an
in-band peak; a mode on an out-of-band peak).

**Assertions (per platform, then cross-platform identity):**
1. Dot set is **independent of annotation mode** — dotPeaks is identical for all / selected / none.
2. Dot set = `isKnown ∩ range` (and honors `showUnknown`); the override cases (1) & (2) resolve the
   Swift/Python way — this is the test that fails for the current web.
3. Annotation set follows mode + `isKnown` (extends the existing D4–D6).
4. Same fixture → byte-identical dot set and annotation set across Swift/Python/web (the parity
   oracle).

**Parity bookkeeping:** new slug e.g. `view/dot-layer`; extend `test/annotation-state`. `@parity`
tags on the 3 source functions + 3 test files; regenerate `PARITY-MAP.md`. Swift/Python source
edits (the extractions) roll their build numbers — batch with the next native change.

This is the concrete, testable wedge for the broader **view-layer architectural-parity** item: the
view layer is where the ports diverge, and paired dot/annotation tests are how we make it provable.

---

## Item 3 — Python recalculates (and re-IDs) peaks on every pan/zoom

Found while validating Item 1's impact. **Do this AFTER Items 1–2** — it touches the frozen-peak
recalculation path (selection / override / offset remapping), the same area as the Peak Min
selection work, so it must not be entangled with a test-hardening change.

`views/fft_canvas.py::_refresh_peaks_for_viewport` is wired to `sigXRangeChanged` (`:570`) and calls
`analyzer.recalculate_frozen_peaks_if_needed()` on **every pan and zoom**. For a complete/frozen
measurement that is not a cheap no-op: it re-derives the peak set, **changes peak UUIDs** (its own
comment: "Snapshot frequency-keyed state BEFORE UUIDs change"), then re-matches annotation offsets,
mode overrides, and selection onto the new ids **by frequency with a 5 Hz tolerance**.

Swift and web do none of this on pan/zoom — `allPeaksInRange` / the web dot loop are pure filters
over an existing array. So Python alone churns peak identity and re-runs a lossy re-match of dragged
labels, overrides, and selection every time the user pans a finished measurement. It probably lands
on the same answer (frequencies don't move), but it is needless risk in exactly the code path we
have been stabilising.

**Fix:** on viewport change, re-apply the display-range/`isKnown` filter to the peaks that already
exist and update the scatter directly — no analyzer recalculation, no UUID churn. Matches Swift/web.

**Dependency:** once Item 1 puts the range filter in the scatter path, *something* must rebuild the
scatter on pan/zoom, and today that something is this very call. So the cheap re-filter path has to
land WITH its removal, not before.

**Still to confirm:** read the tail of `recalculate_frozen_peaks_if_needed()` — the UUID-churn
comment and the re-matching setup are confirmed; the full body is not yet reviewed.