// App settings, mirroring the native TapDisplaySettings. Persisted to localStorage
// (the web equivalent of UserDefaults / @AppStorage).
// @parity state/settings-store tests=test/settings-store

import type { GuitarTypeName } from './dsp/guitarModes'
import {
  MIN_FREQUENCY_HZ,
  MAX_FREQUENCY_HZ,
  MIN_MAGNITUDE_DB,
  MAX_MAGNITUDE_DB,
  MIN_FREQUENCY_SPAN_HZ,
  MIN_MAGNITUDE_SPAN_DB,
} from './presentation/chartLimits'

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

// Per-type one-line description shown under the picker. Mirrors Swift MeasurementType.description.
export const MEASUREMENT_DESCRIPTION: Record<MeasurementType, string> = {
  generic: 'Broad ranges covering all guitar types',
  acoustic: 'Steel string, X-braced (Dreadnought, OM, etc.)',
  classical: 'Nylon string, fan-braced, deep body',
  flamenco: 'Nylon string, light bracing, shallow body',
  plate: 'Rectangular wood plate for calculating stiffness and sound radiation',
  brace: 'Brace strip — measures longitudinal stiffness (fL only)',
}

/** The analysis frequency range for peak detection (Hz) — a fixed bound on where useful modes live:
 *  30 Hz reaches the material fLC, and nothing useful sits above 2000 Hz. Distinct from the display
 *  range, which stays user-controllable. Mirrors Swift TapDisplaySettings.analysisMin/MaxFrequency /
 *  Python analysis_min/max_frequency. */
export const ANALYSIS_MIN_HZ = 30
export const ANALYSIS_MAX_HZ = 2000

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
// Compact label shown in the settings picker — mirrors Swift PlateStiffnessPreset.shortName.
export const STIFFNESS_LABEL: Record<StiffnessPreset, string> = {
  steelStringTop: 'SS Top (75)',
  steelStringBack: 'SS Back (55)',
  classicalTop: 'Classical Top (60)',
  classicalBack: 'Classical Back (50)',
  custom: 'Custom',
}
// Persisted / results preset NAME — mirrors Swift PlateStiffnessPreset.rawValue (shown in the
// f_vs results line, distinct from the compact picker label above).
export const STIFFNESS_RAW_NAME: Record<StiffnessPreset, string> = {
  steelStringTop: 'Steel String Top',
  steelStringBack: 'Steel String Back',
  classicalTop: 'Classical Top',
  classicalBack: 'Classical Back',
  custom: 'Custom',
}
// Reverse of STIFFNESS_RAW_NAME: a snapshot's persisted preset name (Swift rawValue) → web preset.
export const STIFFNESS_FROM_RAW: Record<string, StiffnessPreset> = Object.fromEntries(
  Object.entries(STIFFNESS_RAW_NAME).map(([preset, raw]) => [raw, preset as StiffnessPreset]),
) as Record<string, StiffnessPreset>

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
  // Display Settings — the frequency range is PER measurement type, each bound stored on its own
  // (Swift keys displayMinFreq_<rawValue> / displayMaxFreq_<rawValue>). A bound that was never set
  // reads the type's default — read and write through minFrequency / maxFrequency /
  // setMinFrequency / setMaxFrequency. The dB range stays global, matching Swift/Python.
  displayRanges: Partial<Record<MeasurementType, { minHz?: number; maxHz?: number }>>
  minDb: number
  maxDb: number
  // Analysis Settings
  showUnknownModes: boolean
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
  displayRanges: {},
  minDb: -100,
  maxDb: 0,
  showUnknownModes: true,
  peakMinThreshold: -60,
  dumpCaptureAudio: false,
  tapDetectionThreshold: -40,
  annotationVisibilityMode: 'selected',
}

// Per-measurement-type default display frequency range (Hz). Mirrors Swift
// TapDisplaySettings.defaultMin/MaxFrequency(for:) and Python default_min/max_frequency:
// guitar (all subtypes) 75–350, plate 20–200, brace 30–1000.
export function defaultMinFrequency(type: MeasurementType): number {
  if (type === 'plate') return 20
  if (type === 'brace') return 30
  return 75
}

export function defaultMaxFrequency(type: MeasurementType): number {
  if (type === 'plate') return 200
  if (type === 'brace') return 1000
  return 350
}

// The stored minimum / maximum display frequency for a measurement type, or its default when none
// is stored. Mirrors Swift TapDisplaySettings.minFrequency(for:) / maxFrequency(for:).
export function minFrequency(s: Settings, type: MeasurementType): number {
  return s.displayRanges[type]?.minHz ?? defaultMinFrequency(type)
}

export function maxFrequency(s: Settings, type: MeasurementType): number {
  return s.displayRanges[type]?.maxHz ?? defaultMaxFrequency(type)
}

// Store one bound for a measurement type, leaving the other bound and other types as they are. Stored
// exactly, as Swift's Float (rounded to 32 bits, as a saved file is) — Save Current View's range comes
// back as it was saved. Mirrors Swift TapDisplaySettings.setMinFrequency(_:for:) /
// setMaxFrequency(_:for:); returns the settings patch, since settings here are an immutable value.
export function setMinFrequency(s: Settings, value: number, type: MeasurementType): Pick<Settings, 'displayRanges'> {
  const minHz = Math.fround(value)
  return { displayRanges: { ...s.displayRanges, [type]: { ...s.displayRanges[type], minHz } } }
}

export function setMaxFrequency(s: Settings, value: number, type: MeasurementType): Pick<Settings, 'displayRanges'> {
  const maxHz = Math.fround(value)
  return { displayRanges: { ...s.displayRanges, [type]: { ...s.displayRanges[type], maxHz } } }
}

// Store the magnitude range — shared by all types — exactly, as Swift's Float. Mirrors Swift
// TapDisplaySettings.minMagnitude / maxMagnitude.
export function setMagnitudeRange(minDb: number, maxDb: number): Pick<Settings, 'minDb' | 'maxDb'> {
  return { minDb: Math.fround(minDb), maxDb: Math.fround(maxDb) }
}

// Store both bounds for a measurement type (Settings' range fields, Save Current View, Reset).
export function setFrequencyRange(
  s: Settings,
  range: { minHz?: number; maxHz?: number },
  type: MeasurementType,
): Pick<Settings, 'displayRanges'> {
  let next: Settings = s
  if (range.minHz !== undefined) next = { ...next, ...setMinFrequency(next, range.minHz, type) }
  if (range.maxHz !== undefined) next = { ...next, ...setMaxFrequency(next, range.maxHz, type) }
  return { displayRanges: next.displayRanges }
}

// Validate a display frequency range entered in Settings: each bound clamped to the chart's limits
// (1–5000 Hz), and at least 10 Hz apart; otherwise the saved range for `type`. Mirrors Swift
// TapDisplaySettings.validateFrequencyRange(minFreq:maxFreq:).
export function validateFrequencyRange(
  saved: Settings,
  minHz: number,
  maxHz: number,
  type: MeasurementType,
): { minHz: number; maxHz: number } {
  const lo = Math.max(MIN_FREQUENCY_HZ, Math.min(minHz, MAX_FREQUENCY_HZ))
  const hi = Math.max(MIN_FREQUENCY_HZ, Math.min(maxHz, MAX_FREQUENCY_HZ))
  if (lo < hi && hi - lo >= MIN_FREQUENCY_SPAN_HZ) return { minHz: lo, maxHz: hi }
  return { minHz: minFrequency(saved, type), maxHz: maxFrequency(saved, type) }
}

// Validate a display magnitude range entered in Settings: each bound clamped to the chart's limits
// (−120…20 dB), and at least 10 dB apart; otherwise the saved range. Mirrors Swift
// TapDisplaySettings.validateMagnitudeRange(minDB:maxDB:).
export function validateMagnitudeRange(
  saved: Settings,
  minDb: number,
  maxDb: number,
): { minDb: number; maxDb: number } {
  const lo = Math.max(MIN_MAGNITUDE_DB, Math.min(minDb, MAX_MAGNITUDE_DB))
  const hi = Math.max(MIN_MAGNITUDE_DB, Math.min(maxDb, MAX_MAGNITUDE_DB))
  if (lo < hi && hi - lo >= MIN_MAGNITUDE_SPAN_DB) return { minDb: lo, maxDb: hi }
  return { minDb: saved.minDb, maxDb: saved.maxDb }
}

// dB-axis keys for the Display "Reset" button. The frequency range is reset
// separately (per measurement type) since it is no longer a flat setting.
export const DISPLAY_KEYS = ['minDb', 'maxDb'] as const
export const ANALYSIS_KEYS = ['showUnknownModes', 'peakMinThreshold', 'dumpCaptureAudio'] as const

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
