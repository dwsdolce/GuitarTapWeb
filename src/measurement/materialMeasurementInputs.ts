// @parity model/material-measurement-inputs
// The material inputs of the CURRENT measurement — "Store B" in the measurement-dimensions design
// (Development/MEASUREMENT-DIMENSIONS-SPEC.md), the web mirror of Swift MaterialMeasurementInputs /
// Python material_measurement_inputs. It is the SOLE source for a material measurement's derived
// properties, Results-panel display, PDF, and Save — distinct from `Settings` (Store A), which holds
// only the defaults for a NEW measurement. A measurement's values are seeded from Settings at
// completion, restored from the file's snapshot on load, and (Chunk B) edited in the Results panel —
// none of which touch Settings. `null` for guitar, and before a material measurement completes.
//
// `measureFlc` is deliberately NOT here (mirrors Swift): it decides at capture whether the FLC phase
// is tapped; the completed calc keys on whether an FLC peak was captured, not on this flag.

import type { Dimensions } from '../dsp/material'
import { STIFFNESS_VALUE, STIFFNESS_FROM_RAW, type Settings, type StiffnessPreset } from '../settings'
import type { SpectrumSnapshotModel } from './types'

export interface MaterialMeasurementInputs {
  lengthMm: number
  widthMm: number
  thicknessMm: number
  massG: number
  // Plate-only (Gore target thickness); carried but unused for brace.
  bodyLengthMm: number
  bodyWidthMm: number
  stiffnessPreset: StiffnessPreset
  customStiffness: number
}

/** The four sample dimensions as a `Dimensions` for the property calculations (Swift `.dimensions`). */
export function materialDimensions(mi: MaterialMeasurementInputs): Dimensions {
  return { lengthMm: mi.lengthMm, widthMm: mi.widthMm, thicknessMm: mi.thicknessMm, massG: mi.massG }
}

/** Effective vibrational stiffness f_vs — the custom value when the preset is Custom, else the
 *  preset's value. Mirrors Swift `MaterialMeasurementInputs.stiffness`. */
export function materialStiffness(mi: MaterialMeasurementInputs): number {
  return mi.stiffnessPreset === 'custom' ? mi.customStiffness : STIFFNESS_VALUE[mi.stiffnessPreset]
}

/** Snapshot the current Settings defaults (Store A) for a measurement of `type` — used to seed the
 *  measurement's own values when it completes. Mirrors Swift `fromSettings(for:)`. */
export function materialInputsFromSettings(type: 'plate' | 'brace', s: Settings): MaterialMeasurementInputs {
  const brace = type === 'brace'
  return {
    lengthMm: brace ? s.braceLength : s.plateLength,
    widthMm: brace ? s.braceWidth : s.plateWidth,
    thicknessMm: brace ? s.braceThickness : s.plateThickness,
    massG: brace ? s.braceMass : s.plateMass,
    bodyLengthMm: s.guitarBodyLength,
    bodyWidthMm: s.guitarBodyWidth,
    stiffnessPreset: s.plateStiffnessPreset,
    customStiffness: s.customPlateStiffness,
  }
}

/** Build Store B from a loaded measurement's snapshot dims — used on load instead of clobbering
 *  Settings. Missing fields fall back to 0 / the current-type stiffness default. */
export function materialInputsFromSnapshot(type: 'plate' | 'brace', snap: SpectrumSnapshotModel): MaterialMeasurementInputs {
  const brace = type === 'brace'
  const preset: StiffnessPreset =
    snap.plateStiffnessPreset != null ? (STIFFNESS_FROM_RAW[snap.plateStiffnessPreset] ?? 'custom') : 'steelStringTop'
  return {
    lengthMm: (brace ? snap.braceLength : snap.plateLength) ?? 0,
    widthMm: (brace ? snap.braceWidth : snap.plateWidth) ?? 0,
    thicknessMm: (brace ? snap.braceThickness : snap.plateThickness) ?? 0,
    massG: (brace ? snap.braceMass : snap.plateMass) ?? 0,
    bodyLengthMm: snap.guitarBodyLength ?? 0,
    bodyWidthMm: snap.guitarBodyWidth ?? 0,
    stiffnessPreset: preset,
    customStiffness: snap.customPlateStiffness ?? 0,
  }
}
