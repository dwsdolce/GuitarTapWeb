// @parity test/comparison
import { describe, it, expect } from 'vitest'
import {
  buildGuitarMeasurement,
  buildComparisonEntries,
  buildComparisonMeasurement,
  comparisonEntryModeFreqs,
} from '../src/measurement/fromLive'
import { serializeGuitarTapFile, parseGuitarTapFile, isComparison, type ComparisonEntryModel } from '../src/measurement'
import { DEFAULT_SETTINGS } from '../src/settings'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import type { Peak } from '../src/dsp/peaks'
import type { ResolvedMode } from '../src/dsp/classify'

// Phase 4d: a comparison measurement overlays several measurements. Building it from a
// selection assigns palette colors + disambiguated labels and keeps each source's selected
// peaks; it round-trips through the .guitartap format as a `comparisonEntries` record.

const spectrum = { frequencies: [100, 200, 300], magnitudesDb: [-50, -40, -60] }
const peaks: Peak[] = [
  { id: 1, frequency: 100, magnitude: -50, quality: 10, bandwidth: 10 },
  { id: 2, frequency: 200, magnitude: -40, quality: 20, bandwidth: 10 },
]
const modeByPeak = new Map<number, ResolvedMode>([
  [1, 'air'],
  [2, 'top'],
])

const src = (name: string) =>
  buildGuitarMeasurement({
    name,
    notes: '',
    spectrum,
    peaks,
    modeByPeak,
    selectedIds: new Set<number>([1, 2]),
    overridesById: new Map<number, string>(),
    view: { minHz: 75, maxHz: 350, minDb: -100, maxDb: 0 },
    settings: { ...DEFAULT_SETTINGS, measurementType: 'classical' as const },
    numberOfTaps: 1,
    sampleRate: 48000,
    deviceLabel: 'Mic',
  })

describe('buildComparisonEntries — from a selection', () => {
  const entries = buildComparisonEntries([src('Top'), src('Top')])

  it('makes one entry per source with disambiguated labels and palette colors', () => {
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.label)).toEqual(['Top (1)', 'Top (2)'])
    // Distinct palette colors (blue, orange) as [r,g,b,a] 0–1.
    expect(entries[0]!.colorComponents).not.toEqual(entries[1]!.colorComponents)
    expect(entries[0]!.colorComponents).toHaveLength(4)
    expect(entries[0]!.snapshot.frequencies).toEqual([100, 200, 300])
  })

  it('resolves Air/Top/Back frequencies for the results table', () => {
    const f = comparisonEntryModeFreqs(entries[0]!)
    expect(f.air).toBe(100)
    expect(f.top).toBe(200)
    expect(f.back).toBeNull()
  })
})

describe('comparison measurement round-trip', () => {
  it('saves as a comparison record and survives the .guitartap round-trip', () => {
    const entries = buildComparisonEntries([src('A'), src('B')])
    const m = buildComparisonMeasurement({ name: 'A vs B', notes: 'test', entries })
    expect(isComparison(m)).toBe(true)
    expect(m.peaks).toEqual([])

    const back = parseGuitarTapFile(serializeGuitarTapFile([m]))[0]!
    expect(isComparison(back)).toBe(true)
    expect(back.measurementName).toBe('A vs B')
    expect(back.comparisonEntries).toHaveLength(2)
    expect(back.comparisonEntries!.map((e) => e.label)).toEqual(['A', 'B'])
    expect(back.comparisonEntries![0]!.colorComponents).toEqual(entries[0]!.colorComponents)
    expect(back.comparisonEntries![0]!.snapshot.frequencies).toEqual([100, 200, 300])
  })
})

// ---------------------------------------------------------------------------
// modePeakIDs (Phase 6b) — a comparison stores each entry's DEFINITIVE Air/Top/Back as {mode name → peak
// id}, resolved OVERRIDE-AWARE from the source, so the file is self-describing: the reader reproduces the
// table by id lookup, never re-classifying. Legacy comparisons (no map) heal positionally on decode.
// ---------------------------------------------------------------------------
describe('comparison modePeakIDs — self-describing definitive modes', () => {
  // A source whose Top is a manual override of an out-of-band (Dipole) peak.
  const srcOverride = buildGuitarMeasurement({
    name: 'Ov', notes: '',
    spectrum: { frequencies: [90, 380], magnitudesDb: [-20, -20] },
    peaks: [
      { id: 1, frequency: 90, magnitude: -20, quality: 10, bandwidth: 5 },
      { id: 2, frequency: 380, magnitude: -20, quality: 10, bandwidth: 5 },
    ],
    modeByPeak: new Map<number, ResolvedMode>([[1, 'air'], [2, 'dipole']]),
    selectedIds: new Set<number>([1, 2]),
    overridesById: new Map<number, string>([[2, 'Top']]), // assign the Dipole peak to Top
    view: { minHz: 75, maxHz: 350, minDb: -100, maxDb: 0 },
    settings: { ...DEFAULT_SETTINGS, measurementType: 'classical' as const },
    numberOfTaps: 1, sampleRate: 48000, deviceLabel: 'Mic',
  })

  it("uses the source's OVERRIDDEN Top, not the auto classification", () => {
    const [entry] = buildComparisonEntries([srcOverride])
    const f = comparisonEntryModeFreqs(entry!)
    expect(f.top).toBe(380) // the overridden Dipole-band peak — positional would find no Top at all
    expect(f.air).toBe(90)
  })

  it('trusts the stored map even when it DISAGREES with classifyAll (reader must not re-classify)', () => {
    // 380 Hz classifies to Dipole, never Top — but the stored map pins it as Top.
    const entry: ComparisonEntryModel = {
      id: 'e', label: 'x', colorComponents: [0, 0, 1, 1],
      snapshot: { frequencies: [], magnitudes: [], minFreq: 0, maxFreq: 500, minDB: -100, maxDB: 0, isLogarithmic: false, guitarType: 'Classical' },
      peaks: [{ id: 'p', frequency: 380, magnitude: -20, quality: 10, bandwidth: 5, timestamp: 't' }],
      guitarType: 'Classical',
      modePeakIDs: { Top: 'p' },
    }
    expect(comparisonEntryModeFreqs(entry).top).toBe(380)
  })

  it('modePeakIDs round-trips through the .guitartap format', () => {
    const entries = buildComparisonEntries([srcOverride])
    const topId = entries[0]!.modePeakIDs!.Top
    expect(topId).toBeDefined()
    const m = buildComparisonMeasurement({ name: 'C', notes: '', entries })
    const back = parseGuitarTapFile(serializeGuitarTapFile([m]))[0]!
    expect(back.comparisonEntries![0]!.modePeakIDs!.Top).toBe(topId)
    expect(comparisonEntryModeFreqs(back.comparisonEntries![0]!).top).toBe(380)
  })

  it('a legacy comparison (no modePeakIDs) heals positionally on decode + flags re-save', () => {
    const m = buildComparisonMeasurement({ name: 'Legacy', notes: '', entries: buildComparisonEntries([src('A')]) })
    const json = JSON.parse(serializeGuitarTapFile([m]))
    for (const e of json[0].comparisonEntries) delete e.modePeakIDs // simulate a pre-6b file
    const back = parseGuitarTapFile(JSON.stringify(json))[0]!
    expect(back.comparisonEntries![0]!.modePeakIDs).toBeDefined() // filled positionally
    expect((back as { wasHealed?: boolean }).wasHealed).toBe(true)
  })
})
// ── Display-mode transitions ──────────────────────────────────────────────────────────────────
//
// These are the cases this edition COULD NOT WRITE until #17 F24. The display mode lived in
// App.tsx as `comparison != null`, so every Swift/Python transition test — ten of them — had no
// web counterpart, and the 20/32/7 count spread was the measurement of that rather than of
// anything being under-tested.
//
// Mirrors Swift ComparisonModeTests (initialDisplayMode_isLive, loadComparison_setsDisplayModeTo…,
// clearComparison_…, loadMeasurement_duringComparison_…) and the Python equivalents.
describe('display mode — transitions', () => {
  const entries = (n: number): ComparisonEntryModel[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `e${i}`,
      label: `M${i}`,
      colorComponents: [0, 0, 0, 1],
      snapshot: { frequencies: [100, 200], magnitudes: [-30, -20], minFreq: 80, maxFreq: 300, minDB: -90, maxDB: 0 },
      peaks: [],
    })) as unknown as ComparisonEntryModel[]

  const sut = () => new TapToneAnalyzer()

  it('starts live', () => {
    expect(sut().displayMode).toBe('live')
  })

  it('loadComparison enters comparison', () => {
    const a = sut()
    a.loadComparison(entries(2))
    expect(a.displayMode).toBe('comparison')
    expect(a.comparisonEntries).toHaveLength(2)
  })

  it('an EMPTY comparison stays live — the mode follows the data', () => {
    // Swift: displayMode = comparisonSpectra.isEmpty ? .live : .comparison
    const a = sut()
    a.loadComparison([])
    expect(a.displayMode).toBe('live')
  })

  // CP-U9: building a comparison from an ARMED sequence stands the detector down. An overlay is
  // frozen, like a loaded measurement; left armed, the live analysis keeps overwriting the
  // overlay's peaks and a tap completes a measurement the user never sees (#17 F31 — found by a
  // run-review of F30 in Swift, which had the defect; web already disarmed).
  it('loadComparison disarms an armed detector', () => {
    const a = sut()
    a.detectionState = 'listening'
    a.loadComparison(entries(2))
    expect(a.displayMode).toBe('comparison')
    expect(a.detectionState).toBe('idle')
  })

  // CP-U10: an empty comparison stays live, so there is nothing to freeze — the detector is left
  // exactly as it was. The mode follows the data, and so does the disarm.
  it('an EMPTY comparison leaves the detector alone', () => {
    const a = sut()
    a.detectionState = 'listening'
    a.loadComparison([])
    expect(a.displayMode).toBe('live')
    expect(a.detectionState).toBe('listening')
  })

  it('clearComparison returns to live and drops the entries', () => {
    const a = sut()
    a.loadComparison(entries(2))
    a.clearComparison()
    expect(a.displayMode).toBe('live')
    expect(a.comparisonEntries).toHaveLength(0)
  })

  it('loading a measurement DURING a comparison exits it and freezes', () => {
    // The transition the view maintained by hand at eight call sites, pinned by nothing.
    const a = sut()
    a.loadComparison(entries(2))
    a.loadMeasurement({ magnitudes: [-30, -20], frequencies: [100, 200] })
    expect(a.displayMode).toBe('live')
    expect(a.comparisonEntries).toHaveLength(0)
  })

  it('clearResult (New Tap) returns to live from a comparison', () => {
    const a = sut()
    a.loadComparison(entries(2))
    a.clearResult()
    expect(a.displayMode).toBe('live')
    expect(a.comparisonEntries).toHaveLength(0)
  })

  // The defect the owner's F26 run-review found: load a plate measurement, compare two guitar
  // measurements, press New Tap — the overlay stayed up with a fresh capture arming underneath it.
  // New Tap took the material path (`startMaterial`), which never returned to live; the transition
  // had been wired into `clearResult` only. Neither native can have this: both route every New Tap,
  // guitar and material alike, through one `startTapSequence`. Web now does too.
  it('New Tap returns to live from a comparison — MATERIAL type', () => {
    const a = sut()
    a.measurementType = 'plate'
    a.loadComparison(entries(2))
    expect(a.displayMode).toBe('comparison')
    a.startTapSequence({ arm: false })
    expect(a.displayMode).toBe('live')
    expect(a.comparisonEntries).toHaveLength(0)
    expect(a.materialTapPhase).toBe('capturingL') // and the phase machine did re-arm
  })

  it('New Tap returns to live from a comparison — GUITAR type', () => {
    const a = sut()
    a.measurementType = 'classical'
    a.loadComparison(entries(2))
    a.startTapSequence({ arm: false })
    expect(a.displayMode).toBe('live')
    expect(a.comparisonEntries).toHaveLength(0)
  })

  it('the multi-tap overlay enters comparison, and leaving it returns to frozen', () => {
    const a = sut()
    a.setMultiTapComparison(true)
    expect(a.displayMode).toBe('comparison')
    a.setMultiTapComparison(false)
    expect(a.displayMode).toBe('live')
  })

  it('isSavedMeasurementComparison separates the two kinds of comparison', () => {
    // Both set displayMode to 'comparison'; only the saved-measurement overlay is "the"
    // comparison for save/export/annotation routing. Swift isSavedMeasurementComparison.
    const a = sut()
    a.loadComparison(entries(2))
    expect(a.isSavedMeasurementComparison).toBe(true)
    a.setMultiTapComparison(true)
    expect(a.displayMode).toBe('comparison')
    expect(a.isSavedMeasurementComparison).toBe(false)
  })

  it('loading a saved comparison record drops the per-tap overlay first', () => {
    const a = sut()
    a.setMultiTapComparison(true)
    a.loadComparisonRecord(entries(3))
    expect(a.displayMode).toBe('comparison')
    expect(a.showingMultiTapComparison).toBe(false)
    expect(a.isSavedMeasurementComparison).toBe(true)
  })

  it('frozen and comparison are mutually exclusive — the state that used to be representable', () => {
    const a = sut()
    a.loadMeasurement({ magnitudes: [-30, -20], frequencies: [100, 200] })
    expect(a.displayMode).toBe('live')
    a.loadComparison(entries(2))
    expect(a.displayMode).toBe('comparison') // one value, so it cannot be both
  })
})
