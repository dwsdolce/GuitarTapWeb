# Material Measurement Dimensions — Override, Display & Sourcing (design spec)

**Status:** 🔨 DRAFT — design phase, no code. The **two-store model is decided and the design is
settled** (2026-07-27, §4–5); the earlier OD2/OD5/OD6 dissolved on review. Scope also folds in a
**notes-on-load defect** found while tracing (§3 R10, §5). Swift is canonical; Python + web mirror.

## 1. Origin

Started from a brace precision anomaly: two `.guitartap` files from the **same WAV** (one without
UMIK-1 compensation, one with) computed *different* material properties even after the dimensions
were "reset" to the same values.

Investigation established:

- **Dimensions are stored per-measurement**, inside `longitudinalSnapshot`
  (`braceLength`/`braceWidth`/`braceThickness`/`braceMass`, plus the plate equivalents + Gore body
  dims + f_vs). They are **not** absent from the file — an earlier claim in the thread was wrong.
- The two files stored **different** dims: File 1 = `29.35 / 20.38` (2 dp), File 2 = `29.4 / 20.4`
  (1 dp, saved on the pre-precision-fix build). That 0.05 mm thickness difference is the *entire*
  cause of the derived-value difference (frequencies were identical to 0.0006 Hz; compensation only
  moved the magnitude 0.2 dB, which the material calc doesn't use).
- **Loading a file writes its snapshot dims into global `TapDisplaySettings` (persisted UserDefaults)**
  via `loadMeasurement` → `loaded*` published props → the view's `.onReceive` → the setter. So
  loading File 2 silently overwrote the user's `29.35` with `29.4` and kept it.
- The **Results-panel material calc reads `TapDisplaySettings`** (`calculatedPlateProperties` /
  `calculatedBraceProperties` / the Gore box), while the **PDF reads the snapshot**. They agree for a
  loaded measurement only *because* loading syncs snapshot → settings — the mechanism behind the
  silent overwrite. Reading settings for a measurement's numbers is simply wrong (R7).
- The **Results panel shows no sample dimensions** (brace: none; plate: only body `L × W` + f_vs in
  the Gore box). The only place to see all of a measurement's dims is the **PDF** — too heavy just to
  inspect a value.

## 2. Problem statement

A user must be able to (a) **see** a measurement's dimensions on screen, (b) **override** a
measurement's dimensions and have every derived value recompute, and (c) not have loading corrupt the
defaults used for the *next* measurement — while keeping the convenience of not re-keying dimensions
for repeated tests on one sample.

## 3. Requirements

- **R1** Dimensions are a property of the measurement; the file's snapshot is their store.
- **R2** A persistent **template** of default dimensions avoids re-keying for repeated same-sample tests.
- **R3** A measurement's dimensions are visible on screen (Results panel), no PDF needed.
- **R4** A measurement's dimensions can be edited → **full recalc** of every derived value (density,
  E_L/E_C, c, E/ρ + quality, R, ratios, GLC, Gore target thickness, overall quality).
- **R5 [B]** Nothing is written to disk until **Save**; saving an edited measurement produces a **new
  measurement** with the modified data (the loaded original is not mutated).
- **R6** **Two independent stores** (see §4): the Settings-panel material values are a *template* for a
  new measurement and are edited only in Settings; a measurement's own values are per-measurement,
  edited only in the Results panel. Editing one never affects the other.
- **R7** A measurement's derived values, on-screen display, **and PDF** read **only that measurement's
  own values** — never the Settings template.
- **R8** Precision is faithful (FieldPrecision, shipped): an edited `29.35` stores and reads back as
  `29.35`, never `29.4`.
- **R9** Cross-platform lock-step; Swift canonical.
- **R10** On **load**, a measurement's **notes** are restored alongside its name. Today the name seeds
  the Save form but notes are dropped — see §5. In scope here (same load/save-of-a-measurement path).

## 4. Model — two independent stores (decided)

### Store A — the material settings (defaults for a new measurement)
- **What they are:** ordinary settings — reusable, persistent defaults; nothing novel. They are the
  starting values for the next material measurement.
- **Edited:** in the Settings panel, and nowhere else.
- **Consumed:** copied into a measurement's values **at measurement-complete** — the final freeze,
  when the last tap/phase is accepted. **Not** at New Tap, **not** on type-change, **not** on Cancel.
  (This is the key timing decision: settings edited *during* a capture — while paused/reviewing —
  therefore flow into the completed measurement, since Settings is the only dimension surface before
  the Results block exists.)
- **Never changed by:** **Load** (a loaded measurement never changes the defaults). Cancel simply
  never completes, so it produces no measurement values at all — nothing to seed or discard.
- Persist like any setting — that's what makes them reusable.

### Store B — a measurement's material values = per-measurement (in the snapshot)
- **Purpose:** the **sole** authoritative source for that measurement's derived properties, on-screen
  display, and PDF (R7).
- **Origin:** populated from the settings (Store A) **at measurement-complete**; restored from the
  file's snapshot on **Load**. Nothing reads Store B before completion (the Results properties are
  hidden until then), so it needs no value earlier.
- **Edited:** in the **Results panel** — an editable dimensions block (L / Width / Thickness / Mass +
  Calculated Density; plate also shows body `L × W` + f_vs), shown **only when the measurement is
  complete**. Editing recalculates that measurement's derived values live and **never touches the
  settings** (D-a). Since the block appears only on completion, "the fields show up" and "the fields
  are editable" coincide — including for multi-tap / multi-phase, which display nothing until done.
- **Saved:** on **Save** → a **new measurement** with the edited values; the loaded original is
  untouched (R5 / D-c).

### Flows
| Action | Store A (settings) | Store B (measurement values) |
|---|---|---|
| New Tap / start capture | unchanged | not yet created |
| Edit settings mid-capture (paused/review) | changed | not yet created (the new values will be used) |
| **Measurement completes** (final freeze) | unchanged | **← copied from settings now** |
| Cancel | unchanged | never created (no completion) |
| Load a file | **unchanged** | **← the file's snapshot** |
| Edit dims in Results panel (post-complete) | unchanged | changed + recalc |
| Edit dims in Settings | changed | unchanged |
| Save | unchanged | persisted as a **new** measurement |

The Settings panel **only ever shows the defaults** — never a loaded measurement's values (D-b). A
completed/loaded measurement's values live and are edited in the Results panel.

## 5. Design status — settled

The two-store model (§4) settles the design. The concerns raised as OD2/OD5/OD6 dissolved on review:

- **Settings persistence is not a decision.** Settings are persistent, reusable defaults by definition
  — a non-persistent default couldn't seed the next measurement.
- **No file-format / migration impact.** The settings feed a measurement's values only at creation; a
  captured measurement carries its own values thereafter. Old files keep their own values (File 2
  stays `29.4` until the user edits it in the Results panel and Saves) — there is nothing to migrate.
- **No Save change.** Save already handles changed and unchanged measurements; edited dims are just
  more changed data.

*(Decided: two stores; calc/display/PDF source = the measurement's own values; editable dims block in
the Results panel.)*

### Notes are dropped on load — in scope (R10)

On load, the measurement **name** is restored into the Save form (`SaveMeasurementSheet`,
`defaultName: tap.loadedMeasurementName`), but the **notes are not** — there is no `loadedNotes` /
`defaultNotes`, and the view's `@State notes` starts empty and is never seeded from the loaded
measurement. So **re-saving a loaded measurement drops its notes.** Confirmed in Swift; the same
asymmetry very likely exists in Python + web. Fixed as part of this item — it's the same
load/save-of-a-measurement path the dimensions changes touch (restore name **and** notes on load).

## 6. Cross-platform notes

- Swift drives the design (this doc). Python (`tap_tone_analysis_view.py` + settings) and web
  (`SettingsPanel.tsx`, `tapToneAnalyzer.ts`, results panel + `measurementImage.ts`) mirror it.
- The two-store split has to be built on all three: a template store (Settings) distinct from
  per-measurement values (snapshot), with the calc/display/PDF reading the measurement's values.
- Audit each platform's current sourcing (all three read settings today, to varying degrees) so the
  fix lands identically. Keep @parity tags + PARITY-MAP current.
- Ties to the shipped numeric-precision work (`util/field-precision`): edits already store faithfully.

## 7. Documentation to update (part of this work — not a follow-up)

This changes user-visible behaviour, so the doc surfaces update in the same effort (exact files in
`project_doc_surfaces` memory):

- **Release notes** (all three editions) — viewing and editing a measurement's dimensions in the
  Results panel; that the Settings dimensions are the defaults for a *new* measurement (loading no
  longer changes them); notes restored on load.
- **Help / Quick-Start** (all three) — especially the **plate and brace how-to** sections, where the
  dimension-entry step and where a measurement's dimensions live/are edited now change.
- **User manual** (Swift `Documentation/Manual/`) — the **Plate (ch04)** and **Brace (ch05)** mode
  chapters and the **Settings reference (ch08)**: dimensions are per-measurement and edited in the
  Results panel; Settings holds the new-measurement defaults.

## 8. Implementation plan — Swift (canonical, first)

Build in reviewable chunks; each builds clean and is run-reviewed before the next. Then mirror on
Python + web in lock-step (keep @parity tags + PARITY-MAP current).

**Chunk A — re-sourcing (keeps the app consistent):**
1. **Store B** — add current-measurement material state to `TapToneAnalyzer` (plate/brace L·W·T·M +
   Gore body dims + f_vs). **Not** `measureFlc` — it decides *at capture* whether fLC is tapped; the
   completed calc keys on whether an fLC *peak* was captured, not the flag, so editing it could only
   *ignore a captured fLC* (not worth it). It stays a Settings-only capture setting. f_vs *is*
   included: verified it affects only the Gore calc (`goreTargetThickness`), nothing about capture.
2. **Calc reads Store B** — `calculated{Plate,Brace}Properties` + `goreThicknessView` read
   `analyzer.current…` instead of `TapDisplaySettings.*` (TapAnalysisResultsView.swift:715-719,
   929-933, 1030-1032).
3. **Seed at complete** — at the material measurement-complete freeze, copy `TapDisplaySettings` →
   Store B. One hook; nothing on New Tap / type-change / Cancel.
4. **Load sets Store B ← snapshot; stop writing settings** — `loadMeasurement` sets `current…` from
   the snapshot; **remove** the `loaded*`-dim → `TapDisplaySettings` writes
   (TapToneAnalysisView.swift:583-687). Keep the guitarType / measurementType restores.
5. **Save writes Store B → snapshot** — the save builder reads `current…`
   (MeasurementManagement:197-209).
6. **PDF** — TWO builders: `PDFReportData.from(measurement:)` (snapshot-based; used by the saved-list
   & detail export — correct) and `TapToneAnalysisView+Export.exportPDFReport()` (the Results-panel
   "Export PDF" button — **was reading `TapDisplaySettings`, a bug**). See the review note below.

### Swift review outcome — PDF export bug FIXED (2026-07-28, found during the Python port)

A full trace of every material-dimension read (`grep TapDisplaySettings.{plate,brace,body,stiffness}`)
found the Chunk-A "PDF reads the snapshot (verify)" note was **wrong for the Results-panel export**. The
render path (`PDFReportGenerator.generate(data:)`) was fine, but the *build* path
`TapToneAnalysisView+Export.exportPDFReport()` (two blocks) built `PDFReportData` from `TapDisplaySettings`,
never `materialInputs`. After the de-clobber this meant: **load → Export PDF** computed from the template,
and **edit dims in the Results panel → Export PDF** silently ignored the edits. (The saved-list/detail
export via `PDFReportData.from(measurement:)` reads the snapshot and was always correct.)
**✅ FIXED — committed `fa62764` (macOS+iOS build, 462 tests green):** both export blocks now read
`tap.materialInputs?.dimensions` / `?.bodyLengthMM` / `?.stiffness` / `?.stiffnessPreset` with a Settings
fallback — matching the snapshot builder and the Python port (which re-sourced the same two export blocks
in Chunk A, which is what surfaced this). Also **deleted the now-dead** `loaded*`-dimension `@Published`
publishers (`TapToneAnalyzer.swift`) + their `onReceive` handlers (`TapToneAnalysisView.swift`) — load
no longer routes dims through Settings at all. Everything else (model, seed, load, save `makePhaseSnapshot`,
display calc `calculated{Plate,Brace}Properties`/`goreThicknessView`) correctly reads Store B.
**Lesson: verify the data *source* (build path), not just the *renderer*; "(verify)" notes must be actioned.**

*Chunk A status — ✅ COMMITTED (`81571ec`) + user-verified (2026-07-27), full suites green (Swift 462 / Python 585
/ web 386). Committed together with the playback-deadlock test-infra fix — see below.* Landed:
- `Models/MaterialMeasurementInputs.swift` (Store B type: `dimensions`, `stiffness`, `fromSettings`).
- `TapToneAnalyzer.materialInputs` + seed in the `isMeasurementComplete` `didSet` (guard `!oldValue &&
  !isGuitar && !isLoadingMeasurement`).
- `calculated{Plate,Brace}Properties` + `goreThicknessView` read `analyzer.materialInputs`.
- `loadMeasurement` builds `materialInputs` from the snapshot **and drops the `loaded*`-dimension
  assignments** — so the settings-clobber `onReceive` handlers (TapToneAnalysisView ~511-605) no
  longer fire. Load now touches no Settings defaults.
- `buildSnapshot` reads `materialInputs` for dims + Gore f_vs; `measureFlc` stays from settings.

*Chunk A cleanup / notes (next):* the `loaded*`-dim `@Published` props + their now-dead `onReceive`
handlers are unused — remove them. Loading no longer restores `measureFlc` into the Settings default
(correct — load must not touch defaults); this is invisible in practice, because the phase-count
display is a capture-time indicator that *correctly* reads the live Settings, and `snapshot.measureFlc`
is now read nowhere — harmless documentation in the file, left as-is (removing it from the format would
be a separate change, not needed). The editable Results-panel dims block is **Chunk B** (not in A) —
you can view the re-sourcing effects but not yet edit dims in Results.

**Chunk B — Results-panel editable dims block (R3/R4):** L / W / Thickness / Mass + Calculated Density
(derived, read-only) in `{brace,plate}PropertiesSection`, using `ValidatedNumberField`; shown only
when the measurement is complete.

*Chunk B status (2026-07-27) — ✅ SWIFT DONE, user-approved ("I like… major improvements on plate and
brace"); committed `98e09ef`; builds clean macOS + iOS; full test suite green (462 tests / 101 suites).
NEXT = mirror on Python, then web.*

**➡️ NEXT TASK = PYTHON** (`/Users/dws/src/guitar_tap`). Mirror everything below (all ✅ on Swift) exactly:
the two-store Chunk B editable dims, the layout restructure, the frequency-band removal, and the
Diagonal naming across every surface. Read the Swift files named in each bullet as the canonical source.
Then repeat on web (`/Users/dws/src/GuitarTapWeb`). Chunk C (notes-on-load) + Chunk D (tests+docs) still
pending on all three.

Swift files (this chunk, committed `98e09ef`): `Views/MaterialDimensionsEditor.swift` (new),
`Views/PlateBodyDimensionsEditor.swift` (new), `Views/TapAnalysisResultsView.swift`,
`Views/ExportableSpectrumChart.swift`, `Views/TapToneAnalysisView+SpectrumViews.swift`,
`Views/HelpView.swift`, `Models/TapToneMeasurement.swift`, `Views/Utilities/PDFReportGenerator.swift`.

**Layout restructure + naming — ✅ DONE on Swift (2026-07-27); mirror on Python then web:**
- **Brace:** own **Sample Dimensions** box (L/W/T/M + Density) → **Brace Properties**. (Currently brace's
  dims are inline in Brace Properties — move them to a separate box like plate, for consistency.)
- **Plate:** **Sample Dimensions** box → **Body Dimensions** box → **Gore Target Thickness** (result
  only, smaller) → **Plate Properties**.
- **New Body Dimensions box (plate):** editable Body Length (a) + Lower Bout Width (b) + f_vs. f_vs is a
  setting not a dimension → put it as a **"Panel Stiffness (f_vs)"** row (preset picker + custom value)
  inside the Body Dimensions box. Group name **"Body Dimensions"**, row label **"Panel Stiffness (f_vs)"**
  — both confirmed by the user. Swift: `Views/PlateBodyDimensionsEditor.swift` (new).
- **Trim the Gore box:** it currently shows target thickness + GLC (shear) + a "Body: L×W / f_vs = …"
  echo. Keep ONLY the target-thickness result (make it smaller). Remove the GLC line — GLC is already
  shown in `platePropertiesSection` (the Young's-modulus block), which is where it belongs. Remove the
  body/f_vs echo — those move to the editable Body Dimensions box.
- Make the Sample Dimensions box a shared section used by both brace and plate (generalize the current
  `plateSampleDimensionsSection`).
- **PDF report follows the same layout** (`Views/Utilities/PDFReportGenerator.swift`, and mirror in
  Python + web PDF/report generators): Sample Dimensions → (plate) Body Dimensions → trimmed Gore Target
  Thickness → Plate/Brace Properties (GLC with the moduli, not in the Gore block). The PDF already reads
  the snapshot's own dims (correct per Chunk A) — this is a *layout/section-ordering* change, not a
  sourcing change. **PDF Body Dimensions box:** Body Length (a) + Lower Bout Width (b) share the first
  line; **Panel Stiffness is on its own line below** (the `f_vs = NN (Preset Name)` label is long and
  wraps awkwardly if squeezed into a third column). The trimmed Gore box is the target-thickness number
  only (no body/f_vs echo, no GLC line). The Detected Peaks role cells read "Longitudinal (fL)" /
  "Cross-grain (fC)" / "Diagonal (fLC)" (brace role cell flipped to the same name-first order). Directional
  property labels stay "(L)"/"(C)" (Young's Modulus, Speed of Sound, etc. — a *direction*, not a frequency).
- **Frequencies are inputs, not calculated properties** — remove the fL/fC/fLC (plate) and fL (brace)
  frequency band from the Plate/Brace Properties sections (they already appear in the Detected Peaks
  list). Applies to the Results panel AND the PDF report (`plateSection`/`braceSection` frequency band —
  the Detected Peaks table keeps them). Mirror on Python + web.
- **Diagonal-mode naming is inconsistent across 3 chart/list surfaces** — the diagonal always shows the
  bare abbreviation "FLC" while Longitudinal/Cross show a name + abbreviation. Unify to name = **Diagonal**,
  abbreviation = **fLC**, and switch L/C to the `fL`/`fC` frequency notation used in the property rows,
  PDF, and tips:

  | Surface | Longitudinal | Cross | Diagonal |
  |---|---|---|---|
  | Chart legend (`ExportableSpectrumChart` materialSpectra labels) | Longitudinal (fL) | Cross-grain (fC) | **Diagonal (fLC)** |
  | Chart annotation name (`peakModeLabel` / `roleLabel`) | Longitudinal | Cross-grain | **Diagonal** |
  | Peak-list + live slot badge (`MaterialPeakRowView`) | fL | fC | **fLC** |
  | Three-Tap Measurement Process items (2 copies: empty-plate in `peaksAndModesSection` + `plateMeasurementInstructions`) | Longitudinal (fL) Tap | Cross-grain (fC) Tap | **Diagonal (fLC) Tap** |

  Brace already uses "Longitudinal (fL) Tap" — no change. Also update the Help text mention
  ("Longitudinal, Cross, and FLC" → "Longitudinal, Cross-grain, and Diagonal"). Cross-platform: Swift +
  Python + web (all three surfaces exist in every edition). Also updated the live-capture phase
  titles/descriptions (Step 1/2/3, "Review … Tap", completion summary) to the same fL/fC/fLC + Diagonal
  scheme.

  **File format:** the per-peak `modeLabel` written to `.guitartap` is a *write-only convenience* field
  (ignored on decode — roles restore from the selected-peak IDs), so changing it does **not** affect
  round-trip or old-file loading. Updated its diagonal value `"FLC"` → `"Diagonal"` (Swift
  `TapToneMeasurement.encode`) to match the UI; mirror in the Python/web writers for consistency.

Then: Chunk C (notes on load, R10) + Chunk D (tests + docs), then mirror all of Chunk B–D on Python + web.

**Chunk C — notes on load (R10):** add `loadedNotes` mirroring `loadedMeasurementName`; seed the Save
form's notes symmetrically.

**Chunk D — tests + docs:** parity tests (calc reads B; seed at complete; load sets B and leaves
settings untouched; save writes B; notes restored) + release notes / Help-Quick-Start (plate/brace) /
manual ch04-05-08.

*Build detail to confirm during Chunk A:* the exact single hook for the material measurement-complete
freeze (in `TapToneAnalyzer+SpectrumCapture` material-complete path) so the seed lands in one place.

### Swift addendum — `MaterialTapPhase` display strings (found during the Python audit, 2026-07-28)

My Swift naming pass updated the *view-level* `materialPhaseTitle`/`materialPhaseDescription`
(`TapToneAnalysisView+SpectrumViews.swift`) but **missed `MaterialTapPhase.shortStatus`**, which is
displayed live at `TapToneAnalysisView+SpectrumViews.swift:298` and still returns the old `"L tap…"` /
`"Review L"` / `"Tap for FLC"` / `"FLC tap…"`. `MaterialTapPhase.instruction` is **dead** (no callers).
The enum + its raw values are **never persisted** (`materialTapPhase` appears only in a debug log; not
in `TapToneMeasurement`/`TapDisplaySettings`/`SpectrumSnapshot`) → changing display strings is safe.

**✅ DONE (Swift, 2026-07-28) — committed `ccdb7dc` (builds + full suite green 462/101):** updated
`shortStatus` (→ `"fL tap…"`/`"Review fL"`/`"fC tap…"`/`"Review fC"`/`"Tap for fLC"`/`"fLC tap…"`) and
`instruction` in `MaterialTapPhase.swift`. **Raw values left unchanged** ("Capturing FLC" etc. — internal, unpersisted;
Python must match). The audit also surfaced a **wider miss the first pass didn't touch**: user-facing
`statusMessage` capture/guidance strings in the analyzer — `TapToneAnalyzer+Control.swift` ("Ready for
fL/fC/fLC tap", "Rotate 90° and tap for fC", "Set up for fLC tap", the "— tap again" variants) and
`TapToneAnalyzer+SpectrumCapture.swift` ("fL/fC/fLC tap n/N captured…", "File: fL complete, capturing
fC…", etc.). `gtLog` debug strings left as-is (internal). Test + doc-comment fixups:
`StatusMessageTests.swift` assertions ("Ready for fL tap", "Rotate 90° and tap for fC") + header
examples. **These analyzer status strings are additional naming surfaces to mirror on Python + web.**

## 9. Implementation plan — Python (mirror of Swift, non-divergent)

Python (`/Users/dws/src/guitar_tap`) currently sits at its **pre-Chunk-A** state and its structure
diverges from Swift; the port must reproduce Swift's *design*, read from the Swift source as canonical,
in PyQt idioms. Same chunked order as §8; build + full `pytest` + user review between chunks. Keep
`@parity` tags + PARITY-MAP current.

**File-role map (Python):**
- `views/tap_tone_analysis_view.py` (large) — live UI: the **Results panel** material section AND the
  **Settings dialog** editable dim fields both live here.
- `views/tap_analysis_results_view.py` (misnamed) — the **PDF/report builder** + JSON load/save helpers.
- `models/tap_tone_analyzer*.py` — analyzer + helpers; freeze setter `set_measurement_complete`
  (`tap_tone_analyzer_measurement_management.py:995-1020`); snapshot writer `_make_phase_snapshot`
  (`…measurement_management.py:138-188`, reads `TDS.*`); load clobber `…measurement_management.py:585-604`.
- `models/field_precision.py` (constants `LINEAR_DIMENSION_MM`/`MASS_G`/`BODY_DIMENSION_MM`/`STIFFNESS`,
  `fp.string`/`fp.rounded`) and `models/plate_stiffness_preset.py` (`.stiffness`, `.short_name`) — exist.

*Chunk A status — ✅ DONE + user-verified on Python (2026-07-28), committed `5fc9aa5`; full `pytest` green (585).
Includes the same-session load-type fix (read `resolved_measurement_type`, not the raw field, in
`_load_measurement_body:482` + `_restore_measurement:4426/4433`) — a just-saved in-memory brace/plate was
loading as a Generic guitar because `create()` leaves the raw `measurement_type` None (see §12).* Landed: `models/material_measurement_inputs.py` (new); `material_inputs` on the
analyzer + seed in `set_measurement_complete` (guard: transition & not-guitar & not-loading);
`_make_phase_snapshot` reads Store B; load builds `material_inputs` from the snapshot and **drops the
settings-clobber** (`_load_measurement_body`, kept guitar/measurement-type restores); view display calc
re-sourced via `_get_current_dims` + Gore populate; **both live PDF-export blocks** (`_on_export_pdf`)
re-sourced to Store B for dims + Gore params (required — the de-clobber would otherwise make a loaded
measurement's live PDF read stale template dims). `measure_flc` stays Settings-sourced.

**Chunk A — two-store re-sourcing (parity foundation):**
1. New `models/material_measurement_inputs.py` mirroring Swift `MaterialMeasurementInputs`
   (L/W/T/M + body L/W + stiffness preset/custom; `dimensions`, `stiffness`, `from_settings`).
2. Add `material_inputs` to the analyzer; **seed at the material complete freeze** — one hook in
   `set_measurement_complete` (guard: newly-complete & not-guitar & not-loading).
3. Calc/display read `material_inputs` (live Results panel populate handlers `_populate_brace_section`
   `:3816`, `_populate_plate_section` `:3833`, Gore populate `:3876-3900`) instead of `TDS.*`.
4. **Load** sets `material_inputs` from the snapshot **and removes the settings clobber**
   (`…measurement_management.py:585-604`). Keep guitarType/measurementType restores.
5. **Save** writes `material_inputs` → snapshot (`_make_phase_snapshot` reads the store, not `TDS`).
6. **PDF builder** (`tap_analysis_results_view.py pdf_report_data_from_measurement:271`) already reads
   the snapshot — verify it stays correct once Save writes the store.

*Chunk B status — ✅ DONE on Python (2026-07-28), committed `5fc9aa5`; full `pytest` green (585); the two new
editor widgets smoke-tested offscreen (seed, live edit → recompute, preset combo, None-safe). ✅
user-verified 2026-07-28, committed `5fc9aa5` — including a material-panel layout rebuild to match Swift's GroupBox sections:
each section is a separator line + bold header + rounded gray body box (Sample Dimensions / Body
Dimensions / Gore Target Thickness / Plate·Brace Properties / Measurement Process), correct order, peak
list constrained so it no longer leaves a big vertical gap.* Landed: new `views/material_dimensions_editor.py`
(`MaterialDimensionsEditor` — L/W/T/M + read-only density) and `views/plate_body_dimensions_editor.py`
(`PlateBodyDimensionsEditor` — body a/b + Panel Stiffness f_vs preset/custom), both mirroring the Swift
`View` structs and writing `analyzer.material_inputs` live via `textEdited`→`_commit`. View: brace gets a
Sample Dimensions box; plate reordered to Sample → Body → trimmed Gore (number only) → Plate Properties
(GLC among moduli); removed the fL/fC/fLC labels + brace fL subtitle; new `_refresh_material_properties`
(editors' on-change) + `_seed_material_editors` (called at complete/load/repopulate).

**Chunk B — editable Results-panel dims + layout restructure** (`tap_tone_analysis_view.py`,
`_material_section:1234`): add an editable **Sample Dimensions** group (plate + brace: L/W/T/M +
read-only Density) and a plate **Body Dimensions** group (body a/b + a **Panel Stiffness (f_vs)** row:
preset combo + custom), all writing `material_inputs` live (QLineEdit + `fp` validators, mirroring the
Settings-dialog fields at `:5896-6138`). Reorder plate: Sample → Body → **trimmed** Gore (result only;
drop the params echo `:1430` + GLC line) → Plate Properties (GLC stays among moduli). Remove the
fL/fC/fLC frequency labels (`_plate_fl_lbl:1449`/`_plate_fc_lbl:1453`/`_plate_flc_lbl:1457`) and the
brace fL subtitle. Keep the Settings-dialog fields (they're the template).

**Naming unification (Diagonal / fL / fC / fLC)** — every surface from the audit:
`tap_tone_analysis_view.py` badges (`_mode_btn("FLC"…)` `:241,285`; `_plate_row` `"L:"/"C:"`
`:1478,1481`), tap-step instructions (`:397,402,408`), phase titles/short-status (`:3611-3612,3641,
3674,3683,3691-3696`), results labels (`:1449,1453,1457`, brace subtitle `:3818`, placeholder `:1268`),
redo/short (`:2952,3681,3672`); `exportable_spectrum_chart.py` `peak_mode_label` (`:302,304,306`) +
legend (`:1087,1095,1103`); PDF role labels + tap rows (`tap_analysis_results_view.py:880,882,884,888,
1346,1352,1359`); `material_tap_phase.py` `instruction`/`short_status` (`:129-172`) — **display strings
only, match the (updated) Swift enum; raw values `:65,74,89` unchanged**; `help_view.py` mentions;
write-only `modeLabel` (`tap_tone_measurement.py:716,718,720`, `"FLC"`→`"Diagonal"`). **Also grep the
Python analyzer for user-facing `status_message` capture/guidance strings** (mirror of Swift
`TapToneAnalyzer+Control`/`+SpectrumCapture`: "Ready for fL/fC/fLC tap", "Rotate 90° and tap for fC",
"Set up for fLC tap", "fL/fC/fLC tap n/N captured…", "File: fL complete, capturing fC…") — likely in
`tap_tone_analyzer_control.py`/`tap_tone_analyzer_spectrum_capture.py`; leave debug logs alone. Update
matching Python status-string test assertions (Swift needed `StatusMessageTests` fixups).

**PDF layout (`tap_analysis_results_view.py _build_averaged_story:516`)** — mirror Swift: reorder to
Sample Dimensions → plate **Body Dimensions** (Panel Stiffness on its own line) → **trimmed** Gore
(drop Body echo `:950` + f_vs echo `:946-948`; keep the GLC-assumed-0 note wording as `fLC`) → Plate/
Brace Properties (GLC among moduli). Remove the fL/fC/fLC freq row (`:1080-1085`) and brace fL row
(`:1236-1238`). Directional property labels stay `(L)`/`(C)`.

**Tests + docs:** update/extend `tests/test_plate.py`, `test_brace.py`, `test_material_selection.py`,
`test_measurement_codable.py` (modeLabel + snapshot dims round-trip), `test_measurement_complete_transitions.py`
(seed-at-complete), `test_wi6_tap_display_settings.py`/`test_wi1_settings_persistence.py`
(load no longer clobbers settings), plus any phase/status-string assertions. Run full `pytest`.

**Persistence validation (done 2026-07-28):** `MaterialTapPhase` — NOT persisted (Swift + Python;
transient runtime) → display strings safe to change. `PlateStiffnessPreset` — **IS persisted** (Swift
`SpectrumSnapshot` encodes it; Python snapshot + settings) → raw values unchanged both sides. `modeLabel`
— write-only, ignored on decode → safe.

## 10. Implementation plan — Web (mirror of Swift, non-divergent)

Web (`/Users/dws/src/GuitarTapWeb`, React/TS) sits at its **pre-Chunk-A** state and is the **most
divergent** edition. Unlike Swift/Python — which already had a per-measurement snapshot the calc *could*
read — the web has **no live Store B at all**: `MaterialResults` computes straight from the live
`Settings`, and **load copies the snapshot's dims back into `Settings`** (`measurementToLiveMaterial` →
`settingsPatch`), so `Settings` doubles as both the template (Store A) *and* the current measurement's
values. Introducing Store B (a per-measurement material-dims object in live state) is therefore the core
of the web port — the settings-clobber isn't a stray write to remove, it *is* the current sourcing
mechanism. Same chunked order as §8/§9; `npx tsc --noEmit` + `npm test` (vitest) + user run-review
between chunks. Keep `@parity` tags + PARITY-MAP current.

**File-role map (Web):**
- `src/settings.ts` — **Store A**: the `Settings` type + `DEFAULTS` carry `plateLength/Width/Thickness/Mass`,
  `guitarBodyLength/Width`, `plateStiffnessPreset`/`customPlateStiffness`, `measureFlc`, `brace*`;
  `effectiveStiffness(s)` (`:208`) resolves f_vs. `components/SettingsPanel.tsx` is the Settings UI (material
  dim fields ~`:192`) — the Store-A editor, unchanged in role.
- `src/components/MaterialResults.tsx` — the **Results panel** material section; today takes
  `settings: Settings` + `peaks` + `complete` and computes properties from settings (rendered
  `App.tsx:1450` with `settings={settings}`). This is the origin bug on web **and** where the editable
  dims block goes.
- `src/dsp/material.ts` — **pure calc** (`Dimensions` in): density, plate/brace Young's, `speedOfSound`,
  `specificModulus`, radiation, `goreYoungsLongPa`/Gore target, etc. Dimension-source-agnostic →
  **unchanged** by the port; only its *inputs* change.
- `src/measurement/types.ts` — `SpectrumSnapshotModel` already carries per-measurement dims
  (`plateLength…`, `guitarBody*`, `plateStiffnessPreset`, `brace*` `:48-61`) = the file-side of Store B.
  `resolvedMeasurementType` (`:130`) — see §12.
- `src/measurement/fromLive.ts` — `buildMaterialMeasurement` (`:605`) writes the snapshot dims **from
  `a.settings.*`** (must read Store B); `measurementToLiveMaterial` (`:520`) returns
  `MaterialRestore.settingsPatch` (`:555-568`) that **clobbers Settings on load** (must populate Store B
  instead). `decode.ts`/`encode.ts` = file round-trip (dims already round-trip).
- `src/state/tapToneAnalyzer.ts` — material capture state machine (phase L→C→(FLC), `isMeasurementComplete`);
  no per-measurement material store today.
- `src/App.tsx` — the live host: holds `settings`, `matPeaks`, `matPhase`, `loadedName`; load handlers
  (~`:892/911/967`), `clearLoadedMeasurement` (`:464`), `newTap`/`onMaterialNewTap`, the Save flow, and the
  chart legend labels (`:658-660`). Store B lives here (or in the analyzer) as new live state.
- `src/presentation/pdfReport.ts` (PDF) + `measurementImage.ts` (exported chart) — report/image builders
  (naming + PDF layout + page-height, §11 V-PDF).

*Chunk A status — ✅ DONE + user-verified (V-A), committed `30dff21`; tsc clean, 386 web tests green.* Landed:
`src/measurement/materialMeasurementInputs.ts` (new — `MaterialMeasurementInputs` type + `materialInputsFromSettings`/
`materialInputsFromSnapshot`/`materialDimensions`/`materialStiffness`; `STIFFNESS_FROM_RAW` moved to `settings.ts` as the
shared source); `MaterialResults` takes `matInputs` + `measureFlc` (not `settings`); Store B is App state (`matInputs`),
seeded at complete via a guarded `useEffect` (the web analyzer has no settings global, so it can't live on the analyzer
like Swift/Python — the one accepted architecture divergence), reset on New Tap via `clearLoadedMeasurement`;
`measurementToLiveMaterial` returns `materialInputs` + a dim-free `settingsPatch` (type + measureFlc only);
`buildMaterialMeasurement` reads Store B; PDF/image export already build via `buildCurrentMeasurement`, so covered.
**Also fixed (bundled):** Settings `NumberField` was a controlled *numeric* input, so a decimal point could never be
typed (onChange rounded "4." → 4) — the plate/brace/body dim fields were integer-only; now backed by a string buffer
that preserves the in-progress "4.85", rejecting only over-precise keystrokes (mirrors Swift `limitedInput` / Python
`_decimal_validator`). Slipped past the pure-logic `test/field-precision` suite (no web component-test harness).

**Chunk A — introduce Store B + re-source (parity foundation):**
1. **Store B** — a per-measurement material-inputs object in live state (App or analyzer): plate/brace
   L·W·T·M + body a/b + stiffness preset/custom (mirror `MaterialMeasurementInputs`). **Not** `measureFlc`
   (capture-time only); f_vs *is* included (Gore only).
2. **Calc reads Store B** — `MaterialResults` takes the measurement's own dims (Store B) instead of
   `settings`; `App.tsx:1450` passes Store B for a complete/loaded measurement. `dsp/material.ts` unchanged.
3. **Seed at complete** — copy `Settings` → Store B at the material measurement-complete freeze (one hook;
   nothing on New Tap / type-change / Cancel).
4. **Load sets Store B ← snapshot; STOP clobbering Settings** — `measurementToLiveMaterial` populates
   Store B from the snapshot; **delete the dim entries from `settingsPatch`** (keep `measurementType`).
   Load no longer touches the template.
5. **Save writes Store B → snapshot** — `buildMaterialMeasurement` reads Store B, not `a.settings.*`.
6. **PDF/report + exported image read the snapshot/Store B** — `pdfReport.ts` + `measurementImage.ts`
   (verify no settings read for a loaded measurement's dims — the analog of the Swift/Python export-block bug).

**Chunk B — editable Results-panel dims + layout restructure** (`MaterialResults.tsx`): editable **Sample
Dimensions** block (plate + brace: L/W/T/M + read-only Calculated Density) + plate **Body Dimensions**
block (body a/b + a **Panel Stiffness (f_vs)** row: preset picker + custom), writing Store B live (reuse
the Settings-panel field/validator components + `util/field-precision`). Reorder plate: Sample → Body →
**trimmed** Gore (result only; drop the body/f_vs echo + GLC line) → Plate Properties (GLC among moduli).
Remove the fL/fC/fLC frequency band + brace fL subtitle. Settings-panel fields stay (they're the template).
Shown only when complete.

*Chunk B status — ✅ DONE + user-verified (V-B, plate + brace, 2026-07-29), committed `b490c0a`; tsc clean, 386
web tests green.* Landed: Sample/Body editors bound to Store B (shared `NumberField` extracted from
SettingsPanel = the string-buffer decimal-entry fix); plate reorder Sample → Body → trimmed Gore → Plate
Properties (GLC among moduli, shown only when an FLC peak exists — no assumed-0 note); fL/fC/fLC band + brace
fL subtitle removed. Layout-parity fix vs Swift `platePropertiesSection`: Speed of Sound / Young's Modulus /
Radiation Ratio stack the title over an L/C row, and `.mat-lc` uses `space-between` so C right-justifies
(Swift `HStack … Spacer()`). REMAIN on web: Naming, PDF (layout + page-height), Chunk C, §12 type-resolution,
Chunk D.

**Naming unification (Diagonal / fL / fC / fLC)** — mirror §8/§9 across the web surfaces: chart legend
`App.tsx:658-660` (`'Longitudinal (L)'`/`'Cross-grain (C)'`/`'FLC'` → `'Longitudinal (fL)'`/`'Cross-grain
(fC)'`/`'Diagonal (fLC)'`); chart annotation/role label for the diagonal peak; peak-list/slot badges
(L/C/FLC → fL/fC/fLC); the Three-Tap Measurement Process step text; live phase title/status strings; Help
mention; and the **write-only** `modeLabel` in `encode.ts:72` (`'FLC'` → `'Diagonal'`, ignored on decode →
old files still load). Grep `FLC` / `Cross-grain (C)` / `(L)` across `App.tsx`, `MaterialResults.tsx`,
`measurementImage.ts`, `pdfReport.ts`, the status/phase module, and help content.

**PDF (`pdfReport.ts`) — two parts:**
- **Layout** (V-PDF): mirror Swift — Sample Dimensions → plate Body Dimensions (Panel Stiffness on its own
  line) → trimmed Gore (number only) → Plate/Brace Properties (GLC among moduli); remove the fL/fC/fLC
  frequency band; role cells "Longitudinal (fL)/Cross-grain (fC)/Diagonal (fLC)"; directional labels stay
  (L)/(C). Mirror the same in `measurementImage.ts` if it renders the same sections.
- **Page height:** the report is fixed Letter (`new jsPDF({format:'letter'})`, `PAGE_H=792`,
  `ensure()`→`addPage()`) and spills tall material/multi-tap reports. Mirror Swift's single variable-height
  page: two-pass — dry-render into a throwaway doc to capture the final `cur.y` (natural height), then
  create the real doc with `format:[612, measuredHeight]` and set `PAGE_H` so `ensure()` never breaks;
  multi-tap uses `addPage([612, page2Height])` for its second page.

**Chunk C — notes on load (R10):** add a `loadedNotes` state alongside `loadedName`; set it in the three
load paths (`App.tsx` ~`:892/911/967`); pass it as a `defaultNotes` prop to `SaveSheet` (seed
`useState(defaultNotes)`); add `setLoadedNotes(null)` to `clearLoadedMeasurement` (`:464`) — the New-Tap
clear then comes **for free** (both `newTap` and `onMaterialNewTap` call it). **No sheet refactor** — the web
already seeds the Save fields ephemerally (remount-per-open); this is the architecture Swift had to adopt in
its ephemeral-sheet fix (§11 V-C). The New-Tap stale-name/notes leak that hit Swift never applies here.

**Type-resolution (§12; tracked as V-Type):** align to Swift — route the web's `.measurementType` **logic**
reads through `resolvedMeasurementType` (`types.ts:130`, the snapshot), not the stored top-level field
(populated `fromLive.ts`/`decode.ts:106`); leave `settings.measurementType` reads (the live settings type)
alone. `grep -rn "\.measurementType" src` and classify each. Do NOT "fix" it by keeping the stored duplicate
— derive, don't duplicate. Verify against **V-Type** (same-session save→load keeps the type).

**Chunk D — tests + docs:** the vitest suite is **pure-logic (no React component-test infra — no
testing-library/jsdom)**, so the parity coverage lands as logic tests, not rendered-component tests:
seed-at-complete, load-populates-Store-B, save-writes-Store-B, load-leaves-Settings-untouched, and
notes-on-load — exercised at the `fromLive`/state layer (`buildMaterialMeasurement`,
`measurementToLiveMaterial`, the seed/clear helpers). Plus `@parity` tags + PARITY-MAP regen (`--check`
clean) and the shared docs (release notes / Help / manual, §7). If a genuine UI-render assertion is needed,
note the missing infra rather than adding a framework mid-item.

## 11. Verification (run per edition — Swift, Python, web)

The behaviour is identical across editions, so this is the **shared close-out checklist**: a chunk is
not "done" until these pass **by running the app** (green suites ≠ run-review — see
[[feedback_not_done_until_user_verifies]]). Record pass/fail per edition in that chunk's status block.
Green = user-run-verified; leave ⏳ until then.

### V-A — Chunk A (two-store re-sourcing) — mostly invisible; verify by consequence
1. **Load doesn't disturb Settings.** Open Settings, note the plate (or brace) dimensions. Load a saved
   measurement whose dims **differ**. Reopen Settings → the template values are **unchanged**.
2. **Loaded measurement calc uses its own dims.** The loaded measurement's Results properties (specific
   modulus, Gore target) match the values it was saved with — not the current Settings template.
3. **Save round-trips.** Complete a measurement, Save, reload it → same dims and same computed values.
4. **PDF of a loaded measurement uses its own dims** (this is the bug the Swift review caught): load a
   saved measurement whose dims differ from Settings → Export PDF → the PDF's dimensions + properties are
   the **measurement's**, not the template's.

### V-B — Chunk B (editable Results-panel dims + layout)
1. **Layout — plate:** Results panel shows, in order, **Sample Dimensions** (L/W/T/M + Calculated
   Density) → **Body Dimensions** (Body Length a, Lower Bout Width b, Panel Stiffness f_vs) → **Gore
   Target Thickness** (just the number — no Body/f_vs echo, no GLC line in this box) → **Plate
   Properties** (GLC appears among the moduli). **No fL/fC/fLC frequency rows** in Properties.
2. **Layout — brace:** **Sample Dimensions** box → **Brace Properties**. **No fL subtitle** in Properties.
3. **Live edit recomputes (sample):** edit Length/Width/Thickness/Mass → Calculated Density updates, and
   Speed of Sound / Young's / Specific Modulus / Radiation / Gore target all recompute **live**.
4. **Live edit recomputes (body, plate):** edit Body Length/Width, or change the Panel Stiffness preset
   (and the Custom f_vs value when preset = Custom) → **only the Gore target** changes; the plate
   moduli (which don't depend on body dims/f_vs) do not.
5. **Precision on entry:** fields reject over-precise keystrokes (L/W/T = 2 dp, Mass = 1 dp, Body = 0 dp,
   f_vs = 0 dp) — mirrors the Settings fields.
6. **Seeded on complete/load:** a freshly completed measurement and a freshly loaded one both show their
   own values in the editor fields (not blank, not the previous measurement's).
7. **Settings untouched by editing:** edit dims in the Results panel, then open Settings → the template
   values are **unchanged** (editing writes Store B only).
8. **Save = new measurement:** after editing a loaded measurement's dims, Save → a **new** measurement
   with the edited values; the original file is unchanged.

### V-Naming — Diagonal / fL / fC / fLC
1. **Peak list / slot badges** read `fL` / `fC` / `fLC` (not L / C / FLC).
2. **Chart legend** reads "Longitudinal (fL)" / "Cross-grain (fC)" / "Diagonal (fLC)".
3. **Chart annotation** for the diagonal peak reads "Diagonal" (not "FLC").
4. **Live capture** — the Three-Tap Measurement Process items read "Longitudinal (fL) / Cross-grain (fC)
   / Diagonal (fLC) Tap"; the phase title/status strings read fL/fC/fLC (e.g. "Step 3: Diagonal (fLC)
   Mode", "Ready for fLC tap", "Review fC").
5. **Help** text mentions "Longitudinal, Cross-grain, and Diagonal".
6. **File format unaffected:** save a plate measurement, confirm the `.guitartap` still round-trips (the
   `modeLabel` change "FLC"→"Diagonal" is write-only, ignored on decode — old files still load).

### V-PDF
1. Section order matches the panel: Sample Dimensions → (plate) Body Dimensions (**Panel Stiffness on its
   own line**) → trimmed Gore (number only) → Plate/Brace Properties (GLC among the moduli).
2. **No fL/fC/fLC frequency band** in Plate/Brace Properties (they remain in the Detected Peaks table).
3. Role labels + tap instructions use "Longitudinal (fL) / Cross-grain (fC) / Diagonal (fLC)".
4. Directional property labels still read "(L)"/"(C)" (a direction, not a frequency).
5. **Pagination (Python `c3d1556`)** — the PDF is a **single variable-height page** (each report the
   natural height of its content), matching Swift's ImageRenderer media box (612 × natural), **not** a
   fixed Letter page. Python was pinned to 612×792 and spilled tall material/multi-tap reports onto extra
   pages. Fix: a shared `_measure_story_height` / `_build_variable_page_pdf` (lay the story on a throwaway
   20 000-pt frame, read the consumed height, size the page to fit + 2 pt guard, zero frame padding for the
   full 540 pt width). All 3 renderers route through it — `export_pdf` & `export_comparison_pdf` = 1 page;
   `export_multi_tap_pdf` = 2 **independently-sized** pages (per-`PageTemplate` `onPage` `setPageSize`).
   Residual divergence: font family (ReportLab Helvetica vs Swift SF Pro) — inherent, not fixable here.

### V-C — Chunk C (notes-on-load)
1. Save a measurement **with notes**. Load it → Save again → the notes are **preserved** (today they're
   dropped because only the name is restored).
2. **New Tap must NOT carry stale Save fields** (found 2026-07-29). Load a measurement → New Tap → open Save:
   the name/notes fields must be **empty**, not the loaded measurement's. Root cause was **Swift-only**:
   `SaveMeasurementSheet` bound to the view's long-lived `@State` and its `.onAppear` wrote the seed into that
   binding, which cleared only on Save — so after New Tap the stale seed persisted. Fixed by making the sheet
   **ephemeral** (`2bb1813`): sheet-local `@State` seeded at `init` from `defaultName`/`defaultNotes`, values
   returned via `onSave(name, notes)`; the view field is now a transient save carrier (set on confirm, cleared
   after) that exports still read (`isEmpty ? loaded : field`, `""` at rest). **Python and web were already
   immune** — Python seeds a fresh `QDialog` (its widgets hold the edit; `self._measurement_name`/`_notes` are
   `""` at rest, set only on accept) and web remounts `SaveSheet` per open (`useState(defaultName)`), both
   seeding from `loaded*`/`loadedName` which New Tap already clears. **Lesson:** persisting a sheet's seed into
   shared long-lived state is the anti-pattern; seed ephemerally from the analyzer's `loaded*` each open.

### V-D — Chunk D (tests + docs)
1. **Parity tests exist and pass** for the two-store model: calc reads Store B; seed-at-complete (not on
   New Tap / type-change / Cancel); load sets Store B **and leaves the Settings template untouched**;
   save writes Store B → snapshot; notes restored on load (V-C). Full suite green on the edition.
2. **Release notes** entry (all editions) — viewing and editing a measurement's dimensions in the
   Results panel.
3. **Help / Quick-Start / manual** updated for the dimension-editing UI (see §7).
4. **`@parity` tags updated + PARITY-MAP regenerated**; `--check` clean.

### V-Type — type resolves from the snapshot (§12)
1. **Same-session save → load keeps the type.** Complete a plate (or brace) measurement, Save, then Load it
   back **in the same session** → it loads as a plate/brace, **not** a Generic guitar. (This is the bug §12
   fixed on Python; Swift is immune; web must not regress when it aligns.)
2. **Logic reads derive, don't duplicate.** A measurement's type used for *logic* comes from the snapshot
   (`resolvedMeasurementType`), never a stored top-level field read back. (Web audit: `grep -rn
   "\.measurementType" src` — every logic read routes through `resolvedMeasurementType`; only
   `settings.measurementType` — the live settings type — is exempt.)

### Verification tracking (2026-07-28)

Legend: **✅** user-run-verified · **⏳** code-complete + suites green, awaiting the run-review above ·
**⛔** not yet implemented on this edition · **—** not started.

| Verification | Swift | Python | Web |
|---|---|---|---|
| **V-A** two-store re-sourcing | ✅ (`81571ec`; V-A#4 PDF-export gap fixed post-review in `fa62764`) | ✅ user-verified `5fc9aa5` | ✅ user-verified `30dff21` (Store B `MaterialMeasurementInputs`; load no longer clobbers Settings; PDF/save read Store B) |
| **V-B** editable dims + layout | ✅ (`98e09ef`) | ✅ user-verified `5fc9aa5` | ✅ user-verified `b490c0a` (plate + brace; Sample/Body editors → Store B, shared NumberField, plate reorder + `.mat-lc` right-justify parity) |
| **V-Naming** Diagonal/fL/fC/fLC | ✅ (`98e09ef` + `ccdb7dc` + `afda88a` PeakAnnotations/DetailView misses) | ✅ user-verified `33740d1` | — |
| **V-PDF** report layout + naming | ✅ (`98e09ef`) | ✅ user-verified `33740d1` (naming) + `c3d1556` (layout restructure + variable-height pages, all 3 renderers) | — |
| **V-C** notes-on-load | ✅ user-validated + regression test (`e409ce2`); Save-sheet made ephemeral so New Tap can't leak stale name/notes (`2bb1813`) | ✅ user-verified `eeca018` (loaded_notes; Python & web already immune to the New-Tap leak — ephemeral seed) | — |
| **V-D** tests + docs | ◑ tests ✅ (`e409ce2`, 468/102); docs pending | ◑ tests ✅ `242f756` (`test_material_measurement_inputs.py`, 6 tests, 591 green) + `@parity` orphans/coverage-gap closed (Swift tag backfill `b100157`, map regenerated, 85 groups clean); docs pending | — |
| **V-Type** type resolves from snapshot (§12) | ✅ immune (no stored field) | ✅ user-verified `5fc9aa5` (read `resolved_measurement_type` at both load readers) | — |

## 12. Type-resolution parity — `measurementType` derives from the snapshot (decided)

**Decision:** a measurement's type has **one source of truth — the snapshot** — and is *derived on read*,
never stored a second time on the in-memory model and read back for logic. This is the **Swift** model
(`TapToneMeasurement.resolvedMeasurementType` = `spectrumSnapshot?.measurementType ?? longitudinalSnapshot?.measurementType`;
no stored `measurementType` field). Chosen on the merits, not just because Swift is canonical: a stored
duplicate must be re-populated on every construction path and can fall out of sync with the snapshot —
"derive, don't duplicate." (Writing a top-level `measurementType` into the **.guitartap file** is fine and
stays — it's a write-only convenience for external readers, resolved from the snapshot at encode time. The
rule is only about an in-memory model field that logic reads back.)

**Surfaced by (Python, fixed 2026-07-28):** a same-session save→load showed a plate/brace as a Generic
guitar. Root cause: `TapToneMeasurement.create()` leaves the raw `measurement_type` field `None` (only
`from_dict` populates it), and the load path read that raw field → `from_string("")` → `GENERIC`. Fixed by
reading `resolved_measurement_type` at the two load-path readers: `tap_tone_analyzer_measurement_management.py:482`
(model — was also the reason Store B wasn't built on load) and `tap_tone_analysis_view.py:4426/4433` (view —
the type switch). Committed `5fc9aa5`; user-verified in the app. Full suite green (585). Swift is immune (no stored
field). **Do NOT "fix" Python by populating the raw field web-style — that would add divergence from Swift.**

**➡️ WEB TO-DO (when the web chunk lands):** the web is the divergent one — its measurement model stores a
top-level `measurementType` and reads it for logic (populated in `fromLive.ts:169`/`decode.ts:106`). It works
only because every construction path currently sets it. **Align to Swift:** sweep the web's `.measurementType`
reads (`grep -rn "\.measurementType" src`) and route the ones used for **logic** through the existing
`resolvedMeasurementType` (`src/measurement/types.ts:130`) — the snapshot, not the stored field. Settings
reads (`settings.measurementType`) are unaffected (that's the live settings type, not a measurement's).

*(The other two former web to-dos — **PDF page-height** and **Chunk C notes-on-load** — are now folded into
the §10 web plan (PDF section and Chunk C respectively), with their full file/line detail. This block keeps
only the type-resolution parity, which is §12's own subject and is referenced from §10.)*
