// @parity test/peaks
//
// D3 + D5 + D6 of Development/PEAK-FINDING-DUPLICATE-PEAKS.md.
//
// Port of PeakFixtureRegressionTests.swift. Replays real captured spectra through
// findPeaks and pins the result against a golden baseline.
//
//   D3 — no fixture may yield duplicate peaks.
//   D5 — the peak set must equal the step-2 baseline with the spurious twin removed:
//        same count, frequencies, magnitudes, Q, bandwidth, mode labels and selection.
//        This is what proves the fix removed ONLY the duplicate and moved nothing else.
//   D6 — peak-baseline-expected.json is byte-identical in all three repos, so all three
//        platforms passing D5 is three-way parity. There is no separate test.
//
// Fixtures are one physical tap captured by all three apps (Swift, Python, web),
// chosen so one file per platform proves the shared algorithm's behaviour.
//
// Authored against the UNFIXED code: D3 fails on every fixture (one duplicate each)
// and D5 fails on peak count until detection stops being interleaved with
// classification.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findPeaks, type Peak } from '../src/dsp/peaks'
import { classifyAll, resolvedModePeaks } from '../src/dsp/classify'
import { base64ToFloats } from '../src/measurement/base64'
import type { GuitarTypeName } from '../src/dsp/guitarModes'

const FIXTURE_DIR = join(__dirname, 'fixtures')
const MIN_HZ = 30
const MAX_HZ = 2000
const PEAK_PROXIMITY_HZ = 2
const TOL = 1e-3

const FIXTURES = [
  'dws-2024-umik-1-swift-mac-1784225155.guitartap',
  'dws-2024-umik-1-python-mac-1784225140.guitartap',
  'dws-2024-umik-1-web-mac-1784225174.guitartap',
]

interface ExpectedPeak {
  frequency: number
  magnitude: number
  quality: number
  bandwidth: number
  mode: string
  selected: boolean
}

/** Canonical mode token, shared verbatim with the Swift and Python expectations. */
function modeToken(mode: string | undefined): string {
  switch (mode) {
    case 'air':
    case 'top':
    case 'back':
    case 'dipole':
      return mode
    case 'ring':
      return 'ring'
    case 'upper':
      return 'upper'
    default:
      return 'unknown'
  }
}

/** Replays a fixture's own saved spectrum through the current findPeaks. */
function replay(name: string) {
  const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'))
  const m = (Array.isArray(raw) ? raw : [raw])[0]
  const sn = m.spectrumSnapshot

  const freqs = base64ToFloats(sn.frequenciesData)
  const mags = base64ToFloats(sn.magnitudesData)
  const guitarType = String(m.guitarType ?? sn.guitarType ?? 'Generic').toLowerCase() as GuitarTypeName

  const peaks = findPeaks(mags, freqs, {
    guitarType,
    peakMinThreshold: m.peakMinThreshold ?? -60,
    minHz: MIN_HZ,
    maxHz: MAX_HZ,
  })

  const modes = classifyAll(peaks, guitarType)
  const winners = resolvedModePeaks(peaks, guitarType)
  const selected = new Set([...winners.values()].map((p) => p.id))
  return { peaks, modes, selected }
}

function expected(): Record<string, { peakCount: number; peaks: ExpectedPeak[] }> {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, 'peak-baseline-expected.json'), 'utf8'))
}

describe('D3/D5 — fixture regression', () => {
  it.each(FIXTURES)('D3 — %s yields no duplicate peaks', (name) => {
    const { peaks } = replay(name)
    expect(peaks.length, `${name}: no peaks replayed`).toBeGreaterThan(0)

    const offenders: string[] = []
    for (let i = 0; i < peaks.length; i++) {
      for (let j = i + 1; j < peaks.length; j++) {
        const delta = Math.abs(peaks[i]!.frequency - peaks[j]!.frequency)
        if (delta < PEAK_PROXIMITY_HZ) {
          offenders.push(
            `${peaks[i]!.frequency.toFixed(5)} Hz / ${peaks[j]!.frequency.toFixed(5)} Hz ` +
              `(${delta.toFixed(5)} apart)`,
          )
        }
      }
    }
    expect(offenders, `${name}: duplicate peaks`).toEqual([])
  })

  it.each(FIXTURES)('D5 — %s matches the golden baseline', (name) => {
    const want = expected()[name]
    expect(want, `no expectation recorded for ${name}`).toBeDefined()

    const { peaks, modes, selected } = replay(name)
    expect(peaks.length, `${name}: peak count`).toBe(want!.peakCount)
    if (peaks.length !== want!.peakCount) return

    // Compare in frequency order so ordering changes don't masquerade as value changes.
    const got: Peak[] = [...peaks].sort((a, b) => a.frequency - b.frequency)
    const exp = [...want!.peaks].sort((a, b) => a.frequency - b.frequency)

    for (let i = 0; i < got.length; i++) {
      const g = got[i]!
      const w = exp[i]!
      expect(Math.abs(g.frequency - w.frequency), `${name}: frequency ${g.frequency}`).toBeLessThan(TOL)
      expect(Math.abs(g.magnitude - w.magnitude), `${name}: magnitude at ${w.frequency} Hz`).toBeLessThan(TOL)
      expect(Math.abs(g.quality - w.quality), `${name}: Q at ${w.frequency} Hz`).toBeLessThan(TOL)
      expect(Math.abs(g.bandwidth - w.bandwidth), `${name}: bandwidth at ${w.frequency} Hz`).toBeLessThan(TOL)
      expect(modeToken(modes.get(g.id)), `${name}: mode at ${w.frequency} Hz`).toBe(w.mode)
      expect(selected.has(g.id), `${name}: selection at ${w.frequency} Hz`).toBe(w.selected)
    }
  })
})