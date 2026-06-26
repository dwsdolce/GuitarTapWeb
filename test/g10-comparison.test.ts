import { describe, it, expect } from 'vitest'
import {
  buildGuitarMeasurement,
  buildComparisonEntries,
  buildComparisonMeasurement,
  comparisonEntryModeFreqs,
} from '../src/measurement/fromLive'
import { serializeGuitarTapFile, parseGuitarTapFile, isComparison } from '../src/measurement'
import { DEFAULT_SETTINGS } from '../src/settings'
import type { Peak } from '../src/dsp/peaks'
import type { ResolvedMode } from '../src/dsp/classify'

// Phase 4d: a comparison measurement overlays several measurements. Building it from a
// selection assigns palette colors + disambiguated labels and keeps each source's selected
// peaks; it round-trips through the .guitartap format as a `comparisonEntries` record.

const spectrum = { frequencies: [100, 200, 300], magnitudesDb: [-50, -40, -60] }
const peaks: Peak[] = [
  { id: 1, frequency: 100, magnitude: -50, quality: 10, bandwidth: 10 },
  { id: 2, frequency: 200, magnitude: -40, quality: 20, bandwidth: 10 },
]
const modeByPeak = new Map<number, ResolvedMode>([
  [1, 'air'],
  [2, 'top'],
])

const src = (name: string) =>
  buildGuitarMeasurement({
    name,
    notes: '',
    spectrum,
    peaks,
    modeByPeak,
    selectedIds: new Set<number>([1, 2]),
    overridesByFreq: new Map<string, string>(),
    view: { minHz: 75, maxHz: 350, minDb: -100, maxDb: 0 },
    settings: { ...DEFAULT_SETTINGS, measurementType: 'classical' as const },
    numberOfTaps: 1,
    sampleRate: 48000,
    deviceLabel: 'Mic',
  })

describe('buildComparisonEntries — from a selection', () => {
  const entries = buildComparisonEntries([src('Top'), src('Top')])

  it('makes one entry per source with disambiguated labels and palette colors', () => {
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.label)).toEqual(['Top (1)', 'Top (2)'])
    // Distinct palette colors (blue, orange) as [r,g,b,a] 0–1.
    expect(entries[0]!.colorComponents).not.toEqual(entries[1]!.colorComponents)
    expect(entries[0]!.colorComponents).toHaveLength(4)
    expect(entries[0]!.snapshot.frequencies).toEqual([100, 200, 300])
  })

  it('resolves Air/Top/Back frequencies for the results table', () => {
    const f = comparisonEntryModeFreqs(entries[0]!)
    expect(f.air).toBe(100)
    expect(f.top).toBe(200)
    expect(f.back).toBeNull()
  })
})

describe('comparison measurement round-trip', () => {
  it('saves as a comparison record and survives the .guitartap round-trip', () => {
    const entries = buildComparisonEntries([src('A'), src('B')])
    const m = buildComparisonMeasurement({ name: 'A vs B', notes: 'test', entries })
    expect(isComparison(m)).toBe(true)
    expect(m.peaks).toEqual([])

    const back = parseGuitarTapFile(serializeGuitarTapFile([m]))[0]!
    expect(isComparison(back)).toBe(true)
    expect(back.measurementName).toBe('A vs B')
    expect(back.comparisonEntries).toHaveLength(2)
    expect(back.comparisonEntries!.map((e) => e.label)).toEqual(['A', 'B'])
    expect(back.comparisonEntries![0]!.colorComponents).toEqual(entries[0]!.colorComponents)
    expect(back.comparisonEntries![0]!.snapshot.frequencies).toEqual([100, 200, 300])
  })
})