# Dot list vs Annotation list — web divergence + a 3-platform test structure

_Opened 2026-07-20, to tackle next. Grew out of the loaded-measurement peak-display fix
(STATUS "Done" — web panel/dot parity), which was verified correct in the auto path but
surfaced a deeper, still-open view-layer divergence. Two items below._

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