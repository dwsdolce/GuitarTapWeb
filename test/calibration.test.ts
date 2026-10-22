// @parity test/calibration
// The engine's calibration corrections: the engine holds the active calibration and computes its per-bin
// corrections from its own bins, at each bin's exact frequency, again when the sample rate changes, and
// flat outside the file's range (CAL1–CAL3); and reading a calibration file — its points, its header's
// Sens Factor and reference level, and a file with no data (CP1–CP9). The shared cases in
// calibration.json; the same list, ids and values as Swift CalibrationTests and Python test_calibration.py.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import { calibrationDetails, correctionAt, interpolateToBins, parseCalibration } from '../src/dsp/calibration'

const DATA = JSON.parse(readFileSync('test/fixtures/calibration.json', 'utf8')) as {
  calibrationFile: string
  fftSize: number
  tolerance: number
  cases: { id: string; note: string; sampleRate: number; fromSampleRate?: number; bins: number[]; expect: number[] }[]
  parse: { id: string; note: string; file?: string; content?: string; expect: Record<string, unknown> }[]
  details: { id: string; note: string; file?: string; content?: string; expect: { sensitivity: string | null; dataPoints: string; range: string | null } }[]
}

describe('calibration — the engine’s corrections (calibration.json)', () => {
  for (const row of DATA.cases) {
    it(`${row.id}: ${row.note}`, () => {
      const engine = new RealtimeFFTAnalyzer()
      engine.initForTesting()
      expect(engine.fftSize).toBe(DATA.fftSize)
      engine.sampleRate = row.fromSampleRate ?? row.sampleRate
      engine.setCalibration(parseCalibration(readFileSync(`test/fixtures/${DATA.calibrationFile}`, 'utf8')))
      if (row.fromSampleRate != null) {
        expect(engine.calibrationCorrections).not.toBeNull() // computed for the first rate
        engine.sampleRate = row.sampleRate
      }
      const corrections = engine.calibrationCorrections!
      row.bins.forEach((bin, i) => {
        expect(Math.abs(corrections[bin]! - row.expect[i]!), `bin ${bin}: ${corrections[bin]} dB`).toBeLessThanOrEqual(DATA.tolerance)
      })
    })
  }
})

describe('calibration — the corrections for all bins at once', () => {
  // Every bin's correction, computed for all the FFT's bins at once, is the one correctionAt gives that bin
  // alone — exactly, for the bins of 48 kHz and of 44.1 kHz and for unsorted frequencies. As Swift
  // correctionsForAllBins_areEachBinsCorrection.
  it('each bin’s correction, for all bins and for unsorted frequencies', () => {
    const cal = parseCalibration(readFileSync(`test/fixtures/${DATA.calibrationFile}`, 'utf8'))
    for (const rate of [48000, 44100]) {
      const bins = Array.from({ length: DATA.fftSize / 2 }, (_, i) => (i * rate) / DATA.fftSize)
      expect(interpolateToBins(cal, bins), `${rate} Hz`).toEqual(bins.map((f) => correctionAt(cal.points, f)))
    }
    const unsorted = [1000, 20, 5000, 20, 19000, 3]
    expect(interpolateToBins(cal, unsorted)).toEqual(unsorted.map((f) => correctionAt(cal.points, f)))
  })
})

describe('calibration — reading a calibration file (calibration.json)', () => {
  for (const row of DATA.parse) {
    it(`${row.id}: ${row.note}`, () => {
      const content = row.file ? readFileSync(`test/fixtures/${row.file}`, 'utf8') : row.content!
      let cal: ReturnType<typeof parseCalibration>
      try {
        cal = parseCalibration(content, row.id)
      } catch {
        expect(row.expect.error, `${row.id}: the text did not parse`).toBe(true)
        return
      }
      expect(row.expect.error, `${row.id}: the text parsed, where an error was expected`).toBeUndefined()
      const points = cal.points.map((p) => [p.frequency, p.correction])
      const near = (a: number[] | undefined, b: number[]) => a != null && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < 1e-3)
      for (const [field, want] of Object.entries(row.expect)) {
        const msg = `${row.id} ${field}`
        switch (field) {
          case 'pointCount': expect(points.length, msg).toBe(want); break
          case 'first': expect(near(points[0], want as number[]), msg).toBe(true); break
          case 'last': expect(near(points[points.length - 1], want as number[]), msg).toBe(true); break
          case 'points':
            expect(points.length === (want as number[][]).length && (want as number[][]).every((w, i) => near(points[i], w)), `${msg}: ${JSON.stringify(points)}`).toBe(true)
            break
          case 'sensitivity':
          case 'referenceLevel': {
            const got = field === 'sensitivity' ? cal.sensitivityFactor : cal.referenceLevel
            if (want == null) expect(got, msg).toBeNull()
            else expect(Math.abs((got ?? NaN) - (want as number)), `${msg}: ${got}`).toBeLessThan(1e-4)
            break
          }
          default: throw new Error(`${row.id}: unknown field ${field}`)
        }
      }
    })
  }
})

describe('calibration — the details Settings shows (calibration.json)', () => {
  for (const row of DATA.details) {
    it(`${row.id}: ${row.note}`, () => {
      const content = row.file ? readFileSync(`test/fixtures/${row.file}`, 'utf8') : row.content!
      expect(calibrationDetails(parseCalibration(content, row.id))).toEqual(row.expect)
    })
  }
})
