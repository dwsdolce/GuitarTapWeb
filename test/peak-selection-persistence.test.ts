// @parity test/peak-selection-persistence
//
// Option 1 of PEAK-MIN-SEMANTICS.md: the manual/auto selection flag is persisted, so a reloaded
// measurement behaves like a live one. Mirrors Swift PeakSelectionPersistenceTests / Python
// TestPeakSelectionPersistence. The re-selection behaviour itself lives in the useAnnotations hook
// (effectiveSelectedIds = userModified ? parked : autoIds); here we cover the model/bridge layer:
// the flag is written on save, round-trips, and restores on load (default manual for legacy files).

import { describe, it, expect } from 'vitest'
import { buildGuitarMeasurement, measurementToLive, type BuildMeasurementArgs } from '../src/measurement/fromLive'
import { serializeGuitarTapFile, parseGuitarTapFile } from '../src/measurement'
import { DEFAULT_SETTINGS } from '../src/settings'

const base: Omit<BuildMeasurementArgs, 'userModified'> = {
  name: 'Sel',
  notes: '',
  spectrum: { frequencies: [100, 200, 300], magnitudesDb: [-50, -40, -60] },
  peaks: [],
  modeByPeak: new Map(),
  selectedIds: new Set<number>(),
  overridesByFreq: new Map(),
  view: { minHz: 75, maxHz: 350, minDb: -100, maxDb: 0 },
  settings: { ...DEFAULT_SETTINGS, measurementType: 'generic' },
  numberOfTaps: 1,
  sampleRate: 48000,
  deviceLabel: 'X',
  isLoadedMeasurement: true, // skip the full-set findPeaks pass; irrelevant to the flag
}

describe('userModifiedSelection persistence', () => {
  it('is written on save (and defaults to automatic)', () => {
    expect(buildGuitarMeasurement({ ...base, userModified: true }).userModifiedSelection).toBe(true)
    expect(buildGuitarMeasurement({ ...base, userModified: false }).userModifiedSelection).toBe(false)
    expect(buildGuitarMeasurement(base as BuildMeasurementArgs).userModifiedSelection).toBe(false)
  })

  it('round-trips through serialize/parse', () => {
    for (const v of [true, false]) {
      const m = buildGuitarMeasurement({ ...base, userModified: v })
      expect(parseGuitarTapFile(serializeGuitarTapFile([m]))[0]!.userModifiedSelection).toBe(v)
    }
  })

  it('measurementToLive restores the flag; a legacy file (no field) defaults to manual', () => {
    expect(measurementToLive(buildGuitarMeasurement({ ...base, userModified: true })).userModified).toBe(true)
    expect(measurementToLive(buildGuitarMeasurement({ ...base, userModified: false })).userModified).toBe(false)
    const legacy = { ...buildGuitarMeasurement({ ...base, userModified: false }), userModifiedSelection: undefined }
    expect(measurementToLive(legacy).userModified).toBe(true)
  })
})