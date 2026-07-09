// @parity test/brace
import { describe, it, expect } from 'vitest'
import {
  densityGPerCm3,
  specificModulus,
  braceYoungsLongGPa,
  woodQuality,
  type Dimensions,
} from '../src/dsp/material'

// Reference values from the canonical Python material_properties (brace beam
// constant βL² = 22.37332). Mirrors Swift BracePropertiesTests.
const brace: Dimensions = { lengthMm: 600, widthMm: 24, thicknessMm: 8.5, massG: 58 }

describe('G4b — brace material property formulas', () => {
  it('brace beam modulus (22.37332) + quality', () => {
    const eGPa = braceYoungsLongGPa(brace, 512.6888)
    expect(eGPa).toBeCloseTo(211.446987, 4)
    const spec = specificModulus(eGPa, densityGPerCm3(brace))
    expect(spec).toBeCloseTo(446.226055, 3)
    expect(woodQuality(spec, 'longitudinal', 'spruce')).toBe('Excellent')
  })
})