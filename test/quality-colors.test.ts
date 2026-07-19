// @parity test/quality-colors
//
// Locks the WoodQuality → colour table against silent drift — the material quality-colours motivated
// this whole parity group: a copy once drifted to wrong hues (Good was yellow, Very Good was
// Excellent's green) with nothing to catch it. `light` matches Swift/Python's canonical SwiftUI
// system hexes; `dark` is the web's brightened variant. Each platform pins its own map.

import { describe, it, expect } from 'vitest'
import { WOOD_QUALITY_COLOR, woodQualityColor } from '../src/presentation/qualityColors'

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
})