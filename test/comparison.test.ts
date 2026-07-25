// @parity test/comparison
import { describe, it, expect } from 'vitest'
import {
  buildGuitarMeasurement,
  buildComparisonEntries,
  buildComparisonMeasurement,
  comparisonEntryModeFreqs,
} from '../src/measurement/fromLive'
import { serializeGuitarTapFile, parseGuitarTapFile, isComparison, type ComparisonEntryModel } from '../src/measurement'
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
    overridesById: new Map<number, string>(),
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

// ---------------------------------------------------------------------------
// modePeakIDs (Phase 6b) — a comparison stores each entry's DEFINITIVE Air/Top/Back as {mode name → peak
// id}, resolved OVERRIDE-AWARE from the source, so the file is self-describing: the reader reproduces the
// table by id lookup, never re-classifying. Legacy comparisons (no map) heal positionally on decode.
// ---------------------------------------------------------------------------
describe('comparison modePeakIDs — self-describing definitive modes', () => {
  // A source whose Top is a manual override of an out-of-band (Dipole) peak.
  const srcOverride = buildGuitarMeasurement({
    name: 'Ov', notes: '',
    spectrum: { frequencies: [90, 380], magnitudesDb: [-20, -20] },
    peaks: [
      { id: 1, frequency: 90, magnitude: -20, quality: 10, bandwidth: 5 },
      { id: 2, frequency: 380, magnitude: -20, quality: 10, bandwidth: 5 },
    ],
    modeByPeak: new Map<number, ResolvedMode>([[1, 'air'], [2, 'dipole']]),
    selectedIds: new Set<number>([1, 2]),
    overridesById: new Map<number, string>([[2, 'Top']]), // assign the Dipole peak to Top
    view: { minHz: 75, maxHz: 350, minDb: -100, maxDb: 0 },
    settings: { ...DEFAULT_SETTINGS, measurementType: 'classical' as const },
    numberOfTaps: 1, sampleRate: 48000, deviceLabel: 'Mic',
  })

  it("uses the source's OVERRIDDEN Top, not the auto classification", () => {
    const [entry] = buildComparisonEntries([srcOverride])
    const f = comparisonEntryModeFreqs(entry!)
    expect(f.top).toBe(380) // the overridden Dipole-band peak — positional would find no Top at all
    expect(f.air).toBe(90)
  })

  it('trusts the stored map even when it DISAGREES with classifyAll (reader must not re-classify)', () => {
    // 380 Hz classifies to Dipole, never Top — but the stored map pins it as Top.
    const entry: ComparisonEntryModel = {
      id: 'e', label: 'x', colorComponents: [0, 0, 1, 1],
      snapshot: { frequencies: [], magnitudes: [], minFreq: 0, maxFreq: 500, minDB: -100, maxDB: 0, isLogarithmic: false, guitarType: 'Classical' },
      peaks: [{ id: 'p', frequency: 380, magnitude: -20, quality: 10, bandwidth: 5, timestamp: 't' }],
      guitarType: 'Classical',
      modePeakIDs: { Top: 'p' },
    }
    expect(comparisonEntryModeFreqs(entry).top).toBe(380)
  })

  it('modePeakIDs round-trips through the .guitartap format', () => {
    const entries = buildComparisonEntries([srcOverride])
    const topId = entries[0]!.modePeakIDs!.Top
    expect(topId).toBeDefined()
    const m = buildComparisonMeasurement({ name: 'C', notes: '', entries })
    const back = parseGuitarTapFile(serializeGuitarTapFile([m]))[0]!
    expect(back.comparisonEntries![0]!.modePeakIDs!.Top).toBe(topId)
    expect(comparisonEntryModeFreqs(back.comparisonEntries![0]!).top).toBe(380)
  })

  it('a legacy comparison (no modePeakIDs) heals positionally on decode + flags re-save', () => {
    const m = buildComparisonMeasurement({ name: 'Legacy', notes: '', entries: buildComparisonEntries([src('A')]) })
    const json = JSON.parse(serializeGuitarTapFile([m]))
    for (const e of json[0].comparisonEntries) delete e.modePeakIDs // simulate a pre-6b file
    const back = parseGuitarTapFile(JSON.stringify(json))[0]!
    expect(back.comparisonEntries![0]!.modePeakIDs).toBeDefined() // filled positionally
    expect((back as { wasHealed?: boolean }).wasHealed).toBe(true)
  })
})