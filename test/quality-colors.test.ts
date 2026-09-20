// @parity test/quality-colors
//
// Locks the WoodQuality → colour table against silent drift — the material quality-colours motivated
// this whole parity group: a copy once drifted to wrong hues (Good was yellow, Very Good was
// Excellent's green) with nothing to catch it.
//
// The values are ABSOLUTE in all three editions as of the #17 sweep. Swift used to resolve these
// from SwiftUI's semantic colours, which the OS supplies — so what Swift drew changed when Apple
// revised the palette, and macOS 26 did: Swift moved to .blue = #0088FF and .orange = #FF8D28 while
// this table and Python went on pinning #007AFF and #FF9500. Three editions that all claimed to
// agree rendered two visibly different blues and oranges on the same white surface — the macOS app,
// the Python app, and THIS edition's PDF report, which is pinned to `light` because a printed
// report is never themed. Swift now pins `WoodQuality.hex`, and `light` below is what all three
// editions compare. Mirrors Swift QualityColorsTests and Python test_quality_colors.py.
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