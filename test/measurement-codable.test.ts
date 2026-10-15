// @parity test/measurement-codable
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseGuitarTapFile, serializeGuitarTapFile, encodeMeasurement, encodeSnapshot, f32, type TapToneMeasurementModel } from '../src/measurement'
import { measurementDefinitivePeak, measurementTapToneRatio, measurementPeakModeLabels } from '../src/measurement/types'
import { healSelection } from '../src/measurement/decode'
import { classifyAll } from '../src/dsp/classify'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import type { ResonantPeak } from '../src/measurement/types'

// `.guitartap` model + serialization parity. The canonical format is the
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

// Mode overrides, read from files the APPS actually wrote — one saved by Swift, one by Python — so
// the reader is tested against real overrides, not only hand-built fixtures.
describe.each([
  ['annotation-override-1790037028.guitartap', 'Fred'],          // written by Swift
  ['annotation-override-python-1790037332.guitartap', 'Fred2'],  // written by Python
])('real override fixture — %s', (file, expectedLabel) => {
  it('decodes its label, keyed to a peak the file still contains', () => {
    const text = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')
    const one = parseGuitarTapFile(text)[0]!
    const overrides = one.peakModeOverrides
    expect(overrides).toBeDefined()
    const entries = Object.entries(overrides!)
    expect(entries).toHaveLength(1)
    const [peakId, label] = entries[0]!
    expect(label).toBe(expectedLabel)
    expect(one.peaks.some((p) => p.id === peakId)).toBe(true)
  })
})

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

  it('decodes peaks including pitch', () => {
    const p = m.peaks[0]!
    expect(p.id).toBe('95037FB0-44FE-4163-9937-CBCD57BC1469')
    expect(p.frequency).toBeCloseTo(212.24847, 4)
    expect(p.magnitude).toBeCloseTo(-41.359554, 4)
    expect(p.quality).toBeCloseTo(24.166666, 4)
    expect(p.bandwidth).toBeCloseTo(8.7890625, 4)
    expect(p.pitchNote).toBe('G#3')
    expect(p.pitchCents).toBeCloseTo(37.90079, 4)
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
// The measurement's logic — the shared cases in measurement-codable.json
//
// The tap-tone ratio (TR), the mode label each peak is written with (ML), and the selection heal on
// decode (SH): the same cases as Swift and Python. Mirrors Swift MeasurementLogicTests.
// ---------------------------------------------------------------------------

interface CasePeak { id: string; frequency: number; magnitude: number }
interface LogicRow {
  id: string; note: string; peaks: CasePeak[]; selected: string[] | null; overrides: Record<string, string>
  material?: boolean; live?: boolean; expect?: number | null | string[]
  storedLabels?: (string | null)[]; expectHealed?: boolean; expectSelected?: string[]
}
const LOGIC = JSON.parse(readFileSync('test/fixtures/measurement-codable.json', 'utf8')) as {
  guitarType: string; measurementType: string; ratioTolerance: number
  tapToneRatio: LogicRow[]; modeLabels: LogicRow[]; selectionHeal: LogicRow[]
}

/** A case's measurement, and its peak ids by the case's peak names. */
function caseMeasurement(row: LogicRow): { m: TapToneMeasurementModel; ids: Record<string, string> } {
  const ids: Record<string, string> = {}
  const peaks: ResonantPeak[] = row.peaks.map((p) => {
    ids[p.id] = crypto.randomUUID().toUpperCase()
    return { id: ids[p.id]!, frequency: p.frequency, magnitude: p.magnitude, quality: 0, bandwidth: 0, timestamp: '2026-01-01T00:00:00Z' }
  })
  const snapshot = {
    frequencies: new Float32Array(), magnitudes: new Float32Array(), minFreq: 50, maxFreq: 500, minDB: -100, maxDB: 0,
    isLogarithmic: false,
    ...(row.material ? {} : { guitarType: LOGIC.guitarType, measurementType: LOGIC.measurementType }),
  }
  const overrides = Object.fromEntries(Object.entries(row.overrides).map(([name, label]) => [ids[name]!, label]))
  const m = {
    id: crypto.randomUUID().toUpperCase(), timestamp: '2026-01-01T00:00:00Z', peaks,
    ...(row.material ? { longitudinalSnapshot: snapshot } : { spectrumSnapshot: snapshot }),
    ...(row.selected !== null ? { selectedPeakIDs: row.selected.map((n) => ids[n]!) } : {}),
    ...(Object.keys(overrides).length ? { peakModeOverrides: overrides } : {}),
  } as unknown as TapToneMeasurementModel
  return { m, ids }
}

const ratioMatches = (ratio: number | null, expected: number | null): boolean =>
  expected === null ? ratio === null : ratio !== null && Math.abs(ratio - expected) <= LOGIC.ratioTolerance

describe('measurement-codable — the tap-tone ratio (measurement-codable.json)', () => {
  for (const row of LOGIC.tapToneRatio) {
    it(`${row.id}: ${row.note}`, () => {
      const { m, ids } = caseMeasurement(row)
      const expected = row.expect as number | null
      expect(ratioMatches(measurementTapToneRatio(m), expected), `saved ratio ${measurementTapToneRatio(m)}`).toBe(true)
      if (!row.live) return
      const a = new TapToneAnalyzer()
      a.measurementType = 'classical'
      a.peaks = m.peaks.map((p) => ({ ...p }))
      a.modeByPeak = classifyAll(a.peaks, 'classical')
      const selected = new Set(m.selectedPeakIDs ?? [])
      a.restoreSelection(selected, a.peaks.filter((p) => selected.has(p.id)).map((p) => p.frequency), true)
      for (const [name, label] of Object.entries(row.overrides)) a.setModeOverride(ids[name]!, label)
      expect(ratioMatches(a.tapToneRatio(), expected), `live ratio ${a.tapToneRatio()} — the saved and live ratios must agree`).toBe(true)
    })
  }
})

describe('measurement-codable — the mode label each peak is written with (measurement-codable.json)', () => {
  for (const row of LOGIC.modeLabels) {
    it(`${row.id}: ${row.note}`, () => {
      const { m } = caseMeasurement(row)
      // A file whose peaks already carry `storedLabels`: written, the labels set, read back.
      const written = encodeMeasurement(m) as { peaks: Record<string, unknown>[] }
      row.storedLabels!.forEach((label, i) => {
        if (label === null) delete written.peaks[i]!.modeLabel
        else written.peaks[i]!.modeLabel = label
      })
      const read = parseGuitarTapFile(JSON.stringify([written]))[0]!
      const labels = ((encodeMeasurement(read) as { peaks: Record<string, unknown>[] }).peaks).map((p) => p.modeLabel)
      expect(labels, 'written').toEqual(row.expect)
      const shown = measurementPeakModeLabels(read)
      expect(read.peaks.map((p) => shown.get(p.id)), 'displayed').toEqual(row.expect)
    })
  }
})

describe('measurement-codable — the selection heal on decode (measurement-codable.json)', () => {
  for (const row of LOGIC.selectionHeal) {
    it(`${row.id}: ${row.note}`, () => {
      const { m, ids } = caseMeasurement(row)
      const read = parseGuitarTapFile(serializeGuitarTapFile([m]))[0]!
      expect(read.wasHealed ?? false, 'healed').toBe(row.expectHealed)
      expect(new Set(read.selectedPeakIDs ?? [])).toEqual(new Set(row.expectSelected!.map((n) => ids[n]!)))
    })
  }
})
