// Material property formulas (plate/brace), ported from MaterialProperties.swift /
// material_properties.py. Inputs in mm/grams; SI internally. See INVENTORY.md
// "Material Property Formulas". NOTE: plate beam uses βL²=22.37, brace uses
// 22.37332 (deliberate, matches both Swift and Python).
// @parity dsp/material-properties tests=test/brace,test/plate

export interface Dimensions {
  lengthMm: number
  widthMm: number
  thicknessMm: number
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

export function density(d: Dimensions): number {
  const { L, W, t, mass } = toM(d)
  const vol = L * W * t
  return vol > 0 ? mass / vol : 0
}
export const densityGPerCm3 = (d: Dimensions): number => density(d) / 1000

/** Euler–Bernoulli free-free beam modulus (Pa): 48·π²·ρ·f²·len⁴/(beta·t)². */
function beamModulus(rho: number, f: number, len: number, t: number, beta: number): number {
  if (t <= 0 || rho <= 0) return 0
  return (48 * PI * PI * rho * f * f * len ** 4) / (beta * t) ** 2
}

// ── Plate ──────────────────────────────────────────────────────────────────
export function plateYoungsLongPa(d: Dimensions, fL: number): number {
  const { L, t } = toM(d)
  return beamModulus(density(d), fL, L, t, 22.37)
}
export function plateYoungsCrossPa(d: Dimensions, fC: number): number {
  const { W, t } = toM(d)
  return beamModulus(density(d), fC, W, t, 22.37)
}
export const plateYoungsLongGPa = (d: Dimensions, fL: number) => plateYoungsLongPa(d, fL) / 1e9
export const plateYoungsCrossGPa = (d: Dimensions, fC: number) => plateYoungsCrossPa(d, fC) / 1e9

export function speedOfSound(youngsPa: number, rho: number): number {
  return rho > 0 ? Math.sqrt(youngsPa / rho) : 0
}
export const specificModulus = (youngsGPa: number, densGcm3: number): number =>
  densGcm3 > 0 ? youngsGPa / densGcm3 : 0

// Gore plate moduli (Poisson-coupled).
const GORE_COEF1 = (1 / ((PI / 2) ** 2 * 1.5 ** 4)) * 12 * (1 - V_LC_V_CL)
const GORE_COEF2 = PI * Math.sqrt((12 * (1 - V_LC_V_CL)) / 126)
const GORE_COEF3 = (4 * V_CL) / 7
const GORE_COEF4 = (4 * 12 * (1 - V_LC_V_CL)) / 42

export function goreYoungsLongPa(d: Dimensions, fL: number): number {
  const { L, t } = toM(d)
  const rho = density(d)
  if (t <= 0 || rho <= 0) return 0
  return (GORE_COEF1 * rho * L ** 4 * fL * fL) / (t * t)
}
export function goreYoungsCrossPa(d: Dimensions, fC: number): number {
  const { W, t } = toM(d)
  const rho = density(d)
  if (t <= 0 || rho <= 0) return 0
  return (GORE_COEF1 * rho * W ** 4 * fC * fC) / (t * t)
}
/** Gore shear modulus G_LC (Pa) from the FLC tap; null if no FLC. */
export function goreShearPa(d: Dimensions, fLC: number | null | undefined): number | null {
  if (fLC == null) return null
  const { L, W, t } = toM(d)
  const rho = density(d)
  if (t <= 0 || rho <= 0) return null
  return ((12 / (PI * PI)) * rho * L * L * W * W * fLC * fLC) / (t * t)
}

/** Gore target plate thickness (mm), Eq. 4.5-7, or null on invalid input. */
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
export function braceYoungsLongPa(d: Dimensions, fL: number): number {
  const { L, t } = toM(d)
  return beamModulus(density(d), fL, L, t, 22.37332) // more precise βL² for brace
}
export const braceYoungsLongGPa = (d: Dimensions, fL: number) => braceYoungsLongPa(d, fL) / 1e9

// ── Wood quality ─────────────────────────────────────────────────────────────
export type WoodQuality = 'Excellent' | 'Very Good' | 'Good' | 'Fair' | 'Poor'
export type WoodType = 'spruce' | 'cedar' | 'other'
export type GrainDirection = 'longitudinal' | 'cross'

const QUALITY_SCORE: Record<WoodQuality, number> = {
  Excellent: 5,
  'Very Good': 4,
  Good: 3,
  Fair: 2,
  Poor: 1,
}

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

/** Overall plate quality: 0.7·long + 0.3·cross numeric scores → label. */
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
