import { describe, it, expect } from 'vitest'
import { guitarTapFilename } from '../src/measurement/fromLive'
import { serializeGuitarTapFile, parseGuitarTapFile, type TapToneMeasurementModel } from '../src/measurement'

// Export file names and the export → import round-trip. (The load-time microphone warning is
// test/mic-selection, MS14–MS17.)

const mk = (over: Partial<TapToneMeasurementModel>): TapToneMeasurementModel => ({
  id: 'M1',
  timestamp: '2026-03-09T18:46:19Z',
  peaks: [],
  ...over,
})

describe('guitarTapFilename', () => {
  it('slugifies the name and appends the unix timestamp', () => {
    const ts = Math.floor(Date.parse('2026-03-09T18:46:19Z') / 1000)
    expect(guitarTapFilename(mk({ measurementName: 'Contreras Classical' }))).toBe(`contreras-classical-${ts}.guitartap`)
  })
  it('falls back to "measurement" when unnamed', () => {
    expect(guitarTapFilename(mk({}))).toMatch(/^measurement-\d+\.guitartap$/)
  })
})

describe('export → import file round-trip', () => {
  it('serializeGuitarTapFile → parseGuitarTapFile preserves the measurement', () => {
    const m = mk({
      measurementName: 'Test',
      microphoneName: 'Mic',
      sampleRate: 48000,
      spectrumSnapshot: {
        frequencies: [100, 200],
        magnitudes: [-50, -40],
        minFreq: 75,
        maxFreq: 350,
        minDB: -100,
        maxDB: 0,
        isLogarithmic: false,
        measurementType: 'Classical Guitar',
        guitarType: 'Classical',
      },
    })
    const round = parseGuitarTapFile(serializeGuitarTapFile([m]))
    expect(round).toHaveLength(1)
    expect(round[0]!.measurementName).toBe('Test')
    expect(round[0]!.microphoneName).toBe('Mic')
    expect(round[0]!.sampleRate).toBe(48000)
    expect(round[0]!.spectrumSnapshot!.frequencies).toEqual([100, 200])
  })
})