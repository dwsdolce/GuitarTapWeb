// @parity test/classify
//
// Guitar mode classification — what the shared case file (`classify.json`, run by classify-cases.test.ts
// here and by the Swift and Python suites) cannot express: that the band list is a fresh copy.
import { describe, it, expect } from 'vitest'
import { modeBands } from '../src/dsp/guitarModes'

describe('mode bands', () => {
  it('modeBands returns a fresh copy, so a caller may sort it', () => {
    // classifyAll sorts the result in place. If this returned a shared array that would
    // corrupt module state for every later caller.
    const a = modeBands('generic')
    a.sort((x, y) => y.lo - x.lo)
    expect(modeBands('generic').map((b) => b.name)).toEqual(['air', 'top', 'back', 'dipole', 'ring', 'upper'])
  })
})
