// @parity test/plate
// Plate material property formulas. Mirrors Swift PlatePropertiesTests.swift and Python
// tests/test_plate.py — same fixtures, same cases, same expected values.
//
// TWO fixtures, for two different jobs. Mixing them is what let this suite drift.
//
// `realPlate` is an actual measured sample, for every test that claims a result is
// physically sensible. Dimensions and frequencies are read straight out of the hub's
// committed measurement:
//
//     guitar-tap-project/Tests/Plate/plate-umik-1-swift-mac-1778816330.guitartap
//
// and the expected values are the ones GuitarTap itself reported for it, printed in the .pdf
// beside that file. They are NOT numbers this suite produced — a suite that generates its own
// expectations can never fail. Until the #17 sweep this file used 560 x 230 x 2.8 mm / 210 g:
// a near-miss of the real sample on length, width and mass, but 2.8 mm against a real 4.85 mm.
// Since E is proportional to 1/t-squared, that one field inflated E_L from 6.11 to 31.1 GPa.
//
// `syntheticPlate` is round numbers (density lands on exactly 400 kg/m3), for the algebraic
// identities only. Those hold for any input, so being unphysical costs nothing and
// hand-checkable arithmetic is worth more. It is NOT a plausible plate — its E_C/E_L is 0.0089
// against the 0.04-0.08 the app's own UI calls typical — so no plausibility claim rests on it.
import { describe, it, expect } from 'vitest'
import {
  density,
  densityGPerCm3,
  plateYoungsLongPa,
  plateYoungsCrossPa,
  plateYoungsLongGPa,
  plateYoungsCrossGPa,
  specificModulus,
  speedOfSound,
  radiationRatio,
  crossLongRatio,
  longCrossRatio,
  goreYoungsLongPa,
  goreYoungsCrossPa,
  goreShearPa,
  goreTargetThicknessMm,
  woodQuality,
  overallQuality,
  type Dimensions,
} from '../src/dsp/material'

// Real measured plate — see the header note. rho 0.349 g/cm3, graded Fair.
const realPlate: Dimensions = { lengthMm: 557.5, widthMm: 220.5, thicknessMm: 4.85, massG: 208 }
const fL = 67.11537
const fC = 116.27016
const fLC = 35.353745
// Body outline saved with that measurement (guitarBodyLength / guitarBodyWidth).
const bodyLengthMm = 490
const bodyWidthMm = 390

// Synthetic plate — algebraic identities only. See the header note.
const syntheticPlate: Dimensions = { lengthMm: 500, widthMm: 200, thicknessMm: 3, massG: 120 }

const specL = (d: Dimensions, f: number) => specificModulus(plateYoungsLongGPa(d, f), densityGPerCm3(d))
const specC = (d: Dimensions, f: number) => specificModulus(plateYoungsCrossGPa(d, f), densityGPerCm3(d))
const cL = (d: Dimensions, f: number) => speedOfSound(plateYoungsLongPa(d, f), density(d))
const cC = (d: Dimensions, f: number) => speedOfSound(plateYoungsCrossPa(d, f), density(d))

// ── Real sample report — one test per number GuitarTap printed for that measurement ────────
describe('real plate — matches the values GuitarTap reported', () => {
  it('density: 0.349 g/cm3', () => {
    expect(densityGPerCm3(realPlate)).toBeCloseTo(0.349, 3)
  })

  it("Young's moduli: E_L 6.11 GPa, E_C 0.45 GPa", () => {
    expect(plateYoungsLongGPa(realPlate, fL)).toBeCloseTo(6.11, 2)
    expect(plateYoungsCrossGPa(realPlate, fC)).toBeCloseTo(0.45, 2)
  })

  it('speed of sound: c_L 4185 m/s, c_C 1134 m/s', () => {
    expect(cL(realPlate, fL)).toBeCloseTo(4185, 0)
    expect(cC(realPlate, fC)).toBeCloseTo(1134, 0)
  })

  it('specific modulus: 17.5 (L), 1.3 (C)', () => {
    expect(specL(realPlate, fL)).toBeCloseTo(17.5, 1)
    expect(specC(realPlate, fC)).toBeCloseTo(1.3, 1)
  })

  it('radiation ratio: 12.0 (L)', () => {
    expect(radiationRatio(cL(realPlate, fL), density(realPlate))).toBeCloseTo(12.0, 1)
  })

  it('grades Fair, not saturated at Excellent', () => {
    // The only fixture that exercises the middle of the quality scale. Every synthetic one
    // saturates at Excellent, where the assertion holds however far the thresholds move.
    expect(woodQuality(specL(realPlate, fL), 'longitudinal', 'spruce')).toBe('Fair')
  })

  it('anisotropy ratios land in the bands the app calls typical', () => {
    const eL = plateYoungsLongGPa(realPlate, fL)
    const eC = plateYoungsCrossGPa(realPlate, fC)
    expect(crossLongRatio(eL, eC)).toBeCloseTo(0.0734, 3)
    expect(longCrossRatio(eL, eC)).toBeCloseTo(13.6, 1)
    expect(crossLongRatio(eL, eC)).toBeGreaterThan(0.04)
    expect(crossLongRatio(eL, eC)).toBeLessThan(0.08)
  })
})

// ── Dimensions ─────────────────────────────────────────────────────────────────────────────
describe('material dimensions', () => {
  it('density is mass over volume — 400 kg/m3 for the synthetic plate', () => {
    expect(density(syntheticPlate)).toBeCloseTo(400, 3)
  })

  it('g/cm3 is the kg/m3 value over 1000', () => {
    expect(densityGPerCm3(syntheticPlate)).toBeCloseTo(0.4, 6)
  })

  it('zero thickness gives zero density, not a divide by zero', () => {
    expect(density({ ...syntheticPlate, thicknessMm: 0 })).toBe(0)
  })
})

// ── Young's modulus ────────────────────────────────────────────────────────────────────────
describe("plate Young's modulus", () => {
  it('zero thickness returns zero', () => {
    expect(plateYoungsLongPa({ ...syntheticPlate, thicknessMm: 0 }, fL)).toBe(0)
  })

  it('the GPa accessors are the Pa values over 1e9', () => {
    expect(plateYoungsLongGPa(syntheticPlate, 85)).toBeCloseTo(plateYoungsLongPa(syntheticPlate, 85) / 1e9, 6)
    expect(plateYoungsCrossGPa(syntheticPlate, 50)).toBeCloseTo(plateYoungsCrossPa(syntheticPlate, 50) / 1e9, 6)
  })

  it('E is proportional to f-squared: doubling fL quadruples EL', () => {
    const ratio = plateYoungsLongPa(syntheticPlate, 200) / plateYoungsLongPa(syntheticPlate, 100)
    expect(ratio).toBeCloseTo(4, 2)
  })

  it('E is proportional to L-to-the-fourth at constant density', () => {
    const d1: Dimensions = { lengthMm: 250, widthMm: 200, thicknessMm: 3, massG: 60 }
    const ratio = plateYoungsLongPa(syntheticPlate, 85) / plateYoungsLongPa(d1, 85)
    expect(ratio).toBeCloseTo(16, 1)
  })
})

// ── Speed of sound ─────────────────────────────────────────────────────────────────────────
describe('plate speed of sound', () => {
  it('equals sqrt(E / rho)', () => {
    const expected = Math.sqrt(plateYoungsLongPa(syntheticPlate, 85) / density(syntheticPlate))
    expect(cL(syntheticPlate, 85)).toBeCloseTo(expected, 5)
  })

  it('is proportional to frequency: doubling fL doubles c', () => {
    expect(cL(syntheticPlate, 170) / cL(syntheticPlate, 85)).toBeCloseTo(2, 2)
  })

  it('zero density returns zero', () => {
    expect(cL({ ...syntheticPlate, thicknessMm: 0, massG: 0 }, 85)).toBe(0)
  })
})

// ── Specific modulus ───────────────────────────────────────────────────────────────────────
describe('plate specific modulus', () => {
  it('equals E in GPa over density in g/cm3', () => {
    const expected = plateYoungsLongGPa(syntheticPlate, 85) / densityGPerCm3(syntheticPlate)
    expect(specL(syntheticPlate, 85)).toBeCloseTo(expected, 6)
  })

  it('zero density returns zero', () => {
    expect(specL({ ...syntheticPlate, thicknessMm: 0, massG: 0 }, 85)).toBe(0)
  })
})

// ── Radiation ratio ────────────────────────────────────────────────────────────────────────
describe('plate radiation ratio', () => {
  // R = c/rho is shown in the Results panel and baked into the exported image, and had no test
  // in any edition until the #17 sweep — which is how the web port's inline copy came to be
  // missing this zero guard and to render the string "NaN" where the natives render 0.
  it('equals c over rho, in both directions', () => {
    const rho = density(realPlate)
    expect(radiationRatio(cL(realPlate, fL), rho)).toBeCloseTo(cL(realPlate, fL) / rho, 6)
    expect(radiationRatio(cC(realPlate, fC), rho)).toBeCloseTo(cC(realPlate, fC) / rho, 6)
  })

  it('radiates better along the grain than across it', () => {
    const rho = density(realPlate)
    expect(radiationRatio(cL(realPlate, fL), rho)).toBeGreaterThan(radiationRatio(cC(realPlate, fC), rho))
  })

  it('zero density returns 0, not NaN', () => {
    const d = { ...realPlate, thicknessMm: 0 }
    expect(density(d)).toBe(0)
    expect(radiationRatio(cL(d, fL), density(d))).toBe(0)
    expect(Number.isNaN(radiationRatio(cL(d, fL), density(d)))).toBe(false)
  })

  it('zero mass returns 0, not NaN', () => {
    const d = { ...realPlate, massG: 0 }
    expect(radiationRatio(cL(d, fL), density(d))).toBe(0)
    expect(Number.isNaN(radiationRatio(cL(d, fL), density(d)))).toBe(false)
  })
})

// ── Anisotropy ratios ──────────────────────────────────────────────────────────────────────
describe('plate anisotropy ratios', () => {
  it('crossLongRatio is E_C / E_L', () => {
    const eL = plateYoungsLongPa(syntheticPlate, 85)
    const eC = plateYoungsCrossPa(syntheticPlate, 50)
    expect(crossLongRatio(eL, eC)).toBeCloseTo(eC / eL, 8)
  })

  it('longCrossRatio is E_L / E_C', () => {
    const eL = plateYoungsLongPa(syntheticPlate, 85)
    const eC = plateYoungsCrossPa(syntheticPlate, 50)
    expect(longCrossRatio(eL, eC)).toBeCloseTo(eL / eC, 4)
  })

  it('the two are reciprocals', () => {
    const eL = plateYoungsLongPa(syntheticPlate, 85)
    const eC = plateYoungsCrossPa(syntheticPlate, 50)
    expect(crossLongRatio(eL, eC) * longCrossRatio(eL, eC)).toBeCloseTo(1, 6)
  })

  it('zero moduli return 0, not NaN', () => {
    expect(crossLongRatio(0, 0)).toBe(0)
    expect(longCrossRatio(0, 0)).toBe(0)
    expect(Number.isNaN(crossLongRatio(0, 0))).toBe(false)
    expect(Number.isNaN(longCrossRatio(0, 0))).toBe(false)
  })
})

// ── Gore plate model ───────────────────────────────────────────────────────────────────────
describe('plate Gore moduli and target thickness', () => {
  it('Gore moduli are close to, but not equal to, the beam moduli', () => {
    // The Gore plate model adds Poisson coupling, so it sits a little below the beam value.
    expect(goreYoungsLongPa(realPlate, fL) / 1e9).toBeCloseTo(6.0759, 3)
    expect(goreYoungsCrossPa(realPlate, fC) / 1e9).toBeCloseTo(0.4462, 3)
    expect(goreShearPa(realPlate, fLC)! / 1e9).toBeCloseTo(0.3406, 3)
  })

  it('the shear modulus needs the diagonal tap, and is null without it', () => {
    expect(goreShearPa(realPlate, fLC)).not.toBeNull()
    expect(goreShearPa(realPlate, null)).toBeNull()
  })

  it('target thickness for the real plate is a sensible finished-top thickness', () => {
    // Classical Top stiffness target (60), with the body outline saved alongside the sample.
    const t = goreTargetThicknessMm(realPlate, fL, fC, fLC, bodyLengthMm, bodyWidthMm, 60)
    expect(t).not.toBeNull()
    expect(t!).toBeGreaterThan(2.0)
    expect(t!).toBeLessThan(5.0)
  })

  it('a higher stiffness target gives a thicker plate', () => {
    const t55 = goreTargetThicknessMm(realPlate, fL, fC, fLC, bodyLengthMm, bodyWidthMm, 55)!
    const t75 = goreTargetThicknessMm(realPlate, fL, fC, fLC, bodyLengthMm, bodyWidthMm, 75)!
    expect(t75).toBeGreaterThan(t55)
  })

  it('zero body length returns null', () => {
    expect(goreTargetThicknessMm(realPlate, fL, fC, fLC, 0, bodyWidthMm, 60)).toBeNull()
  })
})

// ── Quality ────────────────────────────────────────────────────────────────────────────────
describe('plate quality', () => {
  it('overall quality blends the two directions', () => {
    // The real plate straddles two grades — Fair along the grain (17.5), Very Good across it
    // (1.29) — so the 0.7/0.3 blend is doing real work here: 0.7*2 + 0.3*4 = 2.6 -> Good.
    expect(woodQuality(specL(realPlate, fL), 'longitudinal', 'spruce')).toBe('Fair')
    expect(woodQuality(specC(realPlate, fC), 'cross', 'spruce')).toBe('Very Good')
    expect(overallQuality(specL(realPlate, fL), specC(realPlate, fC))).toBe('Good')
  })

  it('a high specific modulus grades Excellent', () => {
    expect(woodQuality(30, 'longitudinal', 'spruce')).toBe('Excellent')
  })
})
