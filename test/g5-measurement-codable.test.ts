// @parity test/measurement-codable
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  parseGuitarTapFile,
  serializeGuitarTapFile,
  encodeMeasurement,
  encodeSnapshot,
  f32,
} from '../src/measurement'

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