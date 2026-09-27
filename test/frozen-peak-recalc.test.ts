// @parity test/frozen-peak-recalc
//
// Port of FrozenPeakRecalculationTests.swift / test_frozen_peak_recalculation.py.
//
// SCOPE: this covers the ENGINE half the web analyzer owns —
// `TapToneAnalyzer.recalculateFrozenPeaksIfNeeded` (Swift's name): the frozen-spectrum
// findPeaks path, the loaded-measurement path (loaded peaks are authoritative — never re-analysed), and
// the live-frame path (`onFftFrame` → `analyzeMagnitudes`) with its material guard.
// That is the canonical PR-A1..A5 integration set + PR2 threshold filter.
//
// The selection / mode-override / annotation-offset remapping across a peak re-mint (Swift
// PR1/PR3–PR7, `applyFrozenPeakState`) is on the analyzer; its tests are below — overrides,
// annotation offsets, selection, then the carry-forward edge cases.
//
// PR10 / PR11 (the isLoadingMeasurement guard) are in the PR10/PR11 describe block at the end of this
// file. loadMeasurement applies the whole measurement — spectrum, per-tap entries, peaks, overrides,
// offsets, selection — as one step under isLoadingMeasurement, and `loadedPeaks` lives on the analyzer.

import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { TapEntry, type TapToneMeasurementModel, type ResonantPeak } from '../src/measurement/types'
import { newId } from '../src/measurement/newId'
import { buildMaterialMeasurement } from '../src/measurement/fromLive'
import { DEFAULT_SETTINGS } from '../src/settings'
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
const peak = (frequency: number, magnitude: number, id = String(frequency)): ResonantPeak => ({ id, frequency, magnitude, quality: 0, bandwidth: 0, timestamp: '2026-09-25T00:00:00Z' })
const near = (peaks: ResonantPeak[], hz: number, tol = 20) => peaks.some((p) => Math.abs(p.frequency - hz) < tol)

/** Drive the frozen-spectrum recalculation (Swift `recalculateFrozenPeaksIfNeeded`) on a Generic guitar.
 *  It stores the FULL set at the -100 floor — Peak Min is NOT an input to detection, it is a display
 *  projection. Tests assert the durable set (`a.peaks`) and the projection (`a.peaksAbovePeakMin`)
 *  separately. `loadedPeaks` is analyzer state; assigning it here mirrors what loadMeasurement does. */
function recalc(a: TapToneAnalyzer, over: { loadedPeaks?: ResonantPeak[] | null } = {}) {
  a.measurementType = 'generic'
  if (over.loadedPeaks !== undefined) a.loadedPeaks = over.loadedPeaks
  a.recalculateFrozenPeaksIfNeeded()
}
/** Set Peak Min and read back the analyzer's own projection.
 *
 *  This used to be a local `project()` that re-implemented the filter — a third copy of a rule that
 *  also lived in App.tsx as a useMemo and in Swift/Python as `refreshDisplayedPeaks()`. A test
 *  asserting its own copy of the behaviour under test proves nothing about the code that ships, so
 *  the projection moved onto the analyzer and the copy is gone. Go through the real setter. */
const projected = (a: TapToneAnalyzer, peakMin: number): ResonantPeak[] => {
  a.setPeakMinThreshold(peakMin) // the entry point App.tsx calls — not the bare property
  return a.peaksAbovePeakMin
}
function frozen(a: TapToneAnalyzer, mags: number[], freqs: number[]) {
  a.frozenMagnitudes = mags
  a.frozenFrequencies = freqs
  a.isMeasurementComplete = true
}

describe('frozen-peak-recalc — recalculateFrozenPeaksIfNeeded integration (PR-A1..A5)', () => {
  it('PR01: frozen-spectrum path detects a known peak', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(a, mags, freqs)
    recalc(a)
    expect(a.peaks.length).toBeGreaterThanOrEqual(1)
    expect(near(a.peaks, 200)).toBe(true)
  })

  it('PR02: a weak peak is KEPT in the durable set (detection floors at -100); Peak Min only projects it', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -50)
    frozen(a, mags, freqs)
    recalc(a)
    expect(near(a.peaks, 200)).toBe(true) // the full set holds the -50 peak regardless of any Peak Min
    // The App projection is what hides/shows it — and it hands back the SAME peak object.
    expect(near(projected(a, -60), 200)).toBe(true)
    expect(near(projected(a, -40), 200)).toBe(false)
  })

  // PR03. Already asserted both surfaces; renamed to say so. Swift's twin was called
  // "filtersAboveThresholdOnly" and checked only the projection, which is why this one read as a
  // contradiction rather than the other half of the same rule. All three now name the surface.
  it('PR03: Peak Min projects the loaded set for display and never shrinks the durable set', () => {
    const a = new TapToneAnalyzer()
    frozen(a, [100, 200, 400], [100, 200, 400]) // non-empty frozen (matches Swift guard); loaded path ignores it
    recalc(a, { loadedPeaks: [peak(200, -25), peak(400, -65)] })
    expect(a.peaks).toHaveLength(2) // both kept — Peak Min is a display projection, not a detection gate
    expect(near(a.peaks, 200, 1)).toBe(true)
    expect(near(a.peaks, 400, 1)).toBe(true)
    // The projection filters the faint one for display, keeping the strong one's object.
    expect(projected(a, -60).map((p) => p.frequency)).toEqual([200])
  })

  it('PR04: loaded peaks below the current Peak Min are KEPT in the set (projected out only for display)', () => {
    const a = new TapToneAnalyzer()
    frozen(a, [100, 200, 400], [100, 200, 400])
    recalc(a, { loadedPeaks: [peak(200, -70), peak(400, -65)] })
    expect(a.peaks).toHaveLength(2) // durable set keeps them — save must not prune
    expect(projected(a, -60)).toHaveLength(0) // display projection hides both at Peak Min -60
  })

  it('PR05: empty frozen magnitudes → no peaks (no crash)', () => {
    const a = new TapToneAnalyzer()
    frozen(a, [], [])
    expect(() => recalc(a)).not.toThrow()
    expect(a.peaks).toHaveLength(0)
  })
})

describe('frozen-peak-recalc — loaded peaks are authoritative (PR2c) + live/material paths', () => {
  it('PR06: the loaded path returns saved peaks, does NOT re-analyse the frozen spectrum', () => {
    const a = new TapToneAnalyzer()
    frozen(a, new Array(512).fill(-100), Array.from({ length: 512 }, (_, i) => i * 47)) // flat → findPeaks would find nothing
    recalc(a, { loadedPeaks: [peak(300, -25)] })
    expect(near(a.peaks, 300, 1)).toBe(true) // survives — proves the saved peak is used, not the flat spectrum
  })

  it('PR07: both frozen peaks are in the durable set; Peak Min projects the weaker', () => {
    const a = new TapToneAnalyzer()
    const s = combine(makeSpectrum(200, -20), makeSpectrum(400, -55))
    frozen(a, s.mags, s.freqs)
    recalc(a)
    expect(near(a.peaks, 200)).toBe(true)
    expect(near(a.peaks, 400)).toBe(true) // the full set holds the -55 peak
    expect(near(projected(a, -60), 400)).toBe(true) // shown at -60
    expect(near(projected(a, -40), 200)).toBe(true) // strong shown at -40
    expect(near(projected(a, -40), 400)).toBe(false) // weak projected out at -40
  })

  it('PR12: peaks track the live spectrum while detecting (Swift analyzeMagnitudes / P1b)', () => {
    const a = new TapToneAnalyzer() // not complete, no frozen data
    a.measurementType = 'generic'
    a.startTapSequence({ arm: false }) // detecting
    const { mags, freqs } = makeSpectrum(200, -20)
    a.onFftFrame(mags, freqs)
    expect(near(a.peaks, 200)).toBe(true)
    expect(a.selectedPeakIds).toEqual(new Set(a.peaks.map((p) => p.id))) // every live peak selected (Swift)
  })

  it('PR44: a live frame during a material sequence leaves no peaks', () => {
    // Material has no live peaks, and any guitar peaks left from before are cleared. Mirrors Swift
    // PR44_materialLiveFrame_leavesNoPeaks / Python test_PR44.
    const a = new TapToneAnalyzer()
    a.measurementType = 'plate'
    a.startTapSequence({ arm: false })
    a.peaks = [peak(200, -20)] // guitar peaks left from before the switch
    const { mags, freqs } = makeSpectrum(200, -20)
    a.onFftFrame(mags, freqs)
    expect(a.peaks).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Peak-Min durability — the durable set is the FULL set; Peak Min never shrinks it, and projecting
// hands back the SAME peak objects so per-peak state (selection/overrides/offsets) survives a slider
// move. Mirrors Swift PeakMinDurabilityTests / the "never assign the durable set a filtered view" trap.
// ---------------------------------------------------------------------------
describe('frozen-peak-recalc — Peak-Min durability', () => {
  it('PR18: the durable set holds a sub-Peak-Min peak (found at the -100 floor, not at Peak Min)', () => {
    const a = new TapToneAnalyzer()
    const s = combine(makeSpectrum(200, -20), makeSpectrum(400, -80)) // -80 is below any normal Peak Min
    frozen(a, s.mags, s.freqs)
    recalc(a)
    expect(near(a.peaks, 400)).toBe(true) // kept — so lowering the slider can later reveal it
  })

  it('PR13: a peak hidden then revealed via Peak Min returns the SAME object (id/identity intact)', () => {
    const a = new TapToneAnalyzer()
    const s = combine(makeSpectrum(200, -20), makeSpectrum(400, -50))
    frozen(a, s.mags, s.freqs)
    recalc(a)
    const before = a.peaks.find((p) => Math.abs(p.frequency - 400) < 20)!
    expect(projected(a, -40).some((p) => p === before)).toBe(false) // hidden at -40
    const revealed = projected(a, -60).find((p) => Math.abs(p.frequency - 400) < 20)!
    expect(revealed).toBe(before) // SAME object reference — identity/id preserved across the slider
  })

  it('PR19: recalc does not shrink the durable set as a (former) Peak Min would rise', () => {
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
// Per-tap entries computed ONCE at build, then durable: nothing in the recalculation re-derives them.
// Mirrors Swift.
// ---------------------------------------------------------------------------
describe('frozen-peak-recalc — per-tap entries computed once', () => {
  const twoTaps = (a: TapToneAnalyzer, faintDB = -80) => {
    const s1 = combine(makeSpectrum(200, -20), makeSpectrum(400, faintDB))
    const s2 = combine(makeSpectrum(200, -22), makeSpectrum(400, faintDB - 2))
    a.recordGuitarTap({ magnitudesDb: s1.mags, frequencies: s1.freqs })
    a.recordGuitarTap({ magnitudesDb: s2.mags, frequencies: s2.freqs })
    a.processMultipleTaps()
  }

  it('PR16: processMultipleTaps finds each per-tap peak set once, at the -100 floor', () => {
    const a = new TapToneAnalyzer()
    twoTaps(a) // the 400 Hz per-tap peak is -80 dB — below any normal Peak Min
    expect(a.tapEntries).toHaveLength(2)
    expect(a.tapEntries.every((e) => near(e.peaks, 400))).toBe(true) // faint peak kept (floored at -100)
    expect(a.tapEntries.every((e) => near(e.peaks, 200))).toBe(true)
  })

  it('PR15: recalculateFrozenPeaksIfNeeded does NOT re-derive tapEntries — they are durable, not re-minted', () => {
    const a = new TapToneAnalyzer()
    twoTaps(a, -55)
    const beforeEntries = a.tapEntries
    const beforePeaks0 = a.tapEntries[0]!.peaks
    recalc(a) // a non-peakMin input change drives this — it must not touch the per-tap entries
    expect(a.tapEntries).toBe(beforeEntries) // same array reference — not rebuilt
    expect(a.tapEntries[0]!.peaks).toBe(beforePeaks0) // same peaks array — not re-found
  })

  it('PR17: loading restores the saved per-tap peaks and never re-detects', () => {
    // The saved entry carries a peak at 777 Hz, a frequency absent from its own snapshot, so
    // re-detection could not mint it — if it comes back, it was restored. tapEntries is persisted, so
    // re-deriving here would truncate the saved per-tap set permanently on the next save. Mirrors
    // Swift PR17_loadMeasurement_restoresSavedTapEntryPeaks_neverReDetects / Python test_PR17.
    const a = new TapToneAnalyzer()
    const s = makeSpectrum(200, -20)
    const snapshot = {
      frequencies: s.freqs, magnitudes: s.mags, minFreq: 0, maxFreq: 2000, minDB: -100, maxDB: 0,
      isLogarithmic: false, guitarType: 'Generic', measurementType: 'Generic Guitar',
    }
    const undetectable = { id: newId(), frequency: 777, magnitude: -30, quality: 10, bandwidth: 5, timestamp: '2026-09-25T00:00:00Z' }
    const m: TapToneMeasurementModel = {
      id: newId(),
      timestamp: '2026-09-25T00:00:00Z',
      peaks: [undetectable],
      spectrumSnapshot: snapshot,
      tapEntries: [{ id: newId(), tapIndex: 1, snapshot, peaks: [undetectable], selectedPeakIDs: [undetectable.id] }],
    }

    a.loadMeasurement(m)

    expect(a.tapEntries).toHaveLength(1) // the saved per-tap entry is restored
    expect(a.tapEntries[0]!.peaks.map((p) => p.id)).toEqual([undetectable.id]) // by identity, not re-detected
    expect(a.tapEntries[0]!.peaks.map((p) => p.frequency)).toEqual([777]) // absent from the snapshot → the saved set
  })

  it('PR38: a tap entry resolves its modes over its SELECTED peaks only', () => {
    // At capture a tap's selection is the strongest peak per mode, so resolving over all of its peaks
    // gives the same answer and no other case tells the two apart. Here the selected Top is the weaker
    // of two Top-band peaks. Mirrors Swift PR38_tapEntryResolvedModePeaks_resolvesOverSelectedPeaksOnly
    // / Python test_PR38.
    const air = peak(100, -25)
    const strongerTop = peak(200, -20)
    const selectedTop = peak(220, -30)
    const snapshot = {
      frequencies: [100, 200, 300, 400], magnitudes: [-40, -20, -50, -60], minFreq: 80, maxFreq: 1200,
      minDB: -90, maxDB: 0, isLogarithmic: false,
    }
    const entry = new TapEntry(newId(), 1, snapshot, [air, strongerTop, selectedTop], [air.id, selectedTop.id])

    const modes = entry.resolvedModePeaks('generic')

    expect(modes.get('top')?.id).toBe(selectedTop.id) // the selected Top, not the stronger unselected one
    expect(modes.get('air')?.id).toBe(air.id)
  })

  it('PR39: a live frame never overwrites a complete result', () => {
    // The durable peaks of a finished or loaded measurement are not replaced by live audio. The same
    // frame DOES set the peaks while the sequence is running, so the guard is what the first expectation
    // pins. Mirrors Swift PR39_liveFrame_neverOverwritesACompleteResult / Python test_PR39.
    const a = new TapToneAnalyzer()
    a.measurementType = 'generic'
    a.startTapSequence({ arm: false }) // running
    const result = peak(777, -30)
    a.peaks = [result]
    a.isMeasurementComplete = true
    const { mags, freqs } = makeSpectrum(200, -20)

    a.onFftFrame(mags, freqs)
    expect(a.peaks.map((p) => p.id)).toEqual([result.id]) // a complete result's peaks are not replaced

    a.isMeasurementComplete = false
    a.onFftFrame(mags, freqs)
    expect(near(a.peaks, 200)).toBe(true) // while running, the frame sets the peaks
  })

  it('PR40: a load puts the saved peaks in place', () => {
    // The durable set IS the file's peaks, by identity. Mirrors Swift PR40_loadMeasurement_setsTheSavedPeaks
    // / Python test_PR40.
    const a = new TapToneAnalyzer()
    const s = makeSpectrum(200, -20)
    const snapshot = {
      frequencies: s.freqs, magnitudes: s.mags, minFreq: 0, maxFreq: 2000, minDB: -100, maxDB: 0,
      isLogarithmic: false, guitarType: 'Generic', measurementType: 'Generic Guitar',
    }
    const saved = [peak(100, -25), peak(777, -30)]

    a.loadMeasurement({ id: newId(), timestamp: '2026-09-25T00:00:00Z', peaks: saved, spectrumSnapshot: snapshot })

    expect(a.peaks.map((p) => p.id)).toEqual(saved.map((p) => p.id)) // the saved ones, by identity
  })

  it('PR41: Re-analyze drops the loaded peaks and re-detects', () => {
    // The saved 777 Hz peak is absent from the spectrum, so it can only survive if the loaded peaks were
    // kept. Mirrors Swift PR41_reanalyze_dropsTheLoadedPeaksAndReDetects / Python test_PR41.
    const a = new TapToneAnalyzer()
    a.measurementType = 'generic'
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(a, mags, freqs)
    const saved = peak(777, -30)
    a.peaks = [saved]
    a.loadedPeaks = [saved]

    a.reanalyzePeaks()

    expect(a.loadedPeaks).toBeNull() // Re-analyze drops the loaded peaks
    expect(a.peaks.some((p) => p.id === saved.id)).toBe(false) // the saved peak is gone
    expect(near(a.peaks, 200)).toBe(true) // the spectrum's peak is re-detected
  })
})

// ---------------------------------------------------------------------------
// PR8: canReanalyze — when the Re-analyze button is offered
// ---------------------------------------------------------------------------
//
// Re-analyze is a RESET, not a dirty-flag indicator: it is offered whenever it COULD do
// something, not only when we can prove it WILL. What can leave the displayed analysis differing
// from a clean re-derivation is open-ended (peaks came from a file; mode assignments carried
// forward across Peak Min moves instead of being re-claimed; selections were hand-edited), and the
// two failure modes are not symmetric — a wrongly-DISABLED button is a
// dead end, a wrongly-ENABLED one costs a pointless click. So: any complete guitar measurement
// with a frozen spectrum; never material.
//
// This replaces `loadedPeaks == null`, a proxy for "the peaks are stale" that was wrong in both
// directions — it disabled itself after one press (the web comment even recorded the one-shot as
// intended), and never lit up for a live capture whose mode assignments had drifted.
//
// Mirrors Swift FrozenPeakRecalculation_CanReanalyzeTests / Python TestPR8CanReanalyze.
describe('frozen-peak-recalc — canReanalyze (PR8)', () => {
  it('PR33: a live (never-loaded) frozen capture can be re-analyzed', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(a, mags, freqs)
    recalc(a) // fresh capture — loadedPeaks null
    expect(a.canReanalyze).toBe(true)
  })

  it('PR34: a loaded measurement can be re-analyzed', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(a, mags, freqs)
    recalc(a, { loadedPeaks: [peak(200, -25)] })
    expect(a.canReanalyze).toBe(true)
  })

  it('PR35: it is not a one-shot — still available after the loaded peaks are dropped', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(a, mags, freqs)
    recalc(a, { loadedPeaks: [peak(200, -25)] })
    expect(a.canReanalyze).toBe(true)

    a.reanalyzePeaks() // clears the loaded peaks and re-detects
    expect(a.canReanalyze).toBe(true)
  })

  it('PR36: material can never be re-analyzed', () => {
    for (const mt of ['plate', 'brace'] as const) {
      const a = new TapToneAnalyzer()
      a.measurementType = mt
      const { mags, freqs } = makeSpectrum(200, -20)
      frozen(a, mags, freqs)                                        // even WITH a frozen spectrum…
      a.loadedPeaks = [peak(200, -20)]                              // …and loaded peaks
      expect(a.canReanalyze, `${mt} must never offer Re-analyze`).toBe(false)
    }
  })

  it('PR37: nothing to re-analyze without a completed measurement and a frozen spectrum', () => {
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
// Overrides on the analyzer (id-keyed), carried across a peak RE-MINT by applyFrozenPeakState.
// The web equivalent of Swift's overridesByFrequency snapshot + ±5 Hz remap in applyFrozenPeakState —
// the override half of the PR1/PR3–PR7 family. They live with the peaks they describe, keyed by id,
// and the remap uses ±5 Hz proximity.
// ---------------------------------------------------------------------------
describe('frozen-peak-recalc — overrides on the analyzer', () => {

  it('PR23: an override SURVIVES a re-mint that SHIFTS the id, remapped by ±5 Hz proximity', () => {
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

  it('PR25: an override is ORPHANED when no re-minted peak falls within the ±5 Hz window', () => {
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



  it('PR31: the loaded branch keeps stable ids, so overrides restored against them are NOT remapped away', () => {
    const a = new TapToneAnalyzer()
    frozen(a, [100, 200, 400], [100, 200, 400]) // non-empty frozen (guard); loaded path ignores it
    a.restoreOverrides(new Map<string, string>([['0', 'Air'], ['1', 'Top']])) // keyed to the loaded peaks' ids
    recalc(a, { loadedPeaks: [peak(200, -25, '0'), peak(400, -30, '1')] }) // ids '0','1' — stable, no re-mint
    expect(a.overrides.get('0')).toBe('Air')
    expect(a.overrides.get('1')).toBe('Top')
  })
})

// ---------------------------------------------------------------------------
// Annotation offsets on the analyzer (id-keyed), carried across a re-mint by applyFrozenPeakState.
// One store for guitar AND material, matching Swift `peakAnnotationOffsets` / Python
// `peak_annotation_offsets` (both id/UUID-keyed, material peaks included). The offset half of the remap.
// ---------------------------------------------------------------------------
describe('frozen-peak-recalc — annotation offsets on the analyzer', () => {

  it('PR20: an offset SURVIVES a re-mint that SHIFTS the id, remapped by ±5 Hz proximity', () => {
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



  it('PR32: a captured MATERIAL peak gets a stored id, and its offset lives in the same store (brace)', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'brace'
    a.numberOfTaps = 1
    a.startTapSequence({ arm: false }) // no device needed — arm/session calls are optional-chained
    const s = makeSpectrum(300, -30) // brace search band is 100–1200 Hz
    a.recordMaterialTap({ magnitudesDb: s.mags, frequencies: s.freqs })
    const lp = a.selectedLongitudinalPeak
    expect(lp).not.toBeNull()
    expect(lp!.id).toMatch(/^[0-9A-F-]{36}$/) // a UUID, as Swift's material ResonantPeak.id is
    a.updateAnnotationOffset(lp!.id, [305, -25])
    expect(a.annotationOffsets.get(lp!.id)).toEqual([305, -25])
    a.resetMaterial() // a material reset drops the dragged labels too
    expect(a.annotationOffsets.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// A material measurement's peaks are its identified L/C/FLC, and nothing else. Twins of Swift
// FrozenPeakRecalculation_MaterialPeakIdentity PR42/PR43/PR45 and Python TestMaterialPeakIdentity.
// ---------------------------------------------------------------------------
describe('frozen-peak-recalc — material peaks are the identified L/C/FLC', () => {
  /** Capture one material phase through the real gated path (a synthetic tap at `hz`). */
  function captureLongitudinal(a: TapToneAnalyzer, hz = 300): ResonantPeak | null {
    a.numberOfTaps = 1
    a.startTapSequence({ arm: false })
    const s = makeSpectrum(hz, -30, 5, 16384) // ~1.5 Hz bins: the plate fL band (20–100 Hz) needs ±5 bins
    a.recordMaterialTap({ magnitudesDb: s.mags, frequencies: s.freqs })
    return a.selectedLongitudinalPeak
  }
  /** What the save writes: the analyzer builds the measurement from its own state. */
  function save(a: TapToneAnalyzer) {
    const m = a.buildMeasurement('', '', { minHz: 100, maxHz: 1200, minDb: -100, maxDb: 0 })
    if (!m) throw new Error('no measurement to save')
    return m
  }

  it('PR42: saving a material measurement writes its identified peaks, all selected', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'brace'
    const fL = captureLongitudinal(a)
    expect(fL, 'precondition: the brace capture identifies fL').not.toBeNull()

    const saved = save(a)

    expect(saved.peaks.map((p) => p.id)).toEqual([fL!.id]) // the file's peaks are the identified fL
    expect(saved.selectedPeakIDs).toEqual([fL!.id]) // and it is marked selected
  })

  it('PR43: loading a material measurement restores the identified peaks only', () => {
    // A plate (fL + fC), so each role is restored separately.
    const source = new TapToneAnalyzer()
    source.measurementType = 'plate'
    source.measureFlc = false
    const fL = captureLongitudinal(source, 60)
    expect(fL, 'precondition: the plate capture identifies fL').not.toBeNull()
    source.acceptMaterial()
    const c = makeSpectrum(150, -30, 5, 16384)
    source.recordMaterialTap({ magnitudesDb: c.mags, frequencies: c.freqs })
    const fC = source.selectedCrossPeak
    expect(fC, 'precondition: the plate capture identifies fC').not.toBeNull()
    source.acceptMaterial() // no FLC: the measurement completes, as it must before a save
    expect(source.isMeasurementComplete, 'precondition: the plate is complete').toBe(true)
    const saved = save(source)

    const a = new TapToneAnalyzer()
    a.measurementType = 'plate'
    a.loadMeasurement(saved)

    expect(a.selectedLongitudinalPeak?.id).toBe(fL!.id) // fL restored by id from the file
    expect(a.selectedCrossPeak?.id).toBe(fC!.id) // fC restored by id from the file
    expect(a.peaks).toEqual([]) // the guitar peak set stays empty for material
    expect(a.selectedPeakIds.size).toBe(0) // and so does the guitar selection
  })

  it('PR45: Redo clears the redone phase’s identified peak and spectrum', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'plate'
    expect(captureLongitudinal(a, 60), 'precondition: the plate L capture identifies fL').not.toBeNull()
    expect(a.materialTapPhase, 'precondition: live capture stops at review').toBe('reviewingL')

    a.redoMaterial()

    expect(a.selectedLongitudinalPeak).toBeNull() // the rejected fL is gone
    expect(a.matSpectra.longitudinal).toBeNull() // and so is its spectrum
    expect(a.materialIdentifiedPeaks).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Selection on the analyzer, CONCRETE state (full-Swift paradigm), recomputed on each re-mint by
// applyFrozenPeakState: UNMODIFIED → re-auto; MODIFIED → carry forward by ±5 Hz, keeping below-tolerance
// frequencies in the stable cache (selectedPeakFrequencies) so they re-select when the peak reappears.
// Mirrors Swift applyFrozenPeakState's selection branches + selectedPeakFrequencies. PR1/PR3–PR7 family.
// Note (Swift parity): a manual toggle does NOT sync the cache, so the carry-forward tests seed a synced
// cache via restoreSelection — the realistic loaded-manual path where the carry actually matters.
// ---------------------------------------------------------------------------
describe('frozen-peak-recalc — selection on the analyzer', () => {
  it('PR28: an UNMODIFIED selection re-runs auto over the durable set on each re-mint', () => {
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


  it('PR26: a MANUAL selection (synced cache) carries across a re-mint that shifts the id, by ±5 Hz', () => {
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

  it('PR27: a selected peak that vanishes is kept in the frequency cache and RE-SELECTS when it returns', () => {
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


})

// ---------------------------------------------------------------------------
// Behaviours the web could not express until Peak Min moved onto the analyzer.
//
// PR08 / PR09 / PR14 were recorded as web-only absences on the grounds that "Peak Min is a display
// selector in App, so there is no analyzer state a test could construct". That was true, and it was
// the architecture problem rather than a reason: the rule "Peak Min is guitar-only; material is
// never filtered" is a fact about the measurement, and it was living in a view useMemo (and in a
// third copy inside this file). With `peakMinThreshold` / `peaksAbovePeakMin` /
// `refreshDisplayedPeaks()` on the analyzer — mirroring Swift and Python — they are ordinary twins.
// ---------------------------------------------------------------------------
describe('frozen-peak-recalc — Peak Min is analyzer state (PR08/PR09/PR14)', () => {
  it('PR08: all peaks below Peak Min empties the DISPLAY, keeping the durable set and classification', () => {
    const a = new TapToneAnalyzer()
    const s = combine(makeSpectrum(200, -60), makeSpectrum(400, -70))
    frozen(a, s.mags, s.freqs)
    recalc(a)
    const durable = a.peaks.length
    const classified = a.modeByPeak.size
    expect(durable).toBeGreaterThan(0)

    a.setPeakMinThreshold(-10) // above every peak

    expect(a.peaksAbovePeakMin).toHaveLength(0) // the projection is what empties
    expect(a.peaks).toHaveLength(durable) // a display filter must never shrink the durable set
    expect(a.modeByPeak.size).toBe(classified) // classification describes the measurement, not the screen
  })

  it('PR09: a MATERIAL measurement is never filtered by Peak Min — its peaks ARE the result', () => {
    for (const type of ['plate', 'brace'] as const) {
      const a = new TapToneAnalyzer()
      a.measurementType = type
      // The identified L/C/FLC peaks, below any sane guitar Peak Min (the 2026-07-21 regression:
      // a loaded plate whose fL sat at -62.41 dB with Peak Min -60 lost it from table AND chart).
      a.peaks = [peak(66.88, -62.41), peak(116.75, -57.62)]
      a.setPeakMinThreshold(-60) // would drop fL if the guitar filter applied

      const freqs = a.peaksAbovePeakMin.map((p) => p.frequency)
      expect(freqs).toContain(66.88) // Peak Min is a GUITAR control
      expect(freqs).toContain(116.75)
    }
  })

  it('PR13/PR21/PR24: a Peak Min sweep preserves identity, selection, override AND dragged offset', () => {
    // All four hold across the sweep, as Swift and Python assert: Peak Min re-projects and does
    // nothing else.
    const a = new TapToneAnalyzer()
    const s = combine(makeSpectrum(200, -20), makeSpectrum(400, -50)) // 400 is the one we hide
    frozen(a, s.mags, s.freqs)
    recalc(a)
    a.setPeakMinThreshold(-60) // both displayed
    const quiet = a.peaks.find((p) => Math.abs(p.frequency - 400) < 20)!

    a.selectedPeakIds = new Set([quiet.id])
    a.setModeOverride(quiet.id, 'Wolf note')
    a.updateAnnotationOffset(quiet.id, [12, 34])

    a.setPeakMinThreshold(-40) // hidden from the DISPLAY only
    expect(a.peaksAbovePeakMin.some((p) => p.id === quiet.id)).toBe(false)
    expect(a.peaks.some((p) => p.id === quiet.id)).toBe(true) // hidden, not destroyed

    a.setPeakMinThreshold(-60) // revealed again

    expect(a.peaksAbovePeakMin.find((p) => p.id === quiet.id)).toBe(quiet) // the SAME object
    expect(a.selectedPeakIds.has(quiet.id)).toBe(true)
    expect(a.overrides.get(quiet.id)).toBe('Wolf note')
    expect(a.annotationOffsets.get(quiet.id)).toEqual([12, 34])
  })

  it('PR14: a DESELECTED peak does not re-select on a Peak Min sweep', () => {
    const a = new TapToneAnalyzer()
    const s = combine(makeSpectrum(200, -20), makeSpectrum(400, -25))
    frozen(a, s.mags, s.freqs)
    recalc(a)
    const kept = a.peaks.find((p) => Math.abs(p.frequency - 200) < 20)!
    const dropped = a.peaks.find((p) => Math.abs(p.frequency - 400) < 20)!
    a.selectedPeakIds = new Set([kept.id, dropped.id])

    a.togglePeakSelection(dropped.id) // a deselection is a user decision too
    expect(a.selectedPeakIds.has(dropped.id)).toBe(false)

    a.setPeakMinThreshold(-10) // hide everything…
    a.setPeakMinThreshold(-60) // …and bring it back

    expect(a.selectedPeakIds.has(dropped.id)).toBe(false) // must NOT resurrect
    expect(a.selectedPeakIds.has(kept.id)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Carry-forward edge cases (PR22 / PR29 / PR30) — the negative halves of the override, offset and
// selection carry-forward.
// ---------------------------------------------------------------------------
describe('frozen-peak-recalc — carry-forward edge cases (PR22/PR29/PR30)', () => {
  it('PR22: an offset is DROPPED when no re-minted peak falls within ±5 Hz', () => {
    const a = new TapToneAnalyzer()
    const start = makeSpectrum(200, -20)
    frozen(a, start.mags, start.freqs)
    recalc(a)
    const before = a.peaks.find((p) => Math.abs(p.frequency - 200) < 20)!
    a.updateAnnotationOffset(before.id, [12, -8])

    const moved = makeSpectrum(300, -20) // far outside the tolerance
    frozen(a, moved.mags, moved.freqs)
    recalc(a)

    expect(a.peaks.some((p) => Math.abs(p.frequency - 300) < 20)).toBe(true) // precondition
    // Negative-only assertions pass vacuously on an empty map, so assert the VALUE is gone entirely —
    // not merely absent from the new id, which a leak under the stale id would satisfy.
    expect([...a.annotationOffsets.values()]).toEqual([])
  })

  it('PR29: an empty detection PRESERVES the selection, so lowering the threshold restores it', () => {
    const a = new TapToneAnalyzer()
    const s = makeSpectrum(200, -20)
    frozen(a, s.mags, s.freqs)
    recalc(a)
    const chosen = a.peaks.find((p) => Math.abs(p.frequency - 200) < 20)!
    a.selectedPeakIds = new Set([chosen.id])
    a.userModifiedSelection = true
    const before = new Set(a.selectedPeakIds)

    frozen(a, new Array(s.mags.length).fill(-100), s.freqs) // nothing to detect
    recalc(a)

    expect(a.peaks).toHaveLength(0) // precondition: detection found nothing
    expect(a.selectedPeakIds).toEqual(before) // the selection is not the detector's to erase
  })

  it('PR30: remapping with no prior overrides yields no overrides', () => {
    const a = new TapToneAnalyzer()
    const two = combine(makeSpectrum(200, -20), makeSpectrum(400, -30))
    frozen(a, two.mags, two.freqs)
    recalc(a)
    expect(a.overrides.size).toBe(0)

    const three = combine(two, makeSpectrum(300, -25)) // re-mint: ids shift
    frozen(a, three.mags, three.freqs)
    recalc(a)

    expect(a.overrides.size).toBe(0) // no overrides in, none out — and none invented
  })
})

// ---------------------------------------------------------------------------
// PR10 / PR11 — the loading guard. Previously recorded as web "n/a — the view drives the load, so
// there is no state to construct". The reason was accurate and the conclusion was wrong: the
// restore WAS five analyzer calls sequenced by App.tsx, with the peaks in React state and the
// spectrum on the analyzer, so the two stayed in step only because React batched the handler.
// `loadMeasurement` now applies the whole measurement as one step under `isLoadingMeasurement`,
// and these are ordinary twins of Swift's and Python's.
// ---------------------------------------------------------------------------
describe('frozen-peak-recalc — the loading guard (PR10/PR11)', () => {
  it('PR10: while isLoadingMeasurement is set, recalculateFrozenPeaksIfNeeded is a no-op', () => {
    const a = new TapToneAnalyzer()
    const s = makeSpectrum(200, -20)
    frozen(a, s.mags, s.freqs)
    a.loadedPeaks = [peak(300, -25)]
    a.peaks = []

    a.isLoadingMeasurement = true
    recalc(a)

    expect(a.peaks).toEqual([]) // must not adopt the loaded peaks, or re-detect the spectrum
  })

  it('PR11: clearing it lets the next recalculation through — the guard suppresses, never disables', () => {
    const a = new TapToneAnalyzer()
    const s = makeSpectrum(200, -20)
    frozen(a, s.mags, s.freqs)
    const saved = peak(300, -25)
    a.loadedPeaks = [saved]
    a.peaks = []

    a.isLoadingMeasurement = true
    recalc(a)
    expect(a.peaks).toEqual([]) // precondition: suppressed

    a.isLoadingMeasurement = false
    recalc(a)

    expect(a.peaks.map((p) => p.frequency)).toEqual([300]) // the saved peaks are adopted
  })

  it('PR10/PR11: loadMeasurement is ATOMIC — a recalc mid-load cannot clobber the restored state', () => {
    // The failure the guard exists for, driven end to end. The loaded spectrum has a real peak at
    // 200 Hz, so if a recalc runs while the measurement is half-applied it takes the live branch,
    // re-detects, mints fresh ids, and applyFrozenPeakState drops the override/offset/selection
    // keyed to the SAVED ids. After loadMeasurement returns, all of it must still be there.
    const a = new TapToneAnalyzer()
    const s = makeSpectrum(200, -20)
    const saved = peak(777, -30) // a frequency absent from the spectrum: only a restore can produce it
    a.restoreSnapshot({
      magnitudes: s.mags,
      frequencies: s.freqs,
      loadedPeaks: [saved],
      overrides: new Map<string, string>([[saved.id, 'Wolf note']]),
      annotationOffsets: new Map<string, [number, number]>([[saved.id, [12, -8]]]),
      selection: { ids: new Set([saved.id]), frequencies: [saved.frequency], userModified: true },
    })

    expect(a.isLoadingMeasurement).toBe(false) // cleared by the time it returns
    expect(a.loadedPeaks?.map((p) => p.frequency)).toEqual([777])
    expect(a.frozenMagnitudes.length).toBeGreaterThan(0) // peaks and spectrum landed together

    recalc(a) // the effect's first run, after the load

    expect(a.peaks.map((p) => p.frequency)).toEqual([777]) // saved peaks used, spectrum NOT re-detected
    expect(a.overrides.get(saved.id)).toBe('Wolf note')
    expect(a.annotationOffsets.get(saved.id)).toEqual([12, -8])
    expect(a.selectedPeakIds.has(saved.id)).toBe(true)
  })
})
