# Saved Measurements — Sort / Reorder

**Status:** 📋 Open, deferred (post-1.0.2). Investigation done; spec/sizing captured here. No code.

**Goal:** Let the user control the order of rows in the **Saved Measurements** dialog — either a
**sort button** (by name / date) or **manual drag-to-reorder** — on all three platforms. Design once,
Swift-canonical, mirror to Python + web ([[feedback_improvements_all_three_platforms]]).

This is a **new feature**, not a parity fix: no platform has any ordering control today. Write the
cross-platform behaviour spec (Swift first) before any code.

---

## Current state (investigation, 2026-07-30)

All three platforms are structurally the same: one flat list, backed by the analyzer's saved-measurements
collection, rendered in **insertion order** (oldest first, newest appended). No sort exists anywhere; no
model carries an order/sort-index field. Row actions (delete / update / compare) are keyed by **positional
index** into the backing collection, and each platform has a load gesture a drag would have to coexist with.

| | Swift | Python | Web |
|---|---|---|---|
| List view | `Views/Measurements/MeasurementsListView.swift` — `List`/`ForEach` (keyed by `\.offset`) | `views/measurements/measurements_list_view.py` — `QListWidget` + custom `setItemWidget` rows | `src/components/MeasurementsPanel.tsx` — `<ul>` `items.map()` |
| Backing store | `@Published savedMeasurements: [TapToneMeasurement]` (`Models/TapToneAnalyzer.swift`) | `analyzer.savedMeasurements` | `items` state ← `listMeasurements()` (`src/measurement/store.ts`) |
| Persistence | single `saved_measurements.json` — **ordered JSON array**, array position round-trips | single `saved_measurements.json` — **ordered JSON array**, array position round-trips | **IndexedDB** store `measurements`; order **derived at read time** by sorting on a `savedAt` stamp |
| Load gesture to respect | double-tap load + `.onDelete` swipe already present (no `.onMove`) | double-click load + `⋯`/right-click menu; `NoSelection` | double-press load + `⋯` menu |

**Key persistence divergence:** Swift & Python already persist explicit array order for free — reorder the
in-memory list, persist, done. Web has no stored sequence; a reorder means rewriting the `savedAt` sort key
(or adding a dedicated field). Both round-trip without a schema migration (fields are optional / healed on
read), but the two implementations are genuinely different shapes — call this out in the spec.

---

## Design decisions to settle (before code)

1. **Sort, reorder, or both?** Recommendation: ship the **sort button first** (cheap, low-risk, solves the
   likely real need — "I can't find the one I want in a long list"), then decide whether manual reorder is
   still wanted. They interact (see #2), so bolting both on at once needs deliberate design.
2. **Sort vs. manual order are mutually exclusive orderings.** Sorting discards a hand-arranged order. Decide:
   is manual order the persistent default that a sort *temporarily* overrides, or does choosing a sort mode
   discard the manual order? This is a behaviour decision, not an implementation detail.
3. **Sort keys:** name and date (both fields already present — `measurementName`, `timestamp`). Ascending /
   descending? Persist the chosen sort mode, or reset to default each open?
4. **Manual order across import/merge:** imports **append**. If manual order must survive an import/merge or
   external re-serialization, an explicit `sortIndex` field is warranted; otherwise array position (native) /
   `savedAt` rewrite (web) suffices.

---

## Difficulty estimate

- **Sort button (by name / date): Easy, all 3.** Data present. The one shared trap: sort the *underlying*
  collection (and persist), not a display-only copy — the index-keyed delete/update/compare would break
  against a display-only reorder.
- **Manual drag-to-reorder: Moderate, all 3.** No new persisted field strictly required. Per-platform friction:
  - **Swift** — add `.onMove` next to the existing `.onDelete`; but the `ForEach` is keyed by `\.offset`, fragile
    for move animation → prefer `\.element.id`, but duplicate imports can share an `id`, so the unique key needs care.
  - **Python** — `QListWidget` supports `InternalMove`, but custom `setItemWidget` rows + the positional
    `_compare_indices` set mean re-syncing indices on drop, then `_persist_measurements()`. Add a
    `move_measurement(from, to)` / `sort_measurements(...)` method on the management mixin.
  - **Web** — HTML5 DnD (or a small lib) + a `reorder(ids)` helper in `store.ts` that rewrites `savedAt`
    (or a new `sortIndex`, switching `orderOf`); must not collide with double-press-to-load → likely a
    dedicated drag handle.
- **Parity / tests:** new behaviour → new `@parity` group(s) + PARITY-MAP regen; paired tests for the ordering
  logic (sort key, persist round-trip, reorder). Manual + Help note if it becomes user-facing.

---

## Recommendation

Sort button first as a small, self-contained change (Swift → Python → web); revisit manual reorder as a
separate follow-up once #2 is decided. Not before 1.0.2.
