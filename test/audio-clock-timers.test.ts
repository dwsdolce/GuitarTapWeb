// @parity test/audio-clock-timers
//
// The tap lifecycle's delays — the rest between material taps, the FLC hold, the capture window — run on
// the AUDIO clock, so file playback, which advances audio faster or slower than real time, moves them with
// the audio; the capture's safety timeout runs on the wall clock, which a test moves by hand. The shared
// cases in audio-clock-timers.json (AT1–AT8), the same as Swift and Python. Below them, the web's own
// file-playback pacing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import { makeStepsAnalyzer, runAnalyzerStep, PHASE_RAW, type AnalyzerStep } from './analyzerSteps'

type Fields = Record<string, unknown>
type ClockStep = AnalyzerStep & { fileEnd?: boolean; playingFile?: boolean; noteWarmup?: boolean; check?: Fields }
type ClockCase = { id: string; note: string; steps: ClockStep[]; expect: Fields }
const DATA = JSON.parse(readFileSync('test/fixtures/audio-clock-timers.json', 'utf8')) as { cases: ClockCase[] }

/** The analyzer's warm-up anchor and level latch (TS `private` is compile-time only). */
type Internals = { warmupStartAudioTime: number | null; isAboveThreshold: boolean }

function check(fields: Fields, a: TapToneAnalyzer, notedWarmup: number | null | undefined): void {
  const internal = a as unknown as Internals
  for (const [field, want] of Object.entries(fields)) {
    switch (field) {
      case 'detecting': expect(a.isDetecting, field).toBe(want); break
      case 'phase': expect(PHASE_RAW[a.materialTapPhase], field).toBe(want); break
      case 'complete': expect(a.isMeasurementComplete, field).toBe(want); break
      case 'gatedCapture': expect(a.gatedCaptureActive, field).toBe(want); break
      case 'aboveThreshold': expect(internal.isAboveThreshold, field).toBe(want); break
      case 'warmupAtLastChunk': expect(internal.warmupStartAudioTime === a.lastAudioTime, field).toBe(want); break
      case 'warmupUnchanged': expect(internal.warmupStartAudioTime === notedWarmup, field).toBe(want); break
      default: throw new Error(`unknown field ${field}`)
    }
  }
}

describe('audio-clock-timers — the shared cases (audio-clock-timers.json)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const { a, store } = makeStepsAnalyzer()
    let notedWarmup: number | null | undefined
    for (const step of c.steps) {
      if (step.fileEnd) a.flushGatedCaptureOnFileEnd()
      else if (step.playingFile) {
        const engine = new RealtimeFFTAnalyzer()
        engine.playingFile = true
        a.setDevice(engine)
      } else if (step.noteWarmup) notedWarmup = (a as unknown as Internals).warmupStartAudioTime
      else if (step.check) check(step.check, a, notedWarmup)
      else expect(runAnalyzerStep(step, a, store), `unknown step ${JSON.stringify(step)}`).toBe(true)
    }
    check(c.expect, a, notedWarmup)
  })
})

describe('file playback pacing (the web\'s own)', () => {
  // Web only — the natives pace file playback with a sleep under a timing activity, which a unit
  // test cannot reach. The web paces from the AUDIO clock: each chunk the worklet renders lets one
  // more file chunk through, so a throttled hidden tab still plays at real time.
  it('file playback is paced by the audio the device renders, not by a timer', async () => {
    const played: number[] = []
    const engine = new RealtimeFFTAnalyzer()
    engine.onAudioFrame(() => played.push(1))
    const internal = engine as unknown as { context: unknown; onChunk(d: { samples: Float32Array; rms: number }): void }
    internal.context = { sampleRate: 48000 } // an AudioContext, as far as pacing is concerned
    const tick = () => internal.onChunk({ samples: new Float32Array(1024), rms: 0 })
    const settle = () => new Promise((r) => setTimeout(r, 5))

    const done = engine.playFile(new Float32Array(1024 * 4), 48000)
    await settle()
    expect(played.length, 'one chunk, then it waits for the device').toBe(1)
    tick()
    await settle()
    expect(played.length, 'one rendered chunk lets one more through').toBe(2)
    tick()
    tick()
    await settle()
    expect(played.length).toBe(4)
    tick()
    await done
  })
})
