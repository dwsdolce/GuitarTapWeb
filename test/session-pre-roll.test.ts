// @parity test/session-pre-roll
//
// Pin the bounded pre-roll for the session WAV: the head is trimmed
// to ~2 s ONLY before the first tap; everything after — subsequent taps, plate phases, and the gaps
// between them — is completely live. How Dump Capture Audio decides whether the recording is saved, and
// what changing it does, are the shared cases in session-pre-roll.json (SR1–SR11). Three-way with Swift
// SessionPreRollTests.swift and Python test_session_pre_roll.py. The web session buffer is now a flat SAMPLE buffer (like Swift/Python),
// so these assert exact sample counts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { DEFAULT_SETTINGS } from '../src/settings'
import { captureProbe, LIVE_PROBE } from '../src/state/captureProbe'
import { SampleBuffer } from '../src/audio/sampleBuffer'

const CHUNK_LEN = 1024 // ~21 ms at 48 kHz

/** Access the analyzer's internal session state (TS `private` is compile-time only). */
type SessionInternals = {
  sessionRate: number
  sessionRecording: boolean
  sessionActive: boolean
  sessionPreRollActive: boolean
  gatedCaptureActive: boolean
  sessionSamples: SampleBuffer
  maintainSessionRecording(s: Float32Array): void
  readonly sessionPreRollSamples: number
}

function armed(): { a: TapToneAnalyzer; s: SessionInternals } {
  const a = new TapToneAnalyzer()
  const s = a as unknown as SessionInternals
  s.sessionRate = 48000
  s.sessionRecording = true
  s.sessionActive = true
  s.sessionPreRollActive = true
  s.gatedCaptureActive = false
  s.sessionSamples = new SampleBuffer()
  return { a, s }
}

const feed = (s: SessionInternals, n: number) => {
  for (let i = 0; i < n; i++) s.maintainSessionRecording(new Float32Array(CHUNK_LEN))
}

describe('session-pre-roll — before the first tap the head is bounded', () => {
  it('idle is trimmed to ~2 s, not accumulated', () => {
    const { s } = armed()
    feed(s, 300) // ~6.4 s of idle, well over the 2 s pre-roll
    expect(s.sessionSamples.length).toBeLessThanOrEqual(s.sessionPreRollSamples)
    expect(s.sessionSamples.length).toBeGreaterThan(s.sessionPreRollSamples - CHUNK_LEN)
  })
})

describe('session-pre-roll — the first tap freezes the latch', () => {
  it('capturing state freezes the pre-roll', () => {
    const { s } = armed()
    feed(s, 300)
    expect(s.sessionPreRollActive).toBe(true)
    // The first tap begins: the next chunk appended while a capture is active freezes the latch —
    // driven through gatedCaptureActive, as in Swift and Python, never by setting the latch by hand.
    s.gatedCaptureActive = true
    s.maintainSessionRecording(new Float32Array(CHUNK_LEN))
    expect(s.sessionPreRollActive, 'the first gated capture must freeze the pre-roll latch').toBe(false)
  })
})

describe('session-pre-roll — THE INVARIANT: everything after the first tap is fully live', () => {
  it('multi-tap / multi-phase with big idle gaps trims nothing after the first tap', () => {
    const { s } = armed()
    feed(s, 300)
    s.gatedCaptureActive = true // first tap begins
    s.maintainSessionRecording(new Float32Array(CHUNK_LEN)) // freezes
    let expected = s.sessionSamples.length

    // Long session with ~4 s idle GAPS between taps — far more than the 2 s pre-roll. Toggle
    // gatedCaptureActive like real taps (as Swift and Python do); none of it may be trimmed.
    for (let tap = 0; tap < 5; tap++) {
      s.gatedCaptureActive = false
      for (let i = 0; i < 200; i++) {
        s.maintainSessionRecording(new Float32Array(CHUNK_LEN))
        expected += CHUNK_LEN
      }
      s.gatedCaptureActive = tap % 2 === 0
      s.maintainSessionRecording(new Float32Array(CHUNK_LEN))
      expected += CHUNK_LEN
    }

    expect(s.sessionSamples.length).toBe(expected) // exact — nothing trimmed
    expect(s.sessionPreRollActive).toBe(false)
  })
})

describe('session-pre-roll — the >= 0.5 s lead-in guarantee (playback fixtures)', () => {
  it('the pre-roll comfortably exceeds the 0.5 s warm-up', () => {
    const { s } = armed()
    expect(s.sessionPreRollSamples / s.sessionRate).toBeGreaterThanOrEqual(0.5)
    expect(TapToneAnalyzer.SESSION_PRE_ROLL_SECONDS).toBeGreaterThanOrEqual(0.5)
  })
})

// ── Dump Capture Audio — the shared cases in session-pre-roll.json (SR1–SR11) ──

type Step = { start?: boolean; chunks?: number; tap?: boolean; dump?: boolean; pause?: boolean; resume?: boolean }
type SessionCase = { id: string; steps: Step[]; expect: { saved: boolean; recording: boolean; samples: number } }
const DATA = JSON.parse(readFileSync('test/fixtures/session-pre-roll.json', 'utf8')) as {
  rate: number
  chunk: number
  cases: SessionCase[]
}

describe('session-pre-roll — Dump Capture Audio (the shared cases)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const a = new TapToneAnalyzer()
    const s = a as unknown as SessionInternals
    const chunk = () => new Float32Array(DATA.chunk).fill(0.1)
    for (const step of c.steps) {
      if (step.start !== undefined) {
        a.setSettings({ ...a.settings, dumpCaptureAudio: step.start })
        a.startTapSequence()
        s.sessionRate = DATA.rate
        s.gatedCaptureActive = false
      } else if (step.chunks !== undefined) {
        feedWith(s, step.chunks, chunk)
      } else if (step.tap) {
        s.gatedCaptureActive = true
        s.maintainSessionRecording(chunk())
      } else if (step.dump !== undefined) {
        a.setSettings({ ...a.settings, dumpCaptureAudio: step.dump })
      } else if (step.pause) {
        a.pauseTapDetection()
      } else if (step.resume) {
        a.resumeTapDetection()
      }
    }
    expect(s.sessionActive, 'saved').toBe(c.expect.saved)
    expect(s.sessionRecording, 'recording').toBe(c.expect.recording)
    expect(s.sessionSamples.length, 'samples').toBe(c.expect.samples)
  })
})

function feedWith(s: SessionInternals, n: number, chunk: () => Float32Array): void {
  for (let i = 0; i < n; i++) s.maintainSessionRecording(chunk())
}

// The capture probe's records follow the recording: a sequence saved because Dump Capture Audio was turned on
// before its first tap has its probe file too. Runs only with the probe on.
describe('session-pre-roll — the capture probe follows the recording', () => {
  it.skipIf(!LIVE_PROBE)('turned on before the first tap starts its records', () => {
    const savedSession = captureProbe.liveSession
    try {
      const a = new TapToneAnalyzer()
      const s = a as unknown as SessionInternals
      a.setSettings({ ...DEFAULT_SETTINGS, dumpCaptureAudio: false })
      a.startTapSequence()
      expect(captureProbe.liveSession).toBe(false)
      a.setSettings({ ...a.settings, dumpCaptureAudio: true })
      expect(captureProbe.liveSession, 'turned on before the first tap').toBe(true)
      a.setSettings({ ...a.settings, dumpCaptureAudio: false })
      expect(captureProbe.liveSession, 'turned off').toBe(false)
      s.gatedCaptureActive = true
      s.maintainSessionRecording(new Float32Array(1024).fill(0.1))
      a.setSettings({ ...a.settings, dumpCaptureAudio: true })
      expect(captureProbe.liveSession, 'turned on after the first tap').toBe(false)
    } finally {
      captureProbe.liveSession = savedSession
    }
  })
})
