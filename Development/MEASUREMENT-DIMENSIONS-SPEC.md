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
6. **PDF** — unchanged (reads the snapshot); correct once Save writes Store B (verify).

*Chunk A status — ✅ COMMITTED + user-verified (2026-07-27), full suites green (Swift 462 / Python 585
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

Uncommitted Swift files (this chunk): `Views/MaterialDimensionsEditor.swift` (new),
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
