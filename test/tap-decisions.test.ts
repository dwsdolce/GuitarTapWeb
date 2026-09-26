// @parity test/tap-decisions
//
// The tap detector's decisions — the rising edge, the threshold the application configured, the
// hysteresis latch and the re-arm rule, the warm-up and its sync frame, relative detection and its noise
// floor — and the gated capture's onset alignment.
//
// Every detector case feeds audio through `processAudioFrame`, the per-chunk entry audio takes, after
// arming the way the app does: `startTapSequence()`, then the warm-up on quiet audio. No case sets the
// detector's state by hand. A tap has fired when a capture has started (`gatedCaptureActive`) — the one
// effect a tap has in both capture kinds; cases about the detector's state read that state (never write
// it). The same cases, with the same numbers, are in Swift GuitarTapTests/TapDetectionTests.swift and
// Python tests/test_tap_detection.py (#17 F50 item 3).
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { DEFAULT_SETTINGS } from '../src/settings'
import { advanceAudio, AUDIO_FEED_CHUNK_SECONDS } from './audioClockFeed'
import { GUITAR_FFT_SIZE } from '../src/dsp/guitarFFT'

// The four cases that used to open this file drove `findLevelCrossing` / `findAllLevelCrossings`
// — offline scanners with no production caller since 2026-07-11, deleted with them (#17 F43). They
// asserted, among other things, that the brace fixture yields 1 tap and the plate 3; REG-B1 and
// REG-P1 in file-playback.test.ts assert exactly that on exactly those fixtures, through the engine
// rather than one level under it. What is left here runs against code the app calls.
describe('G5 — tap-detection decisions', () => {
  it('onset alignment positions the transient at pre-onset (+backup)', () => {
    const buf = new Float32Array(10000)
    buf[5000] = 0.5 // a single transient after silence
    const windowSize = 4096
    const preOnset = 1000
    const out = new TapToneAnalyzer().alignCaptureToOnset(buf, windowSize, preOnset)
    let argmax = 0
    for (let i = 1; i < out.length; i++) if (Math.abs(out[i]!) > Math.abs(out[argmax]!)) argmax = i
    expect(argmax).toBe(1032) // the pre-onset 1000, plus the onset backed up 32 samples
    expect(out[argmax]).toBeCloseTo(0.5, 6)
  })

  // The fallbacks: when the onset cannot be found, the start of the buffer, still window-sized — so the
  // tap reaches the transform at the same length as every other (same bin grid, same window gain).
  // Paired with Swift onsetAlignment_tooShort/noOnset and Python test_onset_alignment_too_short/no_onset.
  it('onset alignment of a buffer too short for the noise estimate: its start, window-sized', () => {
    const buf = new Float32Array(1000).fill(0.25) // shorter than the 2048-sample noise estimate
    const out = new TapToneAnalyzer().alignCaptureToOnset(buf, 4096, 1000)
    expect(out.length).toBe(4096)
    expect(out[0]).toBeCloseTo(0.25, 6)
    expect(out[999]).toBeCloseTo(0.25, 6)
    expect(out[1000], 'zero-padded after the buffer').toBe(0)
    expect(out[4095]).toBe(0)
  })

  it('onset alignment with no onset: the start of the buffer, window-sized', () => {
    // A level that never rises 10x above its own RMS: no onset.
    const buf = new Float32Array(10000)
    for (let i = 0; i < buf.length; i++) buf[i] = 0.1 + 0.00001 * i
    const out = new TapToneAnalyzer().alignCaptureToOnset(buf, 4096, 1000)
    expect(out.length, 'window-sized, not the whole buffer').toBe(4096)
    expect(out[0]).toBeCloseTo(buf[0]!, 6)
    expect(out[4095], 'the start of the buffer').toBeCloseTo(buf[4095]!, 6)
  })
})

// ── The detector ──────────────────────────────────────────────────────────────────────────────

const CHUNK = 1024

/** An analyzer armed the way the app arms it — warm-up included — with the threshold the app sets. */
function armed(thresholdDb: number, type: 'classical' | 'plate' = 'classical'): TapToneAnalyzer {
  const a = new TapToneAnalyzer()
  a.measurementType = type
  a.setSettings({ ...DEFAULT_SETTINGS, tapDetectionThreshold: thresholdDb })
  a.startTapSequence()
  return a
}

/** Feed `n` chunks at `levelDb`, each one chunk of audio after the last. */
function chunks(a: TapToneAnalyzer, levelDb: number, n: number): void {
  for (let i = 0; i < n; i++) {
    a.processAudioFrame(new Float32Array(CHUNK), levelDb, a.lastAudioTime + AUDIO_FEED_CHUNK_SECONDS)
  }
}

/** Through the warm-up on quiet audio, and one chunk past it: the sync chunk sees quiet, so the latch is
 *  down and the detector is ready for a rising edge. */
function settled(a: TapToneAnalyzer, levelDb = -90): void {
  advanceAudio(a, a.warmupPeriod + AUDIO_FEED_CHUNK_SECONDS, levelDb)
}

/** Through the warm-up on quiet audio, then a LOUD first chunk after it: the sync chunk latches the
 *  detector above — the state between taps, a tap still sounding — without firing. */
function latchedAbove(a: TapToneAnalyzer): void {
  advanceAudio(a, a.warmupPeriod - 0.001)
  chunks(a, -20, 1)
}

/** The detector's private state, READ (never written) where a case is about that state. */
type DetectorState = { isAboveThreshold: boolean; justExitedWarmup: boolean; noiseFloorEstimate: number }
const detector = (a: TapToneAnalyzer) => a as unknown as DetectorState

/** A decaying tone — a tap's ring-out — at 48 kHz. */
function decayingTone(hz: number, count: number): Float32Array {
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = 0.5 * Math.exp((-i / 48000) * 6) * Math.sin((2 * Math.PI * hz * i) / 48000)
  return out
}

describe("the detector's decisions", () => {
  it('T1: a rising edge above the threshold fires a tap', () => {
    const a = armed(-40)
    settled(a)
    chunks(a, -35, a.confirmChunks)
    expect(a.gatedCaptureActive, 'a tap should start a capture after crossing the rising threshold').toBe(true)
  })

  it("T1b: the tap is stamped with the confirming chunk's audio time", () => {
    const a = armed(-40)
    settled(a)
    chunks(a, -35, a.confirmChunks)
    expect(a.decayTapAudioTime, "the tap's time is the confirming chunk's audio time").toBe(a.lastAudioTime)
  })

  // T1c–T1e: the detector uses the threshold the APPLICATION configured — `tapDetectionThreshold`, which
  // the slider writes. The web once left it behind in the engine's config, so the slider went dead and
  // detection sat at the -40 dB default (#17 F30).

  it('T1c: a level below the configured threshold (but above the -40 default) does not fire', () => {
    const a = armed(-30)
    settled(a)
    chunks(a, -35, a.confirmChunks)
    expect(
      a.gatedCaptureActive,
      'a tap quieter than the configured threshold must not fire — if this fails, the detector is not reading the configured value',
    ).toBe(false)
  })

  it('T1d: a level above the configured threshold fires (the control)', () => {
    const a = armed(-30)
    settled(a)
    chunks(a, -25, a.confirmChunks)
    expect(a.gatedCaptureActive).toBe(true)
  })

  it('T1e: the same tap is accepted or rejected by the threshold', () => {
    const lenient = armed(-50)
    settled(lenient)
    chunks(lenient, -45, lenient.confirmChunks)
    expect(lenient.gatedCaptureActive, '-45 clears a -50 threshold').toBe(true)

    const strict = armed(-35)
    settled(strict)
    chunks(strict, -45, strict.confirmChunks)
    expect(strict.gatedCaptureActive, 'the same tap is too quiet for a -35 threshold').toBe(false)
  })

  // T1f: the re-arm rule — while latched above, a ring-out that dips below the rising threshold but not
  // below the falling one (threshold − margin) is the same tap still sounding, so its next rise is not a
  // new tap. `isAboveThreshold` is both the latch and the gate.
  it('T1f: a ring-out above the falling threshold is not a new tap', () => {
    const a = armed(-40) // rising -40, falling -43
    latchedAbove(a)
    chunks(a, -42, 3) // below rising, ABOVE falling — still the same tap
    chunks(a, -20, 3) // the decay swings back up
    expect(a.gatedCaptureActive, 'a ring-out that never fell below the falling threshold must not be taken as a new tap').toBe(false)
  })

  it('T1g: a dip below the falling threshold re-arms (the control)', () => {
    const a = armed(-40)
    latchedAbove(a)
    chunks(a, -60, 3) // the signal genuinely settled
    chunks(a, -20, a.confirmChunks) // a real second strike
    expect(a.gatedCaptureActive).toBe(true)
  })

  it('T2: a level below the threshold does not fire', () => {
    const a = armed(-40)
    settled(a)
    chunks(a, -50, a.confirmChunks)
    expect(a.gatedCaptureActive, 'a level below the threshold must not start a capture').toBe(false)
  })

  it('T3: the warm-up suppresses detection', () => {
    const a = armed(-40)
    chunks(a, -20, a.confirmChunks) // loud, but inside the warm-up
    expect(a.lastAudioTime).toBeLessThan(a.warmupPeriod)
    expect(a.gatedCaptureActive, 'no tap during the warm-up').toBe(false)
  })

  it('T5: once latched above, a level between falling and rising holds the latch', () => {
    const a = armed(-40) // rising -40, falling -43
    latchedAbove(a)
    chunks(a, -42, 1)
    expect(detector(a).isAboveThreshold, 'above the falling threshold, the latch holds').toBe(true)
    expect(a.gatedCaptureActive, 'no new tap').toBe(false)
  })

  it('T5b: a level below the falling threshold clears the latch', () => {
    const a = armed(-40)
    latchedAbove(a)
    chunks(a, -50, 1)
    expect(detector(a).isAboveThreshold, 'below the falling threshold, the latch clears').toBe(false)
  })

  // T6: plate detection is RELATIVE to the noise floor. With the floor raised to -45 and the threshold at
  // -40, the relative rising threshold is -35 — above the absolute one — so a -38 level, which the
  // absolute rule fires on, is not a tap here, and -30 is. The plate is in a real capture phase, and the
  // tap must start a capture.
  it('T6: plate detection is relative to the noise floor', () => {
    const guitar = armed(-40)
    settled(guitar)
    chunks(guitar, -38, guitar.confirmChunks)
    expect(guitar.gatedCaptureActive, 'the control: -38 clears the absolute -40 threshold').toBe(true)

    const a = armed(-40, 'plate')
    expect(a.materialTapPhase).toBe('capturingL')
    settled(a, -45) // the warm-up, then the floor re-anchors at -45
    expect(detector(a).noiseFloorEstimate).toBe(-45)

    chunks(a, -38, 3)
    expect(a.gatedCaptureActive, '-38 is below the relative threshold (-35): not a tap').toBe(false)

    chunks(a, -30, a.confirmChunks)
    expect(a.gatedCaptureActive, '-30 clears the relative threshold: a capture starts').toBe(true)
  })

  it('T7: in plate mode the noise-floor estimate converges toward the ambient level', () => {
    const a = armed(-40, 'plate')
    settled(a, -60) // the floor re-anchors at -60
    const start = detector(a).noiseFloorEstimate
    expect(start).toBe(-60)

    chunks(a, -55, 50) // α = 0.05, 50 steps from -60 toward -55: ≈ -57.4
    expect(detector(a).noiseFloorEstimate, 'the floor moves toward the ambient level').toBeGreaterThan(start)
    expect(detector(a).noiseFloorEstimate, 'after 50 chunks at -55 dB it is close to -55').toBeGreaterThan(-58)
  })

  // The settle — the latched ring-out falling below the falling threshold — leaves the prompt alone. The
  // natives used to rewrite it with the GUITAR loop status whatever the mode, so a plate's "fL tap 1/2
  // captured. Tap again..." became "Tap 1/2 captured. Tap again..." (#17 F50 item 7).
  it('the settle leaves a plate prompt alone', () => {
    const a = armed(-40, 'plate')
    a.setNumberOfTaps(2)
    settled(a, -60)
    chunks(a, -10, a.confirmChunks) // a tap: the capture opens
    expect(a.gatedCaptureActive).toBe(true)
    a.finishGatedFFTCapture(decayingTone(60, 24_000), 48000, 'capturingL')
    const prompt = a.statusMessage
    expect(prompt.startsWith('fL tap 1/2')).toBe(true)
    advanceAudio(a, a.tapCooldown, -20) // the rest ends while it still rings: latched above
    expect(a.isDetecting && detector(a).isAboveThreshold).toBe(true)
    chunks(a, -60, 3) // the ring-out falls: the settle
    expect(detector(a).isAboveThreshold).toBe(false)
    expect(a.statusMessage, 'the settle must leave the plate prompt alone').toBe(prompt)
  })

  it('the settle leaves a guitar prompt alone', () => {
    const a = armed(-40)
    a.setNumberOfTaps(2)
    settled(a)
    chunks(a, -10, a.confirmChunks)
    expect(a.gatedCaptureActive).toBe(true)
    a.finishGuitarGatedCapture(decayingTone(100, GUITAR_FFT_SIZE), 48000)
    const prompt = a.statusMessage
    expect(prompt).toBe('Tap 1/2 captured. Tap again...')
    advanceAudio(a, a.tapCooldown, -20)
    expect(a.isDetecting && detector(a).isAboveThreshold).toBe(true)
    chunks(a, -60, 3)
    expect(detector(a).isAboveThreshold).toBe(false)
    expect(a.statusMessage).toBe(prompt)
  })

  // Arming and resuming (#17 F50 item 13). A new sequence seeds the noise floor from the current input
  // level — here from a chunk, the way the level reaches the analyzer — and -100 when the warm-up is
  // skipped. (The web seeded a fixed -60.)
  it('starting a sequence seeds the noise floor from the input level', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'plate'
    chunks(a, -50, 1) // the current input level
    a.startTapSequence()
    expect(detector(a).noiseFloorEstimate).toBe(-50)

    a.measurementType = 'classical'
    a.startTapSequence({ skipWarmup: true })
    expect(detector(a).noiseFloorEstimate, 'the warm-up skipped (guitar file playback)').toBe(-100)
  })

  // A resume restarts the tap confirmation: one chunk above the threshold before the pause and one after
  // it do not make a tap. Swift and Python kept the count across the pause, so a single loud chunk after a
  // resume could fire one.
  it('a resume restarts the tap confirmation', () => {
    const a = armed(-40)
    settled(a)
    chunks(a, -35, 1) // one chunk counted
    expect(a.gatedCaptureActive).toBe(false)
    a.pauseTapDetection()
    a.resumeTapDetection()
    chunks(a, -35, 1) // one chunk after the resume
    expect(a.gatedCaptureActive, 'one chunk after the resume must not confirm a tap').toBe(false)
    chunks(a, -35, 1)
    expect(a.gatedCaptureActive, 'two chunks do').toBe(true)
  })

  // A new sequence restarts the tap confirmation too: a chunk counted before it cannot help confirm its
  // first tap.
  it('a new sequence restarts the tap confirmation', () => {
    const a = armed(-40)
    settled(a)
    chunks(a, -35, 1) // one chunk counted
    a.startTapSequence()
    // No quiet chunk in between — one would reset the count by itself. (With no engine attached the
    // audio clock the warm-up anchors to stays at 0, so the new warm-up has already run; the same holds
    // for a resume.)
    chunks(a, -35, 1)
    expect(a.gatedCaptureActive, 'one chunk of the new sequence must not confirm a tap').toBe(false)
    chunks(a, -35, 1)
    expect(a.gatedCaptureActive, 'two chunks do').toBe(true)
  })

  it('a resume keeps the noise floor and puts the latch down', () => {
    const a = armed(-40, 'plate')
    latchedAbove(a)
    const floor = detector(a).noiseFloorEstimate
    a.pauseTapDetection()
    a.resumeTapDetection()
    expect(detector(a).noiseFloorEstimate, 'the floor is left as it was').toBe(floor)
    expect(detector(a).isAboveThreshold, 'the latch goes down').toBe(false)
  })

  it('T8: the first chunk after the warm-up syncs the latch and does not fire', () => {
    const a = armed(-40)
    advanceAudio(a, a.warmupPeriod - 0.001) // every chunk still inside the warm-up
    expect(detector(a).justExitedWarmup).toBe(true)
    chunks(a, -30, 1) // the first chunk after it — loud
    expect(detector(a).justExitedWarmup, 'the sync chunk clears the flag').toBe(false)
    expect(detector(a).isAboveThreshold, 'the latch is synced from the level').toBe(true)
    expect(a.gatedCaptureActive, 'the sync chunk does not fire').toBe(false)
  })
})
