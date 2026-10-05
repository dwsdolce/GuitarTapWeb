// @parity test/quality-colors
//
// The wood-quality grades — label against the shared case file `quality-colors.json`, colour against the grade's
// `wood.*` role in `theme.json` — the same cases the Swift and Python suites run (the web's `light` value is the
// shared colour, and what this edition's PDF report draws); and what only the web has: `dark`, the brightened
// variant for the app's dark chrome.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { WOOD_QUALITY_COLOR, woodQualityColor } from '../src/presentation/qualityColors'
import type { WoodQuality } from '../src/dsp/material'
import { pair, type Role } from '../src/presentation/palette'

const GRADES = (JSON.parse(readFileSync('test/fixtures/quality-colors.json', 'utf8')) as { grades: [string, WoodQuality][] }).grades

describe('quality-colors — shared cases', () => {
  for (const [name, label] of GRADES) {
    it(`${name} is ${label}, the wood.${name} light value`, () =>
      expect(WOOD_QUALITY_COLOR.light[label]).toBe(pair(`wood.${name}` as Role).light))
  }
  it('the file names every grade, and every grade has its own colour', () => {
    expect(Object.keys(WOOD_QUALITY_COLOR.light).sort()).toEqual(GRADES.map(([, label]) => label).sort())
    expect(new Set(Object.values(WOOD_QUALITY_COLOR.light)).size).toBe(GRADES.length)
  })
})

describe('quality-colors — the dark variant (web only)', () => {
  it('Apple dark variants: hue matches light, shade brightened', () => {
    expect(WOOD_QUALITY_COLOR.dark).toEqual({
      Excellent: '#30D158',
      'Very Good': '#66D4CF',
      Good: '#0A84FF',
      Fair: '#FF9F0A',
      Poor: '#FF453A',
    })
  })

  it('woodQualityColor(q, scheme) — the report passes light, the app its scheme', () => {
    expect(woodQualityColor('Good', 'light')).toBe('#007AFF')
    expect(woodQualityColor('Good', 'dark')).toBe('#0A84FF')
  })

  it('every grade has its own dark colour', () => {
    const hexes = Object.values(WOOD_QUALITY_COLOR.dark)
    expect(new Set(hexes).size).toBe(hexes.length)
  })
})
