// @parity test/mode-colors
//
// Locks the per-mode annotation color / label / display-name maps against silent drift — the exact
// class of bug that hit the material quality-colors (item 7 §F), where a copy drifted to wrong hues
// with nothing to catch it. The web hues are brightened for the dark chart, so the hex VALUES differ
// from Swift's semantic Colors / Python's RGB by design; each platform's test pins its own map.

import { describe, it, expect } from 'vitest'
import { MODE_COLOR, MODE_LABEL, MODE_DISPLAY_NAME } from '../src/presentation/modeColors'

describe('mode-colors', () => {
  it('MODE_COLOR — the per-mode hue (brightened for dark), exact hex', () => {
    expect(MODE_COLOR).toEqual({
      air: '#4ea1ff',
      top: '#5fd07a',
      back: '#f0a03a',
      dipole: '#e0584a',
      ring: '#b07ad8',
      upper: '#9aa6b3',
      unknown: '#5a6573',
    })
  })

  it('MODE_LABEL — compact chart abbreviations', () => {
    expect(MODE_LABEL).toEqual({
      air: 'Air', top: 'Top', back: 'Back', dipole: 'DP', ring: 'Ring', upper: 'Upper', unknown: '?',
    })
  })

  it('MODE_DISPLAY_NAME — full names (Air keeps the (Helmholtz) suffix)', () => {
    expect(MODE_DISPLAY_NAME.air).toBe('Air (Helmholtz)')
    expect(MODE_DISPLAY_NAME.top).toBe('Top')
    expect(MODE_DISPLAY_NAME.back).toBe('Back')
    expect(MODE_DISPLAY_NAME.dipole).toBe('Dipole')
    expect(MODE_DISPLAY_NAME.ring).toBe('Ring Mode')
    expect(MODE_DISPLAY_NAME.upper).toBe('Upper Modes')
  })
})