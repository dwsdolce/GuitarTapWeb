// @parity test/status-message
//
// The status line's words, each reached through the app's own path. The shared cases in status-message.json
// (SM1–SM24), the same as Swift and Python. Below them, the web's own guard that strings it alone once
// produced ("Requesting microphone…", "Playing…", "Comparing…", "Microphone unavailable") never come back.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import type { Spectrum } from '../src/dsp/guitarFFT'
import type { ResonantPeak } from '../src/measurement/types'
import { parseGuitarTapFile } from '../src/measurement'
import { makeStepsAnalyzer, runAnalyzerStep, type AnalyzerStep } from './analyzerSteps'

type Fields = Record<string, unknown>
type StatusStep = AnalyzerStep & {
  clipping?: boolean; deviceChange?: boolean; load?: string; playingFile?: boolean
  drainMainQueue?: boolean; countStatusWrites?: boolean; check?: Fields
}
type StatusCase = { id: string; note: string; steps: StatusStep[]; expect: Fields }
const DATA = JSON.parse(readFileSync('test/fixtures/status-message.json', 'utf8')) as {
  files: Record<string, unknown>
  cases: StatusCase[]
}

function check(fields: Fields, a: TapToneAnalyzer, before: string, writes: number): void {
  const status = a.statusMessage
  for (const [field, want] of Object.entries(fields)) {
    switch (field) {
      case 'statusMessage': expect(status, field).toBe(want); break
      case 'statusPrefix': expect(status.startsWith(want as string), `${field}: ${status}`).toBe(true); break
      case 'statusSuffix': expect(status.endsWith(want as string), `${field}: ${status}`).toBe(true); break
      case 'statusContains': expect(status, field).toContain(want); break
      case 'statusUnchangedByLastStep': expect(status === before, `${field}: ${before} → ${status}`).toBe(want); break
      case 'detecting': expect(a.isDetecting, field).toBe(want); break
      case 'tapCount': expect(a.currentTapCount, field).toBe(want); break
      case 'statusWrites': expect(writes, field).toBe(want); break
      default: throw new Error(`unknown field ${field}`)
    }
  }
}

describe('status-message — the shared cases (status-message.json)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const { a, store } = makeStepsAnalyzer()
    let before = a.statusMessage
    let writes = 0
    let unsubscribe: (() => void) | undefined
    for (const step of c.steps) {
      if (step.check) {
        check(step.check, a, before, writes)
        continue
      }
      before = a.statusMessage
      if (step.clipping !== undefined) a.setClipping(step.clipping) // as the device forwards its input level
      else if (step.deviceChange) a.handleDeviceChange(true)
      else if (step.load !== undefined) a.loadMeasurement(parseGuitarTapFile(JSON.stringify(DATA.files[step.load]))[0]!)
      else if (step.playingFile) {
        const engine = new RealtimeFFTAnalyzer()
        engine.playingFile = true
        a.setDevice(engine)
      } else if (step.drainMainQueue) {
        // Each pass runs everything queued before it.
        for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
      } else if (step.countStatusWrites) {
        unsubscribe = a.subscribe(() => writes++)
      } else expect(runAnalyzerStep(step, a, store), `unknown step ${JSON.stringify(step)}`).toBe(true)
    }
    unsubscribe?.()
    check(c.expect, a, before, writes)
  })
})

// A synthetic gated spectrum: flat -80 dB over 0–200 Hz, with an optional single-bin bump (a resonance)
// at `peakHz`. No bump → findDominantPeak finds no candidate (the "no resonance" case).
function spectrum(peakHz: number | null): Spectrum {
  const frequencies = Array.from({ length: 201 }, (_, i) => i)
  const magnitudesDb = frequencies.map(() => -80)
  if (peakHz != null) {
    magnitudesDb[peakHz] = -40
    magnitudesDb[peakHz - 1] = -55
    magnitudesDb[peakHz + 1] = -55
  }
  return { magnitudesDb, frequencies }
}
const mp = (f: number): ResonantPeak => ({ id: '0', frequency: f, magnitude: -40, quality: 8, bandwidth: 2, timestamp: '2026-09-25T00:00:00Z' })

/** A minimal device stand-in — the analyzer only needs playingFile + activeCalibration + its input level
 *  (observed for clipping) + no-op session/arm hooks (armMaterial etc. re-arm the real device; here they do
 *  nothing). */
function fakeDevice(playingFile = false): RealtimeFFTAnalyzer {
  const engine = new RealtimeFFTAnalyzer()
  engine.playingFile = playingFile
  return engine
}

describe('statusMessage — removed web-only inventions are never produced', () => {
  it('none of the sweep states yield a removed string', () => {
    const seen: string[] = []
    const a = new TapToneAnalyzer()
    a.startTapSequence()
    seen.push(a.statusMessage)
    a.restoreSnapshot({ magnitudes: [1, 2], frequencies: [1, 2] })
    seen.push(a.statusMessage)
    const b = new TapToneAnalyzer()
    b.measurementType = 'brace'
    b.setDevice(fakeDevice())
    b.setNumberOfTaps(1)
    b.startTapSequence()
    seen.push(b.statusMessage)
    b.recordMaterialTap(spectrum(150)) // brace L range 100–1200 → complete
    seen.push(b.statusMessage)
    for (const out of seen) {
      expect(out).not.toMatch(/Requesting microphone|Comparing|Tap comparison|Microphone unavailable|Playing|Cancelled/)
    }
    expect(seen[3]).toBe('Complete - check Results') // brace completes generically
  })
})
