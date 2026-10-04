// @parity test/annotation-state
//
// The analyzer's IN-MEMORY state-store mutators: mode overrides, annotation offsets and the
// selection. Set, clear, restore-whole-map, and blank-slate reset — the store itself, not the
// remapping that happens over it when peaks are re-minted.
//
// These are filed under `test/annotation-state`; their Swift and Python counterparts are under
// `test/annotation-state` and `test/measurement-codable`. `clearResult` is Swift's
// `startTapSequence` result reset, `restoreOffsets` is `applyAnnotationOffsets`, and the rest —
// setModeOverride / updateAnnotationOffset / togglePeakSelection / resetToAutoSelection and the CLEAR
// halves resetModeOverride / resetAnnotationOffset / resetAllAnnotationOffsets — have direct twins.
// A name that differs between editions is not a missing test — look for what the code DOES.
//
// The remapping tests that are twins of Swift PR20-PR31 are in frozen-peak-recalc.test.ts.
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import type { ResonantPeak } from '../src/measurement/types'

// A Gaussian bump (downward parabola in dB) on a noise floor — same helper as peaks.test.ts /
// the Swift makeGaussianSpectrum / Python _make_spectrum_with_peak.
function makeSpectrum(peakHz: number, peakDB = -20, halfWidthHz = 5, binCount = 2048, sampleRate = 48000, floor = -100) {
  const binWidth = sampleRate / 2 / (binCount - 1)
  const sigma = halfWidthHz / 2.355
  const mags = new Array<number>(binCount)
  const freqs = new Array<number>(binCount)
  for (let i = 0; i < binCount; i++) {
    const f = i * binWidth
    freqs[i] = f
    const d = f - peakHz
    mags[i] = Math.max(floor, peakDB + (-d * d) / (2 * sigma * sigma))
  }
  return { mags, freqs }
}
const combine = (a: { mags: number[]; freqs: number[] }, b: { mags: number[]; freqs: number[] }) => ({
  mags: a.mags.map((v, i) => Math.max(v, b.mags[i]!)),
  freqs: a.freqs,
})
const peak = (frequency: number, magnitude: number, id = String(frequency)): ResonantPeak => ({ id, frequency, magnitude, quality: 0, bandwidth: 0, timestamp: '2026-09-25T00:00:00Z' })
const near = (peaks: ResonantPeak[], hz: number, tol = 20) => peaks.some((p) => Math.abs(p.frequency - hz) < tol)

/** Drive the frozen-spectrum recalculation (Swift `recalculateFrozenPeaksIfNeeded`) on a Generic guitar.
 *  It stores the FULL set at the -100 floor — Peak Min is NOT an input; it is a display projection
 *  (`peaksAbovePeakMin = allPeaks.filter(mag >= peakMin)`). */
function recalc(a: TapToneAnalyzer) {
  a.measurementType = 'generic'
  a.recalculateFrozenPeaksIfNeeded()
}
/** The Peak-Min display projection (App `peaksAbovePeakMin`): the SAME peak objects, filtered. */
const project = (peaks: ResonantPeak[], peakMin: number) => peaks.filter((p) => p.magnitude >= peakMin)
function frozen(a: TapToneAnalyzer, mags: number[], freqs: number[]) {
  a.frozenMagnitudes = mags
  a.frozenFrequencies = freqs
  a.isMeasurementComplete = true
}

describe('peak-state-store — analyzer override / offset / selection mutators', () => {
  it('setModeOverride / resetModeOverride set and clear by peak id', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(a, mags, freqs)
    recalc(a)
    const id = a.peaks.find((p) => Math.abs(p.frequency - 200) < 20)!.id
    a.setModeOverride(id, 'Wolf note')
    expect(a.overrides.get(id)).toBe('Wolf note')
    a.resetModeOverride(id)
    expect(a.overrides.has(id)).toBe(false)
  })

  it('clearResult drops all overrides (blank-slate reset)', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(a, mags, freqs)
    recalc(a)
    a.setModeOverride(a.peaks[0]!.id, 'Custom')
    a.clearResult()
    expect(a.overrides.size).toBe(0)
  })

  it('restoreOverrides REPLACES the whole map (loaded measurement), not merges', () => {
    const a = new TapToneAnalyzer()
    a.setModeOverride('99', 'stale')
    a.restoreOverrides(new Map<string, string>([['0', 'Air'], ['1', 'Custom']]))
    expect(a.overrides.get('0')).toBe('Air')
    expect(a.overrides.get('1')).toBe('Custom')
    expect(a.overrides.has('99')).toBe(false)
  })

  it('updateAnnotationOffset / resetAnnotationOffset set and clear by peak id', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(a, mags, freqs)
    recalc(a)
    const id = a.peaks.find((p) => Math.abs(p.frequency - 200) < 20)!.id
    a.updateAnnotationOffset(id, [205.5, -18])
    expect(a.annotationOffsets.get(id)).toEqual([205.5, -18])
    a.resetAnnotationOffset(id)
    expect(a.annotationOffsets.has(id)).toBe(false)
  })

  it('resetAllAnnotationOffsets and clearResult both empty the store', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(a, mags, freqs)
    recalc(a)
    a.updateAnnotationOffset(a.peaks[0]!.id, [201, -15])
    a.resetAllAnnotationOffsets()
    expect(a.annotationOffsets.size).toBe(0)
    a.updateAnnotationOffset(a.peaks[0]!.id, [201, -15])
    a.clearResult()
    expect(a.annotationOffsets.size).toBe(0)
  })

  it('restoreOffsets replaces the whole map (loaded measurement)', () => {
    const a = new TapToneAnalyzer()
    a.updateAnnotationOffset('99', [1, 2])
    a.restoreOffsets(new Map<string, [number, number]>([['0', [10, 20]], ['1', [30, 40]]]))
    expect(a.annotationOffsets.get('0')).toEqual([10, 20])
    expect(a.annotationOffsets.has('99')).toBe(false)
  })

  it('togglePeakSelection marks the selection user-modified and flips one peak', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(a, mags, freqs)
    recalc(a)
    const id = a.peaks.find((p) => Math.abs(p.frequency - 200) < 20)!.id
    const was = a.selectedPeakIds.has(id)
    a.togglePeakSelection(id)
    expect(a.userModifiedSelection).toBe(true)
    expect(a.selectedPeakIds.has(id)).toBe(!was)
  })

  it('resetToAutoSelection drops manual edits and re-autos over the durable set', () => {
    const a = new TapToneAnalyzer()
    const s = combine(makeSpectrum(100, -20), makeSpectrum(200, -25))
    frozen(a, s.mags, s.freqs)
    recalc(a)
    a.selectNoPeaks()
    expect(a.userModifiedSelection).toBe(true)
    expect(a.selectedPeakIds.size).toBe(0)
    a.resetToAutoSelection()
    expect(a.userModifiedSelection).toBe(false)
    expect(a.selectedPeakIds.size).toBeGreaterThan(0) // auto re-selected the mode winners
  })

  it('clearResult empties the selection and clears the modified flag + cache', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(a, mags, freqs)
    recalc(a)
    a.togglePeakSelection(a.peaks[0]!.id)
    a.clearResult()
    expect(a.selectedPeakIds.size).toBe(0)
    expect(a.selectedPeakFrequencies).toEqual([])
    expect(a.userModifiedSelection).toBe(false)
  })
})
