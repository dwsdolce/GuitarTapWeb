/**
 * Material-property formulas for tonewood plates and braces — density, Young's
 * moduli (Euler–Bernoulli free-free beam and Gore Poisson-coupled plate), shear
 * modulus, speed of sound, specific modulus, Gore target thickness, and a wood
 * quality grade. Mirrors Swift `MaterialProperties.swift` and Python
 * `material_properties.py`: `MaterialDimensions`, `PlateProperties`, `BraceProperties` and
 * `WoodQuality`, with the same properties.
 *
 * Inputs are in millimetres and grams; all math is done in SI (metres, kilograms)
 * and results are returned in Pa or GPa as noted per property. The free-free beam
 * eigenvalue βL² is `22.37` for plates and the more precise `22.37332` for braces —
 * a deliberate difference that matches both Swift and Python.
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

// ── MaterialDimensions ───────────────────────────────────────────────────────
/**
 * The physical dimensions and mass of a rectangular sample, held in SI units (metres and
 * kilograms) and created from millimetres and grams. Mirrors Swift `MaterialDimensions`.
 */
export class MaterialDimensions {
  /** Length along the grain, in metres. */
  readonly length: number
  /** Width across the grain, in metres. */
  readonly width: number
  /** Thickness, in metres. */
  readonly thickness: number
  /** Mass, in kilograms. */
  readonly mass: number

  /** @param d Dimensions in millimetres and mass in grams. */
  constructor(d: Dimensions) {
    this.length = d.lengthMm / 1000
    this.width = d.widthMm / 1000
    this.thickness = d.thicknessMm / 1000
    this.mass = d.massG / 1000
  }

  /** Volume, in m³. */
  get volume(): number {
    return this.length * this.width * this.thickness
  }

  /** Density, in kg/m³; 0 when the volume is zero. */
  get density(): number {
    return this.volume > 0 ? this.mass / this.volume : 0
  }

  /** Density in g/cm³ (the kg/m³ value over 1000). */
  get densityGPerCm3(): number {
    return this.density / 1000
  }
}

// ── PlateProperties ──────────────────────────────────────────────────────────
// Gore's recommended softwood averages: ν_CL and the product ν_LC·ν_CL.
const V_CL = 0.05
const V_LC_V_CL = 0.02
const GORE_COEF1 = (1 / ((PI / 2) ** 2 * 1.5 ** 4)) * 12 * (1 - V_LC_V_CL)
const GORE_COEF2 = PI * Math.sqrt((12 * (1 - V_LC_V_CL)) / 126)
const GORE_COEF3 = (4 * V_CL) / 7
const GORE_COEF4 = (4 * 12 * (1 - V_LC_V_CL)) / 42

/**
 * Acoustic properties of a rectangular plate from its longitudinal, cross-grain and optional
 * diagonal (FLC) tap frequencies. Mirrors Swift `PlateProperties`.
 */
export class PlateProperties {
  /**
   * @param dimensions Dimensions and mass of the plate.
   * @param fundamentalFrequencyLong Along-grain fundamental frequency, in Hz.
   * @param fundamentalFrequencyCross Cross-grain fundamental frequency, in Hz.
   * @param fundamentalFrequencyFlc Diagonal (FLC) frequency, in Hz, or `null` when not tapped.
   */
  constructor(
    readonly dimensions: MaterialDimensions,
    readonly fundamentalFrequencyLong: number,
    readonly fundamentalFrequencyCross: number,
    readonly fundamentalFrequencyFlc: number | null = null,
  ) {}

  /** Along-grain Young's modulus E_L, in Pa (free-free beam, βL² = 22.37). */
  get youngsModulusLong(): number {
    const d = this.dimensions
    return beamModulus(d.density, this.fundamentalFrequencyLong, d.length, d.thickness, 22.37)
  }

  /** Cross-grain Young's modulus E_C, in Pa (the width is the beam length). */
  get youngsModulusCross(): number {
    const d = this.dimensions
    return beamModulus(d.density, this.fundamentalFrequencyCross, d.width, d.thickness, 22.37)
  }

  /** Speed of sound along the grain, `√(E_L/ρ)`, in m/s. */
  get speedOfSoundLong(): number {
    const rho = this.dimensions.density
    return rho > 0 ? Math.sqrt(this.youngsModulusLong / rho) : 0
  }

  /** Speed of sound across the grain, `√(E_C/ρ)`, in m/s. */
  get speedOfSoundCross(): number {
    const rho = this.dimensions.density
    return rho > 0 ? Math.sqrt(this.youngsModulusCross / rho) : 0
  }

  /** E_L in GPa. */
  get youngsModulusLongGPa(): number {
    return this.youngsModulusLong / 1e9
  }

  /** E_C in GPa. */
  get youngsModulusCrossGPa(): number {
    return this.youngsModulusCross / 1e9
  }

  /** Specific modulus along the grain, E_L / ρ, in GPa/(g/cm³). */
  get specificModulusLong(): number {
    const rho = this.dimensions.densityGPerCm3
    return rho > 0 ? this.youngsModulusLongGPa / rho : 0
  }

  /** Specific modulus across the grain, E_C / ρ, in GPa/(g/cm³). */
  get specificModulusCross(): number {
    const rho = this.dimensions.densityGPerCm3
    return rho > 0 ? this.youngsModulusCrossGPa / rho : 0
  }

  /** Radiation ratio along the grain, `c_L / ρ`; 0 at zero density, never `0/0`. */
  get radiationRatioLong(): number {
    const rho = this.dimensions.density
    return rho > 0 ? this.speedOfSoundLong / rho : 0
  }

  /** Radiation ratio across the grain, `c_C / ρ`. */
  get radiationRatioCross(): number {
    const rho = this.dimensions.density
    return rho > 0 ? this.speedOfSoundCross / rho : 0
  }

  /** Anisotropy E_C / E_L; 0 when E_L is zero. Typical spruce: 0.04–0.08. */
  get crossLongRatio(): number {
    const eL = this.youngsModulusLong
    return eL > 0 ? this.youngsModulusCross / eL : 0
  }

  /** Anisotropy E_L / E_C; 0 when E_C is zero. Typical spruce: 12–25. */
  get longCrossRatio(): number {
    const eC = this.youngsModulusCross
    return eC > 0 ? this.youngsModulusLong / eC : 0
  }

  /** Grade along the grain, on the spruce thresholds. */
  get spruceQualityLong(): WoodQuality {
    return WoodQuality.evaluate(this.specificModulusLong, 'longitudinal', 'spruce')
  }

  /** Grade across the grain, on the spruce thresholds. */
  get spruceQualityCross(): WoodQuality {
    return WoodQuality.evaluate(this.specificModulusCross, 'cross', 'spruce')
  }

  /** Overall grade: 0.7 × the along-grain score + 0.3 × the cross-grain score, mapped back to a grade. */
  get overallQuality(): WoodQuality {
    const combined =
      WoodQuality.numericScore(this.spruceQualityLong) * 0.7 + WoodQuality.numericScore(this.spruceQualityCross) * 0.3
    if (combined >= 4.5) return 'Excellent'
    if (combined >= 3.5) return 'Very Good'
    if (combined >= 2.5) return 'Good'
    if (combined >= 1.5) return 'Fair'
    return 'Poor'
  }

  /** Along-grain Young's modulus from Gore's plate formula, in Pa: `Coef₁·ρ·L⁴·fL² / t²`. */
  get goreYoungsModulusLong(): number {
    const d = this.dimensions
    if (d.thickness <= 0 || d.density <= 0) return 0
    const f = this.fundamentalFrequencyLong
    return (GORE_COEF1 * d.density * d.length ** 4 * f * f) / (d.thickness * d.thickness)
  }

  /** Cross-grain Young's modulus from Gore's plate formula, in Pa: `Coef₁·ρ·W⁴·fC² / t²`. */
  get goreYoungsModulusCross(): number {
    const d = this.dimensions
    if (d.thickness <= 0 || d.density <= 0) return 0
    const f = this.fundamentalFrequencyCross
    return (GORE_COEF1 * d.density * d.width ** 4 * f * f) / (d.thickness * d.thickness)
  }

  /** Shear modulus G_LC from Gore's formula, in Pa: `(12/π²)·ρ·L²·W²·fLC² / t²`; `null` without the FLC tap. */
  get goreShearModulus(): number | null {
    const fLC = this.fundamentalFrequencyFlc
    if (fLC == null) return null
    const d = this.dimensions
    if (d.thickness <= 0 || d.density <= 0) return null
    return ((12 / (PI * PI)) * d.density * d.length ** 2 * d.width ** 2 * fLC * fLC) / (d.thickness * d.thickness)
  }

  /**
   * Target thickness for the finished plate, in mm — Gore Equation 4.5-7. G_LC is taken as 0
   * when the FLC tap was not performed.
   * @param bodyLengthMm Guitar body length, in mm.
   * @param bodyWidthMm Lower-bout width, in mm.
   * @param vibrationalStiffness Target vibrational stiffness (f_vs).
   * @returns Target thickness in mm, or `null` when an input is zero or invalid.
   */
  goreTargetThickness(bodyLengthMm: number, bodyWidthMm: number, vibrationalStiffness: number): number | null {
    if (bodyLengthMm <= 0 || bodyWidthMm <= 0 || vibrationalStiffness <= 0) return null
    const rho = this.dimensions.density
    if (rho <= 0) return null
    const a = bodyLengthMm / 1000
    const b = bodyWidthMm / 1000
    const elGPa = this.goreYoungsModulusLong / 1e9
    const ecGPa = this.goreYoungsModulusCross / 1e9
    const glcGPa = (this.goreShearModulus ?? 0) / 1e9
    const numerator = GORE_COEF2 * vibrationalStiffness * a * a * Math.sqrt(rho)
    const aOverB = a / b
    const aOverB2 = aOverB * aOverB
    const aOverB4 = aOverB2 * aOverB2
    const denominatorGPa = elGPa + aOverB4 * ecGPa + aOverB2 * (GORE_COEF3 * elGPa + GORE_COEF4 * glcGPa)
    if (denominatorGPa <= 0) return null
    return (numerator / Math.sqrt(denominatorGPa * 1e9)) * 1000
  }
}

// ── BraceProperties ──────────────────────────────────────────────────────────
/**
 * Acoustic properties of a brace strip from its longitudinal tap alone. The beam formula uses the
 * more precise βL² = 22.37332 (the plate uses 22.37). Mirrors Swift `BraceProperties`.
 */
export class BraceProperties {
  /**
   * @param dimensions Dimensions and mass of the brace.
   * @param fundamentalFrequencyLong Along-grain fundamental frequency, in Hz.
   */
  constructor(
    readonly dimensions: MaterialDimensions,
    readonly fundamentalFrequencyLong: number,
  ) {}

  /** Along-grain Young's modulus E_L, in Pa. */
  get youngsModulusLong(): number {
    const d = this.dimensions
    return beamModulus(d.density, this.fundamentalFrequencyLong, d.length, d.thickness, 22.37332)
  }

  /** Speed of sound along the grain, `√(E_L/ρ)`, in m/s. */
  get speedOfSoundLong(): number {
    const rho = this.dimensions.density
    return rho > 0 ? Math.sqrt(this.youngsModulusLong / rho) : 0
  }

  /** E_L in GPa. */
  get youngsModulusLongGPa(): number {
    return this.youngsModulusLong / 1e9
  }

  /** Specific modulus along the grain, E_L / ρ, in GPa/(g/cm³). */
  get specificModulusLong(): number {
    const rho = this.dimensions.densityGPerCm3
    return rho > 0 ? this.youngsModulusLongGPa / rho : 0
  }

  /** Radiation ratio along the grain, `c_L / ρ`. */
  get radiationRatioLong(): number {
    const rho = this.dimensions.density
    return rho > 0 ? this.speedOfSoundLong / rho : 0
  }

  /** Grade along the grain, on the spruce thresholds. */
  get spruceQuality(): WoodQuality {
    return WoodQuality.evaluate(this.specificModulusLong, 'longitudinal', 'spruce')
  }
}

// ── WoodQuality ──────────────────────────────────────────────────────────────
/** Wood quality grade, best→worst. Mirrors Swift `WoodQuality`'s raw values. */
export type WoodQuality = 'Excellent' | 'Very Good' | 'Good' | 'Fair' | 'Poor'
/** Grain direction a specific-modulus value was measured along. Mirrors Swift `WoodQuality.Direction`. */
export type GrainDirection = 'longitudinal' | 'cross'
/** Tonewood species selecting the grading thresholds. Mirrors Swift `WoodQuality.WoodType`. */
export type WoodType = 'spruce' | 'cedar' | 'maple' | 'rosewood'

const NUMERIC_SCORE: Record<WoodQuality, number> = {
  Excellent: 5,
  'Very Good': 4,
  Good: 3,
  Fair: 2,
  Poor: 1,
}

/** Swift `WoodQuality`'s members: `numericScore` and `evaluate`. */
export const WoodQuality = {
  /**
   * A grade's numeric score, 5 (Excellent) to 1 (Poor), used to blend grades.
   * @param quality The grade.
   * @returns Its score.
   */
  numericScore(quality: WoodQuality): number {
    return NUMERIC_SCORE[quality]
  },

  /**
   * Grade a specific modulus against per-species, per-direction thresholds. Maple, rosewood and other
   * species not individually calibrated share one generic ladder.
   * @param specificModulus Specific modulus, in GPa/(g/cm³).
   * @param direction Grain direction the value was measured along.
   * @param woodType Species.
   * @returns A grade from `Excellent` down to `Poor`.
   */
  evaluate(specificModulus: number, direction: GrainDirection, woodType: WoodType): WoodQuality {
    const ladder = (e: number, vg: number, g: number, f: number): WoodQuality =>
      specificModulus >= e
        ? 'Excellent'
        : specificModulus >= vg
          ? 'Very Good'
          : specificModulus >= g
            ? 'Good'
            : specificModulus >= f
              ? 'Fair'
              : 'Poor'
    if (woodType === 'spruce') return direction === 'longitudinal' ? ladder(25, 22, 19, 16) : ladder(1.5, 1.2, 0.9, 0.6)
    if (woodType === 'cedar') return direction === 'longitudinal' ? ladder(22, 19, 16, 13) : ladder(1.3, 1.0, 0.7, 0.5)
    return ladder(20, 16, 12, 8)
  },
}
