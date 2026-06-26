import { describe, it, expect } from 'vitest'
import { measurementWarning, guitarTapFilename } from '../src/measurement/fromLive'
import { serializeGuitarTapFile, parseGuitarTapFile, type TapToneMeasurementModel } from '../src/measurement'

// Phase 4c — load-time provenance warning + import/export. The warning tiering mirrors
// Swift loadMeasurement / Python load_measurement: recorded mic ≠ current input → name
// warning; same mic but calibration and/or sample rate differ → "different …" warning.

const mk = (over: Partial<TapToneMeasurementModel>): TapToneMeasurementModel => ({
  id: 'M1',
  timestamp: '2026-03-09T18:46:19Z',
  peaks: [],
  ...over,
})

describe('measurementWarning — tiering', () => {
  it('returns null when the measurement has no recorded microphone', () => {
    expect(measurementWarning(mk({ sampleRate: 44100 }), { microphoneName: 'Mic', sampleRate: 48000 })).toBeNull()
  })

  it('warns when the recorded mic is not the current input', () => {
    const w = measurementWarning(mk({ microphoneName: 'UMIK-1' }), { microphoneName: 'MacBook Pro Microphone' })
    expect(w).toContain("'UMIK-1'")
    expect(w).toContain("isn't the current input")
    expect(w).toContain("'MacBook Pro Microphone'")
  })

  it('treats the same mic with different browser labels as a match (no false warning)', () => {
    // Chrome adds "(Built-in)"; Safari does not — same physical device.
    const w = measurementWarning(
      mk({ microphoneName: 'MacBook Pro Microphone', sampleRate: 48000 }),
      { microphoneName: 'MacBook Pro Microphone (Built-in)', sampleRate: 48000 },
    )
    expect(w).toBeNull()
  })

  it('still surfaces a sample-rate difference even when only the label suffix differs', () => {
    const w = measurementWarning(
      mk({ microphoneName: 'MacBook Pro Microphone', sampleRate: 48000 }),
      { microphoneName: 'MacBook Pro Microphone (Built-in)', sampleRate: 44100 },
    )
    expect(w).toContain('a different sample rate')
  })

  it('returns null when same mic, same rate, no calibration', () => {
    const w = measurementWarning(
      mk({ microphoneName: 'Mic', sampleRate: 48000 }),
      { microphoneName: 'Mic', sampleRate: 48000 },
    )
    expect(w).toBeNull()
  })

  it('warns on a sample-rate difference (same mic)', () => {
    const w = measurementWarning(
      mk({ microphoneName: 'Mic', sampleRate: 44100 }),
      { microphoneName: 'Mic', sampleRate: 48000 },
    )
    expect(w).toBe(
      'This measurement was recorded with a different sample rate. A newly captured tap may not match the saved result.',
    )
  })

  it('warns on a calibration difference (recorded had one, web has none)', () => {
    const w = measurementWarning(
      mk({ microphoneName: 'Mic', sampleRate: 48000, calibrationName: 'UMIK-1 cal' }),
      { microphoneName: 'Mic', sampleRate: 48000 },
    )
    expect(w).toBe(
      'This measurement was recorded with a different calibration. A newly captured tap may not match the saved result.',
    )
  })

  it('combines calibration + sample-rate differences', () => {
    const w = measurementWarning(
      mk({ microphoneName: 'Mic', sampleRate: 44100, calibrationName: 'cal' }),
      { microphoneName: 'Mic', sampleRate: 48000 },
    )
    expect(w).toContain('a different calibration and sample rate')
  })
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