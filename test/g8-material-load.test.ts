import { describe, it, expect } from 'vitest'
import { measurementToLiveMaterial, buildMaterialMeasurement } from '../src/measurement/fromLive'
import { serializeGuitarTapFile, parseGuitarTapFile, type TapToneMeasurementModel } from '../src/measurement'
import { DEFAULT_SETTINGS } from '../src/settings'
import { materialInputsFromSettings } from '../src/measurement/materialMeasurementInputs'
import { measurementToPdfData } from '../src/presentation/measurementImage'

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

  it('restores dimensions into Store B (materialInputs), only the type into the settings patch', () => {
    expect(r.settingsPatch.measurementType).toBe('plate')
    // Dims go to Store B (the measurement's own values) — NOT the Settings patch, so loading never
    // clobbers the user's next-measurement defaults.
    expect(r.materialInputs.lengthMm).toBe(500)
    expect(r.materialInputs.massG).toBe(100)
    expect(r.materialInputs.stiffnessPreset).toBe('steelStringTop')
    expect(r.settingsPatch.plateLength).toBeUndefined()
    expect(r.settingsPatch.plateStiffnessPreset).toBeUndefined()
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
    expect(r.materialInputs.lengthMm).toBe(500)
    expect(r.materialInputs.stiffnessPreset).toBe('steelStringTop')
  })
})

describe('buildMaterialMeasurement — save round-trip (live → model → file → restore)', () => {
  const matPeak = (id: number, f: number, mag: number) => ({ id, frequency: f, magnitude: mag, quality: 20, bandwidth: 5 })
  const built = buildMaterialMeasurement({
    name: 'Top Plate',
    notes: 'spruce',
    spectra: {
      longitudinal: { frequencies: [100, 120, 140], magnitudesDb: [-50, -40, -60] },
      cross: { frequencies: [200, 250, 300], magnitudesDb: [-55, -45, -65] },
      flc: null,
    },
    peaks: { longitudinal: matPeak(0, 120, -40), cross: matPeak(1, 250, -45), flc: null },
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
    // Store B is the source for the saved dims (the measurement's own values).
    materialInputs: {
      lengthMm: 500, widthMm: 200, thicknessMm: 3, massG: 100,
      bodyLengthMm: DEFAULT_SETTINGS.guitarBodyLength, bodyWidthMm: DEFAULT_SETTINGS.guitarBodyWidth,
      stiffnessPreset: 'steelStringTop', customStiffness: DEFAULT_SETTINGS.customPlateStiffness,
    },
    // A real multi-tap count: the builder used to hardcode `numberOfTaps: 1`, so every
    // saved material measurement claimed one tap however many were captured+averaged.
    numberOfTaps: 3,
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
  })

  // REGRESSION: the builder hardcoded `numberOfTaps: 1` while the guitar builder passed the real
  // count, so a 3-tap plate/brace saved "1" — in the FILE, so it reached the Details pane, the PDF,
  // and any reload. The capture and the power-domain average were correct; only the count was wrong.
  // The old assertion here read `toBe(1)` and pinned the literal, which is why it never caught it:
  // the builder ignored its caller, so no value the caller passed could fail the test.
  it('saves the REAL tap count, not a hardcoded 1 (Swift/Python write the true count)', () => {
    expect(built.numberOfTaps).toBe(3)
  })

  it('carries the real tap count through the file round-trip', () => {
    const m = parseGuitarTapFile(serializeGuitarTapFile([built]))[0]!
    expect(m.numberOfTaps).toBe(3)
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
    expect(r.materialInputs.lengthMm).toBe(500)
    expect(r.materialInputs.stiffnessPreset).toBe('steelStringTop')
  })
})

// 6d: material L/C/FLC labels drag exactly like guitar labels, reusing the single shared
// peakAnnotationOffsets store. The live store is keyed by `frequency.toFixed(1)`; persistence is
// keyed by peak UUID (gold-standard format) — this asserts the build→file→restore re-keying both ways.
describe('material annotation offsets round-trip (6d)', () => {
  const matPeak = (id: number, f: number, mag: number) => ({ id, frequency: f, magnitude: mag, quality: 20, bandwidth: 5 })
  const built = buildMaterialMeasurement({
    name: 'Top Plate',
    notes: '',
    spectra: {
      longitudinal: { frequencies: [100, 120, 140], magnitudesDb: [-50, -40, -60] },
      cross: { frequencies: [200, 250, 300], magnitudesDb: [-55, -45, -65] },
      flc: null,
    },
    peaks: { longitudinal: matPeak(0, 120, -40), cross: matPeak(1, 250, -45), flc: null },
    view: { minHz: 10, maxHz: 300, minDb: -100, maxDb: 0 },
    settings: { ...DEFAULT_SETTINGS, measurementType: 'plate' as const },
    materialInputs: materialInputsFromSettings('plate', { ...DEFAULT_SETTINGS, measurementType: 'plate' as const }),
    numberOfTaps: 1,
    sampleRate: 48000,
    deviceLabel: 'Test Mic',
    // Drag only the longitudinal label; cross is left un-dragged.
    annotationOffsetsById: new Map<number, [number, number]>([[0, [125, -38]]]),
  })

  it('writes the dragged offset into peakAnnotationOffsets keyed by the L peak UUID', () => {
    const lId = built.selectedLongitudinalPeakID!
    expect(built.peakAnnotationOffsets).toBeDefined()
    expect(built.peakAnnotationOffsets![lId]).toEqual([125, -38])
    // The un-dragged cross peak gets no entry.
    expect(built.peakAnnotationOffsets![built.selectedCrossPeakID!]).toBeUndefined()
  })

  it('restores the offset re-keyed by material peak id after a file round-trip', () => {
    const m = parseGuitarTapFile(serializeGuitarTapFile([built]))[0]!
    const r = measurementToLiveMaterial(m)
    // Restored material peaks get ids in L,C,FLC order (RB): L=0 (was dragged), C=1 (not).
    expect(r.annotationOffsetsById.get(0)).toEqual([125, -38])
    expect(r.annotationOffsetsById.has(1)).toBe(false)
  })

  it('omits peakAnnotationOffsets entirely when no labels were dragged', () => {
    const plain = buildMaterialMeasurement({
      name: '', notes: '',
      spectra: { longitudinal: { frequencies: [100, 120], magnitudesDb: [-50, -40] }, cross: null, flc: null },
      peaks: { longitudinal: matPeak(0, 120, -40), cross: null, flc: null },
      view: { minHz: 10, maxHz: 300, minDb: -100, maxDb: 0 },
      settings: { ...DEFAULT_SETTINGS, measurementType: 'plate' as const },
      materialInputs: materialInputsFromSettings('plate', { ...DEFAULT_SETTINGS, measurementType: 'plate' as const }),
      numberOfTaps: 1,
      sampleRate: 48000,
      deviceLabel: 'Test Mic',
    })
    expect(plain.peakAnnotationOffsets).toBeUndefined()
  })
})

// Regression: the PDF/PNG export data builder must source dims, body size, AND stiffness from the
// measurement's own Store B (materialInputs) — never DEFAULT_SETTINGS. Chunk A moved dims out of the
// settings patch but this builder kept reading them, so exports computed density/moduli/Gore from the
// template (500×200 plate, steelStringTop) instead of the sample. (Swift V-A#4; missed on web.)
describe('measurementToPdfData — material analysis reads Store B dims, not defaults', () => {
  const matPeak = (id: number, f: number, mag: number) => ({ id, frequency: f, magnitude: mag, quality: 20, bandwidth: 5 })
  const inputs = {
    ...materialInputsFromSettings('plate', { ...DEFAULT_SETTINGS, measurementType: 'plate' as const }),
    lengthMm: 610, // ≠ DEFAULT 500
    widthMm: 175, // ≠ DEFAULT 200
    thicknessMm: 4.5,
    massG: 92,
    bodyLengthMm: 480,
    bodyWidthMm: 355,
    stiffnessPreset: 'classicalBack' as const, // ≠ DEFAULT steelStringTop; raw name "Classical Back"
  }
  const built = buildMaterialMeasurement({
    name: 'Reg', notes: '',
    spectra: {
      longitudinal: { frequencies: [100, 120, 140], magnitudesDb: [-50, -40, -60] },
      cross: { frequencies: [200, 250, 300], magnitudesDb: [-55, -45, -65] },
      flc: null,
    },
    peaks: { longitudinal: matPeak(0, 120, -40), cross: matPeak(1, 250, -45), flc: null },
    view: { minHz: 10, maxHz: 300, minDb: -100, maxDb: 0 },
    settings: { ...DEFAULT_SETTINGS, measurementType: 'plate' as const, measureFlc: false },
    materialInputs: inputs,
    numberOfTaps: 1, sampleRate: 48000, deviceLabel: 'Test Mic',
  })
  // Round-trip through the file so this exercises the saved-measurement export path exactly.
  const m = parseGuitarTapFile(serializeGuitarTapFile([built]))[0]!
  const data = measurementToPdfData(m)
  const a = data.materialAnalysis!

  it('Sample Dimensions come from the measurement (not DEFAULT 500×200)', () => {
    const byLabel = Object.fromEntries(a.dimensions.map((d) => [d.label, d.value]))
    expect(byLabel['Length']).toBe('610.00 mm')
    expect(byLabel['Width']).toBe('175.00 mm')
    expect(byLabel['Thickness']).toBe('4.50 mm')
    expect(byLabel['Mass']).toBe('92.0 g')
  })

  it('Body Dimensions + Panel Stiffness come from the measurement', () => {
    expect(a.body?.dims[0]?.value).toBe('480 mm')
    expect(a.body?.dims[1]?.value).toBe('355 mm')
    expect(a.body?.stiffness.value).toContain('Classical Back')
    expect(a.body?.stiffness.value).toContain('50')
  })

  it('drops the frequency band and uses the fL/fC role naming', () => {
    expect((a as unknown as { freqs?: unknown }).freqs).toBeUndefined()
    expect(data.peaks.map((p) => p.role)).toEqual(['Longitudinal (fL)', 'Cross-grain (fC)'])
  })
})