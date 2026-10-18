// @parity test/measurement-codable
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseGuitarTapFile, serializeGuitarTapFile, encodeMeasurement, encodeSnapshot, isComparison, type TapToneMeasurementModel } from '../src/measurement'
import { measurementDefinitivePeak, measurementTapToneRatio, measurementPeakModeLabels, comparisonEntryModeFreqs } from '../src/measurement/types'
import { decodeSnapshot, healSelection } from '../src/measurement/decode'
import { MODE_DISPLAY_NAME } from '../src/presentation/modeColors'
import { classifyAll } from '../src/dsp/classify'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import type { ResonantPeak } from '../src/measurement/types'
import { idEntries, newId, type Uuid } from '../src/measurement/newId'
import { settingsStore } from '../src/settingsStore'

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

describe('writer — minimal canonical output', () => {
  const enc = encodeMeasurement(m)

  it('emits only current keys, never legacy ones', () => {
    expect(enc.peakMinThreshold).toBe(-78)
    expect(enc.peakThreshold).toBeUndefined()
    expect(enc.hysteresisMargin).toBeUndefined()
    expect((enc.spectrumSnapshot as Record<string, unknown>).maxPeaks).toBeUndefined()
  })

  it('writes the convenience type fields and per-peak modeLabel', () => {
    expect(enc.measurementType).toBe('Classical Guitar')
    expect(enc.guitarType).toBe('Classical')
    expect((enc.peaks as Record<string, unknown>[])[0]!.modeLabel).toBe('Top')
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
function caseMeasurement(row: LogicRow): { m: TapToneMeasurementModel; ids: Record<string, Uuid> } {
  const ids: Record<string, Uuid> = {}
  const peaks: ResonantPeak[] = row.peaks.map((p) => {
    ids[p.id] = newId()
    return { id: ids[p.id]!, frequency: p.frequency, magnitude: p.magnitude, quality: 0, bandwidth: 0, timestamp: '2026-01-01T00:00:00Z' }
  })
  const snapshot = {
    frequencies: new Float32Array([100, 200]), magnitudes: new Float32Array([-60, -60]), minFreq: 50, maxFreq: 500, minDB: -100, maxDB: 0,
    isLogarithmic: false,
    ...(row.material ? {} : { guitarType: LOGIC.guitarType, measurementType: LOGIC.measurementType }),
  }
  const overrides = Object.fromEntries(Object.entries(row.overrides).map(([name, label]) => [ids[name]!, label]))
  const m = {
    id: newId(), timestamp: '2026-01-01T00:00:00Z', peaks,
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
      settingsStore.update({ measurementType: 'classical' })
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

// ── The file format — the shared cases in measurement-codable.json ──────────────────────────────
//
// The spectrum's bytes (SB), what a file reads to (DC), what the writer emits (WR), a comparison
// record (CR) and the real fixtures every edition carries: the same cases as Swift and Python.
// Mirrors Swift MeasurementCodecTests.

type Json = unknown
const CODEC = JSON.parse(readFileSync('test/fixtures/measurement-codable.json', 'utf8')) as {
  snapshotBytes: { id: string; note: string; frequencies: number[]; magnitudes: number[]; frequenciesData: string; magnitudesData: string }[]
  decode: { id: string; note: string; file: Json; rejected?: boolean; expect: Record<string, unknown> }[]
  write: { id: string; note: string; file: Json; present?: string[]; absent?: string[]; text?: Record<string, string>; contains?: string[] }[]
  comparison: { id: string; note: string; file: Json; roundTrip?: boolean; expect: Record<string, unknown> }[]
  fixtures: { file: string; measurements: number; measurementName: string | null; peakCount: number; sampleRate: number | null; isComparison: boolean; overrideLabels: string[] }[]
}
const LEGACY_KEYS = ['tapLocation', 'peakThreshold', 'hysteresisMargin', 'maxPeaks']
const asF32 = (v: Iterable<number>): number[] => Array.from(v, (x) => Math.fround(x))

/** Whether `key` appears anywhere in a JSON document. */
function hasKey(key: string, value: Json): boolean {
  if (Array.isArray(value)) return value.some((v) => hasKey(key, v))
  if (value && typeof value === 'object') {
    return key in value || Object.values(value).some((v) => hasKey(key, v))
  }
  return false
}

/** `peaks[].k` — the key on every peak of every measurement; otherwise the key anywhere. */
function present(path: string, doc: Json): boolean {
  if (path.startsWith('peaks[].')) {
    const k = path.slice('peaks[].'.length)
    const peaks = (doc as { peaks?: object[] }[]).flatMap((m) => m.peaks ?? [])
    return peaks.length > 0 && peaks.every((p) => k in p)
  }
  return hasKey(path, doc)
}

describe('measurement-codable — the spectrum bytes (measurement-codable.json)', () => {
  it.each(CODEC.snapshotBytes.map((r) => [r.id, r] as const))('%s', (_id, r) => {
    const d = encodeSnapshot({
      frequencies: r.frequencies, magnitudes: r.magnitudes,
      minFreq: 50, maxFreq: 500, minDB: -100, maxDB: 0, isLogarithmic: false,
    }) as Record<string, unknown>
    expect(d.frequenciesData).toBe(r.frequenciesData)
    expect(d.magnitudesData).toBe(r.magnitudesData)
    expect('frequencies' in d || 'magnitudes' in d).toBe(false)
    const back = decodeSnapshot(JSON.parse(JSON.stringify(d)))
    expect(asF32(back.frequencies)).toEqual(asF32(r.frequencies))
    expect(asF32(back.magnitudes)).toEqual(asF32(r.magnitudes))
  })
})

type IdCase = { id: string; note: string; file: unknown[]; rejected?: boolean; expect?: Record<string, unknown> }
const ID_CASES = (JSON.parse(readFileSync('test/fixtures/measurement-codable.json', 'utf8')) as { ids: IdCase[] }).ids
const UUID_TEXT = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/g

describe('measurement-codable — the rule for ids (measurement-codable.json)', () => {
  it.each(ID_CASES.map((r) => [r.id, r] as const))('%s', (id, r) => {
    if (r.rejected) {
      expect(() => parseGuitarTapFile(JSON.stringify(r.file)), `${id}: ${r.note}`).toThrow()
      return
    }
    const m = parseGuitarTapFile(JSON.stringify(r.file))[0]!
    const freq = new Map(m.peaks.map((p) => [p.id, String(Math.round(p.frequency))]))
    for (const [field, want] of Object.entries(r.expect ?? {})) {
      switch (field) {
        case 'selectedFrequencies':
          expect((m.selectedPeakIDs ?? []).map((i) => m.peaks.find((p) => p.id === i)!.frequency), field).toEqual(want)
          break
        case 'overrideLabels':
          expect(Object.fromEntries(idEntries(m.peakModeOverrides).filter(([k]) => freq.has(k)).map(([k, v]) => [freq.get(k), v])), field).toEqual(want)
          break
        case 'offsets':
          expect(Object.fromEntries(idEntries(m.peakAnnotationOffsets).filter(([k]) => freq.has(k)).map(([k, v]) => [freq.get(k), v])), field).toEqual(want)
          break
        case 'writtenLowercaseIds':
          expect((serializeGuitarTapFile([m]).match(UUID_TEXT) ?? []).filter((u) => u !== u.toUpperCase()), field).toHaveLength(want as number)
          break
        default: throw new Error(`${id}: unknown field ${field}`)
      }
    }
  })
})

describe('measurement-codable — what a file reads to (measurement-codable.json)', () => {
  it.each(CODEC.decode.map((r) => [r.id, r] as const))('%s', (_id, r) => {
    if (r.rejected) {
      expect(() => parseGuitarTapFile(JSON.stringify(r.file)), r.note).toThrow()
      return
    }
    const m = parseGuitarTapFile(JSON.stringify(r.file))[0]!
    for (const [field, want] of Object.entries(r.expect)) {
      switch (field) {
        case 'measurementName': expect(m.measurementName ?? null, field).toBe(want); break
        case 'peakMinThreshold': expect(m.peakMinThreshold ?? null, field).toBe(want); break
        case 'sampleRate': expect(m.sampleRate ?? null, field).toBe(want); break
        case 'frequencies': expect(asF32(m.spectrumSnapshot!.frequencies), field).toEqual(asF32(want as number[])); break
        case 'magnitudes': expect(asF32(m.spectrumSnapshot!.magnitudes), field).toEqual(asF32(want as number[])); break
        case 'overrides': {
          const lower = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]))
          expect(lower(m.peakModeOverrides ?? {}), field).toEqual(lower(want as Record<string, string>))
          break
        }
        case 'peakCount': expect(m.peaks.length, field).toBe(want); break
        case 'pitchNote': expect(m.peaks[0]!.pitchNote ?? null, field).toBe(want); break
        case 'annotationVisibilityMode': expect(m.annotationVisibilityMode ?? null, field).toBe(want); break
        default: throw new Error(`unknown field ${field}`)
      }
    }
  })
})

describe('measurement-codable — what the writer emits (measurement-codable.json)', () => {
  it.each(CODEC.write.map((r) => [r.id, r] as const))('%s', (_id, r) => {
    const text = serializeGuitarTapFile(parseGuitarTapFile(JSON.stringify(r.file)))
    const doc = JSON.parse(text) as Json
    for (const key of r.present ?? []) expect(present(key, doc), `${key} written`).toBe(true)
    for (const key of r.absent ?? []) expect(hasKey(key, doc), `${key} not written`).toBe(false)
    for (const [key, number] of Object.entries(r.text ?? {})) {
      const found = new RegExp(`"${key}":\\s*([^,}\\]\\s]+)`).exec(text)
      expect(found?.[1], `${key} written as ${number}`).toBe(number)
    }
    const compact = JSON.stringify(doc)
    for (const s of r.contains ?? []) expect(compact.includes(s), `contains ${s}`).toBe(true)
  })
})

describe('measurement-codable — a comparison record (measurement-codable.json)', () => {
  it.each(CODEC.comparison.map((r) => [r.id, r] as const))('%s', (_id, r) => {
    const first = parseGuitarTapFile(JSON.stringify(r.file))[0]!
    let m = first
    let doc: Json = undefined
    if (r.roundTrip) {
      const text = serializeGuitarTapFile([first])
      doc = JSON.parse(text)
      m = parseGuitarTapFile(text)[0]!
    }
    for (const [field, want] of Object.entries(r.expect)) {
      switch (field) {
        case 'isComparison': expect(isComparison(m), field).toBe(want); break
        case 'healed': expect(first.wasHealed ?? false, field).toBe(want); break
        case 'entries': {
          if (want === null) {
            expect(m.comparisonEntries, field).toBeUndefined()
            break
          }
          const wanted = want as Record<string, unknown>[]
          const entries = m.comparisonEntries ?? []
          expect(entries.length, `${field}: count`).toBe(wanted.length)
          entries.forEach((e, i) => {
            for (const [key, value] of Object.entries(wanted[i]!)) {
              switch (key) {
                case 'id': expect(e.id.toLowerCase(), 'entry id').toBe((value as string).toLowerCase()); break
                case 'label': expect(e.label, 'entry label').toBe(value); break
                case 'colorComponents': expect(e.colorComponents, 'entry colour').toEqual(value); break
                case 'guitarType': expect(e.guitarType ?? null, 'entry guitarType').toBe(value); break
                case 'peakCount': expect(e.peaks.length, 'entry peakCount').toBe(value); break
                case 'modePeakIds': {
                  const lower = (o: Record<string, string>) =>
                    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.toLowerCase()]))
                  expect(lower(e.modePeakIDs ?? {}), 'entry modePeakIds').toEqual(lower(value as Record<string, string>))
                  break
                }
                default: throw new Error(`unknown entry field ${key}`)
              }
            }
          })
          break
        }
        case 'modeFrequency': {
          const freqs = comparisonEntryModeFreqs(m.comparisonEntries![0]!)
          for (const [name, hz] of Object.entries(want as Record<string, number>)) {
            const mode = (['air', 'top', 'back'] as const).find((k) => MODE_DISPLAY_NAME[k] === name)!
            expect(freqs[mode], `${field} ${name}`).toBe(hz)
          }
          break
        }
        case 'absent':
          expect(doc, 'absent needs roundTrip').toBeDefined()
          for (const key of want as string[]) expect(hasKey(key, doc), `${key} not written`).toBe(false)
          break
        default: throw new Error(`unknown field ${field}`)
      }
    }
  })
})

describe('measurement-codable — the real fixtures (measurement-codable.json)', () => {
  it.each(CODEC.fixtures.map((r) => [r.file, r] as const))('%s', (file, r) => {
    const ms = parseGuitarTapFile(readFileSync(`test/fixtures/${file}`, 'utf8'))
    expect(ms.length).toBe(r.measurements)
    const m = ms[0]!
    expect(m.measurementName ?? null).toBe(r.measurementName)
    expect(m.peaks.length).toBe(r.peakCount)
    expect(m.sampleRate ?? null).toBe(r.sampleRate)
    expect(isComparison(m)).toBe(r.isComparison)
    expect(Object.values(m.peakModeOverrides ?? {}).sort()).toEqual([...r.overrideLabels].sort())
    const peakIds = new Set(m.peaks.map((p) => p.id.toLowerCase()))
    for (const peakId of Object.keys(m.peakModeOverrides ?? {})) {
      expect(peakIds.has(peakId.toLowerCase()), 'the override names a peak the file contains').toBe(true)
    }

    const text = serializeGuitarTapFile(ms)
    const doc = JSON.parse(text) as Record<string, Record<string, unknown> | undefined>[]
    for (const legacy of LEGACY_KEYS) expect(hasKey(legacy, doc), `${legacy} not written`).toBe(false)
    const original = JSON.parse(readFileSync(`test/fixtures/${file}`, 'utf8')) as typeof doc
    original.forEach((read, i) => {
      const readSnap = read.spectrumSnapshot
      if (!readSnap || !('frequenciesData' in readSnap)) return
      for (const key of ['frequenciesData', 'magnitudesData']) {
        expect(doc[i]!.spectrumSnapshot?.[key], `${key} written as read`).toBe(readSnap[key])
      }
    })
    const again = parseGuitarTapFile(text)
    expect(again.length).toBe(ms.length)
    again.forEach((a, i) => {
      const b = ms[i]!
      expect(asF32(a.peaks.map((p) => p.frequency))).toEqual(asF32(b.peaks.map((p) => p.frequency)))
      expect(a.spectrumSnapshot == null).toBe(b.spectrumSnapshot == null)
      if (a.spectrumSnapshot && b.spectrumSnapshot) {
        expect(asF32(a.spectrumSnapshot.frequencies)).toEqual(asF32(b.spectrumSnapshot.frequencies))
        expect(asF32(a.spectrumSnapshot.magnitudes)).toEqual(asF32(b.spectrumSnapshot.magnitudes))
      }
    })
  })
})
