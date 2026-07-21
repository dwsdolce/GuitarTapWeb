# Peak lifecycle — detection, classification, display

_Spec agreed 2026-07-21 (user + assistant). **Swift is implemented first and validated, then
propagated to Python and the web.** Gap analysis against the current Swift implementation is a
separate step — this document defines the target, not the present._

## Why this exists

Today a Peak Min change **re-runs detection** on a frozen measurement, minting new peak objects with
new identities. Every piece of per-peak state — selection, mode overrides, annotation positions —
then has to be re-matched onto the new identities by frequency (±5 Hz), via
`applyFrozenPeakState`, a `selectedPeakFrequencies` cache, and assorted carry-forward rules. That
compensation machinery is the source of the defects found in run-review: deselected peaks
re-selecting on any slider move, dragged annotation labels snapping back, and peak identity churning
on pan/zoom.

This spec removes the cause rather than patching the symptoms.

---

## 1. Core principle

> **Peak identity changes only when the spectrum changes.**

The peaks *are* the peaks. Nothing re-identifies them except a new frequency spectrum (a new tap).

## 2. Three operations, kept distinct

| Operation | What it does | Triggered by | Effect on per-peak state |
|---|---|---|---|
| **Detect** | Find peaks in a spectrum. Floor differs live vs captured — see below. | A new spectrum ONLY: each live FFT frame (guitar), freeze/approve, a new tap. Also as part of **Re-analyze**. | Creates new identities — state starts fresh |
| **Classify** | Assign a mode to each peak | Detection; **guitar-type change**; **Re-analyze**; **analysis-frequency-range change** | Changes auto mode assignment only. Identities untouched |
| **Display-filter** | Choose what is shown | **Peak Min** (Analysis Results table AND graph); **annotation visibility mode** (graph labels only) | **None.** Pure presentation |

### Detection floor: live vs captured

- **Live (pre-freeze):** detect at **Peak Min**. Live peaks are ephemeral — no durable per-peak state
  exists yet — so re-detecting per frame violates nothing, and a −100 dB floor here would be
  expensive (`findPeaks` runs every FFT frame with parabolic interpolation, a −3 dB bandwidth walk
  per peak and an O(n²) dedup; a real room noise floor sits far above −100 dBFS).
- **Captured (freeze / approve / new tap / Re-analyze / save):** detect at **−100 dB** — the full set.

**This is not a compromise: the displayed set is identical either way.** `findPeaks`' local-maximum
test is threshold-independent, so

> detect-at-PeakMin ≡ detect-at-−100 then filter-at-PeakMin

The list therefore does not jump at the moment of freeze. Beyond freeze, **Peak Min never gates
detection** — it only filters.

**Auto-selection at freeze runs over the FULL set.** So a quiet Air below the current Peak Min is
selected at freeze even though it is not displayed, and that selection is durable and saved. Lowering
Peak Min later simply *reveals an already-selected peak* — the correct outcome reached by durability
rather than by re-deriving selection on a slider move.

## 3. Per-peak state

Each peak owns, for its lifetime:

- **Selection** — automatic, or overridden by the user via the selection button in the peak table.
- **Custom classification** — a user mode override.
- **Annotation position** — a dragged label offset.

Changing the display changes **none** of it. Hiding a peak with Peak Min and bringing it back
restores exactly the selection, classification and position it had.

### What resets per-peak state

Only two things:

1. **A new tap / new capture** — a new spectrum, therefore new peaks.
2. **Re-analyze** — the one explicitly destructive action. It re-detects *and* re-classifies, so it
   necessarily mints new identities, returns selection to automatic, and may orphan custom labels.
   This is already what the release notes promise.

### What does NOT reset it

Peak Min, annotation visibility mode, guitar-type change, pan/zoom, and **load**.

### `userHasModifiedPeakSelection`

**Kept, with a narrowed meaning:** "the user has manually changed the selection". Its old job —
choosing between carry-forward and auto-re-derivation on a Peak Min move — disappears with this spec.
Its remaining job is to **enable the wand** (restore automatic selection), and it stays a persisted
field so that state survives a save/load round trip.

It is deliberately *not* derived by comparing the saved selection against a fresh auto-selection:
that is fragile, and it would mean a format change on three platforms to delete a field added only
yesterday.

## 4. Controls

- **Peak Min** — display only. Filters which already-found peaks appear in the Analysis Results
  table, on the graph, and in the exported spectrum/PDF. Never detects, never classifies, never
  mutates per-peak state. **Disabled** for material measurements, and **disabled** while the
  multi-tap table is displayed.
- **Annotation visibility mode** (All / Selected / None) — graph labels only.
- **Guitar type** — re-classifies; does **not** re-identify. Its purpose is to see the same peaks
  classified under a different guitar type. Manual mode overrides and manual selections **survive**;
  only the *auto* classification, and the *auto* selection where the user has not touched selection,
  re-derive.
- **Analysis frequency range** — genuinely changes which peaks exist, so it forces a **re-analyze**
  (detect + classify). Expected to be rare, but defined.
- **Re-analyze** — see above; the only destructive control.
- **Wand (reset to automatic selection)** — re-selects among the existing peaks. No detection.

## 5. Measurement kinds

### Guitar — live (unfrozen)
Peaks are detected and classified on every FFT frame.

### Guitar — frozen / approved / loaded
Peaks are completely identified and classified. The frozen set is the **full** set (floor −100 dB),
so lowering Peak Min later can reveal quieter peaks that were always there.

**On load nothing is re-DETECTED — the file's peaks win.**

Classification *is* re-derived on load, from the **file's own saved guitar type**, with the user's
saved mode overrides applied on top. This is not a choice: mode assignments are not persisted —
`encode` writes `modeLabel` as a convenience string that `init(from:)` deliberately ignores — so there
is nothing to restore. Accepted consequence: a classifier improvement changes the modes shown for an
existing file when it is reopened. That is desirable (fixes reach old measurements), but it does mean
the file is not a frozen record of what was on screen.

Selection, mode overrides and annotation positions **are** persisted and are restored as saved.

### Guitar — multi-tap
Identical to a guitar measurement, with two caveats:

1. The spectrum is the **averaged** spectrum of all taps; the main peak list and graph derive from it.
2. The per-tap spectra **and their Air/Top/Back classification** are retained for the multi-tap
   table. That table is **independent of Peak Min**, which is disabled while it is displayed.

Per the core principle, each tap's spectrum is fixed, so its peaks and classification are computed
once and are not re-derived when Peak Min moves.

### Material (plate / brace)
Peaks are **not** identified or classified live. The identified L / C / FLC come from the per-phase
captures and **are** the result. **Peak Min is disabled** for material — it plays no role at all,
display or otherwise.

## 5a. Classification vs selection — they are different things

**Classification is many-to-one. Selection is one-per-mode (for the named resonances).**

Several peaks can legitimately be *classified* into the same band — they are all candidates for that
mode. **Selection designates which candidate IS that mode.** Auto-selection guesses "the strongest
candidate", which is wrong whenever the real resonance is quieter than a neighbour.

### The unknown test (single, shared)

A peak is "unknown" only when nothing is known about it:

```
isUnknown(peak) = assignedMode(peak) == .unknown && !hasManualOverride(peak)
```

- auto-classified into a mode → known
- user assigned a **predefined** mode → known
- user assigned a **custom label** → known — *the user knows what it is*
- classifier found nothing and no user label → unknown

`Show Unknown Modes = false` hides only the last case. **One predicate, used by both the Analysis
Results table and the chart dot layer**, so they cannot drift apart.

_(This replaces the previous split: the table tested "assigned mode ≠ unknown" while the dot layer
tested `isKnown(frequency)`. Both hid custom-labelled peaks — backwards, since a labelled peak is by
definition known. It also supersedes the `isKnown` half of `GuitarMode.peaksInDisplayRange`, so the
3-platform `view/dot-layer` group needs re-specifying; its range and annotation-independence halves
stand.)_

### Table and dots show the SAME list

`currentPeaks` → Peak Min → display range → `isUnknown` filter. Consumed by both. Pan/zoom moves the
display range and therefore both, identically. The chart additionally cannot paint a dot below its
visible dB floor — that is a rendering limit, **not** a different list.

**Annotation visibility (All / Selected / None) affects labels ONLY** — never the table, never the dots.

### Selection rules

- **Air, Top, Back** — **at most one selected peak each.** Selecting a peak of one of these modes
  displaces the current holder (mirroring material's `selectLongitudinalPeak`, which clears a
  conflicting cross/FLC assignment). These drive calculated values.
- **All other modes** (Dipole, Ring, Upper Modes, custom, unknown) — unconstrained. Upper Modes is
  explicitly a *cluster*, so multiple selections are correct there. Selection governs annotation only.
- **Assigning an Air/Top/Back mode override makes that peak the holder of the mode**, displacing the
  previous holder. The displaced peak stays classified in that band — still a candidate — and is
  simply no longer selected. This is the intended fix for a mis-guessed auto-selection.
- **Overriding a peak away from Air/Top/Back leaves that mode with no holder.** Derived values needing
  it become undefined. The next-strongest candidate is **not** auto-promoted — the wand restores the
  automatic answer if wanted.
- **Deselecting without replacing is legal** — it means "this mode is not identified in this
  measurement", which is a real outcome.
- **Select All is REMOVED.** Annotation visibility *All* already shows everything and the wand already
  restores automatic selection; "select every peak" asserts twelve Airs and is meaningless under this
  model. **Select None is kept** — it cannot create an impossible state.

## 6. Derived values

Tap-tone ratio, quality, and the report's summary derive from the **selected** peaks alone — and
because Air/Top/Back allow only one selection each (§5a), there is exactly one candidate. The old
"which of the selected Air peaks wins?" ambiguity does not arise.

If a required mode has no holder, the value is undefined and the UI says so ("Need Air & Top").

**Two divergent implementations must be unified**: the live path (`getPeak(for:)`, which scans all
identified modes and ignores selection) and the saved-measurement path
(`TapToneMeasurement.tapToneRatio`, which scans all saved peaks in array order — now the full −100 dB
set). Both become "the selected holder of the mode".

Legacy files where `selectedPeakIDs == nil` continue to mean "all" (`effectiveSelectedPeakIDs`); since
auto-selection picks the strongest candidate per mode, such a file yields the same ratio either way,
so no migration is needed.

**Peak Min does not affect them.** A peak that is selected but hidden by Peak Min still counts. This
is the deliberate consequence of Peak Min being purely a display control; the alternative — hidden
peaks dropping out of the maths — would make Peak Min semantic again and reintroduce exactly the
coupling this spec removes.

Note the reporting consequence: because exports are Peak-Min filtered, a report can print a ratio
derived from a selected peak that does not appear in its own peak list. That is accepted, and is the
user's doing.

---

## Consequences for the implementation (to be confirmed by gap analysis)

Flagged during the discussion, not yet verified against the code:

- A Peak Min change must **filter** the existing frozen peak set, never re-run `findPeaks`. The
  loaded path already behaves this way; the live/frozen path does not.
- With identity stable, the frequency-proximity carry-forward (`applyFrozenPeakState`), the
  `selectedPeakFrequencies` cache, and the ±5 Hz remapping of offsets/overrides/selection have no
  remaining purpose.
- `recalculateTapEntryPeaks()` — which re-derives per-tap peaks at the current Peak Min — conflicts
  with §5 multi-tap and should not exist.
- The freeze transition must store the full −100 dB peak set (the save side of this already landed).