// @parity test/guitar-capture-window
/**
 * A guitar tap reaches the transform as the same samples wherever the audio's chunk boundaries fall.
 *
 * The tap trigger fires on a chunk boundary, so the capture begins at a different sample from one run
 * to the next (and from one edition to the next) for the same tap. The window is aligned to the tap's
 * onset, which takes that out of its start — but the capture is exactly as long as the window, so it
 * runs out before the window's end, by an amount that depends on the boundary. The window's audio
 * therefore ends at a fixed length, short of the window's end by the most that amount can be, and
 * zeros follow: the same tap, the same window.
 *
 * Mirrors: GuitarTapTests/GuitarCaptureWindowTests.swift · tests/test_guitar_capture_window.py
 */
import { describe, it, expect } from 'vitest'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { captureProbe } from '../src/state/captureProbe'
import { waitForCompletion } from './parityRunner'

const SAMPLE_RATE = 48000

/** One second of quiet noise, then a tap — two decaying tones that start at full amplitude, so the
 *  onset is one unmistakable sample — ringing for longer than a capture. */
function recording(): Float32Array {
  const lead = SAMPLE_RATE
  const tail = 80_000
  const samples = new Float32Array(lead + tail)
  let state = 12345
  for (let i = 0; i < samples.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    samples[i] = ((state >>> 8) / (1 << 24) - 0.5) * 0.0005
  }
  for (let n = 0; n < tail; n++) {
    const t = n / SAMPLE_RATE
    samples[lead + n]! += 0.25 * Math.cos(2 * Math.PI * 110 * t) * Math.exp(-t * 4) + 0.1 * Math.cos(2 * Math.PI * 237 * t) * Math.exp(-t * 6)
  }
  return samples
}

/** Play the recording with its first `dropped` samples removed — the same tap, its chunk boundaries
 *  `dropped` samples elsewhere — and return the fingerprint of the window the capture handed to the
 *  transform. */
async function windowFingerprint(samples: Float32Array, dropped: number): Promise<string | undefined> {
  captureProbe.reset()
  captureProbe.enabled = true
  try {
    const analyzer = new TapToneAnalyzer()
    analyzer.measurementType = 'generic'
    analyzer.setNumberOfTaps(1)
    analyzer.tapDetectionThreshold = -40
    const engine = new RealtimeFFTAnalyzer(
      { onAudioFrame: (chunk, levelDb, audioTime) => analyzer.processAudioFrame(chunk, levelDb, audioTime) },
      { tapDetectionThreshold: -40, numberOfTaps: 1 },
    )
    engine.initForTesting()
    analyzer.setDevice(engine)
    await analyzer.playFile(samples.subarray(dropped), SAMPLE_RATE, null)
    await waitForCompletion(analyzer)
    return captureProbe.records[0]?.windowHash
  } finally {
    captureProbe.enabled = false
  }
}

describe('guitar capture window', () => {
  // GW1: the same tap, with its chunk boundaries at four different places, reaches the transform as
  // the same window.
  it('gives the same window wherever the chunk boundaries fall', async () => {
    const samples = recording()
    const seen: Record<number, string | undefined> = {}
    for (const dropped of [0, 300, 700, 1000]) seen[dropped] = await windowFingerprint(samples, dropped)
    expect(Object.values(seen).every(Boolean), `no capture for some chunk boundary: ${JSON.stringify(seen)}`).toBe(true)
    expect(new Set(Object.values(seen)).size, `REGRESSION: the window differs with the chunk boundary — ${JSON.stringify(seen)}`).toBe(1)
  }, 120_000)

  /** Noise whose level rises and falls, then a tap that grows from nothing: the noise measured at one
   *  place gives a different threshold from the noise at another, and the tap's first sample above a
   *  threshold depends on the threshold. */
  function onsetTestSignal(length = 40_000, tap = 12_000): Float32Array {
    const x = new Float32Array(length)
    let state = 24680
    for (let i = 0; i < length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      const u = (state >>> 8) / (1 << 24) - 0.5
      x[i] = u * 0.0008 * (1.0 + 0.6 * Math.sin((2 * Math.PI * i) / 3000.0))
    }
    for (let m = 0; m < length - tap; m++) {
      x[tap + m]! += 0.3 * (1 - Math.exp(-m / 300.0)) * Math.sin((2 * Math.PI * 110 * m) / 48000.0)
    }
    return x
  }

  // GW2: the same tap captured from seven different starting samples — as the trigger's chunk boundary
  // moves the capture's start — aligns to the same window.
  it('aligns to the same window wherever the capture started', () => {
    const analyzer = new TapToneAnalyzer()
    const x = onsetTestSignal()
    const starts = [0, 300, 700, 1000, 1500, 2200, 3000]
    const windows = starts.map((start) => Array.from(analyzer.alignCaptureToOnset(x.subarray(start), 19_200, 4_800)))
    const differing = starts.filter((_, i) => windows[i]!.some((v, k) => v !== windows[0]![k]))
    expect(differing, 'REGRESSION: the window depends on where the capture started').toEqual([])
  })
})
