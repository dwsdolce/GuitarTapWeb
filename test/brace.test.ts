// @parity test/brace
// Brace material property formulas. Mirrors Swift BracePropertiesTests.swift and Python
// tests/test_brace.py — same fixture, same cases, same expected values.
//
// The fixture is the real measured brace blank, read out of the hub's committed measurement
// rather than transcribed:
//
//     guitar-tap-project/Tests/Brace/brace-umik-1-swift-mac-1778816093.guitartap
//
// and the expected values are the ones GuitarTap itself reported for it (see the .pdf beside
// that file), not numbers this suite produced. Until the #17 sweep this file used
// 600 x 24 x 8.5 mm / 58 g with that same 512.6888 Hz — a different object entirely, which
// implied E_L = 211 GPa and c = 21 124 m/s: stiffer than steel, faster than sound in diamond.
// Its one quality assertion then held at a specific modulus of 446 against an Excellent
// threshold of 25, so it could not have failed for any reason.
import { describe, it, expect } from 'vitest'
import {
  density,
  densityGPerCm3,
  specificModulus,
  speedOfSound,
  radiationRatio,
  braceYoungsLongPa,
  braceYoungsLongGPa,
  woodQuality,
  type Dimensions,
} from '../src/dsp/material'

// Real measured spruce brace blank. rho 383.8 kg/m3, E_L 10.557 GPa, c 5244 m/s,
// specific modulus 27.50 -> Excellent.
const realBrace: Dimensions = { lengthMm: 556, widthMm: 20.4, thicknessMm: 29.4, massG: 128 }
const realBraceFl = 512.6888

const eGPa = (d: Dimensions, f: number) => braceYoungsLongGPa(d, f)
const cOf = (d: Dimensions, f: number) => speedOfSound(braceYoungsLongPa(d, f), density(d))
const specOf = (d: Dimensions, f: number) => specificModulus(eGPa(d, f), densityGPerCm3(d))
const rOf = (d: Dimensions, f: number) => radiationRatio(cOf(d, f), density(d))

describe("brace Young's modulus", () => {
  it('real brace is physically plausible (8-16 GPa for quality spruce)', () => {
    const EL = braceYoungsLongPa(realBrace, realBraceFl)
    expect(EL).toBeGreaterThan(8e9)
    expect(EL).toBeLessThan(16e9)
  })

  it('real brace matches the reported value: 10.557 GPa', () => {
    expect(eGPa(realBrace, realBraceFl)).toBeCloseTo(10.557, 2)
  })

  it('zero thickness returns zero', () => {
    const d = { ...realBrace, thicknessMm: 0 }
    expect(braceYoungsLongPa(d, realBraceFl)).toBe(0)
  })

  it('zero mass returns zero (density guard)', () => {
    const d = { ...realBrace, massG: 0 }
    expect(braceYoungsLongPa(d, realBraceFl)).toBe(0)
  })

  it('E is proportional to f-squared: doubling fL quadruples EL', () => {
    const ratio = braceYoungsLongPa(realBrace, realBraceFl * 2) / braceYoungsLongPa(realBrace, realBraceFl)
    expect(ratio).toBeCloseTo(4, 2)
  })

  it('E is proportional to L-to-the-fourth at constant density', () => {
    const d2: Dimensions = { ...realBrace, lengthMm: realBrace.lengthMm * 2, massG: realBrace.massG * 2 }
    const ratio = braceYoungsLongPa(d2, realBraceFl) / braceYoungsLongPa(realBrace, realBraceFl)
    expect(ratio).toBeCloseTo(16, 1)
  })

  it('the GPa accessor is the Pa value over 1e9', () => {
    expect(eGPa(realBrace, realBraceFl)).toBeCloseTo(braceYoungsLongPa(realBrace, realBraceFl) / 1e9, 5)
  })

  it('uses the precise brace beam constant 22.37332, not the plate 22.37', () => {
    const rho = density(realBrace)
    const L = realBrace.lengthMm / 1000
    const t = realBrace.thicknessMm / 1000
    const f = realBraceFl
    const withPrecise = (48 * Math.PI ** 2 * rho * f * f * L ** 4) / (22.37332 * t) ** 2
    const withApprox = (48 * Math.PI ** 2 * rho * f * f * L ** 4) / (22.37 * t) ** 2
    const actual = braceYoungsLongPa(realBrace, f)
    expect(Math.abs(actual - withPrecise)).toBeLessThan(1)
    expect(Math.abs(actual - withApprox)).toBeGreaterThan(1000)
  })
})

describe('brace speed of sound', () => {
  it('real brace is in the 4000-7000 m/s range for quality spruce', () => {
    const c = cOf(realBrace, realBraceFl)
    expect(c).toBeGreaterThan(4000)
    expect(c).toBeLessThan(7000)
  })

  it('real brace matches the reported value: 5244 m/s', () => {
    expect(cOf(realBrace, realBraceFl)).toBeCloseTo(5244.4, 0)
  })

  it('equals sqrt(E / rho)', () => {
    const expected = Math.sqrt(braceYoungsLongPa(realBrace, realBraceFl) / density(realBrace))
    expect(cOf(realBrace, realBraceFl)).toBeCloseTo(expected, 5)
  })

  it('is proportional to frequency: doubling fL doubles c', () => {
    expect(cOf(realBrace, realBraceFl * 2) / cOf(realBrace, realBraceFl)).toBeCloseTo(2, 2)
  })

  it('zero density returns zero', () => {
    const d = { ...realBrace, thicknessMm: 0, massG: 0 }
    expect(cOf(d, realBraceFl)).toBe(0)
  })
})

describe('brace specific modulus', () => {
  it('real brace matches the reported value: 27.50', () => {
    expect(specOf(realBrace, realBraceFl)).toBeCloseTo(27.504, 2)
  })

  it('equals E in GPa over density in g/cm3', () => {
    const expected = eGPa(realBrace, realBraceFl) / densityGPerCm3(realBrace)
    expect(specOf(realBrace, realBraceFl)).toBeCloseTo(expected, 6)
  })

  it('zero density returns zero', () => {
    const d = { ...realBrace, thicknessMm: 0, massG: 0 }
    expect(specOf(d, realBraceFl)).toBe(0)
  })

  it('a higher frequency gives a higher specific modulus', () => {
    expect(specOf(realBrace, realBraceFl)).toBeGreaterThan(specOf(realBrace, realBraceFl / 2))
  })
})

describe('brace radiation ratio', () => {
  // R = c/rho is shown in the Brace Properties panel and baked into the exported image, and
  // had no test in any edition until the #17 sweep — which is how the web port's inline copy
  // came to be missing this zero guard and to render the string "NaN".
  it('equals c over rho', () => {
    const expected = cOf(realBrace, realBraceFl) / density(realBrace)
    expect(rOf(realBrace, realBraceFl)).toBeCloseTo(expected, 6)
  })

  it('real brace is in the 10-15 range for quality spruce', () => {
    const r = rOf(realBrace, realBraceFl)
    expect(r).toBeGreaterThan(10)
    expect(r).toBeLessThan(15)
  })

  it('zero density returns 0, not NaN', () => {
    const d = { ...realBrace, thicknessMm: 0 }
    expect(density(d)).toBe(0)
    expect(rOf(d, realBraceFl)).toBe(0)
    expect(Number.isNaN(rOf(d, realBraceFl))).toBe(false)
  })

  it('zero mass returns 0, not NaN', () => {
    const d = { ...realBrace, massG: 0 }
    expect(rOf(d, realBraceFl)).toBe(0)
    expect(Number.isNaN(rOf(d, realBraceFl))).toBe(false)
  })
})

describe('brace quality', () => {
  it('real brace grades Excellent at specific modulus 27.50', () => {
    expect(woodQuality(specOf(realBrace, realBraceFl), 'longitudinal', 'spruce')).toBe('Excellent')
  })

  it('half the frequency drops the specific modulus below 16 and grades Poor', () => {
    const spec = specOf(realBrace, realBraceFl / 2)
    expect(spec).toBeLessThan(16)
    expect(woodQuality(spec, 'longitudinal', 'spruce')).toBe('Poor')
  })
})
