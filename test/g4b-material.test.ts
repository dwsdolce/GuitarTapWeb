import { describe, it, expect } from 'vitest'
import {
  density,
  densityGPerCm3,
  plateYoungsLongGPa,
  plateYoungsCrossGPa,
  specificModulus,
  speedOfSound,
  plateYoungsLongPa,
  goreYoungsLongPa,
  goreYoungsCrossPa,
  goreShearPa,
  goreTargetThicknessMm,
  braceYoungsLongGPa,
  overallQuality,
  woodQuality,
  type Dimensions,
} from '../src/dsp/material'

// Reference values from the canonical Python material_properties on the same
// dims/frequencies (validates the βL²=22.37 plate / 22.37332 brace split too).
const plate: Dimensions = { lengthMm: 560, widthMm: 230, thicknessMm: 2.8, massG: 210 }
const brace: Dimensions = { lengthMm: 600, widthMm: 24, thicknessMm: 8.5, massG: 58 }
const fL = 67.11537
const fC = 116.27016
const fLC = 35.35375

describe('G4b — material property formulas', () => {
  it('plate density + beam moduli', () => {
    expect(density(plate)).toBeCloseTo(582.298137, 4)
    expect(plateYoungsLongGPa(plate, fL)).toBeCloseTo(31.148306, 5)
    expect(plateYoungsCrossGPa(plate, fC)).toBeCloseTo(2.660028, 5)
    expect(specificModulus(plateYoungsLongGPa(plate, fL), densityGPerCm3(plate))).toBeCloseTo(53.492025, 4)
    expect(speedOfSound(plateYoungsLongPa(plate, fL), density(plate))).toBeCloseTo(7313.8242, 2)
  })

  it('plate Gore moduli + target thickness', () => {
    expect(goreYoungsLongPa(plate, fL) / 1e9).toBeCloseTo(30.976187, 5)
    expect(goreYoungsCrossPa(plate, fC) / 1e9).toBeCloseTo(2.645329, 5)
    expect(goreShearPa(plate, fLC)! / 1e9).toBeCloseTo(1.872464, 5)
    expect(goreTargetThicknessMm(plate, fL, fC, fLC, 560, 230, 75)!).toBeCloseTo(1.44749, 4)
  })

  it('plate overall quality', () => {
    const specL = specificModulus(plateYoungsLongGPa(plate, fL), densityGPerCm3(plate))
    const specC = specificModulus(plateYoungsCrossGPa(plate, fC), densityGPerCm3(plate))
    expect(overallQuality(specL, specC)).toBe('Excellent')
  })

  it('brace beam modulus (22.37332) + quality', () => {
    const eGPa = braceYoungsLongGPa(brace, 512.6888)
    expect(eGPa).toBeCloseTo(211.446987, 4)
    const spec = specificModulus(eGPa, densityGPerCm3(brace))
    expect(spec).toBeCloseTo(446.226055, 3)
    expect(woodQuality(spec, 'longitudinal', 'spruce')).toBe('Excellent')
  })
})
