import { describe, it, expect } from 'vitest'
import { measurementToLive, multiTapComparisonEntries, colorComponentsToCss } from '../src/measurement/fromLive'
import { multiTapPdfData } from '../src/presentation/measurementImage'
import { serializeGuitarTapFile, parseGuitarTapFile } from '../src/measurement'
import { DEFAULT_SETTINGS } from '../src/settings'
import { TapEntry, type SpectrumSnapshotModel, type ResonantPeak } from '../src/measurement/types'
import { newId } from '../src/measurement/newId'
import { saveGuitar } from './saveFromAnalyzer'

// A multi-tap guitar measurement records each tap as a tapEntry — its snapshot, peaks and auto-selected
// peak ids (mirrors Swift). The analyzer builds them at capture; they are saved as they are and must
// survive the .guitartap round-trip so the comparison view returns on load.

const spectrum = { frequencies: [100, 200, 300], magnitudesDb: [-50, -40, -60] }
const tap1 = { frequencies: [100, 200, 300], magnitudesDb: [-48, -38, -62] }
const tap2 = { frequencies: [100, 200, 300], magnitudesDb: [-52, -42, -58] }
const peaks: ResonantPeak[] = [{ id: '1', frequency: 200, magnitude: -40, quality: 20, bandwidth: 10, timestamp: '2026-09-25T00:00:00Z' }]
const snap = (sp: { frequencies: number[]; magnitudesDb: number[] }): SpectrumSnapshotModel => ({
  frequencies: sp.frequencies, magnitudes: sp.magnitudesDb, minFreq: 75, maxFreq: 350, minDB: -100, maxDB: 0,
  isLogarithmic: false, guitarType: 'Generic', measurementType: 'Generic Guitar',
})
const peaks1: ResonantPeak[] = [{ id: newId(), frequency: 200, magnitude: -38, quality: 20, bandwidth: 10, timestamp: '2026-09-25T00:00:00Z' }]
const peaks2: ResonantPeak[] = [{ id: newId(), frequency: 200, magnitude: -42, quality: 20, bandwidth: 10, timestamp: '2026-09-25T00:00:00Z' }]
const entry1 = new TapEntry(newId(), 1, snap(tap1), peaks1, [peaks1[0]!.id])
const entry2 = new TapEntry(newId(), 2, snap(tap2), peaks2, [peaks2[0]!.id])

const args = {
  name: 'Multi', notes: '',
  spectrum, peaks,
  selectedIds: new Set<string>(['1']),
  overridesById: new Map<string, string>(),
  view: { minHz: 75, maxHz: 350, minDb: -100, maxDb: 0 },
  settings: { ...DEFAULT_SETTINGS, measurementType: 'generic' as const },
  numberOfTaps: 2,
  tapEntries: [entry1, entry2],
  sampleRate: 48000,
  deviceLabel: 'Mic',
}

describe('buildGuitarMeasurement — multi-tap entries', () => {
  it('writes one tapEntry per tap with its own snapshot', () => {
    const m = saveGuitar(args)
    expect(m.numberOfTaps).toBe(2)
    expect(m.tapEntries).toHaveLength(2)
    expect(m.tapEntries!.map((e) => e.tapIndex)).toEqual([1, 2])
    expect(m.tapEntries![0]!.snapshot.magnitudes).toEqual(tap1.magnitudesDb)
    expect(m.tapEntries![1]!.snapshot.magnitudes).toEqual(tap2.magnitudesDb)
  })

  it('saves each entry as it is — id, peaks and selected peak ids', () => {
    const m = saveGuitar(args)
    expect(m.tapEntries!.map((e) => e.id)).toEqual([entry1.id, entry2.id])
    expect(m.tapEntries!.map((e) => e.peaks.map((p) => p.id))).toEqual([[peaks1[0]!.id], [peaks2[0]!.id]])
    expect(m.tapEntries!.map((e) => e.selectedPeakIDs)).toEqual([entry1.selectedPeakIDs, entry2.selectedPeakIDs])
  })

  it('omits tapEntries for a single-tap capture', () => {
    const m = saveGuitar({ ...args, numberOfTaps: 1, tapEntries: [entry1] })
    expect(m.tapEntries).toBeUndefined()
  })

  it('survives the .guitartap round-trip', () => {
    const m = parseGuitarTapFile(serializeGuitarTapFile([saveGuitar(args)]))[0]!
    expect(m.tapEntries).toHaveLength(2)
    expect(m.tapEntries![0]!.snapshot.frequencies).toEqual([100, 200, 300])
    expect(m.tapEntries![1]!.snapshot.magnitudes).toEqual(tap2.magnitudesDb)
  })

  it('restores each entry as saved on load', () => {
    const m = parseGuitarTapFile(serializeGuitarTapFile([saveGuitar(args)]))[0]!
    const restored = measurementToLive(m).tapEntries
    expect(restored.map((e) => e.id)).toEqual([entry1.id, entry2.id])
    expect(restored.map((e) => e.selectedPeakIDs)).toEqual([entry1.selectedPeakIDs, entry2.selectedPeakIDs])
    expect(restored[0]!.resolvedModePeaks().get('top')?.frequency).toBe(200)
  })
})

// 6e: a multi-tap guitar measurement exports a TWO-page PDF — page 1 the averaged single-measurement
// report, page 2 the per-tap comparison (each "Tap N" plus a trailing "Averaged"), mirroring Swift
// generateMultiTapReport / exportMultiTapPDFReport.
describe('multiTapComparisonEntries — per-tap + averaged (6e)', () => {
  const entries = multiTapComparisonEntries(saveGuitar(args))

  it('is one entry per tap plus a trailing Averaged entry', () => {
    expect(entries.map((e) => e.label)).toEqual(['Tap 1', 'Tap 2', 'Averaged'])
  })

  it('stores each tap its series slot\'s light colour, and the average the average\'s', () => {
    expect(colorComponentsToCss(entries[0]!.colorComponents)).toBe('rgba(0, 122, 255, 1)') // series.1 #007AFF
    expect(colorComponentsToCss(entries[1]!.colorComponents)).toBe('rgba(224, 120, 0, 1)') // series.2 #E07800
    expect(colorComponentsToCss(entries[2]!.colorComponents)).toBe('rgba(235, 195, 0, 1)') // series.average #EBC300
  })

  it('the Averaged entry keeps the measurement’s selected peaks', () => {
    expect(entries[2]!.peaks.map((p) => p.frequency)).toContain(200)
  })
})

describe('multiTapPdfData — two-page report data (6e)', () => {
  const { averaged, comparison } = multiTapPdfData(saveGuitar(args))

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