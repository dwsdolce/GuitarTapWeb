# Measurement Details Pane — Cross-App Consistency Spec

**Status:** analysis + proposal (decisions pending). 2026-06-25.
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

## 7. Proposed canonical spec

A single Details pane definition all three converge to. Each row shown only when present.

### 7.1 Measurement Info (all types)
1. Measurement Name
2. Date — **decide one format** (proposal: locale medium date + short time)
3. Ring-Out — `"%.2f s"` (guitar only)
4. Tap Tone Ratio — `"%.2f : 1"` (guitar only)
5. Measurement Type
6. Guitar Type
7. Number of Taps
8. Microphone
9. Calibration (where the platform has it; web omits)
10. Notes

→ **Swift adds rows 5–8 (+9).** Python/Web already match. Standardize Ring-Out on `"%.2f s"`.

### 7.2 Dimensions — plate/brace only *(DECISION D2)*
If adopted: Length / Width / Thickness / Mass (+ Density? + body L×W + stiffness preset for plate).
→ New section in **all three**.

### 7.3 Detected Peaks (guitar + material)
- Sorted by frequency; title "Detected Peaks (N selected[, M unselected])".
- Row: star + mode label + `%.1f Hz` + pitch + `Q: %.1f` + `BW: %.1f Hz` + `%.1f dB`; unselected dimmed.
- **Material label = DECISION D1** (fL/fC/fLC vs full words), resolved from the selected
  L/C/FLC IDs so it's correct regardless of stored `modeLabel`.
  → **Web fix required** either way (label by selected IDs, not `modeLabel ?? 'Peak'`).
- Guitar unknown-mode filtering: align all three (proposal: honor `showUnknownModes`).

### 7.4 Compared Spectra (comparison only)
- Per entry: color dot + label + Air / Top / Back (`%.1f Hz` / "—"), resolved from the entry's
  selected peaks + guitar type.
- → **Swift & Python add this section**; web already has it.

---

## 8. Open decisions

- **D1 — Material peak label:** `fL / fC / fLC` (Swift detail style, compact) **vs**
  `Longitudinal / Cross-grain / FLC` (matches the chart annotations we standardized + Python).
  *Recommendation:* full words, for one vocabulary across chart + detail (note: makes rows wider).
- **D2 — Dimensions section** for plate/brace: add **vs** leave out.
  *Recommendation:* add — material detail is otherwise sparse.
- **D3 — Scope/order of changes:** which apps, in what order. Swift is mid App-Store review
  (coordinate before touching the in-flight build).

---

## 9. Per-app change list (once D1–D3 are set)

### Web (`GuitarTapWeb`) — `src/components/MeasurementDetail.tsx`
- [ ] Fix material peak labels: resolve from `selectedLongitudinal/Cross/FlcPeakID` (D1), not `modeLabel ?? 'Peak'`.
- [ ] (D2) Add Dimensions section for plate/brace (data from the snapshot / settings).
- [ ] (Optional) Honor `showUnknownModes` for guitar peak filtering.
- [ ] Comparison "Compared Spectra" already present — confirm it matches the agreed columns.
- Note: `buildMaterialMeasurement` could also persist `modeLabel` for robustness, but
  labeling by selected ID makes the detail correct without relying on it.

### Python (`guitar_tap`) — `views/measurements/measurement_detail_view.py`
- [ ] (D1) Make material peak label match (currently full words from `mode_label`).
- [ ] (D2) Add Dimensions section for plate/brace.
- [ ] **Add Compared Spectra section** for comparison records (currently shows "No peaks detected").
- [ ] Confirm Info field set matches §7.1.

### Swift (`GuitarTap`) — `Views/Measurements/MeasurementDetailView.swift`  *(coordinate w/ review)*
- [ ] **Add Info rows 5–8 (+9):** Measurement Type, Guitar Type, Number of Taps, Microphone, Calibration.
- [ ] (D1) Material peak label (currently fL/fC/fLC).
- [ ] (D2) Add Dimensions section for plate/brace.
- [ ] **Add Compared Spectra section** for comparison records.
- [ ] Standardize Ring-Out string to `"%.2f s"` (currently "seconds").

---

## 10. Reference: data available per type

- **Guitar:** `peaks` (modeLabel, pitch, Q, BW), `decayTime`, tap-tone ratio, `spectrumSnapshot`, `tapEntries`, `numberOfTaps`, provenance (mic, sample rate, peakMin).
- **Plate:** `longitudinalSnapshot`/`crossSnapshot`/`flcSnapshot`, `selectedLongitudinal/Cross/FlcPeakID`, `peaks` = the selected 3, dims (plate L/W/T/Mass, body L×W, stiffness preset, `measureFlc`).
- **Brace:** `longitudinalSnapshot`, `selectedLongitudinalPeakID`, `peaks` = 1, brace L/W/T/Mass.
- **Comparison:** `comparisonEntries` (label, colorComponents, snapshot, peaks, guitarType), `peaks` = [].