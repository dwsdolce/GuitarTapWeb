// @parity test/decay-tracking
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'

// Ring-out time: ringOutTime on generated audio (DK1–DK8, the shared cases in decay-tracking.json), and
// that a new sequence clears the last ring-out (DK9). That a tap's ring-out is the same wherever the
// audio's chunk boundaries fall is guitar-capture-window GW3. The same list, ids and values as Swift
// DecayTrackingTests and Python test_decay_tracking.py.

interface SignalSpec { length: number; onset?: number; timeConstant: number; amplitude?: number; attack?: number }

const DATA = JSON.parse(readFileSync('test/fixtures/decay-tracking.json', 'utf8')) as {
  defaultThreshold: number
  windowSamples: number
  sampleRate: number
  tolerance: number
  ringOutTime: { id: string; note: string; signal: SignalSpec; start: number; end: number; threshold?: number; expect: number | null }[]
}

/** A case's audio, from its `signal` (see decay-tracking.json's `about`). */
function signal(spec: SignalSpec, sampleRate: number): Float32Array {
  const out = new Float32Array(spec.length)
  const onset = spec.onset ?? 0
  const amplitude = spec.amplitude ?? 0.5
  for (let index = 0; index < spec.length; index++) {
    const n = index - onset
    if (n < 0) continue
    let value = amplitude * Math.exp(-n / (spec.timeConstant * sampleRate))
    if (spec.attack) value *= Math.min(1, n / spec.attack)
    out[index] = value
  }
  return out
}

describe('decay tracking', () => {
  for (const row of DATA.ringOutTime) {
    it(`${row.id}: ${row.note}`, () => {
      const t = TapToneAnalyzer.ringOutTime(signal(row.signal, DATA.sampleRate), row.start, row.end,
        DATA.sampleRate, row.threshold ?? DATA.defaultThreshold)
      if (row.expect === null) expect(t).toBeNull()
      else expect(Math.abs(t! - row.expect)).toBeLessThan(DATA.tolerance)
    })
  }

  it('the default threshold', () => {
    expect(new TapToneAnalyzer().decayThreshold).toBe(DATA.defaultThreshold)
  })

  it('the window', () => {
    expect(TapToneAnalyzer.ringOutWindowSamples).toBe(DATA.windowSamples)
  })

  it('DK9: a new sequence clears the ring-out', () => {
    const a = new TapToneAnalyzer()
    a.currentDecayTime = 0.1
    a.startTapSequence()
    expect(a.currentDecayTime).toBeNull()
  })
})
