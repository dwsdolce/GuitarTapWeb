// @parity test/peaks
//
// Peak finding, near-duplicate removal, spectrum averaging, guitar auto-selection and the full-set save,
// against the shared case file, `peaks.json` — the same cases the Swift and Python suites run.
//
// findPeaks must return one peak per spectral feature: the Top/Back overlap case (32768 bins, so peaks 7 Hz
// apart can both be detected) pins three peaks for three features. A saved guitar measurement holds the full
// set found down to the -100 dB floor, not just what Peak Min shows, so a reloaded measurement can reveal
// peaks below its capture-time Peak Min; a loaded measurement is saved as it is.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { classifyAll, type ResolvedMode } from '../src/dsp/classify'
import { base64ToFloats } from '../src/measurement/base64'
import { DEFAULT_SETTINGS } from '../src/settings'
import { makeResonantPeak, type ResonantPeak } from '../src/measurement/types'

type Row = Record<string, unknown>
const DATA = JSON.parse(readFileSync('test/fixtures/peaks.json', 'utf8')) as Row
const rows = (key: string) => DATA[key] as Row[]
const row = (key: string, id: string) => rows(key).find((r) => r.id === id)!

/** The web's mode name → Swift's, as the file spells it. */
const MODE_NAME: Record<ResolvedMode, string> = {
  air: 'air',
  top: 'top',
  back: 'back',
  dipole: 'dipole',
  ring: 'ringMode',
  upper: 'upperModes',
  unknown: 'unknown',
}

/** `|actual − expected| ≤ relative·|expected| + absolute`. */
function close(actual: number | undefined | null, expected: unknown): boolean {
  const tol = DATA.tolerance as { relative: number; absolute: number }
  const e = expected as number
  return actual != null && Math.abs(actual - e) <= tol.relative * Math.abs(e) + tol.absolute
}

/** A case's spectrum, built as the file describes it. */
function spectrum(s: Row): { mags: number[]; freqs: number[] } {
  const bins = s.binCount as number
  const spacing = (s.binSpacingHz as number | undefined) ?? (s.sampleRate as number) / 2 / (bins - 1)
  const freqs = Array.from({ length: bins }, (_, i) => i * spacing)
  if (s.kind === 'flat') return { mags: new Array<number>(bins).fill(s.value as number), freqs }
  if (s.kind === 'triangle') {
    const peakBin = s.peakBin as number
    return { mags: freqs.map((_, i) => (s.peakDB as number) - (s.slopeDBPerBin as number) * Math.abs(i - peakBin)), freqs }
  }
  const floor = s.noiseFloor as number
  const mags = new Array<number>(bins).fill(floor)
  for (const p of s.peaks as Row[]) {
    const sigma = (p.halfWidthHz as number) / 2.355
    for (let i = 0; i < bins; i++) {
      const d = freqs[i]! - (p.peakHz as number)
      mags[i] = Math.max(mags[i]!, Math.max(floor, (p.peakDB as number) + -(d * d) / (2 * sigma * sigma)))
    }
  }
  return { mags, freqs }
}

function genericAnalyzer(): TapToneAnalyzer {
  const a = new TapToneAnalyzer()
  a.measurementType = 'generic'
  a.settings = { ...DEFAULT_SETTINGS, measurementType: 'generic' }
  return a
}

function findPeaks(r: Row): ResonantPeak[] {
  const a = genericAnalyzer()
  a.peakMinThreshold = r.peakMinThreshold as number
  a.minFrequency = r.minFrequency as number
  a.maxFrequency = r.maxFrequency as number
  const { mags, freqs } = spectrum(r.spectrum as Row)
  return a.findPeaks(mags, freqs, { peakMinOverride: r.peakMinOverride as number | undefined })
}

describe('peaks — shared cases', () => {
  for (const r of rows('findPeaks')) {
    it(`findPeaks: ${r.id as string}`, () => {
      const peaks = findPeaks(r)
      const expected = r.expect as Row[]
      expect(peaks.length, `peaks ${peaks.map((p) => p.frequency)}`).toBe(expected.length)
      peaks.forEach((p, i) => {
        const e = expected[i]!
        expect(close(p.frequency, e.frequency), `frequency ${p.frequency}`).toBe(true)
        expect(close(p.magnitude, e.magnitude), `magnitude ${p.magnitude}`).toBe(true)
        expect(close(p.quality, e.quality), `quality ${p.quality}`).toBe(true)
        expect(close(p.bandwidth, e.bandwidth), `bandwidth ${p.bandwidth}`).toBe(true)
        expect(p.pitchNote, 'pitchNote').toBe(e.pitchNote)
        expect(close(p.pitchCents, e.pitchCents), `pitchCents ${p.pitchCents}`).toBe(true)
        expect(close(p.pitchFrequency, e.pitchFrequency), `pitchFrequency ${p.pitchFrequency}`).toBe(true)
      })
    })
  }

  for (const r of rows('removeDuplicatePeaks')) {
    it(`removeDuplicatePeaks: ${r.id as string}`, () => {
      const peaks = (r.peaks as Row[]).map((p) =>
        makeResonantPeak({ frequency: p.frequency as number, magnitude: p.magnitude as number, quality: 0, bandwidth: 0 }),
      )
      const kept = new TapToneAnalyzer().removeDuplicatePeaks(peaks)
      expect(kept.map((k) => peaks.findIndex((p) => p.id === k.id))).toEqual(r.expect)
    })
  }

  for (const r of rows('averageSpectra')) {
    it(`averageSpectra: ${r.id as string}`, () => {
      const taps = (r.taps as Row[]).map((t) => ({
        magnitudesDb: t.magnitudes as number[],
        frequencies: t.frequencies as number[],
      }))
      const avg = new TapToneAnalyzer().averageSpectra(taps)
      const e = r.expect as { magnitudes: number[]; frequencies: number[] }
      expect(avg.magnitudesDb.length).toBe(e.magnitudes.length)
      expect(avg.frequencies.length).toBe(e.frequencies.length)
      avg.magnitudesDb.forEach((m, i) => expect(close(m, e.magnitudes[i]), `magnitude ${m}`).toBe(true))
      avg.frequencies.forEach((f, i) => expect(close(f, e.frequencies[i]), `frequency ${f}`).toBe(true))
    })
  }

  for (const r of rows('autoSelection')) {
    it(`autoSelection: ${r.id as string}`, () => {
      const peaks = findPeaks(row('findPeaks', r.findPeaks as string))
      const modes = classifyAll(peaks, 'generic')
      const selected = genericAnalyzer().guitarModeSelectedPeakIds(peaks)
      const e = r.expect as { modes: string[]; selected: number[] }
      expect(peaks.map((p) => MODE_NAME[modes.get(p.id)!])).toEqual(e.modes)
      expect(peaks.flatMap((p, i) => (selected.has(p.id) ? [i] : []))).toEqual(e.selected)
    })
  }

  for (const r of rows('fullSetSave')) {
    it(`fullSetSave: ${r.id as string}`, () => {
      const raw = JSON.parse(readFileSync(`test/fixtures/${r.fixture as string}`, 'utf8'))[0]
      const mags = base64ToFloats(raw.spectrumSnapshot.magnitudesData)
      const freqs = base64ToFloats(raw.spectrumSnapshot.frequenciesData)

      const a = genericAnalyzer()
      a.frozenMagnitudes = mags
      a.frozenFrequencies = freqs
      a.isMeasurementComplete = true
      a.minFrequency = r.minFrequency as number
      a.maxFrequency = r.maxFrequency as number
      a.peaks = a.findPeaks(mags, freqs, { peakMinOverride: TapToneAnalyzer.peakDetectionFloor })
      a.peakMinThreshold = r.peakMinThreshold as number
      const isAir = (p: ResonantPeak) => Math.abs(p.frequency - (r.airHz as number)) < 1

      const displayed = a.peaksAbovePeakMin
      a.loadedPeaks = null
      const saved = a.guitarFullSavePeaks()
      const e = r.expect as Row
      expect(displayed.length, 'displayed').toBe(e.displayedCount)
      expect(saved.length, 'saved').toBe(e.savedCount)
      expect(displayed.some(isAir), 'Air displayed').toBe(e.airDisplayed)
      expect(saved.some(isAir), 'Air saved').toBe(e.airSaved)
      expect(displayed.every((d) => saved.some((s) => s.id === d.id)), 'displayed among saved').toBe(e.displayedAmongSaved)
      expect(new Set(saved.map((p) => p.id)).size === saved.length, 'each saved peak its own id').toBe(e.savedDistinctIds)

      const loaded = a.peaks.slice(0, r.loadedFirst as number)
      a.peaks = loaded
      a.loadedPeaks = loaded
      const savedLoaded = a.guitarFullSavePeaks()
      expect(savedLoaded.length, 'loaded saved').toBe(e.loadedSavedCount)
      expect(savedLoaded.map((p) => p.id).join() === loaded.map((p) => p.id).join(), 'loaded saved as it is').toBe(
        e.loadedSavedSame,
      )
    })
  }
})
