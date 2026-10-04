// @parity test/peak-selection-persistence
//
// The manual/auto selection flag is persisted, so a reloaded
// measurement behaves like a live one. Mirrors Swift PeakSelectionPersistenceTests / Python
// TestPeakSelectionPersistence. The re-selection behaviour itself lives in the useAnnotations hook
// (effectiveSelectedIds = userModified ? parked : autoIds); here we cover the model/bridge layer:
// the flag is written on save, round-trips, and restores on load (default manual for legacy files).

import { describe, it, expect } from 'vitest'
import { measurementToLive } from '../src/measurement/fromLive'
import { serializeGuitarTapFile, parseGuitarTapFile } from '../src/measurement'
import { DEFAULT_SETTINGS } from '../src/settings'
import { saveGuitar, type GuitarState } from './saveFromAnalyzer'

const base: Omit<GuitarState, 'userModified'> = {
  name: 'Sel',
  notes: '',
  spectrum: { frequencies: [100, 200, 300], magnitudesDb: [-50, -40, -60] },
  peaks: [],
  selectedIds: new Set<string>(),
  overridesById: new Map<string, string>(),
  view: { minHz: 75, maxHz: 350, minDb: -100, maxDb: 0 },
  settings: { ...DEFAULT_SETTINGS, measurementType: 'generic' },
  numberOfTaps: 1,
  sampleRate: 48000,
  deviceLabel: 'X',
}

describe('userModifiedSelection persistence', () => {
  it('is written on save (and defaults to automatic)', () => {
    expect(saveGuitar({ ...base, userModified: true }).userModifiedSelection).toBe(true)
    expect(saveGuitar({ ...base, userModified: false }).userModifiedSelection).toBe(false)
    expect(saveGuitar(base as GuitarState).userModifiedSelection).toBe(false)
  })

  it('round-trips through serialize/parse', () => {
    for (const v of [true, false]) {
      const m = saveGuitar({ ...base, userModified: v })
      expect(parseGuitarTapFile(serializeGuitarTapFile([m]))[0]!.userModifiedSelection).toBe(v)
    }
  })

  it('measurementToLive restores the flag; a legacy file (no field) defaults to manual', () => {
    expect(measurementToLive(saveGuitar({ ...base, userModified: true })).userModified).toBe(true)
    expect(measurementToLive(saveGuitar({ ...base, userModified: false })).userModified).toBe(false)
    const legacy = { ...saveGuitar({ ...base, userModified: false }), userModifiedSelection: undefined }
    expect(measurementToLive(legacy).userModified).toBe(true)
  })
})