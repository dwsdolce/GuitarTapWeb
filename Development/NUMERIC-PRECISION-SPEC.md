# Numeric Precision Consistency — spec (all three editions)

**Status:** 📋 spec written, not started (2026-07-26). Cross-platform (Swift canonical · Python · web).

## Problem

A numeric value the user enters currently means different things depending on which field it is and
where it is shown. For a typed `4.356778` you can see `4.4`, `4.36`, or `4.356778` across the input
field, user settings, the saved measurement, the on-screen results, and the PDF — and it differs by
platform. Surfaced by the brace-thickness bug: entering `29.35` was captured full-precision in a live
measurement but silently rounded to `29.4` in user settings (and brace width `20.38`→`20.4`).

Three axes must agree **per field**:
1. **Input** — how many decimals the user may enter (with feedback).
2. **Storage** — user settings **and** the measurement (`.guitartap`).
3. **Display** — on-screen (input + results) **and** PDF.

## Current state (why it's broken)

- **Swift** — each input `@State` string is seeded with an ad-hoc `String(format: "%.Nf", …)`
  (`%.0f`/`%.1f`/`%.2f`, no principle — e.g. plate thickness `%.2f` but brace thickness `%.1f`).
  The settings save re-parses and re-commits those strings, so **opening + applying Settings silently
  rounds even untouched fields** to their format precision. Settings persist as `Float`.
  (`TapSettingsView.swift` `@State … = String(format:)`, `+Actions.swift` save block.)
- **Python** — input `QLineEdit(str(value))` shows the raw value (faithful); the report rounds
  independently (`f"{…:.2f}"` / `:.1f`). So **input ≠ report**.
- **Web** — `<NumberField value={n}>` shows the raw value (faithful); results/PDF round independently
  (`toFixed(1/2/3)`). So **input ≠ report**.
- **Measurement (`.guitartap`)** — dimensions are stored as **Float32** (`f32`) on all three (canonical
  format). This is the storage floor and is fine for every `P` below.

## Policy

Define **one precision `P` per field**, as a single source of truth, applied identically on all three
editions:

1. **Input** — on commit, round the entered value to `P`; the field immediately re-displays the rounded
   value. That redisplay *is* the feedback (type `4.356778` → the field shows `4.36`). No error dialog.
2. **Storage** — persist the `P`-rounded value to **both** settings and the measurement. (Round to `P`
   *before* the `f32` encode so the stored bits equal the displayed value.)
3. **Display** — every on-screen and PDF site shows the value at `P`. No context-dependent re-rounding.

Result: `input == settings == measurement == on-screen == PDF`, on Swift == Python == web.

**Implementation rule (the important part):** the per-field precision lives in **one constant per
platform** (a table keyed by field). The input formatter, the commit-clamp, and every display/PDF site
read from it. No scattered `%.Nf` / `toFixed(N)` literals that you have to guess at.

## Precision table — input/settings fields

`P` = decimals. Validated against `Wood Property Measurementsl.xlsx` (worst-case = smallest real value):

| field(s) | `P` | step | real range (data) | worst-case `P`/value |
|---|---|---|---|---|
| plate/brace **Length** | 2 (0.01 mm) | 0.01 | 106–690 mm | 0.009 % |
| plate/brace **Width** | 2 (0.01 mm) | 0.01 | ~20–283 mm | 0.05 % |
| plate/brace **Thickness / Height** | 2 (0.01 mm) | 0.01 | ~2.5–103 mm | 0.4 % (caliper limit; t³) |
| plate/brace **Mass** | 1 (0.1 g) | 0.1 | 5–792 g | 0.03–0.1 % @100–300 g |
| guitar **Body Length / Width** | 0 (1 mm) | 1 | 350–613 mm | 0.16–0.29 % |
| **Frequency range** min/max | 0 (1 Hz) | 1 | viewport (FFT bin ≈1.46 Hz) | — |
| **Magnitude range** min/max | 0 (1 dB) | 1 | viewport | — |
| **Peak-Min / tap-detection threshold** | 0 (1 dB) | 1 | dB | — |
| **Custom plate stiffness (f_vs)** | 0 (integer, unitless) | 1 | 50–75 | ~1.3 % |

## Precision table — computed / displayed values

Display-only (no input round-trip), but pin one precision each so a value reads the same at every site:

| value | display `P` |
|---|---|
| Peak frequency | 0.1 Hz |
| Peak magnitude | 0.1 dB |
| Q factor | 0.1 |
| Young's modulus | 0.01 GPa |
| Speed of sound | 1 m/s |
| Density | 0.001 g/cm³ |
| Decay time / tap-tone ratio | 0.01 |
| Gore target thickness | 0.01 mm (matches thickness) |

## Per-platform work

- **Swift (most work — it's the offender).** Replace the ad-hoc `String(format: "%.Nf", …)` `@State`
  seeds and the save-parse with a per-field precision constant; round on commit; format the field and
  every display/PDF site (`PDFReportGenerator`, results views) from the same constant. Round to `P`
  before writing `Float` settings and before the measurement `f32` encode.
- **Python.** Input (`_dim_field`/`_pf`) is already faithful; add round-to-`P` on commit + `P`-format
  display, and align the report/results f-strings to the same per-field `P`.
- **Web.** `NumberField`: round-to-`P` on change/blur, display at `P`, set `step = P`; align
  `MaterialResults` (`f1/f2/f3`) and `pdfReport` (`toFixed`) to the per-field `P`.

## Constraints

- `.guitartap` stores dimensions as **Float32**; all `P` here are ≤ 4 sig figs, well within range. Round
  to `P` before the `f32` encode so stored == displayed.
- Swift settings are `Float` (`defaults.float`); the getter/setter are faithful — round to `P` at the
  input commit, not in the getter.

## Acceptance

1. Enter an over-precise value (`4.356778`) in each field on each edition → the field snaps to `P`, and
   the **same** value appears identically in Settings, the saved `.guitartap`, the on-screen results,
   and the PDF.
2. Merely opening + applying Settings never changes any stored value (the Swift drift is gone).
3. Cross-platform: a value saved on one edition reads identically on the others (already true via `f32`;
   now display-consistent too).
4. `@parity` tags updated where the per-field precision constant is mirrored; oracle/suite green all 3.
