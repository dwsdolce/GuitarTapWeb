// @parity test/tap-decisions
//
// The tap detector's decisions — the rising edge, the threshold the application configured, the
// hysteresis latch and the re-arm rule, the warm-up and its sync chunk, relative detection and its noise
// floor, the confirmation a resume or a new sequence restarts — and the gated capture's onset alignment.
// Every chunk goes through `processAudioFrame`, the per-chunk entry audio takes, after arming the way the
// app does; no case sets the detector's state by hand. The shared cases in tap-decisions.json (T1–T14,
// O1–O3), the same as Swift and Python.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { makeStepsAnalyzer, runAnalyzerStep, PHASE_RAW, type AnalyzerStep } from './analyzerSteps'

type Fields = Record<string, unknown>
type DecisionCase = { id: string; note: string; steps: (AnalyzerStep & { check?: Fields })[]; expect: Fields }
type BufferSpec = { kind: 'impulse' | 'constant' | 'ramp'; length: number; at?: number; value?: number; start?: number; step?: number }
type OnsetCase = {
  id: string; note: string; buffer: BufferSpec; windowSize: number; preOnset: number
  expect: { length: number; argmax?: number; samples?: Record<string, number> }
}
const DATA = JSON.parse(readFileSync('test/fixtures/tap-decisions.json', 'utf8')) as {
  confirmChunks: number; cases: DecisionCase[]; onset: OnsetCase[]
}

/** The detector's private state, read (never written) where a case is about that state. */
type DetectorState = { isAboveThreshold: boolean; justExitedWarmup: boolean; noiseFloorEstimate: number }
const detector = (a: TapToneAnalyzer) => a as unknown as DetectorState

function check(fields: Fields, a: TapToneAnalyzer): void {
  for (const [field, want] of Object.entries(fields)) {
    switch (field) {
      case 'captureOpen': expect(a.gatedCaptureActive, field).toBe(want); break
      case 'aboveThreshold': expect(detector(a).isAboveThreshold, field).toBe(want); break
      case 'justExitedWarmUp': expect(detector(a).justExitedWarmup, field).toBe(want); break
      case 'inWarmUp': expect(a.lastAudioTime < a.warmupPeriod, field).toBe(want); break
      case 'noiseFloor':
        expect(Math.abs(detector(a).noiseFloorEstimate - (want as number)), `${field}: ${detector(a).noiseFloorEstimate}`).toBeLessThan(0.01)
        break
      case 'phase': expect(PHASE_RAW[a.materialTapPhase], field).toBe(want); break
      case 'detecting': expect(a.isDetecting, field).toBe(want); break
      case 'statusMessage': expect(a.statusMessage, field).toBe(want); break
      default: throw new Error(`unknown field ${field}`)
    }
  }
}

describe('tap-decisions — the shared cases (tap-decisions.json)', () => {
  it('the confirmation is the case file’s chunk count', () => {
    expect(new TapToneAnalyzer().confirmChunks).toBe(DATA.confirmChunks)
  })

  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const a = makeStepsAnalyzer()
    for (const step of c.steps) {
      if (step.check) check(step.check, a)
      else expect(runAnalyzerStep(step, a), `unknown step ${JSON.stringify(step)}`).toBe(true)
    }
    check(c.expect, a)
  })
})

/** The buffer an onset case names, as Float32. */
function buffer(spec: BufferSpec): Float32Array {
  const out = new Float32Array(spec.length)
  if (spec.kind === 'impulse') out[spec.at!] = spec.value!
  else if (spec.kind === 'constant') out.fill(spec.value!)
  else for (let i = 0; i < spec.length; i++) out[i] = spec.start! + spec.step! * i
  return out
}

describe('tap-decisions — the onset alignment (tap-decisions.json)', () => {
  it.each(DATA.onset.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const out = new TapToneAnalyzer().alignCaptureToOnset(buffer(c.buffer), c.windowSize, c.preOnset)
    expect(out.length, 'length').toBe(c.expect.length)
    if (c.expect.argmax !== undefined) {
      let argmax = 0
      for (let i = 1; i < out.length; i++) if (Math.abs(out[i]!) > Math.abs(out[argmax]!)) argmax = i
      expect(argmax, 'argmax').toBe(c.expect.argmax)
    }
    for (const [index, value] of Object.entries(c.expect.samples ?? {})) {
      expect(Math.abs(out[Number(index)]! - value), `sample ${index}: ${out[Number(index)]}`).toBeLessThan(1e-6)
    }
  })
})
