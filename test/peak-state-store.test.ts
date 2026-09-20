// @parity test/peak-state-store
//
// The analyzer's IN-MEMORY state-store mutators: mode overrides, annotation offsets and the
// selection. Set, clear, restore-whole-map, and blank-slate reset — the store itself, not the
// remapping that happens over it when peaks are re-minted.
//
// SPLIT OUT of frozen-peak-recalc.test.ts on 2026-09-19 (project issue #8). That file's slug
// claims a three-way pair, and these nine tests have NO Swift or Python counterpart — they are
// web-only coverage of mutators the other editions exercise only indirectly, inside their
// remapping tests. Leaving them under the paired slug made it report "paired" while the suites
// diverged, which is how the divergence survived since July.
//
// They are NOT `@parity none`: the other editions SHOULD have these tests. This slug is expected
// to show as a web-only ORPHAN in `gen_parity_map.py --check` until they do, and that visible
// orphan is the point — a real coverage gap, named, instead of hidden inside a green pair.
//
// The remapping tests that ARE twins of Swift PR3-PR7 stayed in frozen-peak-recalc.test.ts.
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import type { Peak } from '../src/dsp/peaks'

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
const peak = (frequency: number, magnitude: number, id = frequency): Peak => ({ id, frequency, magnitude, quality: 0, bandwidth: 0 })
const near = (peaks: Peak[], hz: number, tol = 20) => peaks.some((p) => Math.abs(p.frequency - hz) < tol)

/** Drive recalculatePeaks with sensible defaults (guitar, generic, 80–1200 Hz).
 *  Phase 1: recalculatePeaks stores the FULL set at the -100 floor — Peak Min is NOT an input; it is a
 *  display projection at the App layer (`peaksAbovePeakMin = allPeaks.filter(mag >= peakMin)`). Tests
 *  that used to assert the analyzer's `peaks` shrank with Peak Min now assert the full set + the
 *  projection separately. */
function recalc(a: TapToneAnalyzer, over: Partial<Parameters<TapToneAnalyzer['recalculatePeaks']>[0]> = {}) {
  a.recalculatePeaks({
    material: false,
    liveSpectrum: null,
    guitarType: 'generic',
    minHz: 80,
    maxHz: 1200,
    ...over,
  })
}
/** The Peak-Min display projection (App `peaksAbovePeakMin`): the SAME peak objects, filtered. */
const project = (peaks: Peak[], peakMin: number) => peaks.filter((p) => p.magnitude >= peakMin)
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
    a.setModeOverride(99, 'stale')
    a.restoreOverrides(new Map<number, string>([[0, 'Air'], [1, 'Custom']]))
    expect(a.overrides.get(0)).toBe('Air')
    expect(a.overrides.get(1)).toBe('Custom')
    expect(a.overrides.has(99)).toBe(false)
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
    a.updateAnnotationOffset(99, [1, 2])
    a.restoreOffsets(new Map<number, [number, number]>([[0, [10, 20]], [1, [30, 40]]]))
    expect(a.annotationOffsets.get(0)).toEqual([10, 20])
    expect(a.annotationOffsets.has(99)).toBe(false)
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
    a.resetToAutoSelection('generic')
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
