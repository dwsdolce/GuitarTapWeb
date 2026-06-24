import { describe, it, expect } from 'vitest'
import { buildGuitarMeasurement, measurementToLive } from '../src/measurement/fromLive'
import { serializeGuitarTapFile, parseGuitarTapFile } from '../src/measurement'
import { DEFAULT_SETTINGS } from '../src/settings'
import type { Peak } from '../src/dsp/peaks'
import type { ResolvedMode } from '../src/dsp/classify'

// Phase 4b: the live <-> persisted bridge. Build a measurement from synthetic live
// state, round-trip it through the canonical writer/reader, then restore it — the
// frozen spectrum, selection, and overrides must come back keyed correctly (by
// frequency, since numeric peak ids are regenerated on re-derivation).

const spectrum = { frequencies: [100, 200, 300], magnitudesDb: [-50, -40, -60] }
const peaks: Peak[] = [
  { id: 1, frequency: 100, magnitude: -50, quality: 10, bandwidth: 10 },
  { id: 2, frequency: 200, magnitude: -40, quality: 20, bandwidth: 10 },
]
const modeByPeak = new Map<number, ResolvedMode>([
  [1, 'air'],
  [2, 'top'],
])
const args = {
  name: 'Test Guitar',
  notes: 'hello',
  spectrum,
  peaks,
  modeByPeak,
  selectedIds: new Set<number>([2]),
  overridesByFreq: new Map<string, string>([['100.0', 'Custom']]),
  view: { minHz: 75, maxHz: 350, minDb: -100, maxDb: 0 },
  settings: { ...DEFAULT_SETTINGS, measurementType: 'classical' as const, showUnknownModes: true, peakMinThreshold: -55 },
  numberOfTaps: 3,
  sampleRate: 48000,
  deviceLabel: 'Test Mic',
}

describe('buildGuitarMeasurement — live state → model', () => {
  const m = buildGuitarMeasurement(args)

  it('mints UUID peaks and maps selection / overrides onto them', () => {
    expect(m.peaks).toHaveLength(2)
    expect(m.peaks.every((p) => /^[0-9A-F-]{36}$/.test(p.id))).toBe(true)
    const top = m.peaks.find((p) => p.frequency === 200)!
    expect(m.selectedPeakIDs).toEqual([top.id])
    expect(m.selectedPeakFrequencies).toEqual([200])
    const air = m.peaks.find((p) => p.frequency === 100)!
    expect(m.peakModeOverrides?.[air.id]).toBe('Custom') // override wins as the label
    expect(air.modeLabel).toBe('Custom')
    expect(top.modeLabel).toBe('Top')
  })

  it('captures snapshot type/provenance from the live settings', () => {
    expect(m.spectrumSnapshot?.measurementType).toBe('Classical Guitar')
    expect(m.spectrumSnapshot?.guitarType).toBe('Classical')
    expect(m.spectrumSnapshot?.showUnknownModes).toBe(true)
    expect(m.measurementName).toBe('Test Guitar')
    expect(m.notes).toBe('hello')
    expect(m.numberOfTaps).toBe(3)
    expect(m.peakMinThreshold).toBe(-55)
    expect(m.sampleRate).toBe(48000)
    expect(m.microphoneName).toBe('Test Mic')
  })
})

describe('round-trip through file → restore into the view', () => {
  it('restores spectrum, ranges, selection (by freq), and settings', () => {
    const m = buildGuitarMeasurement(args)
    const m2 = parseGuitarTapFile(serializeGuitarTapFile([m]))[0]!
    const live = measurementToLive(m2)

    expect(live.captured.frequencies).toEqual([100, 200, 300])
    expect(live.captured.magnitudesDb).toEqual([-50, -40, -60])
    expect(live.view).toEqual({ minHz: 75, maxHz: 350, minDb: -100, maxDb: 0 })
    expect(live.measurementType).toBe('classical')
    expect(live.settingsPatch.showUnknownModes).toBe(true)
    expect(live.settingsPatch.peakMinThreshold).toBe(-55)
    // Saved peaks are injected verbatim (stable index ids); selection restores 1:1.
    expect(live.loadedPeaks.map((p) => p.frequency)).toEqual([100, 200])
    expect([...live.selectedIndices]).toEqual([1]) // the 200 Hz peak
    expect(live.loadedPeaks[1]!.frequency).toBe(200)
    expect(live.overridesByFreq.get('100.0')).toBe('Custom')
  })
})