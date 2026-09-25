// @parity test/audio-clock-timers
//
// The tap lifecycle's delays run on the AUDIO clock, not the wall clock (#19). File playback advances
// audio at "real time + processing time", so a wall-clock delay covered a different stretch of audio
// on a slower run and late captures in a sequence moved.
//
// Each case here advances only audio — through `processAudioFrame`, the path audio takes — and no
// wall time to speak of, so a delay that went back to the wall clock would not have fired and the case
// fails. The guitar rest (T1) and the capture window (T5) are pinned by the scenario traces'
// midCooldown / postReArm / postProcess rows; this file pins what nothing else did.
//
// The ring-out stop (T7) is pinned in decay-tracking.test.ts: the web tracks the ring-out in the
// engine's DecayTracker, where the natives track it on the analyzer.
//
// Paired with Swift GuitarTapTests/AudioClockTimerTests.swift and Python tests/test_audio_clock_timers.py.
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import { GUITAR_FFT_SIZE } from '../src/dsp/guitarFFT'
import { advanceAudio, AUDIO_FEED_CHUNK_SECONDS } from './audioClockFeed'

/** A decaying tone — a tap's ring-out. */
function tapSamples(hz: number, count: number): Float32Array {
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = 0.5 * Math.exp((-i / 48000) * 6) * Math.sin((2 * Math.PI * hz * i) / 48000)
  return out
}

/** Feed real audio chunk by chunk through the production entry point, with each chunk's own level. */
function feed(a: TapToneAnalyzer, samples: Float32Array, until: () => boolean): void {
  for (let i = 0; i < samples.length && !until(); i += 1024) {
    const chunk = samples.subarray(i, Math.min(i + 1024, samples.length))
    let sumSq = 0
    for (let k = 0; k < chunk.length; k++) sumSq += chunk[k]! * chunk[k]!
    const rms = Math.sqrt(sumSq / chunk.length)
    a.processAudioFrame(chunk, rms > 0 ? 20 * Math.log10(rms) : -100, a.lastAudioTime + AUDIO_FEED_CHUNK_SECONDS)
  }
}

describe('the tap lifecycle runs on the audio clock (#19)', () => {
  // T2: between taps of one plate/brace phase, detection rests `tapCooldown` of audio. The tap is a
  // real one, detected from the audio and captured through the real path.
  it('the plate/brace rest between taps runs on the audio clock', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'plate'
    a.setNumberOfTaps(2)
    a.startTapSequence()
    advanceAudio(a, a.warmupPeriod + 0.1, -100) // the warm-up, on quiet audio
    feed(a, tapSamples(60, 48_000), () => a.currentTapCount === 1)
    expect(a.currentTapCount, 'the tap was detected and captured').toBe(1)
    expect(a.materialTapPhase, '1 of 2 taps — the phase is not done').toBe('capturingL')
    expect(a.isDetecting, 'resting after the tap').toBe(false)

    advanceAudio(a, a.tapCooldown / 2)
    expect(a.isDetecting, 'halfway through the rest, in audio').toBe(false)

    advanceAudio(a, a.tapCooldown / 2)
    expect(a.isDetecting, "re-armed once the rest's audio has passed").toBe(true)
  })

  // T3: after C is accepted, the FLC phase arms `tapCooldown` of audio later — anchored on the chunk
  // that made the hold due.
  it('the FLC hold runs on the audio clock', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'plate'
    a.measureFlc = true
    a.setNumberOfTaps(1)
    a.startTapSequence()
    // Both taps captured through the real finish, which turns detection off for the review.
    a.finishGatedFFTCapture(tapSamples(60, 24_000), 48000, 'capturingL')
    a.acceptMaterial() // reviewingL -> capturingC
    a.finishGatedFFTCapture(tapSamples(150, 24_000), 48000, 'capturingC')
    expect(a.materialTapPhase).toBe('reviewingC')

    a.acceptMaterial()
    expect(a.materialTapPhase).toBe('waitingForFlcTap')

    advanceAudio(a, a.tapCooldown / 2)
    expect(a.materialTapPhase, 'halfway through the hold, in audio').toBe('waitingForFlcTap')
    expect(a.isDetecting).toBe(false)

    advanceAudio(a, a.tapCooldown / 2)
    expect(a.materialTapPhase).toBe('capturingFlc')
    expect(a.isDetecting).toBe(true)
    expect(
      (a as unknown as { warmupStartAudioTime: number }).warmupStartAudioTime,
      'the FLC warm-up starts at the audio time of the chunk that ended the hold',
    ).toBe(a.lastAudioTime)
  })

  // A detected tap turns detection off first, and it stays off through the capture — the rest (T2)
  // then starts from the state the natives have always had. The tap is detected from fed audio.
  it('a detected tap turns detection off', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'plate'
    a.setNumberOfTaps(2)
    a.startTapSequence()
    advanceAudio(a, a.warmupPeriod + 0.1) // the warm-up, on quiet audio
    expect(a.isDetecting).toBe(true)
    advanceAudio(a, 2 * AUDIO_FEED_CHUNK_SECONDS, -10) // a tap: two loud chunks
    expect(a.isDetecting, 'detection is off once the tap is detected').toBe(false)
  })

  // T6: a capture the audio stops filling is closed on the WALL clock — it exists for when the audio
  // stops, and then the audio clock stops too. After it, detection rests and re-arms as usual.
  it('the safety timeout closes a capture the audio stopped filling', async () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'plate'
    a.setNumberOfTaps(1)
    a.startTapSequence()
    advanceAudio(a, a.warmupPeriod + 0.1)
    advanceAudio(a, 2 * AUDIO_FEED_CHUNK_SECONDS, -10) // a tap opens the capture...
    expect(a.gatedCaptureActive).toBe(true)
    // ...and then no more audio arrives.
    await new Promise((r) => setTimeout(r, 2300))
    expect(a.gatedCaptureActive, 'closed by the wall-clock safety timeout').toBe(false)

    advanceAudio(a, a.tapCooldown)
    expect(a.isDetecting, 'and detection rests, then re-arms, as after any capture').toBe(true)
  })

  // T6 measures SILENCE, not time since the capture started: while audio keeps arriving — however
  // slowly, as under throttled playback — it does not fire (#19).
  it('the safety timeout does not fire while audio keeps arriving', async () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'plate'
    a.setNumberOfTaps(1)
    a.startTapSequence()
    advanceAudio(a, a.warmupPeriod + 0.1)
    advanceAudio(a, 2 * AUDIO_FEED_CHUNK_SECONDS, -10) // a tap opens the capture
    expect(a.gatedCaptureActive).toBe(true)
    // Slow audio: one quiet chunk every 0.4 s of wall time, for 2.8 s — longer than the 2 s timeout.
    // (Each chunk's samples also fill the capture; 7 chunks cannot fill a 0.5 s window.)
    for (let k = 0; k < 7; k++) {
      await new Promise((r) => setTimeout(r, 400))
      advanceAudio(a, AUDIO_FEED_CHUNK_SECONDS)
    }
    expect(a.gatedCaptureActive, 'audio kept arriving, so the capture is still open').toBe(true)
  })

  // File playback's auto-advance: when a phase completes while a file plays, the next phase is
  // listening at once, the latch ABOVE so the last tap's ring-out must fall before anything counts;
  // the warm-up is not restarted.
  it("file playback's auto-advance arms the next phase at once, latched above", () => {
    const a = new TapToneAnalyzer()
    const engine = new RealtimeFFTAnalyzer()
    engine.playingFile = true
    a.setDevice(engine)
    a.measurementType = 'plate'
    a.setNumberOfTaps(1)
    a.startTapSequence()
    const internal = a as unknown as { warmupStartAudioTime: number | null; isAboveThreshold: boolean }
    const warmupAnchor = internal.warmupStartAudioTime
    a.finishGatedFFTCapture(tapSamples(60, 24_000), 48000, 'capturingL')

    expect(a.materialTapPhase, 'L done — auto-advanced to C').toBe('capturingC')
    expect(a.isDetecting, 'listening at once').toBe(true)
    expect(internal.isAboveThreshold, 'latched above: the ring-out must fall first').toBe(true)
    expect(internal.warmupStartAudioTime, 'the warm-up is not restarted').toBe(warmupAnchor)
  })

  // Web only — the natives pace file playback with a sleep under a timing activity, which a unit
  // test cannot reach. The web paces from the AUDIO clock: each chunk the worklet renders lets one
  // more file chunk through, so a throttled hidden tab still plays at real time (#19).
  it('file playback is paced by the audio the device renders, not by a timer', async () => {
    const played: number[] = []
    const engine = new RealtimeFFTAnalyzer({ onAudioFrame: () => played.push(1) })
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

  // File end: the capture window is released at once, so a measurement whose last capture ends with
  // the file still completes — the audio clock stops with the file.
  it('file end releases the pending capture window', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'classical'
    a.numberOfTaps = 1
    a.startTapSequence()
    a.finishGuitarGatedCapture(tapSamples(100, GUITAR_FFT_SIZE), 48000)
    expect(a.isMeasurementComplete, 'the capture window is pending').toBe(false)

    a.flushGatedCaptureOnFileEnd()
    expect(a.isMeasurementComplete, 'released at file end, with no further audio').toBe(true)
  })

  // File end does NOT release a rest: with no audio there is nothing to detect, so the re-arm waits
  // for audio like any other.
  it('file end does not release a pending rest', () => {
    const a = new TapToneAnalyzer()
    a.measurementType = 'classical'
    a.numberOfTaps = 2
    a.startTapSequence()
    a.finishGuitarGatedCapture(tapSamples(100, GUITAR_FFT_SIZE), 48000)

    a.flushGatedCaptureOnFileEnd()
    expect(a.isDetecting, 'file end left the rest pending').toBe(false)

    advanceAudio(a, a.tapCooldown)
    expect(a.isDetecting, 'the rest still ends when its audio has passed').toBe(true)
  })
})
