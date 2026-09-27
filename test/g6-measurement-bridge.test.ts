import { describe, it, expect } from 'vitest'
import { buildGuitarMeasurement, measurementPeakModeLabels, measurementToLive } from '../src/measurement/fromLive'
import { serializeGuitarTapFile, parseGuitarTapFile } from '../src/measurement'
import { DEFAULT_SETTINGS } from '../src/settings'
import type { ResolvedMode } from '../src/dsp/classify'
import { newId } from '../src/measurement/newId'
import type { ResonantPeak } from '../src/measurement/types'

// The live <-> persisted bridge. Build a measurement from synthetic live
// state, round-trip it through the canonical writer/reader, then restore it — the
// frozen spectrum, selection, and overrides must come back keyed correctly — each peak is saved and
// restored under its own id, as Swift's `ResonantPeak.id` is.

const spectrum = { frequencies: [100, 200, 300], magnitudesDb: [-50, -40, -60] }
const AIR_ID = newId()
const TOP_ID = newId()
const peaks: ResonantPeak[] = [
  { id: AIR_ID, frequency: 100, magnitude: -50, quality: 10, bandwidth: 10, timestamp: '2026-09-25T00:00:00Z' },
  { id: TOP_ID, frequency: 200, magnitude: -40, quality: 20, bandwidth: 10, timestamp: '2026-09-25T00:00:00Z' },
]
const modeByPeak = new Map<string, ResolvedMode>([
  [AIR_ID, 'air'],
  [TOP_ID, 'top'],
])
const args = {
  name: 'Test Guitar',
  notes: 'hello',
  spectrum,
  peaks,
  selectedIds: new Set<string>([TOP_ID]),
  overridesById: new Map<string, string>([[AIR_ID, 'Custom']]), // the 100 Hz peak (id-keyed)
  annotationOffsetsById: new Map<string, [number, number]>([[TOP_ID, [215.5, -32.0]]]), // the 200 Hz peak
  view: { minHz: 75, maxHz: 350, minDb: -100, maxDb: 0 },
  settings: { ...DEFAULT_SETTINGS, measurementType: 'classical' as const, showUnknownModes: true, peakMinThreshold: -55 },
  numberOfTaps: 3,
  sampleRate: 48000,
  deviceLabel: 'Test Mic',
}

describe('buildGuitarMeasurement — live state → model', () => {
  const m = buildGuitarMeasurement(args)

  it('saves each peak under its own id and maps selection / overrides onto them', () => {
    expect(m.peaks.map((p) => p.id)).toEqual([AIR_ID, TOP_ID])
    const top = m.peaks.find((p) => p.frequency === 200)!
    expect(m.selectedPeakIDs).toEqual([top.id])
    expect(m.selectedPeakFrequencies).toEqual([200])
    const air = m.peaks.find((p) => p.frequency === 100)!
    expect(m.peakModeOverrides?.[air.id]).toBe('Custom')
    expect(measurementPeakModeLabels(m).get(air.id)).toBe('Custom') // the override wins as the label
    expect(measurementPeakModeLabels(m).get(top.id)).toBe('Top')
    // Dragged annotation-label position is saved under the peak's id.
    expect(m.peakAnnotationOffsets?.[top.id]).toEqual([215.5, -32.0])
    expect(m.peakAnnotationOffsets?.[air.id]).toBeUndefined()
  })

  it('captures snapshot type/provenance from the live settings', () => {
    expect(m.spectrumSnapshot?.measurementType).toBe('Classical Guitar')
    expect(m.spectrumSnapshot?.guitarType).toBe('Classical')
    expect(m.spectrumSnapshot?.showUnknownModes).toBe(true)
    expect(m.measurementName).toBe('Test Guitar')
    expect(m.notes).toBe('hello')
    expect(m.numberOfTaps).toBe(3)
    expect(m.peakMinThreshold).toBe(-55)
    expect(m.sampleRate).toBe(48000)
    expect(m.microphoneName).toBe('Test Mic')
  })
})

describe('round-trip through file → restore into the view', () => {
  it('restores spectrum, ranges, selection (by freq), and settings', () => {
    const m = buildGuitarMeasurement(args)
    const m2 = parseGuitarTapFile(serializeGuitarTapFile([m]))[0]!
    const live = measurementToLive(m2)

    expect(live.captured.frequencies).toEqual([100, 200, 300])
    expect(live.captured.magnitudesDb).toEqual([-50, -40, -60])
    expect(live.view).toEqual({ minHz: 75, maxHz: 350, minDb: -100, maxDb: 0 })
    expect(live.measurementType).toBe('classical')
    expect(live.settingsPatch.showUnknownModes).toBe(true)
    expect(live.settingsPatch.peakMinThreshold).toBe(-55)
    // Saved peaks are injected verbatim, ids included; selection, overrides and offsets restore
    // by those ids.
    expect(live.loadedPeaks.map((p) => [p.id, p.frequency])).toEqual([[AIR_ID, 100], [TOP_ID, 200]])
    expect([...live.selectedIds]).toEqual([TOP_ID])
    expect(live.overridesById.get(AIR_ID)).toBe('Custom')
    expect(live.annotationOffsetsById.get(TOP_ID)).toEqual([215.5, -32.0])
    expect(live.annotationOffsetsById.has(AIR_ID)).toBe(false)
  })
})