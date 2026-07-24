# Override-marker consistency — italic + ` *` everywhere

**Status:** 🟡 in progress (2026-07-24). Cross-platform (Swift → Python → web). Separate from the
peak-lifecycle work; own commit(s) per repo.

## Decision
A **manually overridden** peak mode is signalled the SAME way on every surface: the mode label is
**italic** with a trailing **` *`**. The small pencil glyph (`pencil.circle.fill` / `✎`) is dropped —
at annotation size it was unreadable (looked like a dot, not a pencil). The separate **in-range**
indicator (check-circle / triangle for "peak frequency inside its assigned mode's band") is a DIFFERENT
signal and is unchanged.

Rationale: the three apps each marked overrides differently, and even within one app the interactive UI
(glyph) disagreed with the tables/PDF (` *`). One vocabulary, chosen as the one already used by the
text/PDF surfaces.

## Starting state (audit 2026-07-24)
| Surface | Swift | Python | Web |
|---|---|---|---|
| Peak card (results list) | italic + `pencil.circle.fill` | nothing | italic + `✎` |
| Peak annotation (chart callout) | italic + `pencil.circle.fill` | nothing | italic + `✎` |
| PDF page-1 peak table | italic + ` *` | italic + ` *` | italic only |
| Multi-tap / comparison tables + PDFs | italic + ` *` | italic + ` *` | unmarked |

## Target state
Every row above → **italic + ` *`**.

## Per-platform work
- **Swift (canonical, first):**
  - `CombinedPeakModeRowView.swift` — remove the `pencil.circle.fill` after the label; append ` *`
    to `effectiveModeLabel` when `isManualOverride` (label already italic).
  - `PeakAnnotations.swift` — same: remove glyph, append ` *`.
- **Python:**
  - `peaks_model.py::annotation_html` — italic + ` *` on the mode label when the peak is overridden
    (currently plain `<b>`). Needs the override flag threaded to the html builder.
  - Peak-card mode label (Analysis Results list) — italic + ` *`.
- **Web:**
  - `PeakCard.tsx` — swap `✎` for ` *` (keep italic via the `override` class).
  - `spectrumRender.ts` annotation — swap `✎` for ` *`.
  - `pdfReport.ts` page-1 peak table — already italic; append ` *`.
  - `pdfReport.ts drawComparisonTable` + `PdfComparison` — add `overrideModes`; render italic + ` *`.

## Notes
- Keep the in-range glyph (check/triangle) — unrelated to override.
- @parity comments + PARITY-MAP unaffected (no file moves); behavior is view-only, no format change,
  no golden movement, no test-fixture change. Add/extend view tests where the platform already has them.