// App settings, mirroring the native TapDisplaySettings. Persisted to localStorage
// (the web equivalent of UserDefaults / @AppStorage).

import type { GuitarTypeName } from './dsp/guitarModes'

export type MeasurementType = GuitarTypeName | 'plate' | 'brace'
export type StiffnessPreset = 'steelStringTop' | 'steelStringBack' | 'classicalTop' | 'classicalBack' | 'custom'

// Which peak annotations to render on the chart (AnnotationVisibilityMode.swift).
// Cycle: all → selected → none. A transient display preference (persisted to
// UserDefaults in Swift); does not affect which peaks are stored/selected.
export type AnnotationMode = 'all' | 'selected' | 'none'
export const ANNOTATION_NEXT: Record<AnnotationMode, AnnotationMode> = {
  all: 'selected',
  selected: 'none',
  none: 'all',
}
export const ANNOTATION_LABEL: Record<AnnotationMode, string> = {
  all: 'All',
  selected: 'Selected',
  none: 'None',
}

export const MEASUREMENT_TYPES: MeasurementType[] = [
  'generic',
  'acoustic',
  'classical',
  'flamenco',
  'plate',
  'brace',
]

// Native MeasurementType.rawValue (full) and shortName (badge).
export const MEASUREMENT_FULL_NAME: Record<MeasurementType, string> = {
  generic: 'Generic Guitar',
  acoustic: 'Acoustic Guitar',
  classical: 'Classical Guitar',
  flamenco: 'Flamenco Guitar',
  plate: 'Material (Plate)',
  brace: 'Material (Brace)',
}
export const MEASUREMENT_SHORT_NAME: Record<MeasurementType, string> = {
  generic: 'Generic',
  acoustic: 'Acoustic',
  classical: 'Classical',
  flamenco: 'Flamenco',
  plate: 'Plate',
  brace: 'Brace',
}

export const isGuitarType = (t: MeasurementType): t is GuitarTypeName =>
  t === 'generic' || t === 'acoustic' || t === 'classical' || t === 'flamenco'
export const isMaterialType = (t: MeasurementType): t is 'plate' | 'brace' => t === 'plate' || t === 'brace'

// Plate stiffness presets (PlateStiffnessPreset.swift): target longitudinal stiffness.
export const STIFFNESS_VALUE: Record<StiffnessPreset, number> = {
  steelStringTop: 75,
  steelStringBack: 55,
  classicalTop: 60,
  classicalBack: 50,
  custom: 0,
}
export const STIFFNESS_LABEL: Record<StiffnessPreset, string> = {
  steelStringTop: 'Steel String Top (75)',
  steelStringBack: 'Steel String Back (55)',
  classicalTop: 'Classical Top (60)',
  classicalBack: 'Classical Back (50)',
  custom: 'Custom',
}

export interface Settings {
  measurementType: MeasurementType
  // Plate
  plateLength: number
  plateWidth: number
  plateThickness: number
  plateMass: number
  plateStiffnessPreset: StiffnessPreset
  customPlateStiffness: number
  measureFlc: boolean
  guitarBodyLength: number
  guitarBodyWidth: number
  // Brace
  braceLength: number
  braceWidth: number
  braceThickness: number
  braceMass: number
  // Display Settings
  displayMinHz: number
  displayMaxHz: number
  minDb: number
  maxDb: number
  // Analysis Settings
  showUnknownModes: boolean
  analysisMinHz: number
  analysisMaxHz: number
  peakMinThreshold: number
  dumpCaptureAudio: boolean
  // Tap-control bar value persisted immediately on change (like Swift's didSet →
  // TapDisplaySettings). NOTE: numberOfTaps is deliberately NOT persisted (Swift
  // defaults it to 1 each launch).
  tapDetectionThreshold: number
  // Chart annotation visibility — persisted immediately on cycle (Swift persists it
  // to UserDefaults; it bypasses the Settings dialog). Auto-dB is NOT persisted
  // (session-only @State in Swift) so it lives in App state, not here.
  annotationVisibilityMode: AnnotationMode
}

// Defaults mirror TapDisplaySettings.swift / tap_display_settings.py.
export const DEFAULT_SETTINGS: Settings = {
  measurementType: 'generic',
  plateLength: 500,
  plateWidth: 200,
  plateThickness: 3,
  plateMass: 100,
  plateStiffnessPreset: 'steelStringTop',
  customPlateStiffness: 75,
  measureFlc: false,
  guitarBodyLength: 490,
  guitarBodyWidth: 390,
  braceLength: 300,
  braceWidth: 6,
  braceThickness: 12,
  braceMass: 8,
  displayMinHz: 75,
  displayMaxHz: 350,
  minDb: -100,
  maxDb: 0,
  showUnknownModes: false,
  analysisMinHz: 30,
  analysisMaxHz: 2000,
  peakMinThreshold: -60,
  dumpCaptureAudio: false,
  tapDetectionThreshold: -40,
  annotationVisibilityMode: 'selected',
}

// Default keys grouped for the two "Reset" buttons in Advanced settings.
export const DISPLAY_KEYS = ['displayMinHz', 'displayMaxHz', 'minDb', 'maxDb'] as const
export const ANALYSIS_KEYS = ['showUnknownModes', 'analysisMinHz', 'analysisMaxHz', 'peakMinThreshold', 'dumpCaptureAudio'] as const

const KEY = 'guitartap-settings'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage may be unavailable (private mode) */
  }
}

/** Effective plate stiffness target (preset value, or custom). */
export const effectiveStiffness = (s: Settings): number =>
  s.plateStiffnessPreset === 'custom' ? s.customPlateStiffness : STIFFNESS_VALUE[s.plateStiffnessPreset]
