// @parity test/material-measurement-inputs
//
// The two-store material-dimensions model — web mirror of Swift MaterialMeasurementInputsTests /
// Python test_material_measurement_inputs.py. A measurement's own dimensions (Store B) are seeded from
// the Settings template (Store A) at completion, restored from the file's snapshot on load, and —
// crucially — loading NEVER writes the Settings defaults (the origin bug this design fixes). See
// Development/MEASUREMENT-DIMENSIONS-SPEC.md.
//
// The SEED-GATING cases below drive the analyzer directly, exactly as Swift and Python do. They could
// not be written until #17 F26 moved Store B onto the analyzer and the seed into
// `isMeasurementComplete`'s setter: while the seed was a guarded `useEffect` in App.tsx, this file's
// header recorded the three canonical cases as untestable "React behaviour, covered by run-review".
// That is METHOD rule 4 — an n/a resting on the view driving the model is a finding, not a difference.
//
// The loadedNotes STATE cases (`loadRestoresNotesForReSave` / `loadTreatsBlankNotesAsNil`) remain
// App.tsx state and are still run-review territory. The SOURCING cases at the pure `fromLive`/helper
// layer — the seed's data mapping, load → Store B, "Settings untouched" (= settingsPatch carries no
// dimensions), and save reading Store B — are here too.

import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../src/settings'
import {
  materialInputsFromSettings,
  type MaterialMeasurementInputs,
} from '../src/measurement/materialMeasurementInputs'
import { measurementToLiveMaterial, buildMaterialMeasurement } from '../src/measurement/fromLive'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { serializeGuitarTapFile, parseGuitarTapFile, type TapToneMeasurementModel } from '../src/measurement'

/** A minimal loadable plate measurement whose snapshot carries its own dimensions (mirrors the
 *  canonical `plateMeasurement` fixture; `preset` is the persisted raw name, Swift `.rawValue`). */
function plateMeasurement(
  opts: {
    notes?: string
    length?: number; width?: number; thickness?: number; mass?: number
    bodyLength?: number; bodyWidth?: number; preset?: string
  } = {},
): TapToneMeasurementModel {
  const {
    notes, length = 111, width = 222, thickness = 3.33, mass = 44,
    bodyLength = 480, bodyWidth = 370, preset = 'Classical Top',
  } = opts
  return {
    id: 'MMI',
    timestamp: '2026-03-09T18:46:19Z',
    peaks: [],
    notes,
    longitudinalSnapshot: {
      frequencies: [100, 200],
      magnitudes: [-10, -20],
      minFreq: 50, maxFreq: 300, minDB: -100, maxDB: 0,
      isLogarithmic: false,
      measurementType: 'Material (Plate)',
      plateLength: length, plateWidth: width, plateThickness: thickness, plateMass: mass,
      guitarBodyLength: bodyLength, guitarBodyWidth: bodyWidth,
      plateStiffnessPreset: preset, customPlateStiffness: 60,
    },
  }
}

const STORE_B_PLATE: MaterialMeasurementInputs = {
  lengthMm: 111, widthMm: 222, thicknessMm: 3.33, massG: 44,
  bodyLengthMm: 480, bodyWidthMm: 370, stiffnessPreset: 'classicalTop', customStiffness: 60,
}

/** Build a saved plate measurement through the real save builder, with the Settings template and Store B
 *  set independently so a test can prove which one the snapshot dimensions come from. */
function buildPlate(materialInputs: MaterialMeasurementInputs, settingsDims: Partial<Settings>, notes = '') {
  return buildMaterialMeasurement({
    name: 'X', notes,
    spectra: { longitudinal: { frequencies: [100, 200], magnitudesDb: [-10, -20] }, cross: null, flc: null },
    peaks: { longitudinal: { id: 0, frequency: 120, magnitude: -40, quality: 20, bandwidth: 5 }, cross: null, flc: null },
    view: { minHz: 10, maxHz: 300, minDb: -100, maxDb: 0 },
    settings: { ...DEFAULT_SETTINGS, measurementType: 'plate' as const, ...settingsDims },
    materialInputs,
    numberOfTaps: 1,
    sampleRate: 48000,
    deviceLabel: 'Test Mic',
  })
}

// ── Seed at complete — the seed's data mapping (Swift seedsStoreBFromSettingsWhenPlateCompletes) ──────
// The gating (nil-until-complete etc.) is the App useEffect; here we pin what the seed COPIES.

describe('seed at complete — materialInputsFromSettings maps the Settings template → Store B', () => {
  it('plate reads the plate dims + body + stiffness preset', () => {
    const s: Settings = {
      ...DEFAULT_SETTINGS, measurementType: 'plate',
      plateLength: 501, plateWidth: 201, plateThickness: 4.5, plateMass: 210,
      plateStiffnessPreset: 'classicalTop', guitarBodyLength: 480, guitarBodyWidth: 370,
    }
    const mi = materialInputsFromSettings('plate', s)
    expect(mi.lengthMm).toBe(501)
    expect(mi.widthMm).toBe(201)
    expect(mi.thicknessMm).toBe(4.5)
    expect(mi.massG).toBe(210)
    expect(mi.stiffnessPreset).toBe('classicalTop')
    expect(mi.bodyLengthMm).toBe(480)
    expect(mi.bodyWidthMm).toBe(370)
  })

  it('brace reads the brace dims (not the plate ones)', () => {
    const s: Settings = {
      ...DEFAULT_SETTINGS,
      braceLength: 300, braceWidth: 25, braceThickness: 6, braceMass: 12,
      plateLength: 999, plateWidth: 999,
    }
    const mi = materialInputsFromSettings('brace', s)
    expect(mi.lengthMm).toBe(300)
    expect(mi.widthMm).toBe(25)
    expect(mi.thicknessMm).toBe(6)
    expect(mi.massG).toBe(12)
  })
})

// ── Load sets Store B without clobbering Settings — the origin bug ────────────────────────────────────
// (Swift loadSetsStoreBFromSnapshotAndLeavesSettingsUntouched.) On the web, load applies
// `settingsPatch` to Settings; "Settings untouched" therefore means the patch carries NO dimensions.

// ── Seed gating — the didSet rules, mirroring Swift doesNotSeedStoreB* / Python's equivalents ──
// Store B is seeded from Settings at the material completion TRANSITION and at no other moment.

/** An analyzer with the plate dimensions of the Swift fixture pushed in, as App's layout effect does. */
function seedSUT(type: 'plate' | 'brace' | 'classical'): TapToneAnalyzer {
  const s = new TapToneAnalyzer()
  s.measurementType = type
  s.setSettings({
    ...DEFAULT_SETTINGS,
    measurementType: type,
    plateLength: 501, plateWidth: 201, plateThickness: 4.5, plateMass: 210,
    plateStiffnessPreset: 'classicalTop',
  })
  return s
}

describe('seed gating — Store B is seeded at the completion transition and nowhere else', () => {
  // Mirrors Swift seedsStoreBFromSettingsWhenPlateCompletes / Python
  // test_seeds_store_b_from_settings_when_plate_completes.
  it('plate completion seeds Store B from Settings', () => {
    const s = seedSUT('plate')
    expect(s.materialInputs).toBeNull() // null until the measurement completes
    s.isMeasurementComplete = true
    expect(s.materialInputs).not.toBeNull()
    expect(s.materialInputs!.lengthMm).toBe(501)
    expect(s.materialInputs!.widthMm).toBe(201)
    expect(s.materialInputs!.thicknessMm).toBe(4.5)
    expect(s.materialInputs!.massG).toBe(210)
  })

  // Mirrors Swift doesNotSeedStoreBForGuitar / Python test_does_not_seed_store_b_for_guitar.
  it('guitar completion does not seed Store B', () => {
    const s = seedSUT('classical')
    s.isMeasurementComplete = true
    expect(s.materialInputs).toBeNull() // guitar has no material dimensions
  })

  // Mirrors Swift doesNotSeedStoreBWhileLoading / Python test_does_not_seed_store_b_while_loading.
  it('completion while loading does not seed Store B', () => {
    const s = seedSUT('plate')
    s.isLoadingMeasurement = true
    s.isMeasurementComplete = true // the load path sets complete; the seed must be suppressed
    expect(s.materialInputs).toBeNull() // load sets Store B from the snapshot instead
    s.isLoadingMeasurement = false
  })

  // The guard is the TRANSITION, not "Store B is empty". This is the case the old useEffect got
  // wrong: guarded on `matInputs == null`, it re-seeded from Settings whenever Store B was cleared
  // while still complete. Swift and Python, having spent their one transition, do not (#17 F26).
  it('re-asserting completion does not re-seed a cleared Store B', () => {
    const s = seedSUT('plate')
    s.isMeasurementComplete = true
    expect(s.materialInputs).not.toBeNull()
    s.materialInputs = null           // something clears Store B while still complete
    s.isMeasurementComplete = true    // no transition — must not re-seed
    expect(s.materialInputs).toBeNull()
  })

  // restoreMaterial holds isLoadingMeasurement across the completion assignment, so a load shows the
  // file's own dimensions. Mirrors Swift loadMeasurement holding the flag across the whole restore.
  it('restoreMaterial keeps the file dimensions instead of re-seeding', () => {
    const s = seedSUT('plate')
    const loaded: MaterialMeasurementInputs = materialInputsFromSettings('plate', {
      ...DEFAULT_SETTINGS, plateLength: 111, plateWidth: 222, plateThickness: 3.33, plateMass: 44,
    })
    s.restoreMaterial({ matSpectra: s.matSpectra, matPeaks: s.matPeaks, materialInputs: loaded })
    expect(s.isMeasurementComplete).toBe(true)
    expect(s.materialInputs!.lengthMm).toBe(111) // the file's dims, not the 501 Settings template
    expect(s.isLoadingMeasurement).toBe(false)   // the window is closed again
  })
})

describe('load sets Store B from the snapshot and never clobbers the Settings template', () => {
  const r = measurementToLiveMaterial(plateMeasurement())

  it('Store B carries the measurement’s OWN dimensions (from the snapshot)', () => {
    expect(r.materialInputs.lengthMm).toBe(111)
    expect(r.materialInputs.widthMm).toBe(222)
    expect(r.materialInputs.thicknessMm).toBe(3.33)
    expect(r.materialInputs.massG).toBe(44)
    expect(r.materialInputs.bodyLengthMm).toBe(480)
    expect(r.materialInputs.bodyWidthMm).toBe(370)
    expect(r.materialInputs.stiffnessPreset).toBe('classicalTop')
  })

  it('settingsPatch carries only the type (+ measureFlc) — NO dimensions (the de-clobber invariant)', () => {
    const dimKeys = [
      'plateLength', 'plateWidth', 'plateThickness', 'plateMass',
      'braceLength', 'braceWidth', 'braceThickness', 'braceMass',
      'guitarBodyLength', 'guitarBodyWidth', 'plateStiffnessPreset', 'customPlateStiffness',
    ] as const
    for (const k of dimKeys) expect(k in r.settingsPatch).toBe(false)
    expect(r.settingsPatch.measurementType).toBe('plate')
  })
})

// ── Save writes Store B, not Settings — the sourcing invariant the origin bug violated ────────────────

describe('save writes the snapshot dimensions from Store B, ignoring the Settings template', () => {
  const built = buildPlate(STORE_B_PLATE, { plateLength: 999, plateWidth: 999, plateThickness: 9.9, plateMass: 999 })
  const snap = built.longitudinalSnapshot!

  it('snapshot dims come from Store B (111/222/…), not the 999 Settings template', () => {
    expect(snap.plateLength).toBe(111)
    expect(snap.plateWidth).toBe(222)
    expect(snap.plateThickness).toBe(3.33)
    expect(snap.plateMass).toBe(44)
    expect(snap.guitarBodyLength).toBe(480)
    expect(snap.guitarBodyWidth).toBe(370)
    expect(snap.plateStiffnessPreset).toBe('Classical Top') // persisted raw name for classicalTop
  })
})

// ── Notes round-trip on save (Swift loadRestoresNotesForReSave / loadTreatsBlankNotesAsNil) ────────────
// The load→loadedNotes state (and Swift's blank→nil) is App state, verified by V-C; here the model-layer
// round-trip is what's unit-testable.

describe('notes survive save + file round-trip', () => {
  it('non-empty notes are written and restored', () => {
    const built = buildPlate(STORE_B_PLATE, {}, 'spruce, tight grain')
    expect(built.notes).toBe('spruce, tight grain')
    const rt = parseGuitarTapFile(serializeGuitarTapFile([built]))[0]!
    expect(rt.notes).toBe('spruce, tight grain')
  })
})
