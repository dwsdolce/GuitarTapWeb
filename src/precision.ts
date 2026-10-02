// @parity util/field-precision
//
// Single source of truth for numeric precision (decimal places) per value. An input field's `P`
// limits what can be typed and rounds what is committed; a computed value's `P` is the decimals it
// is shown with, on screen, in exports and in the PDF. Every display of a number formats it through
// `string` with its entry, so a value reads identically everywhere and across the Swift, Python and
// web editions. The saved display range is stored exactly, not rounded to `frequencyHz` /
// `magnitudeDB`. Mirrors Swift `FieldPrecision` / Python `field_precision`.
//
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
//     peakFrequencyHz 1 · peakMagnitudeDB 1 · qFactor 1 · bandwidthHz 1 · goreThicknessMM 2
//     youngsModulusGPa 2 · shearModulusGPa 3 · specificModulus 1 · speedOfSoundMS 0 · densityGPerCm3 3
//     radiationRatio 1 · crossLongRatio 3 · longCrossRatio 1 · decayTimeS 2 · decayRatio 2

/** `x` with `decimals` places, from its exact binary value, an exact tie rounded to even — C's `%.Nf`. */
function fixedHalfEven(x: number, decimals: number): string {
  const negative = x < 0 || Object.is(x, -0)
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, Math.abs(x))
  const bits = view.getBigUint64(0)
  const biased = Number((bits >> 52n) & 0x7ffn)
  const fraction = bits & ((1n << 52n) - 1n)
  // |x| = mantissa × 2^exponent, exactly.
  const mantissa = biased === 0 ? fraction : fraction | (1n << 52n)
  const exponent = (biased === 0 ? 1 : biased) - 1075
  const scaled = mantissa * 10n ** BigInt(decimals)
  let units: bigint
  if (exponent >= 0) {
    units = scaled << BigInt(exponent)
  } else {
    const denominator = 1n << BigInt(-exponent)
    units = scaled / denominator
    const twice = (scaled % denominator) * 2n
    if (twice > denominator || (twice === denominator && units % 2n === 1n)) units += 1n
  }
  const digits = units.toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const text = decimals > 0 ? `${whole}.${digits.slice(digits.length - decimals)}` : whole
  return negative ? `-${text}` : text
}

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
  /** A peak's bandwidth (frequency / Q). */
  bandwidthHz: 1,
  youngsModulusGPa: 2,
  /** The plate's GLC shear modulus. */
  shearModulusGPa: 3,
  /** E / ρ, in GPa per g/cm³. */
  specificModulus: 1,
  speedOfSoundMS: 0,
  densityGPerCm3: 3,
  radiationRatio: 1,
  /** fC / fL stiffness ratio. */
  crossLongRatio: 3,
  /** fL / fC stiffness ratio. */
  longCrossRatio: 1,
  goreThicknessMM: 2,
  /** Ring-out (decay) time, in seconds. */
  decayTimeS: 2,
  /** The tap-tone ratio (f_Top / f_Air). */
  decayRatio: 2,

  /** Format a value for display at the given precision: the value as Swift's `Float` (32 bits),
   * rounded to the nearest, an exact tie to even — what Swift's `String(format:)` shows (`toFixed`
   * rounds a tie up). Infinity reads as "-∞" / "∞" — what Swift's status bar shows — not
   * "-Infinity": a silent input's peak is -∞ dB, and it must not look different from one screen to
   * the next. */
  string(value: number, decimals: number): string {
    if (value === Infinity || value === -Infinity) return value < 0 ? '-∞' : '∞'
    if (Number.isNaN(value)) return 'nan'
    return fixedHalfEven(Math.fround(value), decimals)
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
