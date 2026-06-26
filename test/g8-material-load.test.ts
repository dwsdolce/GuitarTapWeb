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

  it('restores type + dimensions + dB range into the settings patch', () => {
    expect(r.settingsPatch.measurementType).toBe('plate')
    expect(r.settingsPatch.plateLength).toBe(500)
    expect(r.settingsPatch.plateMass).toBe(100)
    expect(r.settingsPatch.plateStiffnessPreset).toBe('steelStringTop')
    expect(r.settingsPatch.minDb).toBe(-100)
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