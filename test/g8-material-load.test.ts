import { describe, it, expect } from 'vitest'
import { measurementToLiveMaterial, buildMaterialMeasurement } from '../src/measurement/fromLive'
import { serializeGuitarTapFile, parseGuitarTapFile, type TapToneMeasurementModel } from '../src/measurement'
import { DEFAULT_SETTINGS } from '../src/settings'

// Phase 4b (material follow-up): loading a saved plate/brace measurement restores the
// per-phase spectra (chart overlay), the selected L/C/FLC peaks (markers + results), and
// the dimensions (so Material Results recomputes). Mirrors Swift loadMeasurement's
// material branch.

const peak = (id: string, f: number, mag: number) => ({
  id,
  frequency: f,
  magnitude: mag,
  quality: 20,
  bandwidth: 5,
  timestamp: '2026-03-09T18:46:19Z',
})
const snap = (freqs: number[], mags: number[], extra: Record<string, unknown> = {}) => ({
  frequencies: freqs,
  magnitudes: mags,
  minFreq: 10,
  maxFreq: 300,
  minDB: -100,
  maxDB: 0,
  isLogarithmic: false,
  measurementType: 'Material (Plate)',
  ...extra,
})

const plate: TapToneMeasurementModel = {
  id: 'P1',
  timestamp: '2026-03-09T18:46:19Z',
  peaks: [peak('L', 120, -40), peak('C', 250, -45)],
  longitudinalSnapshot: snap([100, 120, 140], [-50, -40, -60], {
    plateLength: 500,
    plateWidth: 200,
    plateThickness: 3,
    plateMass: 100,
    plateStiffnessPreset: 'Steel String Top',
    measureFlc: false,
  }),
  crossSnapshot: snap([200, 250, 300], [-55, -45, -65]),
  selectedLongitudinalPeakID: 'L',
  selectedCrossPeakID: 'C',
}

describe('measurementToLiveMaterial — restore a plate measurement', () => {
  const r = measurementToLiveMaterial(plate)

  it('restores per-phase spectra (L + C present, FLC absent)', () => {
    expect(r.measurementType).toBe('plate')
    expect(r.matSpectra.longitudinal?.frequencies).toEqual([100, 120, 140])
    expect(r.matSpectra.cross?.magnitudesDb).toEqual([-55, -45, -65])
    expect(r.matSpectra.flc).toBeNull()
  })

  it('restores the selected L/C peaks (markers + results)', () => {
    expect(r.matPeaks.longitudinal?.frequency).toBe(120)
    expect(r.matPeaks.cross?.frequency).toBe(250)
    expect(r.matPeaks.flc).toBeNull()
  })

  it('restores type + dimensions into the settings patch (NOT the axis range)', () => {
    expect(r.settingsPatch.measurementType).toBe('plate')
    expect(r.settingsPatch.plateLength).toBe(500)
    expect(r.settingsPatch.plateMass).toBe(100)
    expect(r.settingsPatch.plateStiffnessPreset).toBe('steelStringTop')
    // The axis range is a transient override (Swift loadedAxisRange), not a persisted
    // setting — so it must NOT be in the settings patch.
    expect(r.settingsPatch.minDb).toBeUndefined()
    expect('displayRanges' in r.settingsPatch).toBe(false)
  })

  it('carries the saved axis range as a transient view (freq + dB), not persisted', () => {
    expect(r.view).toEqual({ minHz: 10, maxHz: 300, minDb: -100, maxDb: 0 })
  })
})

describe('material survives the .guitartap file round-trip (export → import)', () => {
  it('serialize → parse → restore preserves spectra, peaks, and dims', () => {
    const m = parseGuitarTapFile(serializeGuitarTapFile([plate]))[0]!
    const r = measurementToLiveMaterial(m)
    expect(r.matSpectra.longitudinal?.frequencies).toEqual([100, 120, 140])
    expect(r.matSpectra.cross?.frequencies).toEqual([200, 250, 300])
    expect(r.matPeaks.longitudinal?.frequency).toBe(120)
    expect(r.settingsPatch.plateLength).toBe(500)
    expect(r.settingsPatch.plateStiffnessPreset).toBe('steelStringTop')
  })
})

describe('buildMaterialMeasurement — save round-trip (live → model → file → restore)', () => {
  const matPeak = (f: number, mag: number) => ({ frequency: f, magnitude: mag, quality: 20, bandwidth: 5 })
  const built = buildMaterialMeasurement({
    name: 'Top Plate',
    notes: 'spruce',
    spectra: {
      longitudinal: { frequencies: [100, 120, 140], magnitudesDb: [-50, -40, -60] },
      cross: { frequencies: [200, 250, 300], magnitudesDb: [-55, -45, -65] },
      flc: null,
    },
    peaks: { longitudinal: matPeak(120, -40), cross: matPeak(250, -45), flc: null },
    view: { minHz: 10, maxHz: 300, minDb: -100, maxDb: 0 },
    settings: {
      ...DEFAULT_SETTINGS,
      measurementType: 'plate' as const,
      plateLength: 500,
      plateWidth: 200,
      plateThickness: 3,
      plateMass: 100,
      plateStiffnessPreset: 'steelStringTop' as const,
      measureFlc: false,
      peakMinThreshold: -70,
    },
    sampleRate: 48000,
    deviceLabel: 'Test Mic',
  })

  it('writes per-phase snapshots, selected peaks, dims, and provenance', () => {
    expect(built.longitudinalSnapshot?.frequencies).toEqual([100, 120, 140])
    expect(built.crossSnapshot?.magnitudes).toEqual([-55, -45, -65])
    expect(built.flcSnapshot).toBeUndefined()
    expect(built.longitudinalSnapshot?.measurementType).toBe('Material (Plate)')
    expect(built.longitudinalSnapshot?.plateLength).toBe(500)
    expect(built.longitudinalSnapshot?.plateStiffnessPreset).toBe('Steel String Top')
    expect(built.crossSnapshot?.plateMass).toBe(100)
    expect(built.peaks).toHaveLength(2)
    const selL = built.peaks.find((p) => p.id === built.selectedLongitudinalPeakID)!
    expect(selL.frequency).toBe(120)
    expect(built.selectedFlcPeakID).toBeUndefined()
    expect(built.measurementName).toBe('Top Plate')
    expect(built.notes).toBe('spruce')
    expect(built.microphoneName).toBe('Test Mic')
    expect(built.sampleRate).toBe(48000)
  })

  it('writes the full Swift/Python field set (parity with buildGuitarMeasurement)', () => {
    // selectedPeakIDs / selectedPeakFrequencies cover every role-selected peak so a
    // native consumer marks the same peaks "selected".
    expect(built.selectedPeakIDs).toEqual([built.selectedLongitudinalPeakID, built.selectedCrossPeakID])
    expect(built.selectedPeakFrequencies).toEqual([120, 250])
    // guitarType written on every snapshot (Generic for plate) + provenance fields.
    expect(built.longitudinalSnapshot?.guitarType).toBe('Generic')
    expect(built.crossSnapshot?.guitarType).toBe('Generic')
    expect(built.annotationVisibilityMode).toBeDefined()
    expect(built.peakMinThreshold).toBe(-70)
    expect(built.numberOfTaps).toBe(1)
  })

  it('round-trips through the file back into live material', () => {
    const m = parseGuitarTapFile(serializeGuitarTapFile([built]))[0]!
    const r = measurementToLiveMaterial(m)
    expect(r.measurementType).toBe('plate')
    expect(r.matSpectra.longitudinal?.frequencies).toEqual([100, 120, 140])
    expect(r.matSpectra.cross?.magnitudesDb).toEqual([-55, -45, -65])
    expect(r.matSpectra.flc).toBeNull()
    expect(r.matPeaks.longitudinal?.frequency).toBe(120)
    expect(r.matPeaks.cross?.frequency).toBe(250)
    expect(r.settingsPatch.plateLength).toBe(500)
    expect(r.settingsPatch.plateStiffnessPreset).toBe('steelStringTop')
  })
})

// 6d: material L/C/FLC labels drag exactly like guitar labels, reusing the single shared
// peakAnnotationOffsets store. The live store is keyed by `frequency.toFixed(1)`; persistence is
// keyed by peak UUID (gold-standard format) — this asserts the build→file→restore re-keying both ways.
describe('material annotation offsets round-trip (6d)', () => {
  const matPeak = (f: number, mag: number) => ({ frequency: f, magnitude: mag, quality: 20, bandwidth: 5 })
  const built = buildMaterialMeasurement({
    name: 'Top Plate',
    notes: '',
    spectra: {
      longitudinal: { frequencies: [100, 120, 140], magnitudesDb: [-50, -40, -60] },
      cross: { frequencies: [200, 250, 300], magnitudesDb: [-55, -45, -65] },
      flc: null,
    },
    peaks: { longitudinal: matPeak(120, -40), cross: matPeak(250, -45), flc: null },
    view: { minHz: 10, maxHz: 300, minDb: -100, maxDb: 0 },
    settings: { ...DEFAULT_SETTINGS, measurementType: 'plate' as const },
    sampleRate: 48000,
    deviceLabel: 'Test Mic',
    // Drag only the longitudinal label; cross is left un-dragged.
    annotationOffsetsByFreq: new Map<string, [number, number]>([['120.0', [125, -38]]]),
  })

  it('writes the dragged offset into peakAnnotationOffsets keyed by the L peak UUID', () => {
    const lId = built.selectedLongitudinalPeakID!
    expect(built.peakAnnotationOffsets).toBeDefined()
    expect(built.peakAnnotationOffsets![lId]).toEqual([125, -38])
    // The un-dragged cross peak gets no entry.
    expect(built.peakAnnotationOffsets![built.selectedCrossPeakID!]).toBeUndefined()
  })

  it('restores the offset re-keyed by frequency after a file round-trip', () => {
    const m = parseGuitarTapFile(serializeGuitarTapFile([built]))[0]!
    const r = measurementToLiveMaterial(m)
    expect(r.annotationOffsetsByFreq.get('120.0')).toEqual([125, -38])
    expect(r.annotationOffsetsByFreq.has('250.0')).toBe(false)
  })

  it('omits peakAnnotationOffsets entirely when no labels were dragged', () => {
    const plain = buildMaterialMeasurement({
      name: '', notes: '',
      spectra: { longitudinal: { frequencies: [100, 120], magnitudesDb: [-50, -40] }, cross: null, flc: null },
      peaks: { longitudinal: matPeak(120, -40), cross: null, flc: null },
      view: { minHz: 10, maxHz: 300, minDb: -100, maxDb: 0 },
      settings: { ...DEFAULT_SETTINGS, measurementType: 'plate' as const },
      sampleRate: 48000,
      deviceLabel: 'Test Mic',
    })
    expect(plain.peakAnnotationOffsets).toBeUndefined()
  })
})