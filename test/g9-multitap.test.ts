import { describe, it, expect } from 'vitest'
import { buildGuitarMeasurement, multiTapComparisonEntries, colorComponentsToCss } from '../src/measurement/fromLive'
import { multiTapPdfData } from '../src/presentation/measurementImage'
import { serializeGuitarTapFile, parseGuitarTapFile } from '../src/measurement'
import { DEFAULT_SETTINGS } from '../src/settings'
import type { Peak } from '../src/dsp/peaks'

// Phase 4d: a multi-tap guitar measurement records each tap's spectrum as a tapEntry
// (mirrors Swift). The web builds them from the per-tap spectra surfaced by the engine,
// and they must survive the .guitartap round-trip so the comparison view returns on load.

const spectrum = { frequencies: [100, 200, 300], magnitudesDb: [-50, -40, -60] }
const tap1 = { frequencies: [100, 200, 300], magnitudesDb: [-48, -38, -62] }
const tap2 = { frequencies: [100, 200, 300], magnitudesDb: [-52, -42, -58] }
const peaks: Peak[] = [{ id: 1, frequency: 200, magnitude: -40, quality: 20, bandwidth: 10 }]
// Per-tap entries now carry their own peaks (found by the analyzer), mirroring Swift tapEntries.
const peaks1: Peak[] = [{ id: 1, frequency: 200, magnitude: -38, quality: 20, bandwidth: 10 }]
const peaks2: Peak[] = [{ id: 2, frequency: 200, magnitude: -42, quality: 20, bandwidth: 10 }]
const entry1 = { tapIndex: 1, spectrum: tap1, peaks: peaks1 }
const entry2 = { tapIndex: 2, spectrum: tap2, peaks: peaks2 }

const args = {
  name: 'Multi', notes: '',
  spectrum, peaks,
  modeByPeak: new Map<number, 'air' | 'top' | 'back' | 'unknown'>([[1, 'top']]),
  selectedIds: new Set<number>([1]),
  overridesByFreq: new Map<string, string>(),
  view: { minHz: 75, maxHz: 350, minDb: -100, maxDb: 0 },
  settings: { ...DEFAULT_SETTINGS, measurementType: 'generic' as const },
  numberOfTaps: 2,
  tapEntries: [entry1, entry2],
  sampleRate: 48000,
  deviceLabel: 'Mic',
}

describe('buildGuitarMeasurement — multi-tap entries', () => {
  it('writes one tapEntry per tap with its own snapshot', () => {
    const m = buildGuitarMeasurement(args)
    expect(m.numberOfTaps).toBe(2)
    expect(m.tapEntries).toHaveLength(2)
    expect(m.tapEntries!.map((e) => e.tapIndex)).toEqual([1, 2])
    expect(m.tapEntries![0]!.snapshot.magnitudes).toEqual(tap1.magnitudesDb)
    expect(m.tapEntries![1]!.snapshot.magnitudes).toEqual(tap2.magnitudesDb)
  })

  it('omits tapEntries for a single-tap capture', () => {
    const m = buildGuitarMeasurement({ ...args, numberOfTaps: 1, tapEntries: [entry1] })
    expect(m.tapEntries).toBeUndefined()
  })

  it('survives the .guitartap round-trip', () => {
    const m = parseGuitarTapFile(serializeGuitarTapFile([buildGuitarMeasurement(args)]))[0]!
    expect(m.tapEntries).toHaveLength(2)
    expect(m.tapEntries![0]!.snapshot.frequencies).toEqual([100, 200, 300])
    expect(m.tapEntries![1]!.snapshot.magnitudes).toEqual(tap2.magnitudesDb)
  })
})

// 6e: a multi-tap guitar measurement exports a TWO-page PDF — page 1 the averaged single-measurement
// report, page 2 the per-tap comparison (each "Tap N" plus a trailing "Averaged"), mirroring Swift
// generateMultiTapReport / exportMultiTapPDFReport.
describe('multiTapComparisonEntries — per-tap + averaged (6e)', () => {
  const entries = multiTapComparisonEntries(buildGuitarMeasurement(args))

  it('is one entry per tap plus a trailing Averaged entry', () => {
    expect(entries.map((e) => e.label)).toEqual(['Tap 1', 'Tap 2', 'Averaged'])
  })

  it('cycles the comparison palette for taps and uses the avg color for Averaged', () => {
    expect(colorComponentsToCss(entries[0]!.colorComponents)).toBe('rgba(10, 132, 255, 1)') // #0a84ff
    expect(colorComponentsToCss(entries[1]!.colorComponents)).toBe('rgba(255, 159, 10, 1)') // #ff9f0a
    expect(colorComponentsToCss(entries[2]!.colorComponents)).toBe('rgba(255, 217, 0, 1)') // #ffd900 (avg)
  })

  it('the Averaged entry keeps the measurement’s selected peaks', () => {
    expect(entries[2]!.peaks.map((p) => p.frequency)).toContain(200)
  })
})

describe('multiTapPdfData — two-page report data (6e)', () => {
  const { averaged, comparison } = multiTapPdfData(buildGuitarMeasurement(args))

  it('page 1 is the averaged guitar report (peaks + analysis)', () => {
    expect(averaged.kind).toBe('guitar')
    expect(averaged.guitarAnalysis).toBeDefined()
    expect(averaged.peaks.length).toBeGreaterThan(0)
  })

  it('page 2 is a comparison of the N taps + Averaged', () => {
    expect(comparison.kind).toBe('comparison')
    expect(comparison.comparison!.spectraCount).toBe(3)
    expect(comparison.comparison!.rows.map((r) => r.label)).toEqual(['Tap 1', 'Tap 2', 'Averaged'])
  })
})