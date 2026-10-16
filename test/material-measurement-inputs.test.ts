// @parity test/material-measurement-inputs
//
// A material measurement's own dimensions (Store B, the analyzer's `materialInputs`) and its notes: taken
// from the Settings defaults (Store A) at completion, from the file on a load — which never writes the
// Settings defaults — and written by a save. The shared cases in material-measurement-inputs.json
// (M1–M13), the same as Swift and Python, run through an analyzer attached to its own settings store.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { parseGuitarTapFile, MEASUREMENT_TYPE_FROM_RAW } from '../src/measurement'
import { SettingsStore } from '../src/settingsStore'
import { DEFAULT_SETTINGS, STIFFNESS_FROM_RAW, STIFFNESS_RAW_NAME, type Settings } from '../src/settings'
import type { MaterialMeasurementInputs } from '../src/measurement/materialMeasurementInputs'
import type { TapToneMeasurementModel } from '../src/measurement/types'

type Step = {
  settings?: Record<string, string | number>
  complete?: boolean
  loading?: boolean
  clearInputs?: boolean
  hasInputs?: boolean
  load?: string
  notes?: string
  save?: boolean
}
type InputsCase = { id: string; note: string; steps: Step[]; expect: Record<string, unknown> }
const DATA = JSON.parse(readFileSync('test/fixtures/material-measurement-inputs.json', 'utf8')) as {
  files: Record<string, unknown[]>
  cases: InputsCase[]
}

/** Store B's fields by the case file's names (Swift's). */
const INPUT_FIELDS: Record<string, keyof MaterialMeasurementInputs> = {
  lengthMM: 'lengthMm', widthMM: 'widthMm', thicknessMM: 'thicknessMm', massG: 'massG',
  bodyLengthMM: 'bodyLengthMm', bodyWidthMM: 'bodyWidthMm', stiffnessPreset: 'stiffnessPreset',
  customStiffness: 'customStiffness',
}

/** A setting from the case file (Swift's names; the type and preset by their saved names) as the store holds it. */
function settingPatch(name: string, value: string | number): Partial<Settings> {
  if (name === 'measurementType') return { measurementType: MEASUREMENT_TYPE_FROM_RAW[value as string]! }
  if (name === 'plateStiffnessPreset') return { plateStiffnessPreset: STIFFNESS_FROM_RAW[value as string]! }
  return { [name]: value } as Partial<Settings>
}

/** The inline file a load step names, with its notes replaced when the step gives them. */
function measurement(step: Step): TapToneMeasurementModel {
  const file = JSON.parse(JSON.stringify(DATA.files[step.load!])) as Record<string, unknown>[]
  if (step.notes !== undefined) file[0]!.notes = step.notes
  return parseGuitarTapFile(JSON.stringify(file))[0]!
}

describe('material-measurement-inputs — the shared cases (material-measurement-inputs.json)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const store = new SettingsStore({ ...DEFAULT_SETTINGS })
    const a = new TapToneAnalyzer()
    a.attachSettingsStore(store)
    let saved: TapToneMeasurementModel | null = null
    for (const step of c.steps) {
      if (step.settings) {
        // The type first, as a load applies it before the rest.
        if (step.settings.measurementType !== undefined) {
          store.update(settingPatch('measurementType', step.settings.measurementType))
        }
        for (const [name, value] of Object.entries(step.settings)) {
          if (name !== 'measurementType') store.update(settingPatch(name, value))
        }
      }
      else if (step.complete) a.isMeasurementComplete = true
      else if (step.loading !== undefined) a.isLoadingMeasurement = step.loading
      else if (step.clearInputs) a.materialInputs = null
      else if (step.hasInputs !== undefined) {
        expect(a.materialInputs !== null, 'precondition: has dimensions').toBe(step.hasInputs)
      }
      else if (step.load !== undefined) a.loadMeasurement(measurement(step))
      else if (step.save) saved = a.buildMeasurement('', '', { minHz: 50, maxHz: 300, minDb: -100, maxDb: 0 })
    }

    const s = store.get()
    for (const [field, want] of Object.entries(c.expect)) {
      switch (field) {
        case 'inputs': {
          if (want === null) {
            expect(a.materialInputs, field).toBeNull()
            break
          }
          const mi = a.materialInputs
          expect(mi, 'dimensions').not.toBeNull()
          for (const [key, value] of Object.entries(want as Record<string, string | number>)) {
            if (key === 'stiffnessPreset') expect(STIFFNESS_RAW_NAME[mi!.stiffnessPreset], key).toBe(value)
            else expect(mi![INPUT_FIELDS[key]!] as number, key).toBeCloseTo(value as number, 4)
          }
          break
        }
        case 'settings':
          for (const [name, value] of Object.entries(want as Record<string, number>)) {
            expect(s[name as keyof Settings] as number, `setting ${name}`).toBeCloseTo(value, 4)
          }
          break
        case 'saved': {
          const snap = saved?.longitudinalSnapshot
          expect(snap, 'saved snapshot').toBeTruthy()
          for (const [key, value] of Object.entries(want as Record<string, string | number>)) {
            const actual = snap![key as keyof typeof snap]
            if (typeof value === 'string') expect(actual, key).toBe(value)
            else expect(actual as number, key).toBeCloseTo(value, 4)
          }
          break
        }
        case 'loadedNotes': expect(a.loadedNotes, field).toBe(want); break
        default: throw new Error(`unknown field ${field}`)
      }
    }
  })
})
