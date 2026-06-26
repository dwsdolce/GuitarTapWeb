import { describe, it, expect } from 'vitest'
import { buildGuitarMeasurement } from '../src/measurement/fromLive'
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

const args = {
  name: 'Multi', notes: '',
  spectrum, peaks,
  modeByPeak: new Map<number, 'air' | 'top' | 'back' | 'unknown'>([[1, 'top']]),
  selectedIds: new Set<number>([1]),
  overridesByFreq: new Map<string, string>(),
  view: { minHz: 75, maxHz: 350, minDb: -100, maxDb: 0 },
  settings: { ...DEFAULT_SETTINGS, measurementType: 'generic' as const },
  numberOfTaps: 2,
  tapSpectra: [tap1, tap2],
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
    const m = buildGuitarMeasurement({ ...args, numberOfTaps: 1, tapSpectra: [tap1] })
    expect(m.tapEntries).toBeUndefined()
  })

  it('survives the .guitartap round-trip', () => {
    const m = parseGuitarTapFile(serializeGuitarTapFile([buildGuitarMeasurement(args)]))[0]!
    expect(m.tapEntries).toHaveLength(2)
    expect(m.tapEntries![0]!.snapshot.frequencies).toEqual([100, 200, 300])
    expect(m.tapEntries![1]!.snapshot.magnitudes).toEqual(tap2.magnitudesDb)
  })
})