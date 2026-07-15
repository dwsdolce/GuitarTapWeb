// @parity test/session-pre-roll
//
// Pin the bounded pre-roll for the session WAV (FILE-PATHS-AND-NAMES-SPEC §6): the head is trimmed
// to ~2 s ONLY before the first tap; everything after — subsequent taps, plate phases, and the gaps
// between them — is completely live. Three-way with Swift SessionPreRollTests.swift and Python
// test_session_pre_roll.py. The web session buffer is now a flat SAMPLE buffer (like Swift/Python),
// so these assert exact sample counts.
import { describe, it, expect } from 'vitest'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'

const CHUNK_LEN = 1024 // ~21 ms at 48 kHz

/** Access the analyzer's internal session state (TS `private` is compile-time only). */
type SessionInternals = {
  sessionRate: number
  sessionRecording: boolean
  sessionPreRollActive: boolean
  sessionSamples: number[]
  state: string
  maintainSessionRecording(s: Float32Array): void
  readonly sessionPreRollSamples: number
}

function armed(): { a: RealtimeFFTAnalyzer; s: SessionInternals } {
  const a = new RealtimeFFTAnalyzer()
  const s = a as unknown as SessionInternals
  s.sessionRate = 48000
  s.sessionRecording = true
  s.sessionPreRollActive = true
  s.sessionSamples = []
  s.state = 'listening'
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
    s.state = 'capturing' // first tap begins
    s.maintainSessionRecording(new Float32Array(CHUNK_LEN))
    expect(s.sessionPreRollActive).toBe(false)
  })
})

describe('session-pre-roll — THE INVARIANT: everything after the first tap is fully live', () => {
  it('multi-tap / multi-phase with big idle gaps trims nothing after the first tap', () => {
    const { s } = armed()
    feed(s, 300)
    s.state = 'capturing'
    s.maintainSessionRecording(new Float32Array(CHUNK_LEN)) // freezes
    let expected = s.sessionSamples.length

    // Long session with ~4 s idle GAPS between taps — far more than the 2 s pre-roll. None trimmed.
    for (let tap = 0; tap < 5; tap++) {
      s.state = 'listening'
      for (let i = 0; i < 200; i++) {
        s.maintainSessionRecording(new Float32Array(CHUNK_LEN))
        expected += CHUNK_LEN
      }
      s.state = tap % 2 === 0 ? 'capturing' : 'listening'
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
    expect(RealtimeFFTAnalyzer.SESSION_PRE_ROLL_SECONDS).toBeGreaterThanOrEqual(0.5)
  })
})