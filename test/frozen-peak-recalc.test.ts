// @parity test/frozen-peak-recalc
//
// Port of FrozenPeakRecalculationTests.swift / test_frozen_peak_recalculation.py.
//
// SCOPE (2026-07-12): this covers the ENGINE half the web analyzer owns after the 3c
// consolidation — `TapToneAnalyzer.recalculatePeaks` (Swift `recalculateFrozenPeaksIfNeeded`):
// the frozen-spectrum findPeaks path, the loaded-measurement threshold filter (loaded peaks are
// authoritative — filtered, never re-analysed), the live-spectrum path, and the material guard.
// That is the canonical PR-A1..A5 integration set + PR2 threshold filter.
//
// The selection / mode-override / annotation-offset remapping-by-frequency (Swift PR1/PR3–PR7,
// `applyFrozenPeakState`) is moving onto the analyzer in the selection-ownership restructure. RA (mode
// overrides) and RB (annotation offsets) have landed and their remap tests are appended below; SELECTION
// (RC) is the remaining piece and its carry-forward tests land with it.
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import type { Peak } from '../src/dsp/peaks'
import type { Spectrum } from '../src/dsp/guitarFFT'

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
    loadedPeaks: null,
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

describe('frozen-peak-recalc — recalculatePeaks integration (PR-A1..A5)', () => {
  it('PR-A1: frozen-spectrum path detects a known peak', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(a, mags, freqs)
    recalc(a)
    expect(a.peaks.length).toBeGreaterThanOrEqual(1)
    expect(near(a.peaks, 200)).toBe(true)
  })

  it('PR-A2: a weak peak is KEPT in the durable set (detection floors at -100); Peak Min only projects it', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -50)
    frozen(a, mags, freqs)
    recalc(a)
    expect(near(a.peaks, 200)).toBe(true) // the full set holds the -50 peak regardless of any Peak Min
    // The App projection is what hides/shows it — and it hands back the SAME peak object.
    expect(near(project(a.peaks, -60), 200)).toBe(true)
    expect(near(project(a.peaks, -40), 200)).toBe(false)
  })

  it('PR-A3: the loaded path keeps the FULL authoritative set (not filtered at the analyzer)', () => {
    const a = new TapToneAnalyzer()
    frozen(a, [100, 200, 400], [100, 200, 400]) // non-empty frozen (matches Swift guard); loaded path ignores it
    recalc(a, { loadedPeaks: [peak(200, -25), peak(400, -65)] })
    expect(a.peaks).toHaveLength(2) // both kept — Peak Min is a display projection, not a detection gate
    expect(near(a.peaks, 200, 1)).toBe(true)
    expect(near(a.peaks, 400, 1)).toBe(true)
    // The projection filters the faint one for display, keeping the strong one's object.
    expect(project(a.peaks, -60).map((p) => p.frequency)).toEqual([200])
  })

  it('PR-A4: loaded peaks below the current Peak Min are KEPT in the set (projected out only for display)', () => {
    const a = new TapToneAnalyzer()
    frozen(a, [100, 200, 400], [100, 200, 400])
    recalc(a, { loadedPeaks: [peak(200, -70), peak(400, -65)] })
    expect(a.peaks).toHaveLength(2) // durable set keeps them — save must not prune
    expect(project(a.peaks, -60)).toHaveLength(0) // display projection hides both at Peak Min -60
  })

  it('PR-A5: empty frozen magnitudes → no peaks (no crash)', () => {
    const a = new TapToneAnalyzer()
    frozen(a, [], [])
    expect(() => recalc(a)).not.toThrow()
    expect(a.peaks).toHaveLength(0)
  })
})

describe('frozen-peak-recalc — loaded peaks are authoritative (PR2c) + live/material paths', () => {
  it('PR2c: the loaded path returns saved peaks, does NOT re-analyse the frozen spectrum', () => {
    const a = new TapToneAnalyzer()
    frozen(a, new Array(512).fill(-100), Array.from({ length: 512 }, (_, i) => i * 47)) // flat → findPeaks would find nothing
    recalc(a, { loadedPeaks: [peak(300, -25)] })
    expect(near(a.peaks, 300, 1)).toBe(true) // survives — proves the saved peak is used, not the flat spectrum
  })

  it('PR2 (two peaks): both frozen peaks are in the durable set; Peak Min projects the weaker', () => {
    const a = new TapToneAnalyzer()
    const s = combine(makeSpectrum(200, -20), makeSpectrum(400, -55))
    frozen(a, s.mags, s.freqs)
    recalc(a)
    expect(near(a.peaks, 200)).toBe(true)
    expect(near(a.peaks, 400)).toBe(true) // the full set holds the -55 peak
    expect(near(project(a.peaks, -60), 400)).toBe(true) // shown at -60
    expect(near(project(a.peaks, -40), 200)).toBe(true) // strong shown at -40
    expect(near(project(a.peaks, -40), 400)).toBe(false) // weak projected out at -40
  })

  it('live-spectrum path: peaks track the live spectrum while not complete (Swift analyzeMagnitudes / P1b)', () => {
    const a = new TapToneAnalyzer() // not complete, no frozen data
    const { mags, freqs } = makeSpectrum(200, -20)
    const live: Spectrum = { magnitudesDb: mags, frequencies: freqs }
    recalc(a, { liveSpectrum: live })
    expect(near(a.peaks, 200)).toBe(true)
  })

  it('material mode yields no guitar peaks (material uses matPeaks)', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    recalc(a, { material: true, liveSpectrum: { magnitudesDb: mags, frequencies: freqs }, loadedPeaks: [peak(200, -20)] })
    expect(a.peaks).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Phase 1 durability — the durable set is the FULL set; Peak Min never shrinks it, and projecting
// hands back the SAME peak objects so per-peak state (selection/overrides/offsets) survives a slider
// move. Mirrors Swift PeakMinDurabilityTests / the "never assign the durable set a filtered view" trap.
// ---------------------------------------------------------------------------
describe('frozen-peak-recalc — Peak-Min durability (Phase 1)', () => {
  it('the durable set holds a sub-Peak-Min peak (found at the -100 floor, not at Peak Min)', () => {
    const a = new TapToneAnalyzer()
    const s = combine(makeSpectrum(200, -20), makeSpectrum(400, -80)) // -80 is below any normal Peak Min
    frozen(a, s.mags, s.freqs)
    recalc(a)
    expect(near(a.peaks, 400)).toBe(true) // kept — so lowering the slider can later reveal it
  })

  it('a peak hidden then revealed via Peak Min returns the SAME object (id/identity intact)', () => {
    const a = new TapToneAnalyzer()
    const s = combine(makeSpectrum(200, -20), makeSpectrum(400, -50))
    frozen(a, s.mags, s.freqs)
    recalc(a)
    const before = a.peaks.find((p) => Math.abs(p.frequency - 400) < 20)!
    expect(project(a.peaks, -40).some((p) => p === before)).toBe(false) // hidden at -40
    const revealed = project(a.peaks, -60).find((p) => Math.abs(p.frequency - 400) < 20)!
    expect(revealed).toBe(before) // SAME object reference — identity/id preserved across the slider
  })

  it('recalc does not shrink the durable set as a (former) Peak Min would rise', () => {
    const a = new TapToneAnalyzer()
    const s = combine(makeSpectrum(200, -20), makeSpectrum(400, -55))
    frozen(a, s.mags, s.freqs)
    recalc(a)
    const n = a.peaks.length
    recalc(a) // re-run (what the effect does when non-peakMin inputs change) — the set must not shrink
    expect(a.peaks.length).toBe(n)
  })
})

// ---------------------------------------------------------------------------
// Phase 3 — per-tap entries computed ONCE at build, then durable. Nothing re-derives them (the web's
// recalculateTapEntryPeaks equivalent is deleted from recalculatePeaks). Mirrors Swift 11689b6.
// ---------------------------------------------------------------------------
describe('frozen-peak-recalc — per-tap entries computed once (Phase 3)', () => {
  const twoTaps = (a: TapToneAnalyzer, faintDB = -80) => {
    const s1 = combine(makeSpectrum(200, -20), makeSpectrum(400, faintDB))
    const s2 = combine(makeSpectrum(200, -22), makeSpectrum(400, faintDB - 2))
    a.recordGuitarTap({ magnitudesDb: s1.mags, frequencies: s1.freqs })
    a.recordGuitarTap({ magnitudesDb: s2.mags, frequencies: s2.freqs })
    a.processMultipleTaps()
  }

  it('processMultipleTaps finds each per-tap peak set once, at the -100 floor', () => {
    const a = new TapToneAnalyzer()
    twoTaps(a) // the 400 Hz per-tap peak is -80 dB — below any normal Peak Min
    expect(a.tapEntries).toHaveLength(2)
    expect(a.tapEntries.every((e) => near(e.peaks, 400))).toBe(true) // faint peak kept (floored at -100)
    expect(a.tapEntries.every((e) => near(e.peaks, 200))).toBe(true)
  })

  it('recalculatePeaks does NOT re-derive tapEntries — they are durable, not re-minted', () => {
    const a = new TapToneAnalyzer()
    twoTaps(a, -55)
    const beforeEntries = a.tapEntries
    const beforePeaks0 = a.tapEntries[0]!.peaks
    recalc(a) // a non-peakMin input change drives this — it must not touch the per-tap entries
    expect(a.tapEntries).toBe(beforeEntries) // same array reference — not rebuilt
    expect(a.tapEntries[0]!.peaks).toBe(beforePeaks0) // same peaks array — not re-found
  })

  it('loaded per-tap entries are found once from the saved spectra (deterministic, floored)', () => {
    const a = new TapToneAnalyzer()
    const s = combine(makeSpectrum(200, -20), makeSpectrum(400, -70))
    a.loadMeasurement({ magnitudes: s.mags, frequencies: s.freqs, taps: [{ magnitudesDb: s.mags, frequencies: s.freqs }] })
    expect(a.tapEntries).toHaveLength(1)
    expect(near(a.tapEntries[0]!.peaks, 400)).toBe(true) // -70 peak kept — not gated at Peak Min
    const before = a.tapEntries[0]!.peaks
    recalc(a, { loadedPeaks: [peak(200, -20)] })
    expect(a.tapEntries[0]!.peaks).toBe(before) // durable across recalc
  })
})

// ---------------------------------------------------------------------------
// PR8: canReanalyze — when the Re-analyze button is offered
// ---------------------------------------------------------------------------
//
// Re-analyze is a RESET, not a dirty-flag indicator: it is offered whenever it COULD do
// something, not only when we can prove it WILL. What can leave the displayed analysis differing
// from a clean re-derivation is open-ended (peaks came from a file; mode assignments carried
// forward across Peak Min moves instead of being re-claimed; the analysis range moved; selections
// were hand-edited), and the two failure modes are not symmetric — a wrongly-DISABLED button is a
// dead end, a wrongly-ENABLED one costs a pointless click. So: any complete guitar measurement
// with a frozen spectrum; never material.
//
// This replaces `loadedPeaks == null`, a proxy for "the peaks are stale" that was wrong in both
// directions — it disabled itself after one press (the web comment even recorded the one-shot as
// intended), and never lit up for a live capture whose mode assignments had drifted.
//
// Mirrors Swift FrozenPeakRecalculation_CanReanalyzeTests / Python TestPR8CanReanalyze.
describe('frozen-peak-recalc — canReanalyze (PR8)', () => {
  it('PR8a: a live (never-loaded) frozen capture can be re-analyzed', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(a, mags, freqs)
    recalc(a) // fresh capture — loadedPeaks null
    expect(a.canReanalyze).toBe(true)
  })

  it('PR8b: a loaded measurement can be re-analyzed', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(a, mags, freqs)
    recalc(a, { loadedPeaks: [peak(200, -25)] })
    expect(a.canReanalyze).toBe(true)
  })

  it('PR8c: it is not a one-shot — still available after the loaded peaks are dropped', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(a, mags, freqs)
    recalc(a, { loadedPeaks: [peak(200, -25)] })
    expect(a.canReanalyze).toBe(true)

    recalc(a, { loadedPeaks: null }) // what the App's reanalyze() does: clears the loaded peaks
    expect(a.canReanalyze).toBe(true)
  })

  it('PR8d: material can never be re-analyzed', () => {
    for (const mt of ['plate', 'brace'] as const) {
      const a = new TapToneAnalyzer()
      a.measurementType = mt
      const { mags, freqs } = makeSpectrum(200, -20)
      frozen(a, mags, freqs)                                        // even WITH a frozen spectrum…
      recalc(a, { material: true, loadedPeaks: [peak(200, -20)] })  // …and loaded peaks
      expect(a.canReanalyze, `${mt} must never offer Re-analyze`).toBe(false)
    }
  })

  it('PR8e: nothing to re-analyze without a completed measurement and a frozen spectrum', () => {
    const noSpectrum = new TapToneAnalyzer()
    noSpectrum.isMeasurementComplete = true
    expect(noSpectrum.canReanalyze).toBe(false)

    const incomplete = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(incomplete, mags, freqs)
    incomplete.isMeasurementComplete = false
    expect(incomplete.canReanalyze).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// RA — overrides on the analyzer (id-keyed), carried across a peak RE-MINT by applyFrozenPeakState.
// The web equivalent of Swift's overridesByFrequency snapshot + ±5 Hz remap in applyFrozenPeakState —
// the override half of the PR1/PR3–PR7 family (offsets land in RB, selection in RC). Before RA these
// lived in the VIEW (useAnnotations), keyed by frequency.toFixed(1); now they live with the peaks they
// describe, keyed by id, and the remap uses ±5 Hz proximity (more robust than exact 0.1 Hz matching).
// ---------------------------------------------------------------------------
describe('frozen-peak-recalc — overrides on the analyzer (RA)', () => {
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

  it('an override SURVIVES a re-mint that SHIFTS the id, remapped by ±5 Hz proximity', () => {
    // findPeaks assigns ids positionally (0,1,… ascending frequency), so an id only churns when the
    // detected SET changes. Re-freeze with an extra peak (300 Hz) BELOW the target so the 400 Hz peak's
    // index shifts (1 → 2) while its frequency is unchanged — the exact case the proximity remap exists for.
    const a = new TapToneAnalyzer()
    const two = combine(makeSpectrum(200, -20), makeSpectrum(400, -30))
    frozen(a, two.mags, two.freqs)
    recalc(a)
    const before = a.peaks.find((p) => Math.abs(p.frequency - 400) < 20)!
    a.setModeOverride(before.id, 'Custom')

    const three = combine(two, makeSpectrum(300, -25))
    frozen(a, three.mags, three.freqs)
    recalc(a)
    const after = a.peaks.find((p) => Math.abs(p.frequency - 400) < 20)!
    expect(after.id).not.toBe(before.id) // the id genuinely shifted (a peak was inserted below it)…
    expect(a.overrides.get(after.id)).toBe('Custom') // …but the override carried across by frequency
    expect(a.overrides.has(before.id)).toBe(false) // the old id is gone from the map
  })

  it('an override is ORPHANED when no re-minted peak falls within the ±5 Hz window', () => {
    const a = new TapToneAnalyzer()
    const s = combine(makeSpectrum(200, -20), makeSpectrum(400, -30))
    frozen(a, s.mags, s.freqs)
    recalc(a)
    const p400 = a.peaks.find((p) => Math.abs(p.frequency - 400) < 20)!
    a.setModeOverride(p400.id, 'Custom')
    const only200 = makeSpectrum(200, -20) // re-freeze on a spectrum whose 400 Hz peak is gone
    frozen(a, only200.mags, only200.freqs)
    recalc(a)
    expect([...a.overrides.values()]).not.toContain('Custom') // nothing within tolerance → dropped
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

  it('the loaded branch keeps stable ids, so overrides restored against them are NOT remapped away', () => {
    const a = new TapToneAnalyzer()
    frozen(a, [100, 200, 400], [100, 200, 400]) // non-empty frozen (guard); loaded path ignores it
    a.restoreOverrides(new Map<number, string>([[0, 'Air'], [1, 'Top']])) // keyed to loaded indices
    recalc(a, { loadedPeaks: [peak(200, -25, 0), peak(400, -30, 1)] }) // ids 0,1 — stable, no re-mint
    expect(a.overrides.get(0)).toBe('Air')
    expect(a.overrides.get(1)).toBe('Top')
  })
})

// ---------------------------------------------------------------------------
// RB — annotation offsets on the analyzer (id-keyed), carried across a re-mint by applyFrozenPeakState.
// One store for guitar AND material, matching Swift `peakAnnotationOffsets` / Python
// `peak_annotation_offsets` (both id/UUID-keyed, material peaks included). The offset half of the remap.
// ---------------------------------------------------------------------------
describe('frozen-peak-recalc — annotation offsets on the analyzer (RB)', () => {
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

  it('an offset SURVIVES a re-mint that SHIFTS the id, remapped by ±5 Hz proximity', () => {
    const a = new TapToneAnalyzer()
    const two = combine(makeSpectrum(200, -20), makeSpectrum(400, -30))
    frozen(a, two.mags, two.freqs)
    recalc(a)
    const before = a.peaks.find((p) => Math.abs(p.frequency - 400) < 20)!
    a.updateAnnotationOffset(before.id, [402, -25])
    const three = combine(two, makeSpectrum(300, -25)) // inserts a peak below 400 → its id shifts
    frozen(a, three.mags, three.freqs)
    recalc(a)
    const after = a.peaks.find((p) => Math.abs(p.frequency - 400) < 20)!
    expect(after.id).not.toBe(before.id)
    expect(a.annotationOffsets.get(after.id)).toEqual([402, -25]) // carried across by frequency
    expect(a.annotationOffsets.has(before.id)).toBe(false)
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

  it('a captured MATERIAL peak gets a stored id, and its offset lives in the same store (brace)', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'brace'
    a.numberOfTaps = 1
    a.startMaterial(false) // no device needed — arm/session calls are optional-chained
    const s = makeSpectrum(300, -30) // brace search band is 100–1200 Hz
    a.recordMaterialTap({ magnitudesDb: s.mags, frequencies: s.freqs })
    const lp = a.matPeaks.longitudinal
    expect(lp).not.toBeNull()
    expect(typeof lp!.id).toBe('number')
    a.updateAnnotationOffset(lp!.id, [305, -25])
    expect(a.annotationOffsets.get(lp!.id)).toEqual([305, -25])
    a.resetMaterial() // a material reset drops the dragged labels too
    expect(a.annotationOffsets.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// RC — selection on the analyzer, CONCRETE state (full-Swift paradigm), recomputed on each re-mint by
// applyFrozenPeakState: UNMODIFIED → re-auto; MODIFIED → carry forward by ±5 Hz, keeping below-tolerance
// frequencies in the stable cache (selectedPeakFrequencies) so they re-select when the peak reappears.
// Mirrors Swift applyFrozenPeakState's selection branches + selectedPeakFrequencies. PR1/PR3–PR7 family.
// Note (Swift parity): a manual toggle does NOT sync the cache, so the carry-forward tests seed a synced
// cache via restoreSelection — the realistic loaded-manual path where the carry actually matters.
// ---------------------------------------------------------------------------
describe('frozen-peak-recalc — selection on the analyzer (RC)', () => {
  it('an UNMODIFIED selection re-runs auto over the durable set on each re-mint', () => {
    // Top (200) + Dipole (400) — both above the scan floor (~140 Hz for minHz 80); auto picks each.
    const a = new TapToneAnalyzer()
    const s = combine(makeSpectrum(200, -20), makeSpectrum(400, -25))
    frozen(a, s.mags, s.freqs)
    recalc(a)
    expect(a.userModifiedSelection).toBe(false)
    expect(a.selectedPeakIds.size).toBeGreaterThan(0) // auto picked the mode winners
    const topId = a.peaks.find((p) => Math.abs(p.frequency - 200) < 20)!.id
    expect(a.selectedPeakIds.has(topId)).toBe(true)
    recalc(a) // a re-mint re-runs auto (unmodified) — the Top peak is still selected
    const topId2 = a.peaks.find((p) => Math.abs(p.frequency - 200) < 20)!.id
    expect(a.selectedPeakIds.has(topId2)).toBe(true)
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

  it('a MANUAL selection (synced cache) carries across a re-mint that shifts the id, by ±5 Hz', () => {
    const a = new TapToneAnalyzer()
    const two = combine(makeSpectrum(200, -20), makeSpectrum(400, -30))
    frozen(a, two.mags, two.freqs)
    recalc(a)
    const before = a.peaks.find((p) => Math.abs(p.frequency - 400) < 20)!
    a.restoreSelection(new Set([before.id]), [before.frequency], true) // manual, cache synced (loaded path)
    const three = combine(two, makeSpectrum(300, -25)) // inserts a peak below 400 → its id shifts
    frozen(a, three.mags, three.freqs)
    recalc(a)
    const after = a.peaks.find((p) => Math.abs(p.frequency - 400) < 20)!
    expect(after.id).not.toBe(before.id)
    expect([...a.selectedPeakIds]).toEqual([after.id]) // carried to the new id, nothing spurious
  })

  it('a selected peak that vanishes is kept in the frequency cache and RE-SELECTS when it returns', () => {
    const a = new TapToneAnalyzer()
    const two = combine(makeSpectrum(200, -20), makeSpectrum(400, -30))
    frozen(a, two.mags, two.freqs)
    recalc(a)
    const p400 = a.peaks.find((p) => Math.abs(p.frequency - 400) < 20)!
    a.restoreSelection(new Set([p400.id]), [p400.frequency], true)
    const only200 = makeSpectrum(200, -20) // re-freeze WITHOUT the 400 peak
    frozen(a, only200.mags, only200.freqs)
    recalc(a)
    expect(a.selectedPeaks.some((p) => Math.abs(p.frequency - 400) < 20)).toBe(false) // dropped from selection
    expect(a.selectedPeakFrequencies.some((f) => Math.abs(f - 400) < 5)).toBe(true) // …but preserved in the cache
    frozen(a, two.mags, two.freqs) // 400 returns
    recalc(a)
    expect(a.selectedPeaks.some((p) => Math.abs(p.frequency - 400) < 20)).toBe(true) // re-selects from the cache
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
