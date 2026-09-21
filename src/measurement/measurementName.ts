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

/** The notes to store: trimmed, or undefined if blank.
 *
 *  The two user-entered text fields normalize the same way, so "has this been edited" means the
 *  same thing for both. This edition already trimmed notes; Swift stored them verbatim and Python
 *  trimmed in the edit dialog but not on the save path, so the three disagreed on whether retyping
 *  whitespace counted as an edit. All three now share this rule. See SLUG-SWEEP.md F21. */
export function normalizedMeasurementNotes(notes: string): string | undefined {
  const trimmed = notes.trim()
  return trimmed.length > 0 ? trimmed : undefined
}