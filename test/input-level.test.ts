// @parity test/input-level
/**
 * One contract, three mechanisms: an audio buffer's level is announced on the input level alone.
 *
 * The level changes on every buffer, many times a second. Whatever announces it is redrawn that often,
 * so only the threshold meter may hear it: announced by the engine or the analyzer — held as React state
 * in the app, as it once was — every buffer re-renders everything that listens to them. The values were
 * right all along; only who was told was wrong, so the value tests could not see it.
 *
 * Swift checks `objectWillChange` on each object, Python which signals fire, the web which listeners and
 * callbacks are called. `onAudioFrame` is the engine's per-chunk delivery to the analyzer's detection —
 * Swift's `rmsLevelHandler`, Python's private per-chunk signal — not an announcement; it is wired as the
 * app wires it, and every other engine callback is counted.
 *
 * Mirrors: GuitarTapTests/InputLevelTests.swift · tests/test_input_level.py
 */
import { describe, it, expect } from 'vitest'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { settingsStore } from '../src/settingsStore'

/** One 0.1 s buffer at 48 kHz of a quiet 1 kHz sine: well below any detection threshold, and far
 *  short of an FFT frame (65 536 samples). */
function quietBuffer(): Float32Array {
  return Float32Array.from({ length: 4800 }, (_, i) => 0.001 * Math.sin((2 * Math.PI * 1000 * i) / 48000))
}

describe('input level — a buffer is announced on the input level alone', () => {
  // IL1: a buffer, while the analyzer listens for a tap, is announced on the input level and by nothing
  // else. Mirrors Swift buffer_isAnnouncedOnTheInputLevelAlone.
  it('announces a buffer on the input level, and nothing else does', async () => {
    const analyzer = new TapToneAnalyzer()
    settingsStore.update({ measurementType: 'generic' })
    const engineCalls: string[] = []
    const engine = new RealtimeFFTAnalyzer()
    analyzer.setDevice(engine) // the analyzer takes each chunk
    // Every other event the engine announces, recorded by name.
    engine.frame.onFrame(() => engineCalls.push('frame'))
    engine.onDeviceStateChanged(() => engineCalls.push('deviceState'))
    engine.onInputChanged(() => engineCalls.push('inputChanged'))
    engine.onInputOpenFailed(() => engineCalls.push('inputOpenFailed'))
    engine.onInputAppearsDead(() => engineCalls.push('inputAppearsDead'))
    analyzer.startTapSequence({ skipWarmup: true })
    await new Promise((r) => setTimeout(r, 0))
    engineCalls.length = 0

    let level = 0
    const stopLevel = engine.level.onInputLevel(() => level++)
    let analyzerNotified = 0
    const stopAnalyzer = analyzer.subscribe(() => analyzerNotified++)

    engine.processRawSamples(quietBuffer())
    await new Promise((r) => setTimeout(r, 50))
    stopLevel()
    stopAnalyzer()

    expect(level, "the buffer's level must reach the input level, or the meter stands still").toBeGreaterThan(0)
    expect(engineCalls, 'REGRESSION: the engine announced a change for one buffer').toEqual([])
    expect(analyzerNotified, 'REGRESSION: the analyzer announced a change for one buffer').toBe(0)
  })
})
