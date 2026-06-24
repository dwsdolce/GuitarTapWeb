# Web UI Guidelines

How the desktop/mobile GuitarTap UI translates to the web. Porting from a desktop app to
the web is a UI translation as real as desktop → iPad/iPhone: each platform follows its
own native idioms, but the **function set and naming are identical across all platforms**
so a **single User Manual** stays correct everywhere. Web targets are desktop **and**
tablet **and** phone (desktop > tablet > phone), so every rule below must work on touch.

> Status: agreed 2026-06-23. Provisional where noted — to be validated in practice.

## Principles

1. **Function parity is mandatory; mechanism is per-platform.** Every action available on
   macOS/iOS is reachable on web, with the **same names** (Load, View Details, Edit,
   Export, Delete, Compare, …). We never drop functionality in translation.
2. **Match the native primary gesture: double-press = the screen's most common action.**
   Double-click (pointer) / double-tap (touch) performs the main action, consistent with
   macOS and iPhone/iPad — e.g. in the Measurements list, **double-press a row = Load**.
   **Single click/tap does nothing by default.** Attaching a single-click action delays or
   pre-empts double-press detection and makes it unreliable, so a no-op single tap is what
   lets double-press fire immediately. Give single click a meaning *only* where one
   genuinely exists (e.g. toggling a row's inclusion in **Compare** mode); otherwise it is
   a no-op. Detail and every other action live in the ⋯/right-click menu (Detail is rarely
   used), and the double-press action also appears there so it's never the only path.
3. **Secondary / per-item actions = a visible "⋯" button on the right of the item.** This
   is the web's equivalent of the macOS/iPad **right-click** menu and the iPad/iPhone
   **long-press** menu (both open the same menu natively). On the web neither right-click
   (the browser owns it; absent on touch) nor long-press (mobile-only, finicky) is a good
   *primary*, so a real, right-aligned **"⋯" button** is the affordance that reads the same
   on desktop, tablet, and phone — which is what lets the manual describe **one** mechanism.
   It is **always visible/tappable on touch** (no hover to reveal it; on desktop it may sit
   quietly and brighten on hover). Right-click (desktop) and long-press (mobile) **may**
   additionally open the same menu as shortcuts, but the "⋯" is **never** the only way.
4. **Everything works on touch.** Visible affordances, ≥44 px tap targets, no hover-only
   and no right-click-only controls. Hover may *reveal* the "⋯", but the "⋯" is always
   tappable. **Long-press** is mobile-only — an optional enhancement, never required and
   never the only path.
5. **Double-press is allowed — it works on the web.** Double-click has always worked with a
   pointer; on touch, disable the browser's default double-tap-to-zoom per element
   (`touch-action: manipulation` + a sane viewport) and double-tap behaves exactly as on
   iPhone/iPad. The only disciplines: never make double-press the *sole* path to a function
   (also expose it in the ⋯/right-click menu), and don't rely on it to *discover* a
   rarely-used action.
6. **List / dialog-level actions = visible toolbar buttons** in the header — the same set
   and labels as native (e.g. Import, Export, Delete All, Compare, Done).
7. **Match native content exactly** even where the interaction differs — row fields,
   titles ("Saved Measurements"), date/number formatting, section structure.
8. **One manual instruction.** The manual names the action and the generic **actions (⋯)
   menu**, with at most a short per-platform parenthetical (⋯ / right-click / swipe).

## Worked example — the Measurements ("Saved Measurements") dialog

- Title **"Saved Measurements"**; header toolbar: Import · Export · Delete All · Compare ·
  Done (added per sub-phase: Import/Export = 4c, Compare = 4d).
- Row content mirrors `MeasurementRowView`: name · waveform indicator (when a snapshot
  exists) · abbreviated date + short time · second line **"N peaks • Ratio: X.XX •
  Decay: X.XXs"** · notes (≤2 lines). Comparison records render as "N spectra compared".
- **Double-press a row → Load** (and dismiss). **Single click/tap → nothing** (keeps
  double-press reliable; a row has no standalone "selected" state outside Compare mode).
  This matches iPhone/iPad, which also do nothing on single tap here — an earlier tap
  action was removed as confusing.
  **"⋯" menu** per row, and right-click on desktop → Load · View Details · Edit · Export ·
  Delete; Delete confirms. In **Compare** mode, single click/tap toggles the row's inclusion.

## Worked example — the spectrum chart

- **Zoom/pan: wheel and gestures coexist, both region-aware by location.** The chart
  responds to whatever input the device sends — no mode switch. Pointer: mouse-wheel /
  modifier zoom + drag-pan. Touch: pinch-to-zoom + drag-to-pan. Either way the *location*
  picks the region exactly as the pointer does (and exactly as iPad/iPhone already do):
  **plot = both axes, x-axis gutter = frequency, y-axis gutter = magnitude.** (Touch *is*
  region-aware — a touch has a location like a pointer.)
- **Chart options: a "⋯" button in the chart's upper-right** opens a **"Chart Options"**
  popover, mirroring iPhone/iPad exactly:
  - *Reset to Saved* → Reset Both Axes · Reset Frequency Axis · Reset Magnitude Axis
  - *Reset to Defaults* → Reset Both Axes · Reset Frequency Axis · Reset Magnitude Axis
  - *Reset Labels* (only when there are dragged labels to reset — Phase-5 draggable
    annotations; disabled otherwise)

  Right-click on the plot opens the same menu on desktop as a shortcut. There is **no**
  separate "controls help" dialog — mobile has none, and the gestures/wheel just work.

## Implementation debt

- The current `SpectrumChart` predates these guidelines: wheel-zoom + a **right-click-only**
  reset menu, no visible "⋯" affordance, no touch gestures. Bring it to the design above
  (add the "⋯" Chart Options menu + touch pinch/drag; keep the wheel) when scheduled.