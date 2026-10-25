// @parity test/live-frame
/**
 * One contract, three mechanisms: a live FFT frame is announced on the live frame alone.
 *
 * A frame comes several times a second. Whatever announces it is redrawn that often, so only what draws a
 * frame may hear it: announced by the engine or the analyzer — held as React state in the app, as it once
 * was — every frame re-renders everything that listens to them; in Swift's, a menu open in the results
 * snapped back under the user's finger. The values were right all along; only who was told was wrong, so the
 * value tests could not see it.
 *
 * Swift checks `objectWillChange` on each object, Python which signals fire, the web which listeners and
 * callbacks are called. `onAudioFrame` is the engine's per-chunk delivery to the analyzer's detection, not an
 * announcement; it is wired as the app wires it, and every other engine callback is counted.
 *
 * Mirrors: GuitarTapTests/LiveFrameTests.swift · tests/test_live_frame.py
 */
import { describe, it, expect } from 'vitest'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import { TapToneAnalyzer, type CapturedTap } from '../src/state/tapToneAnalyzer'
import { settingsStore } from '../src/settingsStore'
import { GUITAR_FFT_SIZE } from '../src/dsp/guitarFFT'

/** One FFT frame at 48 kHz of a quiet 1 kHz sine: well below any detection threshold. */
function quietFrame(): Float32Array {
  return Float32Array.from({ length: GUITAR_FFT_SIZE }, (_, i) => 0.001 * Math.sin((2 * Math.PI * 1000 * i) / 48000))
}

/** A captured tap: 64 bins at 31.25 Hz, −80 dB but bin 16 at `peakDB` — as the measurement-complete cases. */
function capturedTap(peakDB: number): CapturedTap {
  const magnitudes = new Array<number>(64).fill(-80)
  magnitudes[16] = peakDB
  return { magnitudes, frequencies: Array.from({ length: 64 }, (_, i) => i * 31.25), captureTime: 0 }
}

describe('live frame — a frame is announced on the live frame alone', () => {
  // LF1: a frame, while a completed measurement is on screen, is announced on the live frame and by nothing
  // else. (While a sequence runs, a frame's live peaks are announced on the detected peaks —
  // detected-peaks.test.ts.) Mirrors Swift frame_isAnnouncedOnTheLiveFrameAlone.
  it('announces a frame on the live frame, and nothing else does', async () => {
    settingsStore.update({ measurementType: 'classical' })
    const analyzer = new TapToneAnalyzer()
    const engine = new RealtimeFFTAnalyzer()
    analyzer.setDevice(engine) // the analyzer takes each chunk and each frame
    analyzer.setNumberOfTaps(1)
    analyzer.capturedTaps = [capturedTap(-30)]
    analyzer.processMultipleTaps()
    expect(analyzer.isMeasurementComplete).toBe(true)

    const engineCalls: string[] = []
    engine.onDeviceStateChanged(() => engineCalls.push('deviceState'))
    engine.onInputChanged(() => engineCalls.push('inputChanged'))
    engine.onInputOpenFailed(() => engineCalls.push('inputOpenFailed'))
    engine.onInputAppearsDead(() => engineCalls.push('inputAppearsDead'))
    await new Promise((r) => setTimeout(r, 0))

    let frames = 0
    const stopFrame = engine.frame.onFrame(() => frames++)
    let analyzerNotified = 0
    const stopAnalyzer = analyzer.subscribe(() => analyzerNotified++)

    engine.processRawSamples(quietFrame())
    await new Promise((r) => setTimeout(r, 50))
    stopFrame()
    stopAnalyzer()

    expect(frames, 'the frame must reach the live frame, or the chart stands still').toBeGreaterThan(0)
    expect(engineCalls, 'REGRESSION: the engine announced a change for one frame').toEqual([])
    expect(analyzerNotified, 'REGRESSION: the analyzer announced a change for one frame').toBe(0)
  })
})
