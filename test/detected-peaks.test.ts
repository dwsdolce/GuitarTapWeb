// @parity test/detected-peaks
/**
 * One contract, three mechanisms: the detected peaks are announced on the detected peaks alone.
 *
 * While a sequence waits for a tap, every live frame finds the peaks again. Whatever announces them is redrawn
 * at the frame rate, so only what shows peaks may hear it: announced by the analyzer, every frame re-renders
 * everything that listens to it; in Swift's, the whole main window, and on iOS a menu open anywhere in it lost
 * the item under the user's finger. The peaks were right all along; only who was told was wrong, so the value
 * tests could not see it.
 *
 * Swift checks `objectWillChange` on each object, Python which signals fire, the web which listeners are called.
 *
 * Mirrors: GuitarTapTests/DetectedPeaksTests.swift · tests/test_detected_peaks.py
 */
import { describe, it, expect } from 'vitest'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { settingsStore } from '../src/settingsStore'

/** One clear peak at bin 200 (about 146 Hz at 0.732 Hz a bin), falling 2 dB a bin from −30 dB. */
function spectrumWithPeak(): { magnitudes: number[]; frequencies: number[] } {
  const frequencies = Array.from({ length: 4096 }, (_, i) => i * 0.732)
  const magnitudes = frequencies.map((_, i) => -30 - 2 * Math.abs(i - 200))
  return { magnitudes, frequencies }
}

/** An analyzer waiting for a tap on a running engine, the way a live frame finds it. */
function waitingForATap(): TapToneAnalyzer {
  settingsStore.update({ measurementType: 'classical' })
  const analyzer = new TapToneAnalyzer()
  const engine = new RealtimeFFTAnalyzer()
  engine.initForTesting() // a frame comes only from the running engine
  analyzer.setDevice(engine)
  analyzer.setNumberOfTaps(1)
  analyzer.startTapSequence({ skipWarmup: true })
  return analyzer
}

describe('detected peaks — a frame\'s peaks are announced on the detected peaks alone', () => {
  // DP1: while waiting for a tap, a frame's peaks are announced on the detected peaks, and the analyzer
  // announces nothing. Mirrors Swift livePeaks_areAnnouncedOnTheDetectedPeaksAlone.
  it('announces live peaks on the detected peaks, and the analyzer does not', () => {
    const analyzer = waitingForATap()
    expect(analyzer.isDetecting).toBe(true)

    let peaksNotified = 0
    const stopPeaks = analyzer.detectedPeaks.subscribe(() => peaksNotified++)
    let analyzerNotified = 0
    const stopAnalyzer = analyzer.subscribe(() => analyzerNotified++)

    const { magnitudes, frequencies } = spectrumWithPeak()
    for (let i = 0; i < 3; i++) analyzer.analyzeMagnitudes(magnitudes, frequencies)
    stopPeaks()
    stopAnalyzer()

    expect(analyzer.peaks.length, 'the frame must find its peak, or the test proves nothing').toBeGreaterThan(0)
    expect(peaksNotified, 'the peaks must reach the detected peaks, or the chart and Results stand still').toBeGreaterThan(0)
    expect(analyzerNotified, "REGRESSION: the analyzer announced a change for a frame's peaks").toBe(0)
  })

  // DP2: a frame with no peaks, while waiting for a tap, is not announced by the analyzer either. Mirrors Swift
  // noPeaks_areNotAnnouncedByTheAnalyzer.
  it('does not announce a frame with no peaks on the analyzer', () => {
    const analyzer = waitingForATap()
    let analyzerNotified = 0
    const stop = analyzer.subscribe(() => analyzerNotified++)

    const frequencies = Array.from({ length: 4096 }, (_, i) => i * 0.732)
    const magnitudes = frequencies.map(() => -100)
    for (let i = 0; i < 3; i++) analyzer.analyzeMagnitudes(magnitudes, frequencies)
    stop()

    expect(analyzerNotified, 'REGRESSION: the analyzer announced a change for a frame with no peaks').toBe(0)
  })
})
