// @parity test/peaks
//
// Full-set save (Option 4 — Development/PEAK-MIN-SEMANTICS.md). A freshly captured guitar
// measurement persists every peak down to the −100 dB floor, not just those above the current Peak
// Min, so a reloaded measurement can reveal peaks below the capture-time Peak Min exactly as the
// live one can. Mirrors Swift GuitarFullSavePeaksTests / Python TestGuitarFullSavePeaks.
//
// Uses the real swift-mac capture: its Air resonance sits at 97.26 Hz / −64.21 dB, so a Peak Min of
// −60 would exclude the Air winner from any Peak-Min-filtered set. The saved set must contain it.
//
// The `peaks` passed in here is the analyzer's DURABLE set, found at the −100 dB floor — what
// App.tsx passes from `snapshot.peaks`. It used to pass a set filtered at Peak Min −60, the
// pre-Phase-1 contract, and that mismatch hid a real defect: `buildGuitarMeasurement` re-detected
// and appended every sub-Peak-Min peak on the assumption they were missing, so a real capture saved
// 111 peaks as 217 with 106 duplicated. Pass what the app passes.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildGuitarMeasurement } from '../src/measurement/fromLive'
import { findPeaks, PEAK_DETECTION_FLOOR, type Peak } from '../src/dsp/peaks'
import { classifyAll } from '../src/dsp/classify'
import { base64ToFloats } from '../src/measurement/base64'
import { DEFAULT_SETTINGS } from '../src/settings'

const raw = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'dws-2024-umik-1-swift-mac-1784225155.guitartap'), 'utf8'),
)[0]
const spectrum = {
  frequencies: base64ToFloats(raw.spectrumSnapshot.frequenciesData),
  magnitudesDb: base64ToFloats(raw.spectrumSnapshot.magnitudesData),
}
const isAir = (p: { frequency: number }) => Math.abs(p.frequency - 97.26) < 1

describe('buildGuitarMeasurement — full-set save (Option 4, real capture)', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    measurementType: 'generic' as const,
    peakMinThreshold: -60, // above the real Air peak (−64.21 dB) — reproduces the original defect
  }
  // The Peak-Min display projection — what the user sees at −60, and what must NOT be saved.
  const displayed: Peak[] = findPeaks(spectrum.magnitudesDb, spectrum.frequencies, {
    guitarType: 'generic',
    peakMinThreshold: -60,
    minHz: 30,
    maxHz: 2000,
  })
  // The analyzer's durable set — what App.tsx actually hands the save path.
  const durable: Peak[] = findPeaks(spectrum.magnitudesDb, spectrum.frequencies, {
    guitarType: 'generic',
    peakMinOverride: PEAK_DETECTION_FLOOR,
    minHz: 30,
    maxHz: 2000,
  })
  const args = {
    name: 'FullSet',
    notes: '',
    spectrum,
    peaks: durable,
    modeByPeak: classifyAll(durable, 'generic'),
    selectedIds: new Set<number>(),
    overridesById: new Map<number, string>(),
    view: { minHz: 75, maxHz: 350, minDb: -100, maxDb: 0 },
    settings,
    numberOfTaps: 1,
    sampleRate: 48000,
    deviceLabel: 'Test',
  }

  it('the displayed set at Peak Min −60 excludes the real Air peak', () => {
    expect(displayed.some(isAir)).toBe(false)
  })

  it('a capture saves the full set, including the sub-Peak-Min Air peak', () => {
    const m = buildGuitarMeasurement(args)
    expect(m.peaks.some(isAir)).toBe(true)
    expect(m.peaks.length).toBeGreaterThan(displayed.length)
    // Every displayed peak is still present verbatim.
    for (const d of displayed) expect(m.peaks.some((p) => Math.abs(p.frequency - d.frequency) < 0.01)).toBe(true)
  })

  it('saves the durable set EXACTLY — one row per peak, no re-detected duplicates', () => {
    const m = buildGuitarMeasurement(args)
    expect(m.peaks.length).toBe(durable.length)
    const counts = new Map<string, number>()
    for (const p of m.peaks) {
      const k = p.frequency.toFixed(4)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const duplicated = [...counts.values()].filter((n) => n > 1)
    expect(duplicated).toEqual([])
  })

  it('every saved peak carries a distinct UUID', () => {
    const m = buildGuitarMeasurement(args)
    expect(new Set(m.peaks.map((p) => p.id)).size).toBe(m.peaks.length)
  })
})