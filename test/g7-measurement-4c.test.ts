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
    expect(measurementWarning(mk({ sampleRate: 44100 }), { microphoneName: 'Mic', sampleRate: 48000, calibrationName: undefined })).toBeNull()
  })

  it('reports UNKNOWN identity when the label differs from the current input', () => {
    const w = measurementWarning(mk({ microphoneName: 'UMIK-1' }), { microphoneName: 'MacBook Pro Microphone', calibrationName: undefined })
    expect(w).toContain("'UMIK-1'")
    expect(w).toContain("'MacBook Pro Microphone'")
    // We no longer assert "wrong mic" — a display label cannot prove device identity.
    expect(w).toContain("can't tell whether these are the same microphone")
    // Impact sentence is shared verbatim with Swift + Python.
    expect(w).toContain('Peak frequencies should be comparable')
    expect(w).toContain('faint peaks (such as FLC) may differ')
  })

  it('labels differing only by a parenthetical are UNKNOWN, not a match', () => {
    // Chrome adds "(Built-in)"; Safari does not. We deliberately no longer strip parentheticals:
    // on Windows that collapsed "Microphone (Umik-1  Gain: 18dB)" to "microphone", and it could
    // collapse two genuinely different mics onto one token — suppressing a warning that should
    // fire. Unverifiable identity is now reported as unknown rather than forced into a match.
    const w = measurementWarning(
      mk({ microphoneName: 'MacBook Pro Microphone', sampleRate: 48000 }),
      { microphoneName: 'MacBook Pro Microphone (Built-in)', sampleRate: 48000, calibrationName: undefined },
    )
    expect(w).toContain("can't tell whether these are the same microphone")
  })

  it('surfaces a sample-rate difference when the mic label matches exactly', () => {
    // An exact label match still silences the mic warning (the common same-platform reload),
    // so the sample-rate check is reached.
    const w = measurementWarning(
      mk({ microphoneName: 'MacBook Pro Microphone', sampleRate: 48000 }),
      { microphoneName: 'MacBook Pro Microphone', sampleRate: 44100, calibrationName: undefined },
    )
    expect(w).toContain('a different sample rate')
  })

  it('returns null when same mic, same rate, no calibration', () => {
    const w = measurementWarning(
      mk({ microphoneName: 'Mic', sampleRate: 48000 }),
      { microphoneName: 'Mic', sampleRate: 48000, calibrationName: undefined },
    )
    expect(w).toBeNull()
  })

  it('warns on a sample-rate difference (same mic)', () => {
    const w = measurementWarning(
      mk({ microphoneName: 'Mic', sampleRate: 44100 }),
      { microphoneName: 'Mic', sampleRate: 48000, calibrationName: undefined },
    )
    expect(w).toBe(
      'This measurement was recorded with a different sample rate. A newly captured tap may not match the saved result.',
    )
  })

  it('returns null when same mic, same rate, and the SAME calibration', () => {
    // REGRESSION (2026-07-16): every calibrated measurement warned on load. The function was
    // always right — App.tsx simply never passed the current calibration, so the recorded
    // '7108913' was compared against undefined and could never match. Nothing asserted this
    // case because the suite predates the web having calibration at all (see the test below,
    // named "web has none"). `CaptureSetup.calibrationName` is now a required key so a caller
    // that omits it fails to compile.
    const w = measurementWarning(
      mk({ microphoneName: 'Umik-1  Gain: 18dB', sampleRate: 48000, calibrationName: '7108913' }),
      { microphoneName: 'Umik-1  Gain: 18dB', sampleRate: 48000, calibrationName: '7108913' },
    )
    expect(w).toBeNull()
  })

  it('warns on a calibration difference (recorded had one, none loaded now)', () => {
    const w = measurementWarning(
      mk({ microphoneName: 'Mic', sampleRate: 48000, calibrationName: 'UMIK-1 cal' }),
      { microphoneName: 'Mic', sampleRate: 48000, calibrationName: undefined },
    )
    expect(w).toBe(
      'This measurement was recorded with a different calibration. A newly captured tap may not match the saved result.',
    )
  })

  it('combines calibration + sample-rate differences', () => {
    const w = measurementWarning(
      mk({ microphoneName: 'Mic', sampleRate: 44100, calibrationName: 'cal' }),
      { microphoneName: 'Mic', sampleRate: 48000, calibrationName: undefined },
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