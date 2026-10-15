// @parity test/calibration
// The engine's calibration corrections: the engine holds the active calibration and computes its per-bin
// corrections from its own bins, at each bin's exact frequency, and again when the sample rate changes
// (CAL1, CAL2 — the shared cases in calibration.json). The same list, ids and values as Swift
// CalibrationTests and Python test_calibration.py.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import { parseCalibration } from '../src/dsp/calibration'

const DATA = JSON.parse(readFileSync('test/fixtures/calibration.json', 'utf8')) as {
  calibrationFile: string
  fftSize: number
  tolerance: number
  cases: { id: string; note: string; sampleRate: number; fromSampleRate?: number; bins: number[]; expect: number[] }[]
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
