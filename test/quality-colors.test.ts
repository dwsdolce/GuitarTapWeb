// @parity test/quality-colors
//
// Locks the WoodQuality → colour table against silent drift, such as a hue swapped between grades.
//
// The values are ABSOLUTE in all three editions: Swift pins `WoodQuality.hex` rather than resolving
// SwiftUI's semantic colours, which the OS supplies and Apple revises (macOS 26 moved .blue and
// .orange). `light` below is what all three editions compare; it is also what THIS edition's PDF
// report draws, because a printed report is never themed. Mirrors Swift QualityColorsTests and
// Python test_quality_colors.py.
//
// `dark` is web-only for now: the brightened variant for the app's dark chrome, which the natives
// have no equivalent of until the theme work lands. Hue matches `light`; only shade differs.

import { describe, it, expect } from 'vitest'
import { WOOD_QUALITY_COLOR, woodQualityColor } from '../src/presentation/qualityColors'
import type { WoodQuality } from '../src/dsp/material'

describe('quality-colors', () => {
  it('light — canonical SwiftUI system hexes (matches Python/Swift)', () => {
    expect(WOOD_QUALITY_COLOR.light).toEqual({
      Excellent: '#34C759', // .green
      'Very Good': '#00C7BE', // .mint
      Good: '#007AFF', // .blue
      Fair: '#FF9500', // .orange
      Poor: '#FF3B30', // .red
    })
  })

  it('dark — Apple dark variants (hue matches light; shade brightened)', () => {
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

  it('every grade has its own colour, in both schemes', () => {
    // Five grades must be five distinguishable colours — the only thing the hue has to do.
    // Mirrors Swift everyGradeHasItsOwnColour / Python test_every_grade_has_its_own_colour.
    for (const scheme of ['light', 'dark'] as const) {
      const hexes = Object.values(WOOD_QUALITY_COLOR[scheme])
      expect(new Set(hexes).size).toBe(hexes.length)
    }
  })

  it('labels — the five grade names', () => {
    // Mirrors Swift rawLabel / Python test_labels. The labels are the keys of the colour table, so
    // this pins that it covers exactly the five grades and spells them as the natives do.
    const labels: WoodQuality[] = ['Excellent', 'Very Good', 'Good', 'Fair', 'Poor']
    expect(Object.keys(WOOD_QUALITY_COLOR.light).sort()).toEqual([...labels].sort())
    expect(Object.keys(WOOD_QUALITY_COLOR.dark).sort()).toEqual([...labels].sort())
  })
})