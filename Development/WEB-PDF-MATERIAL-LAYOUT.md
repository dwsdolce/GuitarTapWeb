# Web PDF — material (brace/plate) report diverges from Swift/Python

**Status:** ✅ **DONE + USER-VERIFIED 2026-07-16** — *"I just verified the plate and brace measurements
pdfs. All look good."* Brace analysed, plate inventory taken, **A–L implemented** (G withdrawn as a
phantom; K also applied to Python). Web build exit 0 · 278 tests · Python 488 tests · parity
`--check` exit 0. Verified against the exported artifacts, not just the code.

**Measured outcome of §L:** the plate report went **3.50 MB → 0.18 MB** (`/FlateDecode`), making the
web's PDF **smaller than Swift's (0.61 MB) and Python's (0.62 MB)**. Brace: 0.10 MB.

**⚠ A stale deploy nearly cost an afternoon.** The brace PDF that looked un-reordered was exported
*after* the fix but *by the old server build* — the user's `npm run dev` run was correct all along.
**A PDF's timestamp says when it was exported, not which code exported it.** Re-deploy before
re-reviewing.

### Orphaned heading — ✅ FIXED + USER-VERIFIED 2026-07-16

Noticed while reviewing the verified PDFs: "Plate Properties" could land alone at the foot of a page
with its content overleaf, which reads as missing content. (Pagination *itself* is fine — the user
ruled that for the brace: *"that is not a problem"*. This is only about the heading travelling with
its first block.)

**Cause:** the heading and the Sample Dimensions box each called `ensure()` **separately** — the
heading claimed the last 30 pt of a page, then the box didn't fit and paginated away without it.
Swift never hits this: its page **auto-grows**, so nothing is ever pushed.

**Fix:** reserve them together — `ensure(cur, max(30, 18 + threeColBoxHeight(dimensions) + 6))`
before drawing the title, via a new `threeColBoxHeight()` that `threeColBox` also uses (one height
calculation, not two that can drift).

**Verified by simulation**, walking the title's y across the 90 pt danger zone at a page foot:
**46 of 90 positions orphaned the title under the old rule; 0 of 90 under the new one.** Web build
exit 0 · 278 tests.

## What landed (2026-07-16)

| | fix | files |
|---|---|---|
| **A** | Sample Dimensions → **3 columns in a grey box** (new `threeColBox`) | `pdfReport.ts` |
| **B** | Properties → **column-major** (`twoColRows(…, 'column')`; explicit `fill` per caller, no default) | `pdfReport.ts` |
| **C** | fL/fC/fLC → 3 columns, grey box, **bold values** (`freqs` is now `PdfMaterialProp[]`, was `string[]`) | `pdfReport.ts`, `measurementImage.ts` |
| **D** | **`GLC (Shear Modulus)` full-width row** added after the two-column block (+ the italic "GLC assumed 0" note) | both |
| **E** | Gore box sub-lines → **Body/f_vs then GLC** | `pdfReport.ts` |
| **F** | Quality colours → **one scheme-qualified table** (see below) | `qualityColors.ts` (new), `measurementImage.ts`, `MaterialResults.tsx` |
| ~~G~~ | **WITHDRAWN — not a bug.** See below. | — |
| **H** | Both frequency formatters (they were **swapped**) | `pdfReport.ts`, `spectrumExport.ts` |
| **I** | Chart subtitle → **conditional**, not a rename | `spectrumExport.ts` |
| **J** | Legend `Series:` → `Measurements:` | `spectrumExport.ts` |
| **K** | Dark rounded **matte** around the chart — web **and Python** (user's call) | `pdfReport.ts`, `tap_analysis_results_view.py` |
| **L** | `addImage(…, 'MEDIUM')` — 3.50 MB → **~0.13 MB** | `pdfReport.ts` |

### ⚠ G was a PHANTOM — I invented it, do not re-chase

I reported `Young's Modulus (L):6.09 GPa` as missing a space after the colon. **It is not.** Measured
with jsPDF: `getTextWidth(label + ': ')` counts the trailing space and yields a **2.80 pt gap for
every label**, identical across all four; the apostrophe is plain ASCII `0x27`; and the value is
always placed at exactly `width(label + ': ')`. There is no mechanism for a per-label difference.
**I misread a rasterised image.** Lesson: do not report a text-level defect from a rendered
screenshot — measure it.

### §H was worse than logged — the two formatters were SWAPPED

Swift deliberately keeps **two**: `formattedAsFrequency()` (`Extensions.swift:53`, `%.1f`) for the
report's metadata row, and a local `formatFreq` closure (`ExportableSpectrumChart.swift:510`, `%.0f`,
and the odd `"1.5k Hz"` kHz form) for the chart's `Range:` line. The web had **each one's rounding on
the other**. Both now match their own counterpart. Keep them distinct.

### §F grew into a structural fix — see `src/presentation/qualityColors.ts`

The map was **duplicated** (`MaterialResults.tsx` + `measurementImage.ts`), both copies already
drifted from Swift: `Good` was **yellow** (`#ffd60a`) where Swift is `.blue`, and `Very Good` was
`#34c759` — *Excellent's* canonical green, not `.mint`. Both were **hue** errors, not shades.

Verified against **Python**, which documents itself as the single source of truth and names each
system colour: `.green #34C759 · .mint #00C7BE · .blue #007AFF · .orange #FF9500 · .red #FF3B30`.
(My first attempt guessed the hexes and got all of them wrong — Python is the authority here, not
recollection.)

Now **one table, qualified by scheme** (`light` | `dark`), living in `presentation/` — because a hex
is a presentation concern. **Swift and Python are wrong to hang it off the model enum**
(`WoodQuality.color`); that is a layer violation for the theme work to fix, not worth churning the
natives for now. The web already had the correct pattern for the analogous case (`GuitarMode.color`
→ `presentation/modeColors.ts`), and this mirrors it as the new `model/quality-colors` parity slug.
Callers name their scheme: the **PDF is always `'light'`** (a printed report is not themed); the app
passes `'dark'` until the theme work supplies the active scheme.

⚠ `dark`'s `Very Good` (`#66D4CF`) is the **one unverified hex** — no mint exists anywhere in the
three repos to copy. The *hue* is what parity requires and is correct; the exact token is the theme
project's to confirm.

### §K — Swift's "border" is a MATTE, not a stroke

`.background(Color(white: 0.05)).cornerRadius(6)`. Swift's chart PNG carries **transparent padding**
(hence the `DeviceGray` alpha mask in its PDF) and the near-black background shows *through* it — so
the thickness is SwiftUI's default padding leaking, which is why the user reads it as "a little too
thick". Web and Python have opaque images, so both now draw the look deliberately (`#0D0D0D`,
radius 6, 5 pt inset). **Thinning it is a 3-platform change including Swift → post-release.**

Python needed it at **both** story builders (`_build_averaged_story` / `_build_comparison_story`) —
Swift applies it at both its sites (`:405`, `:1261`) and Python had it at neither. Done via one
shared `_spectrum_image_matte()` helper; ReportLab 4.4.10 supports `ROUNDEDCORNERS`, so no custom
Flowable was needed (my first estimate over-stated this).

### Structural note for item 2 — the web has ONE image path, Swift/Python have TWO

Swift (`:405`, `:1261`) and Python (`_build_averaged_story`, `_build_comparison_story`) each
duplicate the whole story builder per report type; **the web consolidated them into one**. So every
fix above lands on both report types from a single web edit, while Python needed K twice. The web is
arguably better here (the two cannot drift) but it *is* a divergence from canonical — **decide it
with the view-layer restructure (STATUS item 2), not here** (user, 2026-07-16).

**SCOPE = 1.0.2 RELEASE** (user, 2026-07-16): *"If we can fix the discrepancies in the web PDF for brace
and plate then that is enough for this release."* Web-only. Swift and Python are near-identical to each
other and **Swift is canonical**. The parking condition ("wait for the plate tests so brace + plate get
ONE fix pass") is now **satisfied** — fix them together.

Every **value** is correct on all three; this is **placement, styling, and a few missing rows**.

## ⭐ The brace bug IS in the plate report — it was just camouflaged

The user's read was *"I do not see the problem we saw in the Brace PDF (but I may be missing it)"*. **It
is there.** Same `twoColRows()` root cause, same row-major-vs-column-major fill:

**Swift (canonical) — column-major, fills DOWN then across:**
```
Speed of Sound (L): 4174 m/s      Specific Modulus (L): 17.4 (Fair)
Speed of Sound (C): 1144 m/s      Specific Modulus (C): 1.3 (Very Good)
Young's Modulus (L): 6.08 GPa     Radiation Ratio (L): 12.0
Young's Modulus (C): 0.46 GPa     Radiation Ratio (C): 3.3
GLC (Shear Modulus): 0.350 GPa
```

**Web — row-major, fills ACROSS then down:**
```
Speed of Sound (L): 4180 m/s      Speed of Sound (C): 1144 m/s
Young's Modulus (L):6.09 GPa      Young's Modulus (C):0.46 GPa
Specific Modulus (L): 17.5 (Fair) Specific Modulus (C): 1.3 (Very Good)
Radiation Ratio (L): 12.0         Radiation Ratio (C): 3.3
```

**Why it hides:** row-major fill *accidentally* produces a plausible layout — every `(L)` lands in the
left column and every `(C)` on the right, which reads like a deliberate L/C split. Swift instead pairs
each property's L and C **vertically**. On the brace (4 unrelated properties) the same bug produced an
obviously-wrong order; on the plate it produces a wrong-but-tidy one. **Do not judge this fix by whether
the output "looks reasonable" — compare against Swift item by item.**

---

## Inventory — web PDF vs Swift (canonical)

Evidence: `~/Documents/GuitarTap/plate-umik-1-{swift,python,web}-mac-*.pdf` (2026-07-16, same
measurement) and the earlier brace set. ⚠ **Transient** — these tables are the record.

### A. Sample Dimensions — 2 columns instead of 3, and no box

| | layout |
|---|---|
| Swift / Python | **3 columns**, grey box: `Length \| Width \| Thickness` / `Mass \| Density` |
| **Web** | **2 columns**, no box: `Length \| Width` / `Thickness \| Mass` / `Density` |

**Consequence the user spotted:** thickness lands *"on a different line"*. **And worse — `Density`
is pushed onto PAGE 2**, so the Sample Dimensions box is split across a page break with a lone
`Density: 0.349 g/cm³` orphaned at the top of page 2.

*(This is also the source of the earlier "web omits the plate sample thickness" concern — it does not;
the 2-column wrap merely moved it. User: "My fault. It was hiding… it looks like 2 vs 3 column issue.")*

### B. Plate properties — row-major vs column-major

See the section above. Root cause: `twoColRows()` in `src/presentation/pdfReport.ts` fills
`rows[i]` left / `rows[i+1]` right.

### C. fL / fC / fLC row — no box, values not bold *(user)*

| | |
|---|---|
| Swift / Python | grey box; **values bold** — `fL: **66.9 Hz**   fC: **117.3 Hz**   fLC: **35.9 Hz**` |
| **Web** | no box; **values not bold** |

### D. `GLC (Shear Modulus)` row MISSING from Plate Properties *(web)*

Swift and Python list `GLC (Shear Modulus): 0.350 GPa` **in the properties list** (left column, after
Young's Modulus (C)) *as well as* inside the Gore box. The web has it **only in the Gore box** — the
properties-list row is absent.

### E. Gore Target Thickness box — sub-lines in the wrong order

| | order |
|---|---|
| Swift / Python | `Body: 490 × 368 mm · f_vs = 60 (Classical Top)` **then** `GLC (Shear Modulus): 0.350 GPa` |
| **Web** | `GLC (Shear Modulus): 0.350 GPa` **then** `Body: 490 × 368 mm · f_vs = 60 (Classical Top)` |

### F. Overall Quality — wrong colour

Swift and Python render `Good` in **blue**; the web renders it in **orange/amber**. (The web's Specific
Modulus quality colours — 17.5 orange "Fair", 1.3 green "Very Good" — do match.)

### G. Missing space after the colon *(web, and inconsistent with itself)*

`Young's Modulus (L):6.09 GPa` — no space after `:`. The web's own `Speed of Sound (L): 4180 m/s` has
one. Affects both Young's Modulus rows.

### H. Frequency Range format

| | |
|---|---|
| Swift / Python | `20.0 Hz – 200.0 Hz` |
| **Web** | `20 Hz – 200 Hz` |

⚠ Same family as the Results-panel "Showing …" divergence — see
[RESULTS-PANEL-CONSISTENCY.md](RESULTS-PANEL-CONSISTENCY.md) §2. **Fix the frequency-range formatting
once**, not twice.

### I. Chart subtitle

Swift / Python: `Comparing 3 measurements` · **Web:** `Detected Peaks: 3`

### J. Chart legend label

Swift / Python: `Measurements:` · **Web:** `Series:`

### K. Chart border *(Swift is the odd one — decide, don't assume)*

Swift draws a **black rounded border** around the chart image; Python and the web do not. Swift is
canonical, so either the web+Python gain it or Swift drops it — a decision, not an obvious fix.

### L. Web PDF is 3.5 MB vs ~615 KB *(cosmetic; note only)*

The embedded chart image is far larger. Not a correctness issue; worth a look if the fix pass touches
chart export.

---

## ✅ NOT web bugs — found while comparing, belong to the OTHER platforms (post-release)

These are **out of the 1.0.2 web-only scope.** Recorded so they aren't lost.

### M. ⚠ Swift's chart peak chips show GUITAR MODE names on a PLATE

Swift's "Detected Peaks Summary" chips read **`Unknown` / `Unknown` / `Air (Helmholtz)`**. Python and
the web both show the material **roles** (`FLC` / `Longitudinal` / `Cross-grain`). **"Air (Helmholtz)"
is meaningless for a plate** — the guitar-mode classifier is being applied to a material measurement.
Swift is canonical *but wrong here*; Python/web have it right. Related:
[[project_loaded_peaks_authoritative]] / the mode-classification path.

### N. Swift's chart legend omits the role suffixes

Swift: `Longitudinal` / `Cross-grain` / `FLC` · Python + web: `Longitudinal (L)` / `Cross-grain (C)` /
`FLC`. Minor; pairs with M (same Swift chart-export path).

### O. Python's date format differs

Python: `Jul 16, 2026, 3:56 PM` · Swift + web: `Jul 16, 2026 at 3:56 PM`. Check against
[[project_datetime_format_consistency]] (unified 2026-06-25) before changing — this may be
locale-medium formatting doing the right thing per platform.

---

## ✅ Confirmed NOT problems (checked — don't re-chase)

- **Detected Peaks table order is CORRECT on all three** — 35.9 / 67.0 / 117.3, sorted by frequency,
  web included. ⭐ Notable: the web's **PDF** sorts correctly while its **Results panel** does not
  (RESULTS-PANEL-CONSISTENCY §1) — so the two render from different orderings, and fixing the panel
  must not "fix" the PDF into agreement with the panel's bug.
- **Sample thickness is present on all three** (`Thickness: 4.85 mm`) — see §A.
- **Page count** (Swift 1, Python 2, web 2) — content-dependent; user already confirmed for the brace
  that spilling to page 2 is fine.
- **`Generated by GuitarTap Web 1.0.2 (112)`** vs `GuitarTap 1.0.2 (398/440)` — the edition name is
  intentional.
- **fL/thickness value differences** (66.9 vs 67.0; 2.81 vs 2.80) — STATUS item 4's first-tap defect,
  not a PDF issue.

## Canonical reference — `PDFReportGenerator.swift:893-910` (brace 4-property block)

Two side-by-side `VStack`s, i.e. column-major by construction:

```swift
HStack(alignment: .top, spacing: 0) {
    VStack {                                   // LEFT column  = props[0], props[1]
        platePropRow("Speed of Sound", …)
        platePropRow("Young's Modulus (E)", …)
    }
    VStack {                                   // RIGHT column = props[2], props[3]
        specificModulusRow("Specific Modulus", …)
        platePropRow("Radiation Ratio", …)
    }
}
```

The plate branch is `PDFReportGenerator.swift:~799-820` — **read it before fixing the plate**; it has 8
properties + a ratios block and its fill was inferred from the rendered PDF, not yet from the source.

## Web mechanism — `src/presentation/pdfReport.ts`

`twoColRows()` fills **row-major** (`rows[i]` left, `rows[i+1]` right) and is shared by THREE callers:

```js
twoColRows(cur, a.dimensions)   // Swift uses 3 columns here, not 2      → §A
twoColRows(cur, a.props)        // Swift is column-major here            → §B
twoColRows(cur, a.ratios)       // plate only — Swift's fill NOT verified
```

⚠ **Do not just flip `twoColRows` to column-major** — the three callers need *different* treatment
(dimensions needs **3 columns**; props needs **column-major**; ratios is unverified). The grey boxes
come from `drawMaterialAnalysis` drawing `doc.text('Sample Dimensions', …)` / `a.freqs.join(…)` as plain
text, where Swift wraps each in `Color.gray.opacity(0.06)` + `cornerRadius(4)` — the web already boxes
"Overall Quality", so the primitive exists (→ §A, §C).

## Before fixing

1. **Read Swift's plate branch** (`~799-820`) for the 8-property + ratios fill. Do not extrapolate the
   4-property column-major rule to 8 items without looking.
2. **Give each caller an explicit fill direction + column count** rather than a shared default — that is
   the realistic guard, since a canvas-layout unit test is impractical.
3. **Release note?** Apply the test used for the other two web fixes: did it *ship*? If the material PDF
   existed in web 1.0.1 the layout was wrong for users and it earns an entry; if it arrived with the
   1.0.2 catch-up it does not.
4. Fix the frequency-range format (§H) **once**, shared with the Results panel.