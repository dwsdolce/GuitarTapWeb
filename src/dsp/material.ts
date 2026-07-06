/**
 * Material-property formulas for tonewood plates and braces — density, Young's
 * moduli (Euler–Bernoulli free-free beam and Gore Poisson-coupled plate), shear
 * modulus, speed of sound, specific modulus, Gore target thickness, and a wood
 * quality grade. Mirrors Swift `MaterialProperties.swift` and Python
 * `material_properties.py`; pinned by oracle cases G3b / G3c / G4b (brace / plate /
 * material) and regressions REG-P1 / REG-B1.
 *
 * Inputs are in millimetres and grams; all math is done in SI (metres, kilograms)
 * and results are returned in Pa or GPa as noted per function. The free-free beam
 * eigenvalue βL² is `22.37` for plates and the more precise `22.37332` for braces —
 * a deliberate difference that matches both Swift and Python.
 *
 * @see Development/INVENTORY.md — "Material Property Formulas"
 */
// @parity dsp/material-properties tests=test/brace,test/plate

/** Sample dimensions and mass (input units: millimetres and grams). */
export interface Dimensions {
  /** Length along the grain, in mm. */
  lengthMm: number
  /** Width across the grain, in mm. */
  widthMm: number
  /** Thickness, in mm. */
  thicknessMm: number
  /** Mass, in grams. */
  massG: number
}

const PI = Math.PI
const V_CL = 0.05
const V_LC_V_CL = 0.02

const toM = (d: Dimensions) => ({
  L: d.lengthMm / 1000,
  W: d.widthMm / 1000,
  t: d.thicknessMm / 1000,
  mass: d.massG / 1000,
})

/**
 * Density in kg/m³ from dimensions and mass (0 if the volume is non-positive).
 * @param d Sample dimensions and mass.
 * @returns Density in kg/m³.
 */
export function density(d: Dimensions): number {
  const { L, W, t, mass } = toM(d)
  const vol = L * W * t
  return vol > 0 ? mass / vol : 0
}
/** Density in g/cm³ (the SI kg/m³ value divided by 1000). */
export const densityGPerCm3 = (d: Dimensions): number => density(d) / 1000

/**
 * Euler–Bernoulli free-free beam Young's modulus, in Pa:
 * `E = 48·π²·ρ·f²·len⁴ / (β·t)²`. Returns 0 for non-positive thickness or density.
 * @param rho Density, in kg/m³.
 * @param f Resonant frequency of the tap, in Hz.
 * @param len Beam length in the measured direction, in metres.
 * @param t Thickness, in metres.
 * @param beta Free-free beam eigenvalue βL² (22.37 plate, 22.37332 brace).
 * @returns Young's modulus in Pa.
 */
function beamModulus(rho: number, f: number, len: number, t: number, beta: number): number {
  if (t <= 0 || rho <= 0) return 0
  return (48 * PI * PI * rho * f * f * len ** 4) / (beta * t) ** 2
}

// ── Plate ──────────────────────────────────────────────────────────────────
/**
 * Along-grain plate Young's modulus (Pa) from the longitudinal tap, via the
 * free-free beam model with βL² = 22.37.
 * @param d Sample dimensions and mass.
 * @param fL Longitudinal (along-grain) resonant frequency, in Hz.
 * @returns Young's modulus in Pa.
 */
export function plateYoungsLongPa(d: Dimensions, fL: number): number {
  const { L, t } = toM(d)
  return beamModulus(density(d), fL, L, t, 22.37)
}
/**
 * Cross-grain plate Young's modulus (Pa) from the cross tap (βL² = 22.37).
 * @param d Sample dimensions and mass.
 * @param fC Cross-grain resonant frequency, in Hz.
 * @returns Young's modulus in Pa.
 */
export function plateYoungsCrossPa(d: Dimensions, fC: number): number {
  const { W, t } = toM(d)
  return beamModulus(density(d), fC, W, t, 22.37)
}
/** Along-grain plate Young's modulus, in GPa. */
export const plateYoungsLongGPa = (d: Dimensions, fL: number) => plateYoungsLongPa(d, fL) / 1e9
/** Cross-grain plate Young's modulus, in GPa. */
export const plateYoungsCrossGPa = (d: Dimensions, fC: number) => plateYoungsCrossPa(d, fC) / 1e9

/**
 * Speed of sound `√(E/ρ)`, in m/s (0 for non-positive density).
 * @param youngsPa Young's modulus, in Pa.
 * @param rho Density, in kg/m³.
 * @returns Speed of sound, in m/s.
 */
export function speedOfSound(youngsPa: number, rho: number): number {
  return rho > 0 ? Math.sqrt(youngsPa / rho) : 0
}
/** Specific modulus `E/ρ` (GPa per g/cm³) — a stiffness-to-weight figure of merit. */
export const specificModulus = (youngsGPa: number, densGcm3: number): number =>
  densGcm3 > 0 ? youngsGPa / densGcm3 : 0

// Gore plate moduli (Poisson-coupled).
const GORE_COEF1 = (1 / ((PI / 2) ** 2 * 1.5 ** 4)) * 12 * (1 - V_LC_V_CL)
const GORE_COEF2 = PI * Math.sqrt((12 * (1 - V_LC_V_CL)) / 126)
const GORE_COEF3 = (4 * V_CL) / 7
const GORE_COEF4 = (4 * 12 * (1 - V_LC_V_CL)) / 42

/**
 * Along-grain Gore plate Young's modulus (Pa) — Poisson-coupled plate model.
 * `E = GORE_COEF1·ρ·L⁴·fL² / t²`. Returns 0 for non-positive thickness or density.
 * @param d Sample dimensions and mass.
 * @param fL Longitudinal resonant frequency, in Hz.
 * @returns Young's modulus in Pa.
 */
export function goreYoungsLongPa(d: Dimensions, fL: number): number {
  const { L, t } = toM(d)
  const rho = density(d)
  if (t <= 0 || rho <= 0) return 0
  return (GORE_COEF1 * rho * L ** 4 * fL * fL) / (t * t)
}
/**
 * Cross-grain Gore plate Young's modulus (Pa) — as {@link goreYoungsLongPa} but
 * across the grain, using the width.
 * @param d Sample dimensions and mass.
 * @param fC Cross-grain resonant frequency, in Hz.
 * @returns Young's modulus in Pa.
 */
export function goreYoungsCrossPa(d: Dimensions, fC: number): number {
  const { W, t } = toM(d)
  const rho = density(d)
  if (t <= 0 || rho <= 0) return 0
  return (GORE_COEF1 * rho * W ** 4 * fC * fC) / (t * t)
}
/**
 * Gore shear modulus G_LC (Pa) from the twisting (FLC) tap:
 * `G = (12/π²)·ρ·L²·W²·fLC² / t²`. Returns `null` if no FLC frequency was measured.
 * @param d Sample dimensions and mass.
 * @param fLC Longitudinal-cross (twisting) resonant frequency, in Hz, or `null`.
 * @returns Shear modulus in Pa, or `null`.
 */
export function goreShearPa(d: Dimensions, fLC: number | null | undefined): number | null {
  if (fLC == null) return null
  const { L, W, t } = toM(d)
  const rho = density(d)
  if (t <= 0 || rho <= 0) return null
  return ((12 / (PI * PI)) * rho * L * L * W * W * fLC * fLC) / (t * t)
}

/**
 * Gore target plate thickness (mm) to reach a desired vibrational stiffness for a
 * body of the given outline — Gore Eq. 4.5-7, combining the along/cross Young's and
 * the shear moduli with the plate aspect ratio. Returns `null` on invalid input.
 * @param d Sample dimensions and mass.
 * @param fL Longitudinal resonant frequency, in Hz.
 * @param fC Cross-grain resonant frequency, in Hz.
 * @param fLC Twisting (FLC) frequency, in Hz, or `null` (shear taken as 0 then).
 * @param bodyLengthMm Target body outline length, in mm.
 * @param bodyWidthMm Target body outline width, in mm.
 * @param vibrationalStiffness Desired panel vibrational stiffness.
 * @returns Target thickness in mm, or `null`.
 */
export function goreTargetThicknessMm(
  d: Dimensions,
  fL: number,
  fC: number,
  fLC: number | null | undefined,
  bodyLengthMm: number,
  bodyWidthMm: number,
  vibrationalStiffness: number,
): number | null {
  const rho = density(d)
  if (bodyLengthMm <= 0 || bodyWidthMm <= 0 || vibrationalStiffness <= 0 || rho <= 0) return null
  const a = bodyLengthMm / 1000
  const b = bodyWidthMm / 1000
  const elGPa = goreYoungsLongPa(d, fL) / 1e9
  const ecGPa = goreYoungsCrossPa(d, fC) / 1e9
  const glcGPa = (goreShearPa(d, fLC) ?? 0) / 1e9
  const numerator = GORE_COEF2 * vibrationalStiffness * a * a * Math.sqrt(rho)
  const aOverB = a / b
  const aOverB2 = aOverB * aOverB
  const aOverB4 = aOverB2 * aOverB2
  const denGPa = elGPa + aOverB4 * ecGPa + aOverB2 * (GORE_COEF3 * elGPa + GORE_COEF4 * glcGPa)
  if (denGPa <= 0) return null
  return (numerator / Math.sqrt(denGPa * 1e9)) * 1000
}

// ── Brace ──────────────────────────────────────────────────────────────────
/**
 * Along-grain brace Young's modulus (Pa) — free-free beam with the more precise
 * βL² = 22.37332 used for braces.
 * @param d Sample dimensions and mass.
 * @param fL Longitudinal resonant frequency, in Hz.
 * @returns Young's modulus in Pa.
 */
export function braceYoungsLongPa(d: Dimensions, fL: number): number {
  const { L, t } = toM(d)
  return beamModulus(density(d), fL, L, t, 22.37332) // more precise βL² for brace
}
/** Along-grain brace Young's modulus, in GPa. */
export const braceYoungsLongGPa = (d: Dimensions, fL: number) => braceYoungsLongPa(d, fL) / 1e9

// ── Wood quality ─────────────────────────────────────────────────────────────
/** Wood quality grade, best→worst. Mirrors the Swift/Python quality ladder. */
export type WoodQuality = 'Excellent' | 'Very Good' | 'Good' | 'Fair' | 'Poor'
/** Tonewood species selecting the grading thresholds. */
export type WoodType = 'spruce' | 'cedar' | 'other'
/** Grain direction a specific-modulus value was measured along. */
export type GrainDirection = 'longitudinal' | 'cross'

const QUALITY_SCORE: Record<WoodQuality, number> = {
  Excellent: 5,
  'Very Good': 4,
  Good: 3,
  Fair: 2,
  Poor: 1,
}

/**
 * Grade a wood sample from its specific modulus, against per-species,
 * per-direction thresholds (spruce / cedar / other; along vs. cross grain).
 * @param specMod Specific modulus (GPa per g/cm³).
 * @param direction Grain direction the value was measured along.
 * @param woodType Species (default `'spruce'`).
 * @returns A quality label from `Excellent` down to `Poor`.
 */
export function woodQuality(
  specMod: number,
  direction: GrainDirection,
  woodType: WoodType = 'spruce',
): WoodQuality {
  const ladder = (e: number, vg: number, g: number, f: number): WoodQuality =>
    specMod >= e ? 'Excellent' : specMod >= vg ? 'Very Good' : specMod >= g ? 'Good' : specMod >= f ? 'Fair' : 'Poor'
  if (woodType === 'spruce') return direction === 'longitudinal' ? ladder(25, 22, 19, 16) : ladder(1.5, 1.2, 0.9, 0.6)
  if (woodType === 'cedar') return direction === 'longitudinal' ? ladder(22, 19, 16, 13) : ladder(1.3, 1.0, 0.7, 0.5)
  return ladder(20, 16, 12, 8)
}

/**
 * Overall plate quality: a weighted blend of the along- and cross-grain grades
 * (0.7·long + 0.3·cross on a 1–5 numeric scale) mapped back to a label.
 * @param specModLong Along-grain specific modulus.
 * @param specModCross Cross-grain specific modulus.
 * @returns The combined quality label.
 */
export function overallQuality(specModLong: number, specModCross: number): WoodQuality {
  const combined =
    QUALITY_SCORE[woodQuality(specModLong, 'longitudinal')] * 0.7 +
    QUALITY_SCORE[woodQuality(specModCross, 'cross')] * 0.3
  if (combined >= 4.5) return 'Excellent'
  if (combined >= 3.5) return 'Very Good'
  if (combined >= 2.5) return 'Good'
  if (combined >= 1.5) return 'Fair'
  return 'Poor'
}
