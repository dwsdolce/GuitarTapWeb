// @parity test/peaks
//
// Full-set save (Option 4 — Development/PEAK-MIN-SEMANTICS.md). A freshly captured guitar
// measurement persists every peak down to the −100 dB floor, not just those above the current Peak
// Min, so a reloaded measurement can reveal peaks below the capture-time Peak Min exactly as the
// live one can. Mirrors Swift GuitarFullSavePeaksTests / Python TestGuitarFullSavePeaks.
//
// Uses the real swift-mac capture: its Air resonance sits at 97.26 Hz / −64.21 dB, so a Peak Min of
// −60 reproduces the exact original defect (the Air winner excluded from what was saved). The full
// set must recover it.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildGuitarMeasurement } from '../src/measurement/fromLive'
import { findPeaks, type Peak } from '../src/dsp/peaks'
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
    analysisMinHz: 30,
    analysisMaxHz: 2000,
  }
  const displayed: Peak[] = findPeaks(spectrum.magnitudesDb, spectrum.frequencies, {
    guitarType: 'generic',
    peakMinThreshold: -60,
    minHz: 30,
    maxHz: 2000,
  })
  const args = {
    name: 'FullSet',
    notes: '',
    spectrum,
    peaks: displayed,
    modeByPeak: classifyAll(displayed, 'generic'),
    selectedIds: new Set<number>(),
    overridesByFreq: new Map<string, string>(),
    view: { minHz: 75, maxHz: 350, minDb: -100, maxDb: 0 },
    settings,
    numberOfTaps: 1,
    sampleRate: 48000,
    deviceLabel: 'Test',
  }

  it('the displayed set at Peak Min −60 excludes the real Air peak', () => {
    expect(displayed.some(isAir)).toBe(false)
  })

  it('a fresh capture saves the full set, recovering the sub-Peak-Min Air peak', () => {
    const m = buildGuitarMeasurement(args)
    expect(m.peaks.some(isAir)).toBe(true)
    expect(m.peaks.length).toBeGreaterThan(displayed.length)
    // Every displayed peak is still present verbatim.
    for (const d of displayed) expect(m.peaks.some((p) => Math.abs(p.frequency - d.frequency) < 0.01)).toBe(true)
  })

  it('a still-loaded measurement is saved as-is (no full-set upgrade)', () => {
    const m = buildGuitarMeasurement({ ...args, isLoadedMeasurement: true })
    expect(m.peaks.length).toBe(displayed.length)
    expect(m.peaks.some(isAir)).toBe(false)
  })
})