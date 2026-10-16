// @parity test/frozen-peak-recalc
//
// Frozen peaks: Re-analyze's re-detection, Peak Min's projection, and what a load, a live frame, a capture,
// Save and Redo do to a measurement's peaks and their per-peak state — each through the app's own path. A
// measurement is put in place by writing a .guitartap document and loading it as the app loads a file. The
// shared cases in frozen-peak-recalc.json, the same as Swift and Python.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import { parseGuitarTapFile } from '../src/measurement'
import { guitarTypeNameFromRaw, TapEntry, type ResonantPeak } from '../src/measurement/types'
import { listMeasurements, clearMeasurements } from '../src/measurement/store'
import { MODE_DISPLAY_NAME } from '../src/presentation/modeColors'
import type { ResolvedMode } from '../src/dsp/classify'
import { makeStepsAnalyzer, runAnalyzerStep, PHASE_RAW, type AnalyzerStep } from './analyzerSteps'
import { spectrum } from './spectrumSpec'

type Row = Record<string, unknown>
type Load = {
  type: string; spectrum?: Row; peaks: [number, number][]; selected?: number[]; userModified?: boolean
  overrides?: Record<string, string>; offsets?: Record<string, [number, number]>
  tapEntries?: { peaks: [number, number][]; selected: number[] }[]
}
type FrozenStep = AnalyzerStep & {
  load?: Load; loadFixture?: string; reanalyze?: boolean; toggleSelection?: number; nameMode?: { at: number; label: string }
  dragLabel?: { at: number; to: [number, number] }; liveFrame?: Row; save?: boolean; loadSaved?: boolean
  mark?: boolean; check?: Row
}
type FrozenCase = { id: string; note: string; steps: FrozenStep[]; expect: Row }
type ModesCase = { id: string; guitarType: string; peaks: [number, number][]; selected: number[]; expect: Record<string, number> }
const DATA = JSON.parse(readFileSync('test/fixtures/frozen-peak-recalc.json', 'utf8')) as {
  cases: FrozenCase[]
  tapEntryModes: ModesCase[]
}

// ── The document a load step describes ──────────────────────────────────────────────────────────

/** What a case's run keeps between steps: the ids a load wrote and the state a mark recorded. */
class Run {
  nextId = 1
  loadedIds: string[] = []
  markedIds: string[] = []
  markedSelection = new Set<string>()
  markedTapEntries: string[][] = []
  markedTapSelections: string[][] = []
  engineAttached = false
  newId(): string {
    return `00000000-0000-0000-0000-${String(this.nextId++).padStart(12, '0')}`
  }
}

function snapshot(spec: Row | undefined, type: string): Row {
  const { mags, freqs } = spec ? spectrum(spec) : { mags: [-100, -100, -100, -100], freqs: [0, 100, 200, 300] }
  return {
    frequencies: freqs, magnitudes: mags, minFreq: 0, maxFreq: 600, minDB: -100, maxDB: 0, isLogarithmic: false,
    measurementType: type, guitarType: type.split(' ')[0],
  }
}

/** The peaks of a load step, written as the file writes them, with each one's id by frequency. */
function peaksOf(rows: [number, number][], run: Run): { json: Row[]; ids: [number, string][] } {
  const json: Row[] = []
  const ids: [number, string][] = []
  for (const [hz, db] of rows) {
    const id = run.newId()
    json.push({ id, frequency: hz, magnitude: db, quality: 10, bandwidth: hz / 10, timestamp: '2026-01-01T00:00:00Z' })
    ids.push([hz, id])
  }
  return { json, ids }
}

const idAt = (hz: number | string, ids: [number, string][]) => ids.find(([f]) => Math.abs(f - Number(hz)) <= 1)![1]

function document(load: Load, run: Run): Row {
  const snap = snapshot(load.spectrum, load.type)
  const { json, ids } = peaksOf(load.peaks, run)
  const doc: Row = { id: run.newId(), timestamp: '2026-01-01T00:00:00Z', peaks: json }
  if (load.spectrum) doc.spectrumSnapshot = snap
  if (load.selected) doc.selectedPeakIDs = load.selected.map((hz) => idAt(hz, ids))
  if (load.userModified !== undefined) doc.userModifiedSelection = load.userModified
  if (load.overrides) {
    doc.peakModeOverrides = Object.entries(load.overrides).flatMap(([hz, label]) => [idAt(hz, ids), { label, type: 'assigned' }])
  }
  if (load.offsets) {
    doc.peakAnnotationOffsets = Object.entries(load.offsets).flatMap(([hz, [x, y]]) => [idAt(hz, ids), { absFreqHz: x, absDB: y }])
  }
  if (load.tapEntries) {
    doc.tapEntries = load.tapEntries.map((e, i) => {
      const entry = peaksOf(e.peaks, run)
      return { id: run.newId(), tapIndex: i + 1, snapshot: snap, peaks: entry.json, selectedPeakIDs: e.selected.map((hz) => idAt(hz, entry.ids)) }
    })
  }
  run.loadedIds = ids.map(([, id]) => id)
  return doc
}

// ── Peaks named by frequency ────────────────────────────────────────────────────────────────────

/** Every peak the state can name: the measurement's peaks and a material measurement's identified ones. */
const known = (a: TapToneAnalyzer): ResonantPeak[] => [...a.peaks, ...a.materialIdentifiedPeaks]
const peakAt = (hz: number, a: TapToneAnalyzer) => known(a).find((p) => Math.abs(p.frequency - hz) <= 1)!

function sameFreqs(got: number[], want: unknown): boolean {
  const g = [...got].sort((x, y) => x - y)
  const w = (want as number[]).map(Number).sort((x, y) => x - y)
  return g.length === w.length && g.every((x, i) => Math.abs(x - w[i]!) <= 1)
}

/** An id-keyed map, by its peaks' frequencies, against the case's frequency-keyed one. */
function sameMap<V>(got: Map<string, V>, want: Row, a: TapToneAnalyzer, equal: (v: V, w: unknown) => boolean): boolean {
  if (got.size !== Object.keys(want).length) return false
  for (const [id, value] of got) {
    const p = known(a).find((q) => q.id === id)
    const key = p && Object.keys(want).find((k) => Math.abs(Number(k) - p.frequency) <= 1)
    if (key === undefined || !equal(value, want[key])) return false
  }
  return true
}

// ── Steps and checks ────────────────────────────────────────────────────────────────────────────

async function check(fields: Row, a: TapToneAnalyzer, run: Run): Promise<void> {
  for (const [field, want] of Object.entries(fields)) {
    switch (field) {
      case 'peaks': expect(sameFreqs(a.peaks.map((p) => p.frequency), want), `${field}: ${a.peaks.map((p) => p.frequency)}`).toBe(true); break
      case 'shown':
        expect(sameFreqs(a.peaksAbovePeakMin.map((p) => p.frequency), want), `${field}: ${a.peaksAbovePeakMin.map((p) => p.frequency)}`).toBe(true)
        break
      case 'selected':
        expect(sameFreqs(a.selectedPeaks.map((p) => p.frequency), want), `${field}: ${a.selectedPeaks.map((p) => p.frequency)}`).toBe(true)
        break
      case 'overrides': expect(sameMap(a.overrides, want as Row, a, (v, w) => v === w), `${field}: ${[...a.overrides]}`).toBe(true); break
      case 'offsets': {
        const same = sameMap(a.annotationOffsets, want as Row, a, (v, w) => v[0] === (w as number[])[0] && v[1] === (w as number[])[1])
        expect(same, `${field}: ${JSON.stringify([...a.annotationOffsets])}`).toBe(true)
        break
      }
      case 'labels':
        for (const [hz, label] of Object.entries(want as Record<string, string>)) {
          const p = known(a).find((q) => Math.abs(q.frequency - Number(hz)) <= 1)
          const got = p ? a.effectiveModeLabel(p.id) : null
          expect(got, `${field} ${hz}: ${got}`).toBe(label)
        }
        break
      case 'modes': {
        const modes = new Map([...a.modeByPeak].map(([id, m]) => [id, MODE_DISPLAY_NAME[m as ResolvedMode]]))
        expect(sameMap(modes, want as Row, a, (v, w) => v === w), `${field}: ${JSON.stringify([...modes])}`).toBe(true)
        break
      }
      case 'tapEntries': {
        const wanted = want as { peaks: number[]; selected: number[] }[]
        expect(a.tapEntries.length, `${field}: count`).toBe(wanted.length)
        a.tapEntries.forEach((e, i) => {
          expect(sameFreqs(e.peaks.map((p) => p.frequency), wanted[i]!.peaks), `${field} peaks`).toBe(true)
          const selected = e.peaks.filter((p) => e.selectedPeakIDs.includes(p.id)).map((p) => p.frequency)
          expect(sameFreqs(selected, wanted[i]!.selected), `${field} selected`).toBe(true)
        })
        break
      }
      case 'idsAsMarked':
        expect(JSON.stringify(a.peaks.map((p) => p.id)) === JSON.stringify(run.markedIds), field).toBe(want)
        break
      case 'selectedIdsAsMarked': {
        const same = a.selectedPeakIds.size === run.markedSelection.size && [...a.selectedPeakIds].every((id) => run.markedSelection.has(id))
        expect(same, field).toBe(want)
        break
      }
      case 'tapEntriesAsMarked': {
        const same = JSON.stringify(a.tapEntries.map((e) => e.peaks.map((p) => p.id))) === JSON.stringify(run.markedTapEntries)
          && JSON.stringify(a.tapEntries.map((e) => e.selectedPeakIDs)) === JSON.stringify(run.markedTapSelections)
        expect(same, field).toBe(want)
        break
      }
      case 'idsAsLoaded': {
        const ids = new Set(a.peaks.map((p) => p.id))
        expect(ids.size === run.loadedIds.length && run.loadedIds.every((id) => ids.has(id)), field).toBe(want)
        break
      }
      case 'canReanalyze': expect(a.canReanalyze, field).toBe(want); break
      case 'complete': expect(a.isMeasurementComplete, field).toBe(want); break
      case 'phase': expect(PHASE_RAW[a.materialTapPhase], field).toBe(want); break
      case 'fL':
      case 'fC': {
        const p = field === 'fL' ? a.selectedLongitudinalPeak : a.selectedCrossPeak
        if (want === null) expect(p, field).toBeNull()
        else expect(p !== null && Math.abs(p.frequency - (want as number)) <= 1, `${field}: ${p?.frequency}`).toBe(true)
        break
      }
      case 'materialPeaks': expect(sameFreqs(a.materialIdentifiedPeaks.map((p) => p.frequency), want), field).toBe(true); break
      case 'saved': {
        const w = want as { peaks?: number[]; selectedAll?: boolean }
        const saved = (await listMeasurements()).at(-1)!
        if (w.peaks) expect(sameFreqs(saved.peaks.map((p) => p.frequency), w.peaks), 'saved peaks').toBe(true)
        if (w.selectedAll !== undefined) {
          const sel = new Set(saved.selectedPeakIDs ?? [])
          expect(sel.size === saved.peaks.length && saved.peaks.every((p) => sel.has(p.id)), 'saved selectedAll').toBe(w.selectedAll)
        }
        break
      }
      default: throw new Error(`unknown field ${field}`)
    }
  }
}

async function step(s: FrozenStep, a: TapToneAnalyzer, run: Run, store: Parameters<typeof runAnalyzerStep>[2]): Promise<void> {
  if (s.load) a.loadMeasurement(parseGuitarTapFile(JSON.stringify([document(s.load, run)]))[0]!)
  else if (s.loadFixture) a.loadMeasurement(parseGuitarTapFile(readFileSync(`test/fixtures/${s.loadFixture}`, 'utf8'))[0]!)
  else if (s.reanalyze) a.reanalyzePeaks()
  else if (s.toggleSelection !== undefined) a.togglePeakSelection(peakAt(s.toggleSelection, a).id)
  else if (s.nameMode) a.setModeOverride(peakAt(s.nameMode.at, a).id, s.nameMode.label)
  else if (s.dragLabel) a.updateAnnotationOffset(peakAt(s.dragLabel.at, a).id, s.dragLabel.to)
  else if (s.liveFrame) {
    const { mags, freqs } = spectrum(s.liveFrame)
    if (!run.engineAttached) {
      // A frame comes only from the running engine.
      const engine = new RealtimeFFTAnalyzer()
      engine.initForTesting()
      a.setDevice(engine)
      run.engineAttached = true
    }
    a.onFftFrame(mags, freqs)
  } else if (s.save) await a.saveMeasurement('', '', { minHz: 0, maxHz: 600, minDb: -100, maxDb: 0 })
  else if (s.loadSaved) a.loadMeasurement((await listMeasurements()).at(-1)!)
  else if (s.mark) {
    run.markedIds = a.peaks.map((p) => p.id)
    run.markedSelection = new Set(a.selectedPeakIds)
    run.markedTapEntries = a.tapEntries.map((e) => e.peaks.map((p) => p.id))
    run.markedTapSelections = a.tapEntries.map((e) => [...e.selectedPeakIDs])
  } else expect(runAnalyzerStep(s, a, store), `unknown step ${JSON.stringify(s)}`).toBe(true)
}

beforeEach(async () => {
  await clearMeasurements()
})

describe('frozen-peak-recalc — the shared cases (frozen-peak-recalc.json)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const { a, store } = makeStepsAnalyzer()
    const run = new Run()
    for (const s of c.steps) {
      if (s.check) await check(s.check, a, run)
      else await step(s, a, run, store)
    }
    await check(c.expect, a, run)
  })
})

describe('frozen-peak-recalc — a tap entry’s modes (frozen-peak-recalc.json)', () => {
  it.each(DATA.tapEntryModes.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const run = new Run()
    const { json, ids } = peaksOf(c.peaks, run)
    const m = parseGuitarTapFile(JSON.stringify([{
      id: run.newId(), timestamp: '2026-01-01T00:00:00Z', peaks: [],
      tapEntries: [{ id: run.newId(), tapIndex: 1, snapshot: snapshot(undefined, 'Generic Guitar'), peaks: json,
        selectedPeakIDs: c.selected.map((hz) => idAt(hz, ids)) }],
    }]))[0]!
    const e = m.tapEntries![0]!
    const entry = new TapEntry(e.id, e.tapIndex, e.snapshot, e.peaks, e.selectedPeakIDs)
    const modes = entry.resolvedModePeaks(guitarTypeNameFromRaw(c.guitarType))
    const got = Object.fromEntries([...modes].map(([mode, p]) => [MODE_DISPLAY_NAME[mode as ResolvedMode], p.frequency]))
    expect(got).toEqual(c.expect)
  })
})
