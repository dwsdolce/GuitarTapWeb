# Measurement Details Pane — Cross-App Consistency Spec

**Status:** IMPLEMENTED 2026-06-25 in all three apps (§9). Decisions: D1 = full words; D2 = no dimensions; D3 = all three apps. §1–§6 are the original "before" analysis; §7 is the spec.
**Apps:** Swift `GuitarTap` (canonical), Python `guitar_tap` (mirror), Web `GuitarTapWeb` (port).
**Scope:** the read-only **Measurement Details** inspector, opened from the Measurements list.

The Details pane diverged because it was never specced — each app grew its own version. This
document captures the current state of all three, the inconsistencies, and a proposed
canonical spec to converge on. Numbers/formatting must match to the usual parity bar
(2–3 dp + exact categorical strings).

---

## 1. Where it lives / how it opens

| App | File | Opened by | Presentation |
|---|---|---|---|
| Swift | `Views/Measurements/MeasurementDetailView.swift` (Info 77–135, Peaks 137–198) | `MeasurementsListView` row menu → **View Details** (~603) | macOS: separate `NSWindow` 600×700; iOS: `.sheet` with Done |
| Python | `views/measurements/measurement_detail_view.py` (Info 261–316, Peaks 318–360) | `measurements_list_view.py` `_open_detail` (~276), row double-click / **View Details** | modal `QDialog` 640×640, Close button |
| Web | `src/components/MeasurementDetail.tsx` | `MeasurementsPanel` ⋯ menu → **View Details** | modal overlay, Close button |

All three are **read-only** (Load / Edit / Export / Delete live on the row's ⋯ / context menu).

---

## 2. Current state — section structure

| Section | Swift | Python | Web |
|---|:--:|:--:|:--:|
| Measurement Info | ✓ | ✓ | ✓ |
| Detected Peaks | ✓ | ✓ | ✓ |
| Compared Spectra (comparison) | ✗ | ✗ | ✓ |
| Dimensions (plate/brace) | ✗ | ✗ | ✗ |

---

## 3. Current state — Measurement Info fields & order

Order is top-to-bottom; every row is shown only when its value is present.

| # | Field | Swift | Python | Web | Format notes |
|---|---|:--:|:--:|:--:|---|
| 1 | Measurement Name | ✓ | ✓ | ✓ | bold value |
| 2 | Date | ✓ | ✓ | ✓ | Swift: `date "at" time`; Python: `YYYY-MM-DD HH:MM:SS`; Web: locale `medium/short` |
| 3 | Ring-Out | ✓ | ✓ | ✓ | Swift: `"%.2f seconds"`; Python/Web: `"%.2f s"` |
| 4 | Tap Tone Ratio | ✓ | ✓ | ✓ | `"%.2f : 1"` (all) |
| 5 | Measurement Type | ✗ | ✓ | ✓ | raw enum string ("Acoustic Guitar", "Material (Plate)") |
| 6 | Guitar Type | ✗ | ✓ | ✓ | raw enum ("Acoustic", "Classical", "Generic") |
| 7 | Number of Taps | ✗ | ✓ | ✓ | integer |
| 8 | Microphone | ✗ | ✓ | ✓ | device name |
| 9 | Calibration | ✗ | ✓ | ✗ | web has no calibration data |
| 10 | Notes | ✓ | ✓ | ✓ | word-wrapped |

**Divergence:** Swift Info is minimal (rows 1–4, 10). Python & Web are rich (adds 5–8, Python also 9).

---

## 4. Current state — Detected Peaks

All three: peaks **sorted by frequency ascending**, group title **"Detected Peaks (N selected[, M unselected])"**, each row = selection star + mode label + `%.1f Hz` + pitch (`♪ Note ±¢`) + `Q: %.1f` + `BW: %.1f Hz` + `%.1f dB` (color-coded), unselected dimmed to ~40%.

**Material peak label diverges three ways:**

| App | Material label source | Result |
|---|---|---|
| Swift | resolved at display time from `selectedLongitudinal/Cross/FlcPeakID` | **fL / fC / fLC** |
| Python | stored `peak.mode_label` (falls back to guitar classify) | **Longitudinal / Cross-grain / FLC** |
| Web | `peak.modeLabel ?? 'Peak'` | **BUG:** web-saved material has no `modeLabel` → shows **"Peak" ×3**; imported files show words |

> Web root cause: `buildMaterialMeasurement` (fromLive.ts ~451) never sets `modeLabel` on the
> peaks. The encoder injects it on export, so a re-imported file looks right, but the
> IndexedDB-stored object (what the detail reads) has no label.

**Guitar peaks** are consistent across apps (mode label from classification / override).

---

## 5. Current state — by measurement type

### Guitar (generic / acoustic / classical / flamenco)
- Info: shows Ring-Out + Tap Tone Ratio (guitar-only). Type = "… Guitar", Guitar Type set.
- Peaks: all detected peaks, mode labels Air/Top/Back/etc. Swift filters unknown modes unless `showUnknownModes`; **web does not filter** (shows all). (minor divergence)
- Multi-tap: `tapEntries` exist but the detail shows only the averaged peaks in all apps.

### Plate
- Info: **no** Ring-Out / Ratio. Type = "Material (Plate)".
- Peaks: the selected L / C / FLC peaks → label divergence above.
- **Dimensions** (Length/Width/Thickness/Mass, body L×W, stiffness preset, measureFlc) — stored in the snapshot but **shown by no app**.

### Brace
- Like plate but single peak (fL) and brace dimensions; no Cross/FLC.

### Comparison
- `comparisonEntries` populated; top-level `peaks: []`; no snapshot, decay, ratio, dims.
- Swift / Python: Info shows ~Name/Date/Notes only; Detected Peaks → **"No peaks detected"**. **Effectively empty — the reported "missing information."**
- Web: shows **"Compared Spectra (N)"** = per-entry color dot + label + Air/Top/Back table. (most useful of the three)

---

## 6. Inconsistencies (summary)

1. **Info field set** — Swift minimal vs Python/Web rich (rows 5–8 missing in Swift).
2. **Material peak labels** — fL/fC/fLC (Swift) vs full words (Python) vs broken "Peak" (Web-saved).
3. **Comparison** — Web informative; Swift/Python show nothing.
4. **Plate/brace dimensions** — absent in all three; material detail is sparse.
5. **Guitar unknown-mode filtering** — Swift filters, Web doesn't.
6. **Formatting nits** — Date format; Ring-Out "seconds" vs "s".

---

## 7. Canonical spec — DECIDED 2026-06-25

**Purpose.** A lightweight read-only inspector: confirm *what a saved measurement is and how it
was captured*, plus its *identified results*. NOT a full data dump. The page has existed since
the early days but is rarely used; this trims it to what's actually worth inspecting (drop the
all-peaks listing and the redundant analysis numbers).

Each row/section shown only when it has a value.

### 7.1 Measurement Info (all types)
1. **Measurement Name**
2. **Date** — the app's single canonical format, **identical to the Saved-Measurements list row
   and the PDF report** (per app; web = locale *medium date + short time*).
3. **Measurement Type** — ONE field from the Settings vocabulary:
   **Acoustic / Classical / Flamenco / Generic / Plate / Brace / Comparison**.
   Replaces the old raw "… Guitar" / "Material (Plate)" string AND the separate "Guitar Type" row.
4. **Number of Taps** — provenance.
5. **Microphone** — provenance.
6. **Calibration** — provenance; **add on all platforms**, shown when present (web populates it
   once calibration support lands; omitted until then).
7. **Notes**

**Removed:** Ring-Out, Tap Tone Ratio (not useful here), Guitar Type (folded into Type),
Sample Rate. **No Dimensions section** — D2 resolved to *no* (part of the data trim).

### 7.2 Identified Peaks (guitar + plate + brace) — SELECTED peaks only
- Show only the **selected / identified** peaks — NOT every detected peak (the "too much data").
  - Guitar: the identified mode peaks (Air/Top/Back + any user-selected). Multi-tap → the
    **averaged** result's selected peaks.
  - Plate/brace: the selected fL/fC/fLC peaks.
- Drop the unselected rows, the "(N selected, M unselected)" count, and the star/dimming
  (everything shown is selected).
- Per-peak row: mode label + `%.1f Hz` + pitch + `Q: %.1f` + `BW: %.1f Hz` + `%.1f dB`.
- Material label resolved from `selectedLongitudinal/Cross/FlcPeakID` (correct regardless of any
  stored `modeLabel` — fixes the web "Peak" bug). **Label text = D1 (open).**
- Guitar unknown-mode filtering is now moot — only identified peaks are shown.

### 7.3 Compared Spectra (comparison only)
- Per entry: color dot + label + Air / Top / Back (`%.1f Hz` / "—"), resolved from the entry's
  selected peaks + guitar type. Keep; Swift & Python **add** it.

---

## 8. Decisions

**Resolved 2026-06-25:**
- Purpose = lightweight inspector; **no all-peaks dump**.
- **Identified Peaks = selected-only** (guitar identified / plate-brace L-C-FLC / multi-tap averaged).
- **Comparison** keeps the Air/Top/Back table everywhere.
- **Info trimmed:** remove Ring-Out + Tap Tone Ratio; one **Measurement Type** field (Settings
  vocabulary + Comparison); fold away Guitar Type; drop Sample Rate.
- **Date** unified to the app's Saved-Measurements-list / PDF format.
- **Calibration** added on all platforms (web fills it when available).
- **D2 = NO** dimensions section.

**Remaining:**
- **D1 — plate/brace peak label:** `fL / fC / fLC` (compact; Swift's current detail) **vs**
  `Longitudinal / Cross-grain / FLC` (matches the chart annotations + Python). *Recommendation:*
  full words, for one vocabulary across chart + detail.
- **D3 — scope/order:** which apps to change, in what order (Swift mid App-Store review).

---

## 9. Per-app change list — DONE 2026-06-25

### Web (`GuitarTapWeb`) — `src/components/MeasurementDetail.tsx` ✅
- [x] Info trimmed: removed Ring-Out, Tap Tone Ratio, Guitar Type, Sample Rate.
- [x] Single **Measurement Type** field via `measurementTypeName()` (Settings vocabulary + Comparison).
- [x] Kept Name, Date, Number of Taps, Microphone, **Calibration** (shown when present), Notes.
- [x] Peaks: **selected-only** "Identified Peaks"; no star/dimming/count.
- [x] Material labels (full words) resolved from `selectedLongitudinal/Cross/FlcPeakID`.
- [x] Comparison "Compared Spectra" kept. *(typecheck + build clean, 83 tests pass)*

### Python (`guitar_tap`) — `views/measurements/measurement_detail_view.py` ✅
- [x] Info: removed Ring-Out + Tap Tone Ratio; single **Measurement Type** field (`_type_name`); folded away Guitar Type.
- [x] `_PeakRow`: dropped star/opacity; added `label_color` override for material.
- [x] Peaks: **selected-only** "Identified Peaks"; material full-word labels + colours.
- [x] **Added Compared Spectra section** (reuses `ComparisonResultsView` via `_comparison_data`).
      *(ruff clean, 372 tests pass; dialog smoke-tested guitar/plate/comparison)*

### Swift (`GuitarTap`) — `Views/Measurements/MeasurementDetailView.swift` ✅ *(build/verify in Xcode; stash for release)*
- [x] Info: added Measurement Type (single field via `measurementTypeName`) + Number of Taps + Microphone + Calibration; removed Ring-Out + Tap Tone Ratio.
- [x] Peaks: **selected-only** "Identified Peaks"; material full-word labels; `isSelected: true` (no star/dimming).
- [x] **Added Compared Spectra section** for comparison records (`ComparisonResultsView(spectra:)`).
      *(parse-clean + braces balanced here; NOT compiled — verify in Xcode)*

**Note — Date format:** the web already uses the Saved-Measurements-list format; Python/Swift kept their
existing absolute date formats. If those differ from each app's list/PDF, align as a small follow-up.
**Note — Calibration (web):** the row is wired but stays hidden until the web grows microphone-calibration
storage in Settings (a Phase 5 feature, mirroring Python/Swift).

---

## 10. Reference: data available per type

- **Guitar:** `peaks` (modeLabel, pitch, Q, BW), `decayTime`, tap-tone ratio, `spectrumSnapshot`, `tapEntries`, `numberOfTaps`, provenance (mic, sample rate, peakMin).
- **Plate:** `longitudinalSnapshot`/`crossSnapshot`/`flcSnapshot`, `selectedLongitudinal/Cross/FlcPeakID`, `peaks` = the selected 3, dims (plate L/W/T/Mass, body L×W, stiffness preset, `measureFlc`).
- **Brace:** `longitudinalSnapshot`, `selectedLongitudinalPeakID`, `peaks` = 1, brace L/W/T/Mass.
- **Comparison:** `comparisonEntries` (label, colorComponents, snapshot, peaks, guitarType), `peaks` = [].