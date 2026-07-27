// @parity util/field-precision
//
// Single source of truth for numeric precision (decimal places) per field. One `P` per field
// governs input (restrict-on-entry), storage, and display, so a value reads identically in the
// input field, Settings, the saved measurement, and the report — and identically across the Swift,
// Python, and web editions. Mirrors Swift `FieldPrecision` / Python `field_precision`.
//
// Spec (with the validated value ranges): Development/NUMERIC-PRECISION-SPEC.md.
// This table MUST stay identical across the Swift, Python, and web mirrors.
//
// Precision table — P = decimal places:
//   INPUT / SETTINGS
//     linearDimensionMM  2   plate/brace length · width · thickness   0.01 mm  (caliper)
//     massG              1   plate/brace mass                         0.1 g
//     bodyDimensionMM    0   guitar body length · width               1 mm
//     frequencyHz        0   display frequency range                  1 Hz  (< FFT bin ~1.46 Hz)
//     magnitudeDB        0   display magnitude range · thresholds     1 dB
//     stiffness          0   custom plate stiffness (f_vs)            1  (unitless)
//   COMPUTED / DISPLAYED
//     peakFrequencyHz 1 · peakMagnitudeDB 1 · qFactor 1 · youngsModulusGPa 2
//     speedOfSoundMS 0 · densityGPerCm3 3 · decayRatio 2

export const FieldPrecision = {
  // input / settings (decimal places)
  linearDimensionMM: 2,
  massG: 1,
  bodyDimensionMM: 0,
  frequencyHz: 0,
  magnitudeDB: 0,
  stiffness: 0,
  // computed / displayed (decimal places)
  peakFrequencyHz: 1,
  peakMagnitudeDB: 1,
  qFactor: 1,
  youngsModulusGPa: 2,
  speedOfSoundMS: 0,
  densityGPerCm3: 3,
  decayRatio: 2,

  /** Format a value for display at the given precision. */
  string(value: number, decimals: number): string {
    return value.toFixed(decimals)
  },

  /** Round to `decimals` places (half away from zero, matching Swift `.rounded()`). Safety net for
   * values reaching state by a non-typed path; typed entry is restricted up front by `decimalsWithin`. */
  rounded(value: number, decimals: number): number {
    const m = 10 ** decimals
    const scaled = value * m
    return (scaled >= 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5)) / m
  },

  /** Whether `text` is an acceptable *partial* numeric entry limited to `decimals` fractional digits
   * — used to reject a keystroke that would exceed the precision, so the extra digit never appears (a
   * 2-dp field accepts "29.35" but not "29.356"). A 0-decimal field rejects the decimal point
   * entirely. Allows in-progress states ("", "-", "29", and "29." when decimals > 0). */
  decimalsWithin(text: string, decimals: number): boolean {
    if (text === '' || text === '-') return true
    const pattern = decimals > 0 ? `^-?[0-9]*(\\.[0-9]{0,${decimals}})?$` : `^-?[0-9]*$`
    return new RegExp(pattern).test(text)
  },
}
