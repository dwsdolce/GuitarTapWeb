// @parity test/measurement-codable
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  parseGuitarTapFile,
  serializeGuitarTapFile,
  encodeMeasurement,
  encodeSnapshot,
  f32,
  type ResonantPeakModel,
  type TapToneMeasurementModel,
} from '../src/measurement'
import { measurementDefinitivePeak, measurementTapToneRatio, healSelection } from '../src/measurement/fromLive'
import { classifyAll } from '../src/dsp/classify'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'

// `.guitartap` model + serialization parity (Phase 4a). The canonical format is the
// Swift user manual Appendix B; this mirrors the Swift MeasurementCodableTests and the
// Python test_measurement_codable. The vendored Contreras file is an OLDER save (legacy
// `peakThreshold`, extra `hysteresisMargin`/`maxPeaks`, no `sampleRate`), so it doubles
// as the legacy-decode regression — it is a reader fixture, not a definition of the
// format (the reader/writer are). Bar = semantic round-trip, not byte-identity.

const fixtureUrl = new URL('./fixtures/contreras-classical-1774731564.guitartap', import.meta.url)
const rawText = readFileSync(fixtureUrl, 'utf8')
const raw = JSON.parse(rawText)[0]
const measurements = parseGuitarTapFile(rawText)
const m = measurements[0]!

describe('decode — canonical fields + legacy compromises', () => {
  it('reads the array-wrapped document into one measurement', () => {
    expect(measurements).toHaveLength(1)
    expect(m.id).toBe('0B3AA3B4-02BC-43AC-9715-E17C81975C20')
    expect(m.peaks).toHaveLength(44)
    expect(m.numberOfTaps).toBe(10)
    expect(m.annotationVisibilityMode).toBe('selected')
    expect(m.measurementName).toBe('Contreras Classical')
    expect(m.notes).toBe('Umik-1')
    expect(m.tapDetectionThreshold).toBe(-64)
  })

  // Covered only by ACCIDENT until 2026-07-21: the Python copy of this fixture still carried the
  // pre-rename `tapLocation` key while the Swift and web copies had been updated to
  // `measurementName`, so the three platforms' "same" parity test silently exercised different
  // branches. The fixture is now byte-identical everywhere and the fallback is pinned deliberately,
  // here and in the Swift/Python twins.
  it('maps the legacy `tapLocation` key onto `measurementName`', () => {
    const legacy = [{
      id: '6B29FC40-CA47-1067-B31D-00DD010662DA',
      timestamp: 1774731564,
      peaks: [],
      tapLocation: 'Contreras Classical',
    }]
    const [decoded] = parseGuitarTapFile(JSON.stringify(legacy))
    expect(decoded!.measurementName).toBe('Contreras Classical')
  })

  it('never writes the legacy `tapLocation` key back out', () => {
    const legacy = [{
      id: '6B29FC40-CA47-1067-B31D-00DD010662DA',
      timestamp: 1774731564,
      peaks: [],
      tapLocation: 'Contreras Classical',
    }]
    const out = serializeGuitarTapFile(parseGuitarTapFile(JSON.stringify(legacy)))
    expect(out).not.toContain('tapLocation')
    expect(out).toContain('measurementName')
  })

  it('maps the legacy `peakThreshold` key onto `peakMinThreshold`', () => {
    expect(raw.peakThreshold).toBe(-78) // present in the file…
    expect(raw.peakMinThreshold).toBeUndefined() // …under the old name only
    expect(m.peakMinThreshold).toBe(-78) // …decoded under the new name
  })

  it('treats a missing `sampleRate` as unknown (undefined)', () => {
    expect(raw.sampleRate).toBeUndefined()
    expect(m.sampleRate).toBeUndefined()
  })

  it('decodes the snapshot scalars and binary spectra', () => {
    const s = m.spectrumSnapshot!
    expect(s.measurementType).toBe('Classical Guitar')
    expect(s.guitarType).toBe('Classical')
    expect(s.showUnknownModes).toBe(true)
    expect([s.minFreq, s.maxFreq, s.minDB, s.maxDB]).toEqual([75, 350, -100, 0])
    expect(s.isLogarithmic).toBe(false)
    expect(s.frequencies.length).toBeGreaterThan(0)
    expect(s.magnitudes.length).toBe(s.frequencies.length)
  })

  it('decodes peaks including pitch and the carried-through modeLabel', () => {
    const p = m.peaks[0]!
    expect(p.id).toBe('95037FB0-44FE-4163-9937-CBCD57BC1469')
    expect(p.frequency).toBeCloseTo(212.24847, 4)
    expect(p.magnitude).toBeCloseTo(-41.359554, 4)
    expect(p.quality).toBeCloseTo(24.166666, 4)
    expect(p.bandwidth).toBeCloseTo(8.7890625, 4)
    expect(p.pitchNote).toBe('G#3')
    expect(p.pitchCents).toBeCloseTo(37.90079, 4)
    expect(p.modeLabel).toBe('Top')
  })

  it('decodes an empty annotation-offsets array to an empty map', () => {
    expect(raw.peakAnnotationOffsets).toEqual([])
    expect(m.peakAnnotationOffsets).toEqual({})
  })
})

describe('binary spectrum encoding round-trips byte-for-byte', () => {
  it('re-encodes frequenciesData / magnitudesData to the exact base64 of the file', () => {
    const enc = encodeSnapshot(m.spectrumSnapshot!)
    expect(enc.frequenciesData).toBe(raw.spectrumSnapshot.frequenciesData)
    expect(enc.magnitudesData).toBe(raw.spectrumSnapshot.magnitudesData)
  })
})

describe('writer — minimal canonical output', () => {
  const enc = encodeMeasurement(m)

  it('emits only current keys, never legacy ones', () => {
    expect(enc.peakMinThreshold).toBe(-78)
    expect(enc.peakThreshold).toBeUndefined()
    expect(enc.hysteresisMargin).toBeUndefined()
    expect((enc.spectrumSnapshot as Record<string, unknown>).maxPeaks).toBeUndefined()
  })

  it('omits an unset optional rather than writing null', () => {
    expect('sampleRate' in enc).toBe(false)
  })

  it('writes the convenience type fields and per-peak modeLabel', () => {
    expect(enc.measurementType).toBe('Classical Guitar')
    expect(enc.guitarType).toBe('Classical')
    expect((enc.peaks as Record<string, unknown>[])[0]!.modeLabel).toBe('Top')
  })

  it('writes Float fields as shortest float32 text (no float64 expansion)', () => {
    expect(JSON.stringify(f32(212.24847))).toBe('212.24847')
    const text = serializeGuitarTapFile(measurements)
    expect(text).toContain('"frequency": 212.24847')
    expect(text).toContain('"decayTime": 0.09321606')
  })
})

describe('semantic round-trip (decode → encode → decode)', () => {
  it('preserves every modeled field', () => {
    const again = parseGuitarTapFile(serializeGuitarTapFile(measurements))
    expect(again).toEqual(measurements)
  })
})

// ---------------------------------------------------------------------------
// Definitive saved-measurement ratio + legacy selection heal (Phase 6). The saved-list/PDF ratio uses
// the same DEFINITIVE rule as the live analyzer (selected + override-aware), so they cannot disagree;
// decode heals a legacy selection to a valid definitive set. Mirrors Swift TapToneMeasurement
// definitivePeak / tapToneRatio + the decode heal. Classical bands: air 80–110, top 170–230, back 190–280.
// ---------------------------------------------------------------------------
const rp = (id: string, frequency: number, magnitude: number): ResonantPeakModel => ({
  id, frequency, magnitude, quality: 10, bandwidth: 5, timestamp: '2026-01-01T00:00:00Z',
})
const guitarModel = (
  peaks: ResonantPeakModel[],
  opts: { selectedPeakIDs?: string[]; peakModeOverrides?: Record<string, string> } = {},
): TapToneMeasurementModel => ({
  id: 'M', timestamp: '2026-01-01T00:00:00Z', peaks,
  spectrumSnapshot: {
    frequencies: [], magnitudes: [], minFreq: 0, maxFreq: 500, minDB: -100, maxDB: 0,
    isLogarithmic: false, guitarType: 'Classical', measurementType: 'Classical Guitar',
  },
  ...opts,
})

describe('measurement-codable — definitive saved ratio', () => {
  it('divides the definitive Top by the definitive Air (over the selection)', () => {
    const m = guitarModel([rp('a', 90, -20), rp('t', 200, -20)], { selectedPeakIDs: ['a', 't'] })
    expect(measurementTapToneRatio(m)).toBeCloseTo(200 / 90, 5)
  })

  it('a freeform override on the Top drops the ratio', () => {
    const m = guitarModel([rp('a', 90, -20), rp('t', 200, -20)], { selectedPeakIDs: ['a', 't'], peakModeOverrides: { t: 'Wolf note' } })
    expect(measurementDefinitivePeak(m, 'top')).toBeNull()
    expect(measurementTapToneRatio(m)).toBeNull()
  })

  it('overriding a selected non-Top peak TO Top retargets the ratio onto it', () => {
    const m = guitarModel([rp('a', 90, -20), rp('d', 380, -20)], { selectedPeakIDs: ['a', 'd'], peakModeOverrides: { d: 'Top' } })
    expect(measurementDefinitivePeak(m, 'top')?.id).toBe('d')
    expect(measurementTapToneRatio(m)).toBeCloseTo(380 / 90, 5)
  })

  it('a deselected Top drops the ratio', () => {
    const m = guitarModel([rp('a', 90, -20), rp('t', 200, -20)], { selectedPeakIDs: ['a'] })
    expect(measurementTapToneRatio(m)).toBeNull()
  })

  it('the saved ratio equals the live analyzer ratio for the same measurement', () => {
    const m = guitarModel([rp('a', 90, -20), rp('t', 200, -20)], { selectedPeakIDs: ['a', 't'] })
    const a = new TapToneAnalyzer()
    a.measurementType = 'classical'
    a.peaks = [
      { id: 0, frequency: 90, magnitude: -20, quality: 10, bandwidth: 5 },
      { id: 1, frequency: 200, magnitude: -20, quality: 10, bandwidth: 5 },
    ]
    a.modeByPeak = classifyAll(a.peaks, 'classical')
    a.restoreSelection(new Set([0, 1]), [90, 200], true)
    expect(a.tapToneRatio()).toBeCloseTo(measurementTapToneRatio(m)!, 6)
  })
})

describe('measurement-codable — legacy selection heal on decode', () => {
  it('a nil selection is healed to the strongest peak per effective mode', () => {
    const m = guitarModel([rp('a', 90, -20), rp('t', 200, -20), rp('b', 250, -20)]) // no selectedPeakIDs
    expect(healSelection(m)).toBe(true)
    expect(new Set(m.selectedPeakIDs)).toEqual(new Set(['a', 't', 'b'])) // one definitive per mode
  })

  it('a pre-uniqueness selection with two Tops is pruned to the strongest', () => {
    // Two peaks made Top by override (the only way a legacy file could select two); prune to the louder.
    const m = guitarModel(
      [rp('a', 90, -20), rp('t', 200, -20), rp('t2', 220, -50)],
      { selectedPeakIDs: ['a', 't', 't2'], peakModeOverrides: { t2: 'Top' } },
    )
    expect(healSelection(m)).toBe(true)
    expect(new Set(m.selectedPeakIDs)).toEqual(new Set(['a', 't'])) // the weaker Top (t2) is dropped
  })

  it('a valid one-per-mode selection is left untouched (not reflagged)', () => {
    const m = guitarModel([rp('a', 90, -20), rp('t', 200, -20)], { selectedPeakIDs: ['a', 't'] })
    expect(healSelection(m)).toBe(false)
  })

  it('material measurements are never touched by the selection heal', () => {
    const m = guitarModel([rp('a', 90, -20)], { selectedPeakIDs: ['a'] })
    // Make it look material: a longitudinal snapshot + no guitar spectrum snapshot.
    delete (m as { spectrumSnapshot?: unknown }).spectrumSnapshot
    ;(m as { longitudinalSnapshot?: unknown }).longitudinalSnapshot = { frequencies: [], magnitudes: [], minFreq: 0, maxFreq: 500, minDB: -100, maxDB: 0, isLogarithmic: false }
    expect(healSelection(m)).toBe(false)
  })
})