# Date/Time Display — Cross-App Consistency Spec

**Status:** IMPLEMENTED 2026-06-25 in all three apps. Decisions: locale-aware **medium date +
short time**, local time, **compact** (no-year) variant for chart titles / legends; one utility
per app. §A is the original "before" audit; §B/§C unchanged by design.
**Apps:** Swift `GuitarTap`, Python `guitar_tap`, Web `GuitarTapWeb`.
**Goal:** one date/time DISPLAY format used everywhere, backed by a single formatting utility
per app. Filenames and on-disk serialization are intentionally NOT changed (see Rules).

---

## Rules / scope

Three distinct kinds of date/time string exist. Only the first should be unified:

1. **DISPLAY** (user-facing) — list rows, detail, PDF, chart titles, etc. **These diverge and
   are the target of this spec.**
2. **FILENAME** — export filenames embed a Unix epoch (`<slug>-<unix>`). Already identical in
   all three apps. **Leave as-is.**
3. **SERIALIZATION** — the `.guitartap` JSON `timestamp` is ISO-8601 UTC, the cross-app
   interop contract. **Leave as-is** (changing it breaks round-trip parity). One minor variance
   noted below.

---

## A. DISPLAY formats today (the inconsistency)

Example instant used below: 25 June 2026, 14:34 local.

| # | Where it shows | Swift | Python | Web |
|---|---|---|---|---|
| 1 | **Saved Measurements list row** | `Jun 25, 2026 at 2:34 PM` (`.formatted(date:.abbreviated,time:.shortened)`) | `6/25/26, 2:34 PM` (QLocale ShortFormat) | `Jun 25, 2026, 2:34 PM` (`toLocaleString medium/short`) |
| 2 | **Measurement Detail** | `January 25, 2026` + `2:34 PM` (split, `style:.date`/`.time`) | `2026-06-25 14:34:09` (`%Y-%m-%d %H:%M:%S`) | `Jun 25, 2026, 2:34 PM` (`toLocaleString medium/short`) |
| 3 | **PDF report header** | `January 25, 2026` + `2:34 PM` (`style:.date`/`.time`) | `June 25, 2026` + `2:34 PM` (`%B %d, %Y` + 12h) | n/a (no web PDF yet) |
| 4 | **PDF report footer ("Generated...")** | (uses header style) | `Jun 25, 2026, 2:34 PM` (`%b %d, %Y` + 12h) | n/a |
| 5 | **Spectrum chart title / header** | locale default `1/25/26, 2:34 PM` (`Date().formatted()`) | `Jun 25 14:34` (`%b %d %H:%M`) | n/a (web chart title is name-only) |
| 6 | **Comparison legend label (unnamed fallback)** | `Jan 25, 2:34 PM` (`.dateTime.month(.abbreviated).day().hour().minute()`) | `Jun 25 14:34` (`%b %d %H:%M`) | `6/25/2026` (DATE ONLY — `toLocaleDateString`) |
| 7 | **Exported spectrum PNG header** | locale default (`.formatted()`) | `6/25/2026, 2:34 PM` (custom `M/D/YYYY, h:MM AM/PM`) | n/a |
| 8 | **Measurement fallback display name** | (see #6) | `2026-06-25 14:34` (`%Y-%m-%d %H:%M`) — `display_name()` | n/a |

**Observations**
- Within a single app the format already varies (Swift list vs detail vs chart; Python detail
  `%Y-%m-%d %H:%M:%S` vs PDF `%B %d, %Y` vs chart `%b %d %H:%M`).
- Across apps the "same" spot differs (list row: `Jun 25, 2026 at 2:34 PM` vs `6/25/26, 2:34 PM`
  vs `Jun 25, 2026, 2:34 PM`).
- The web comparison fallback (#6) shows **date only, no time** — almost certainly unintended.
- **Bug:** Python PDF footer (#4) uses `datetime.now()` (system local *now*), not the
  measurement's timestamp converted from UTC — fix during consolidation.
- The user's read: **Swift's list-row format is the friendliest** (`Jun 25, 2026 at 2:34 PM`).

---

## B. FILENAME formats (leave as-is — already consistent)

| App | Where | Format | Example |
|---|---|---|---|
| Swift | `TapToneMeasurement.baseFilename`, PNG/PDF/JSON exports | `<slug>-<unix seconds>` | `ramirez-1771351833` |
| Python | `TapToneMeasurement.base_filename`, exports | `<slug>-<unix seconds>` | `ramirez-1771351833` |
| Web | `guitarTapFilename()` | `<slug>-<unix seconds>` | `ramirez-1771351833` |

Debug-only WAV dumps use `YYYY-MM-DDTHH-MM-SSZ` (colons -> hyphens) in all apps; internal, ignore.

---

## C. SERIALIZATION (leave as-is — interop contract)

The `.guitartap` `timestamp` is ISO-8601 UTC in all three. Minor, harmless variance (all valid
ISO-8601, all parse cross-app):

| App | Producer | Example |
|---|---|---|
| Swift | `JSONEncoder.dateEncodingStrategy = .iso8601` | `2026-06-25T14:34:09Z` |
| Python | `datetime.now(timezone.utc).isoformat()` | `2026-06-25T14:34:09.123456+00:00` |
| Web | `new Date().toISOString()` (microseconds stripped) | `2026-06-25T14:34:09Z` |

(Optional tidy-up, not required: have Python drop microseconds / use `Z`. Cosmetic only.)

---

## D. Proposal

**D1 — the unified DISPLAY format.** Pick one; used by EVERY display spot (#1-#8):

- **Option A (recommended): fixed pattern, identical on every platform**
  `MMM d, yyyy 'at' h:mm a` -> `Jun 25, 2026 at 2:34 PM`
  (Swift `DateFormatter`/template; Python `%b %-d, %Y at %-I:%M %p`; web `Intl.DateTimeFormat`
  parts or a small builder.) Pros: truly identical across apps; matches the format the user
  likes. Cons: English-only (not localized).
- **Option B: each platform's locale-aware medium-date + short-time**
  (~ Swift's current list row). Pros: localized. Cons: output differs by user locale, so not
  pixel-identical across platforms; harder to call "consistent".

**D2 — compact variant for tight spots (chart title, comparison legend #5/#6)?**
  e.g. `MMM d, h:mm a` -> `Jun 25, 2:34 PM` (drop the year). Or just use the full format
  everywhere. Decision needed.

**D3 — timezone:** display in the **user's local time** (convert from the stored UTC), which is
what most spots already do. Standardize on that and fix the Python PDF-footer bug.

---

## E. Single-utility plan (after D1-D3)

Each app gets ONE helper used by every display site; no inline date formatting elsewhere.

- **Swift** — `DateDisplay.string(_ date: Date)` (+ `.compact(_:)` if D2=yes) in a small
  `DateDisplay.swift`. Replace the `.formatted(...)` / `style:.date`/`.time` calls at:
  MeasurementRowView, MeasurementDetailView, PDFReportGenerator, TapToneAnalysisView+Export,
  ExportableSpectrumChart, `comparisonLabel(for:)`.
- **Python** — `format_display_datetime(value)` (+ `_compact`) in `utilities/` (accepts an ISO
  string or datetime; UTC->local). Replace: measurement_row_view, measurement_detail_view,
  tap_analysis_results_view (PDF header+footer), fft_canvas, exportable_spectrum_chart,
  tap_tone_measurement.display_name, the analyzer fallback label.
- **Web** — `formatDisplayDate(iso)` (+ `formatDisplayDateCompact`) in `src/format/date.ts`.
  Replace the duplicated `fmtDate` in MeasurementsPanel + MeasurementDetail and the
  `toLocaleDateString` comparison fallback in fromLive. (No web PDF yet; the future one uses it.)

Filenames keep their own `<slug>-<unix>` helper (unchanged). Serialization keeps ISO-8601.

---

## F. Decisions (RESOLVED 2026-06-25)

- **D1 — Option B (locale-aware)**, **medium date + short time**. Each app uses its native
  locale formatter so the three render equivalently per user: web `Intl medium/short`, Swift
  `.formatted(date:.abbreviated,time:.shortened)`, Python Babel `format_date('medium')` +
  `format_time('short')` combined via the locale's datetime pattern.
- **D2 — yes, a compact (no-year) variant** for chart titles / comparison legends
  (e.g. "Jun 25, 2:34 PM"): web `formatDisplayDateCompact`, Swift `DateDisplay.compact`,
  Python `format_display_datetime_compact` (Babel skeleton "MMMd" + short time).
- **D3 — local time** everywhere (convert from stored UTC). The Python PDF footer is the report
  *generation* time (`datetime.now()`), now routed through the util for consistent formatting.

### Implemented — one utility per app, all display sites routed through it
- **Web** (`src/format/date.ts`): `formatDisplayDate` / `formatDisplayDateCompact`; swapped
  MeasurementsPanel, MeasurementDetail, fromLive comparison label (was date-only — fixed).
  typecheck/build clean, 83 tests.
- **Python** (`utilities/date_format.py`, **adds `babel` dep**): `format_display_datetime` /
  `_compact`; swapped row view, detail, PDF header+footer (x2), fft_canvas legend,
  exportable_spectrum_chart, model `display_name`, analyzer comparison label. ruff-F clean,
  372 tests, widgets smoke-tested.
- **Swift** (`Utilities/DateDisplay.swift`): `DateDisplay.string` / `.compact`; swapped
  MeasurementRowView, MeasurementDetailView, PDFReportGenerator (x4), TapToneAnalysisView+Export
  (x3), ExportableSpectrumChart (x3), comparison label. Parse-clean here; **build in Xcode**.