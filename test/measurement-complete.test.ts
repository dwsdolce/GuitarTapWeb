// @parity test/measurement-complete
//
// isMeasurementComplete gates whether the spectrum freezes or keeps showing live frames, so every path
// that should set it true or false is a case here — a new completion path without one is a gap — and so
// are the paths that move the loaded-settings warning with it. The shared cases in
// measurement-complete.json (MC1–MC18), the same as Swift and Python, run through an analyzer attached
// to its own settings store.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TapToneAnalyzer, type CapturedTap } from '../src/state/tapToneAnalyzer'
import { parseGuitarTapFile } from '../src/measurement'
import { settingsStore } from '../src/settingsStore'

type Step = {
  numberOfTaps?: number
  captureTaps?: number[]
  processTaps?: boolean
  newTap?: boolean
  cancel?: boolean
  load?: string
  warning?: boolean
  setTaps?: number
  setThreshold?: number
}
type CompleteCase = { id: string; note: string; steps: Step[]; expect: Record<string, unknown> }
const DATA = JSON.parse(readFileSync('test/fixtures/measurement-complete.json', 'utf8')) as {
  files: Record<string, unknown>
  cases: CompleteCase[]
}

/** A captured tap: 64 bins at 31.25 Hz, −80 dB but bin 16 at `peakDB`. */
function capturedTap(peakDB: number): CapturedTap {
  const magnitudes = new Array<number>(64).fill(-80)
  magnitudes[16] = peakDB
  return { magnitudes, frequencies: Array.from({ length: 64 }, (_, i) => i * 31.25), captureTime: 0 }
}

describe('measurement-complete — the shared cases (measurement-complete.json)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    settingsStore.update({ measurementType: 'classical' })
    const a = new TapToneAnalyzer()
    a.tapDetectionThreshold = -40
    a.setNumberOfTaps(1)
    for (const step of c.steps) {
      if (step.numberOfTaps !== undefined) a.setNumberOfTaps(step.numberOfTaps)
      else if (step.captureTaps) a.capturedTaps = step.captureTaps.map(capturedTap)
      else if (step.processTaps) a.processMultipleTaps()
      else if (step.newTap) a.startTapSequence()
      else if (step.cancel) a.cancelTapSequence()
      else if (step.load !== undefined) a.loadMeasurement(parseGuitarTapFile(JSON.stringify(DATA.files[step.load]))[0]!)
      else if (step.warning) a.showLoadedSettingsWarning = true
      else if (step.setTaps !== undefined) a.setNumberOfTaps(step.setTaps)
      else if (step.setThreshold !== undefined) a.tapDetectionThreshold = step.setThreshold
    }
    for (const [field, want] of Object.entries(c.expect)) {
      switch (field) {
        case 'complete': expect(a.isMeasurementComplete, field).toBe(want); break
        case 'frozenSpectrum':
          expect(a.frozenMagnitudes.length > 0 && a.frozenFrequencies.length > 0, field).toBe(want)
          break
        case 'detecting': expect(a.isDetecting, field).toBe(want); break
        case 'loadedSettingsWarning': expect(a.showLoadedSettingsWarning, field).toBe(want); break
        case 'numberOfTaps': expect(a.numberOfTaps, field).toBe(want); break
        default: throw new Error(`unknown field ${field}`)
      }
    }
  })
})
