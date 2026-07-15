// Measurement-name validation — the required-name rule.
// See FILE-PATHS-AND-NAMES-SPEC.md §3. Mirrors Swift TapToneMeasurement.isValidName /
// normalizedName and Python is_valid_name / normalized_name.
//
// @parity model/measurement-name tests=test/measurement-name

/** Whether `name` is acceptable to save: non-empty after trimming whitespace. The Save action is
 *  disabled until this holds. Single source of truth — a view binds its Save button to this,
 *  never re-implements it. */
export function isValidMeasurementName(name: string): boolean {
  return name.trim().length > 0
}

/** The name to store: trimmed, or undefined if blank. Blank is prevented at the UI by
 *  isValidMeasurementName, but the model stays tolerant so nameless files from older builds still
 *  read (the format keeps the name optional — this is a UI rule, not a format change). */
export function normalizedMeasurementName(name: string): string | undefined {
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : undefined
}