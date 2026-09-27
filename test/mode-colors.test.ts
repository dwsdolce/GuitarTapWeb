// @parity test/mode-colors
//
// Locks the per-mode annotation colour against silent drift.
//
// The values are ABSOLUTE in all three editions: fixed hex values, not colours the OS resolves.
//
// This edition's chart is DARK, which is the one legitimate reason to differ: the web keeps its own
// value where the difference is the background and follows Swift where it is not. `top`, `back` and
// `dipole` sit 1°, 5° and 7° from Swift's and are genuine dark variants; `air` and `ring` carry
// Swift's values. `upper` and `unknown` are near-neutral, where only lightness matters, so they keep
// the web's.
//
// Mirrors Swift ModeColorsTests and Python test_mode_colors.py.
//
// The label and display-name maps are NOT tested here: Swift and Python file those two rules under
// test/classify, so they are in classify.test.ts.

import { describe, it, expect } from 'vitest'
import { MODE_COLOR } from '../src/presentation/modeColors'

describe('mode-colors', () => {
  it('the per-mode colour for this edition\'s dark chart, exact hex', () => {
    expect(MODE_COLOR).toEqual({
      air: '#00C0E8', // Swift's cyan — was #4ea1ff, a different hue
      top: '#5fd07a', // Swift's green, brightened for dark
      back: '#f0a03a', // Swift's orange, brightened for dark
      dipole: '#e0584a', // Swift's red, brightened for dark
      ring: '#CB30E0', // Swift's purple — was #b07ad8, a different hue
      upper: '#9aa6b3', // near-neutral
      unknown: '#5a6573', // near-neutral, must stay distinct from upper
    })
  })

  it('every mode has its own colour', () => {
    // Seven modes must be seven tellable-apart colours — the only thing the hue has to do.
    // Upper and Unknown are the close pair.
    const hexes = Object.values(MODE_COLOR)
    expect(new Set(hexes).size).toBe(hexes.length)
    expect(MODE_COLOR.upper).not.toBe(MODE_COLOR.unknown)
  })

  it('air and ring carry Swift\'s values exactly', () => {
    // The two that were a different colour rather than a different shade. Pinned against Swift's
    // table directly so a future dark-mode tweak cannot quietly reintroduce the divergence.
    expect(MODE_COLOR.air).toBe('#00C0E8')
    expect(MODE_COLOR.ring).toBe('#CB30E0')
  })
})
