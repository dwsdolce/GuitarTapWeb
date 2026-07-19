// @parity test/material-selection
//
// Locks the material (plate/brace) selection HEAL against the real iPad save-corruption bug.
// Fixture `plate-umik-1-3-tap-swift-ipad-1784314709.guitartap` is a genuine iPad-saved plate whose
// `selectedPeakIDs` aggregate was clobbered to just the cross peak (the intermittent iPad Swift
// glitch), while `peaks[]` correctly holds all three (L ~67, C ~117, FLC ~36 Hz). Material has no
// per-peak selection, so `effectiveSelectedPeakIDs` must ignore the corrupt aggregate and resolve
// to all three — healing the file at render time. Swift + Python pin the same fixture in this group.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseGuitarTapFile } from '../src/measurement'
import { effectiveSelectedPeakIDs, isMaterialMeasurement } from '../src/measurement/types'

const raw = readFileSync(
  new URL('./fixtures/plate-umik-1-3-tap-swift-ipad-1784314709.guitartap', import.meta.url),
  'utf8',
)
const m = parseGuitarTapFile(raw)[0]!

describe('material-selection', () => {
  it('corrupt iPad plate: effectiveSelectedPeakIDs heals to all three', () => {
    // Preconditions: a material measurement, all three peaks present, corrupt aggregate = cross only.
    expect(isMaterialMeasurement(m)).toBe(true)
    expect(m.peaks).toHaveLength(3)
    expect(m.selectedPeakIDs?.length ?? 0).toBe(1)

    // The heal: the corrupt aggregate is ignored for material → all three peaks resolve.
    expect(effectiveSelectedPeakIDs(m)).toEqual(new Set(m.peaks.map((p) => p.id)))
    expect(effectiveSelectedPeakIDs(m).size).toBe(3)
  })
})