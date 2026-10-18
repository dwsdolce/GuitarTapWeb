// @parity test/session-pre-roll
//
// The session WAV: its head is trimmed to a 2 s pre-roll only before the first tap — everything after,
// later taps and the gaps between them, is completely live — and Dump Capture Audio decides whether it is
// saved. The shared cases in session-pre-roll.json (SR1–SR14), the same as Swift and Python; and the
// capture probe's case, which runs only with the probe on.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { captureProbe, LIVE_PROBE } from '../src/state/captureProbe'
import { SampleBuffer } from '../src/audio/sampleBuffer'
import { settingsStore } from '../src/settingsStore'

/** Access the analyzer's internal session state (TS `private` is compile-time only). */
type SessionInternals = {
  sessionRate: number
  sessionRecording: boolean
  sessionActive: boolean
  sessionPreRollActive: boolean
  gatedCaptureActive: boolean
  sessionSamples: SampleBuffer
  maintainSessionRecording(s: Float32Array): void
}

// ── The shared cases in session-pre-roll.json (SR1–SR14) ──

type Step = { start?: boolean; chunks?: number; tap?: boolean; release?: boolean; dump?: boolean; pause?: boolean; resume?: boolean }
type SessionCase = { id: string; steps: Step[]; expect: { saved?: boolean; recording?: boolean; samples?: number; preRoll?: boolean } }
const DATA = JSON.parse(readFileSync('test/fixtures/session-pre-roll.json', 'utf8')) as {
  rate: number
  chunk: number
  preRollSeconds: number
  cases: SessionCase[]
}

describe('session-pre-roll — the shared cases (session-pre-roll.json)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const a = new TapToneAnalyzer()
    const s = a as unknown as SessionInternals
    const chunk = () => new Float32Array(DATA.chunk).fill(0.1)
    for (const step of c.steps) {
      if (step.start !== undefined) {
        settingsStore.update({ dumpCaptureAudio: step.start })
        a.startTapSequence()
        s.sessionRate = DATA.rate
        s.gatedCaptureActive = false
      } else if (step.chunks !== undefined) {
        feedWith(s, step.chunks, chunk)
      } else if (step.tap) {
        s.gatedCaptureActive = true
        s.maintainSessionRecording(chunk())
      } else if (step.release) {
        s.gatedCaptureActive = false
      } else if (step.dump !== undefined) {
        settingsStore.update({ dumpCaptureAudio: step.dump })
        a.applyDumpCaptureAudioSetting()
      } else if (step.pause) {
        a.pauseTapDetection()
      } else if (step.resume) {
        a.resumeTapDetection()
      }
    }
    const e = c.expect
    if (e.saved !== undefined) expect(s.sessionActive, 'saved').toBe(e.saved)
    if (e.recording !== undefined) expect(s.sessionRecording, 'recording').toBe(e.recording)
    if (e.samples !== undefined) expect(s.sessionSamples.length, 'samples').toBe(e.samples)
    if (e.preRoll !== undefined) expect(s.sessionPreRollActive, 'preRoll').toBe(e.preRoll)
  })

  it("the pre-roll's length is the file's preRollSeconds", () => {
    expect(TapToneAnalyzer.SESSION_PRE_ROLL_SECONDS).toBe(DATA.preRollSeconds)
  })
})

function feedWith(s: SessionInternals, n: number, chunk: () => Float32Array): void {
  for (let i = 0; i < n; i++) s.maintainSessionRecording(chunk())
}

// The capture probe's records follow the recording: a sequence saved because Dump Capture Audio was turned on
// before its first tap has its probe file too. Runs only with the probe on.
describe('session-pre-roll — the capture probe follows the recording', () => {
  it('turned on before the first tap starts its records', (ctx) => {
    if (!LIVE_PROBE) return ctx.skip('the capture probe is switched off')
    const savedSession = captureProbe.liveSession
    try {
      const a = new TapToneAnalyzer()
      const s = a as unknown as SessionInternals
      settingsStore.update({ dumpCaptureAudio: false })
      a.startTapSequence()
      expect(captureProbe.liveSession).toBe(false)
      settingsStore.update({ dumpCaptureAudio: true })
      a.applyDumpCaptureAudioSetting()
      expect(captureProbe.liveSession, 'turned on before the first tap').toBe(true)
      settingsStore.update({ dumpCaptureAudio: false })
      a.applyDumpCaptureAudioSetting()
      expect(captureProbe.liveSession, 'turned off').toBe(false)
      s.gatedCaptureActive = true
      s.maintainSessionRecording(new Float32Array(1024).fill(0.1))
      settingsStore.update({ dumpCaptureAudio: true })
      a.applyDumpCaptureAudioSetting()
      expect(captureProbe.liveSession, 'turned on after the first tap').toBe(false)
    } finally {
      captureProbe.liveSession = savedSession
    }
  })
})
