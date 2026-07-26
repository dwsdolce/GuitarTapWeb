# Log-Frequency Axis Removal — Tracked Effort

Status: **✅ DONE (2026-07-08)** — removed lock-step on Swift + Python + web. **Decision: B1**
(kept the `SpectrumSnapshot.isLogarithmic` format field pinned `false`; deleted all interactive/
render log paths). Swift `AxisTickGenerator` log support removed too (its sole caller was the dead
frequency axis). All suites green: Swift 315, Python 376, web 144; Swift builds, web `tsc` clean.
Surfaced repeatedly during the comment/doc review as dead code that generated false findings
(most recently the withdrawn "log-mode gesture gap" in `view/spectrum-gestures`).

## Decision & rationale

**Remove all logarithmic-frequency-axis support.** It is leftover from early work that offered
log *and* linear frequency axes (with matching tick generators). For this product — guitar,
plate, and brace tap-tone analysis — the interesting resonances are all **sub-1 kHz**, so a log
frequency axis adds no value. It is **unreachable on every platform today**:

- **Web:** `logFreq` prop defaults `false`; **no caller ever sets it true** (no toggle/menu).
- **Swift:** `isLogarithmic` is a `@Binding` but every call site passes `false` / `.constant(false)`.
- **Python:** the live chart (`fft_canvas.py`) has **no** log-freq flag at all.

Keeping it and only *documenting* it as dead does not stop the recurring friction: the branches
still have to be read, kept in sync across three repos, and re-reasoned every review — and they
have already **diverged subtly** (Swift carries full log-zoom math in `applyFrequencyZoom`; the
web just early-returns from gestures when `logFreq` is on). Removal permanently deletes a class of
false findings. If a log axis is ever wanted again, it is a bounded, well-understood feature and
**git history preserves the reference implementation**.

## Two layers — treat them differently

### A. Interactive / rendering layer — DELETE (the source of the friction)
The dead branches in the view/gesture/render code. Safe to remove; no format impact.

| Platform | Sites (from `grep isLogarithmic / logFreq / logarithmic`) |
|---|---|
| **Web** | `components/SpectrumChart.tsx` (`logFreq` prop + gesture guards + render dep); `presentation/spectrumRender.ts` (`FREQ_TICKS_LOG_ARR`, log tick placement, `hzAt` log branch); `presentation/spectrumExport.ts` (`logFreq` passthrough) |
| **Swift** | `Views/SpectrumView.swift` (`@Binding isLogarithmic`); `Views/SpectrumView+GestureHandlers.swift` (log branches in `applyFrequencyZoom`/`handlePan`/`handleZoom`); `Views/PeakAnnotations.swift`; `Views/ExportableSpectrumChart.swift`; `Views/TapToneAnalysisView+Export.swift` / `+SpectrumViews.swift` (the `false` / `.constant(false)` args); `Views/Utilities/AxixTickGenerator.swift` `.logarithmic` case — **audit first**: remove only if log-freq was its sole caller (it may be a general tick utility) |
| **Python** | `views/exportable_spectrum_chart.py` (field/param); the live `fft_canvas.py` has nothing to remove |

### B. Serialized format layer — DECISION REQUIRED (the compatibility crux)
`isLogarithmic` is a field of the **`SpectrumSnapshot`** that is written into the canonical
`.guitartap` / snapshot JSON on all three platforms:
- Swift `Models/SpectrumSnapshot.swift` (`Codable` case + encode + decode)
- Python `models/spectrum_snapshot.py`
- Web `measurement/types.ts` + `encode.ts` + `decode.ts` + `fromLive.ts`

Removing a format field is a **format change** with hard parity requirements (Swift JSONEncoder
output is canonical; semantic round-trip is the bar — see `[[project_guitartap_file_format_parity]]`).
Two options:

- **B1 — keep the field, pinned `false` (RECOMMENDED).** Zero format churn, zero compat risk.
  The snapshot keeps a single always-`false` serialized constant; all the *interactive* dead code
  (layer A) still goes. This removes ~all of the review friction (the branches) at no format cost.
- **B2 — drop the field.** Cleaner data model, but a coordinated format change: bump behavior so
  the **reader tolerates** both presence (old files) and absence (new files), and the **writer**
  stops emitting it — mirrored lock-step across all three writers, re-pinning the format oracle.

Recommendation: **B1** unless we're already opening the format for another reason.

## Lock-step plan
| Step | Swift | Python | Web | notes |
|---|---|---|---|---|
| 1. Confirm B1 vs B2 (format field) | — shared — | — shared — | — shared — | B1 = no format change (recommended) |
| 2. Audit `AxisTickGenerator.logarithmic` (Swift) — is log-freq its only caller? | ☐ | — | — | keep the util if used elsewhere |
| 3. Delete layer-A interactive/render log paths | ☐ | ☐ (small) | ☐ | props/bindings, gesture branches, log tick arrays, log render/`hzAt` |
| 4. Apply the B1/B2 format decision | ☐ | ☐ | ☐ | B1: pin `false`; B2: tolerant read + drop write + re-pin oracle |
| 5. Verify: parity tests + `.guitartap` round-trip + gate | — shared — | — shared — | — shared — | no DSP/oracle value change; format round-trip must hold |

## Open decisions — RESOLVED
1. **B1 vs B2** → **B1** (user-confirmed 2026-07-08). Field kept, pinned `false`; its doc on all three
   now marks it a legacy format-compatibility flag. No format change, no oracle re-pin.
2. **`AxisTickGenerator.logarithmic`** → audit found the frequency axis was its **sole** caller, so the
   `.logarithmic` case + `AxisScale` enum + log tick/label helpers were removed; `generateTicks`/
   `formatTickLabel(s)` are linear-only. Linear logic preserved verbatim.

No DSP / numeric-oracle impact — this was dead-interaction cleanup only; the format round-trip is unchanged.