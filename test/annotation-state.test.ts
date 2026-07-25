// @parity test/annotation-state
//
// Web side of the annotation-state parity group (Swift AnnotationStateTests.swift D4–D6,
// Python test_annotation_state.py D4–D6). Pins the ONE rule that decides which peaks the
// chart and the report are about — Swift `TapToneAnalyzer.visiblePeaks` / Python `visible_peaks`:
//
//   all      → every peak
//   selected → only peaks in selectedPeakIDs
//   none     → nothing
//
// The web has no analyzer-owned `visiblePeaks`; it encodes the same rule as the `annotated`
// flag on each marker (buildGuitarMarkers) and materialises the set with `reportPeaks`.
// This side of the group was parked, and its absence is exactly why the bug below shipped:
// Swift and Python both tested the rule and were correct; the web never did.
//
// REGRESSION (2026-07-16, found in 1.0.2 testing): a 3-app simultaneous capture of ONE tap
// showed the web PDF/PNG reporting "Detected Peaks: 47" against Swift's 6, summarising the
// lowest-frequency peaks rather than the selected ones. The header/summary ignored `annotated`.
// These tests pin `annotated` = the visiblePeaks rule, which drives the BADGE layer and the
// report summary. (The chart DOT layer is separate — Swift Layer 1 `allPeaksInRange` dots every
// in-range peak regardless of annotation mode; that is the renderer's job, not this flag's.)
import { describe, it, expect } from 'vitest'
import { buildGuitarMarkers } from '../src/presentation/measurementImage'
import { reportPeaks } from '../src/presentation/spectrumExport'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import type { Peak } from '../src/dsp/peaks'
import type { ResolvedMode } from '../src/dsp/classify'

/** Three peaks, ids 1..3 — mirrors the 3-peak fixture the Swift/Python D4–D6 tests use. */
const PEAKS: Peak[] = [
  { id: 1, frequency: 97.4, magnitude: -63.2, quality: 10, bandwidth: 9.74 },
  { id: 2, frequency: 197.4, magnitude: -41.5, quality: 10, bandwidth: 19.74 },
  { id: 3, frequency: 239.6, magnitude: -54.5, quality: 10, bandwidth: 23.96 },
]

const MODES = new Map<number, ResolvedMode>([
  [1, 'air'],
  [2, 'top'],
  [3, 'back'],
])

const build = (mode: 'all' | 'selected' | 'none', selected: number[]) =>
  buildGuitarMarkers(PEAKS, MODES, new Set(selected), new Map(), mode, undefined)

/** The visible set = what the chart dots and the report summarise. */
const visible = (mode: 'all' | 'selected' | 'none', selected: number[]) =>
  reportPeaks(build(mode, selected)).map((m) => m.frequency)

describe('annotation-state — visiblePeaks rule (3-way parity)', () => {
  it("D4 — mode 'all' → every peak is visible", () => {
    expect(visible('all', [2])).toEqual([97.4, 197.4, 239.6])
  })

  it("D5 — mode 'selected' → only the selected peaks are visible", () => {
    expect(visible('selected', [1, 3])).toEqual([97.4, 239.6])
  })

  it("D6 — mode 'none' → nothing is visible", () => {
    expect(visible('none', [1, 2, 3])).toEqual([])
  })

  it("D5b — 'selected' with nothing selected → nothing visible (not a fallback to all)", () => {
    // Guards the `?? all`-style fallback that makes an empty selection silently mean "everything".
    expect(visible('selected', [])).toEqual([])
  })
})

describe('annotation-state — the report is about the visible peaks (regression)', () => {
  it('reports the selected count, not the detected count', () => {
    // The shipped bug: header read "Detected Peaks: <all>" (47 vs Swift's 6).
    const markers = build('selected', [2])
    expect(markers).toHaveLength(3) // markers still carry every peak…
    expect(reportPeaks(markers)).toHaveLength(1) // …but the report is about the selected one
  })

  it('keeps selected peaks that sit OUTSIDE the plotted range', () => {
    // Swift lists all selected peaks (e.g. 409/622/994 Hz under a 75–350 Hz view). The old
    // `.slice(0, 8)`-of-all-peaks summary dropped exactly these while including unselected ones.
    const wide: Peak[] = [...PEAKS, { id: 4, frequency: 994.5, magnitude: -68.6, quality: 10, bandwidth: 99.45 }]
    const markers = buildGuitarMarkers(
      wide,
      new Map<number, ResolvedMode>([...MODES, [4, 'unknown']]),
      new Set([1, 4]),
      new Map(),
      'selected',
      undefined,
    )
    expect(reportPeaks(markers).map((m) => m.frequency)).toEqual([97.4, 994.5])
  })

  it('marks exactly the selected peaks as annotated — badges + report follow this flag', () => {
    // `annotated` drives the BADGE layer (Swift visiblePeaks) and the report summary. The chart
    // DOT layer is NOT gated on it (Swift Layer 1 allPeaksInRange dots every in-range peak).
    const markers = build('selected', [1, 3])
    expect(markers.map((m) => m.annotated)).toEqual([true, false, true])
  })
})

// ---------------------------------------------------------------------------
// DefinitiveModeUniqueness — the SELECTION invariant: at most one SELECTED peak per Air/Top/Back (the
// definitive one). It is a selection rule, NOT classification: many peaks may be classified/assigned to a
// mode; only the selection is constrained, and only for the single-holder modes. Mode is resolved through
// the OVERRIDE-AWARE path (analyzer.effectiveMode / Swift peakMode(for:)). Mirrors Swift
// AnnotationStateTests DefinitiveModeUniqueness. The auto modes are set directly for full control.
// ---------------------------------------------------------------------------
const p = (id: number): Peak => ({ id, frequency: id, magnitude: -30, quality: 10, bandwidth: 5 })
/** An analyzer in a guitar type with the given peaks + auto classification, nothing selected. */
const analyzerWith = (autoModes: [number, ResolvedMode][]): TapToneAnalyzer => {
  const a = new TapToneAnalyzer()
  a.measurementType = 'classical' // any guitar type → isGuitar true
  a.peaks = autoModes.map(([id]) => p(id))
  a.modeByPeak = new Map(autoModes)
  return a
}

describe('annotation-state — DefinitiveModeUniqueness (selection invariant)', () => {
  it('assigning + selecting a second Top displaces the first; the displaced peak stays classified Top', () => {
    const a = analyzerWith([[1, 'top'], [2, 'dipole']])
    a.togglePeakSelection(1) // the auto-Top is definitive
    expect(a.selectedPeakIds).toEqual(new Set([1]))
    a.setModeOverride(2, 'Top') // assign peak 2 to Top — but it isn't selected, so nothing changes yet
    expect(a.selectedPeakIds).toEqual(new Set([1]))
    a.togglePeakSelection(2) // select the new Top → the previous holder is deselected
    expect(a.selectedPeakIds).toEqual(new Set([2]))
    expect(a.modeByPeak.get(1)).toBe('top') // deselect ≠ relabel — peak 1 is still classified Top
  })

  it('Dipole allows several selected peaks (only Air/Top/Back are single-holder)', () => {
    const a = analyzerWith([[1, 'dipole'], [2, 'dipole']])
    a.togglePeakSelection(1)
    a.togglePeakSelection(2) // enforce runs but Dipole is not single-holder → no displacement
    expect(a.selectedPeakIds).toEqual(new Set([1, 2]))
  })

  it('overriding an ALREADY-SELECTED peak into Top displaces the previous Top holder', () => {
    const a = analyzerWith([[1, 'top'], [2, 'back']])
    a.togglePeakSelection(1) // definitive Top
    a.togglePeakSelection(2) // definitive Back — different mode, both stay
    expect(a.selectedPeakIds).toEqual(new Set([1, 2]))
    a.setModeOverride(2, 'Top') // peak 2 (selected) becomes Top → displaces peak 1
    expect(a.selectedPeakIds).toEqual(new Set([2]))
  })

  it('overriding an UNSELECTED peak into Top changes no selection', () => {
    const a = analyzerWith([[1, 'top'], [2, 'back']])
    a.togglePeakSelection(1)
    a.setModeOverride(2, 'Top') // peak 2 not selected → enforce is a no-op
    expect(a.selectedPeakIds).toEqual(new Set([1]))
  })

  it('overriding the definitive Top AWAY leaves Top holderless — nothing auto-promotes', () => {
    const a = analyzerWith([[1, 'top'], [2, 'top']]) // peak 2 is another Top candidate, unselected
    a.togglePeakSelection(1) // peak 1 is the definitive Top
    a.setModeOverride(1, 'Back') // move the definitive Top away to Back
    expect(a.selectedPeakIds).toEqual(new Set([1])) // still selected, just no longer Top
    expect(a.effectiveMode(1)).toBe('back')
    expect([...a.selectedPeakIds].some((id) => a.effectiveMode(id) === 'top')).toBe(false) // Top holderless
    expect(a.selectedPeakIds.has(2)).toBe(false) // peak 2 was NOT promoted
  })

  it('Select None clears the selection but leaves classification intact', () => {
    const a = analyzerWith([[1, 'top'], [2, 'back']])
    a.togglePeakSelection(1)
    a.togglePeakSelection(2)
    a.selectNoPeaks()
    expect(a.selectedPeakIds.size).toBe(0)
    expect(a.modeByPeak.get(1)).toBe('top')
    expect(a.modeByPeak.get(2)).toBe('back')
  })
})