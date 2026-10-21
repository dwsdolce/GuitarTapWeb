// @parity model/live-frame tests=test/live-frame
import type { Spectrum } from '../dsp/guitarFFT'

/**
 * The latest live FFT frame — its spectrum, peak, readout level and processing times — owned by the
 * {@link RealtimeFFTAnalyzer} as `frame` and announced once per frame, several times a second.
 *
 * It is an object of its own so that only what draws a frame hears of it — the chart, the status bar's
 * readouts, the Metrics panel — and the analyzer, which takes each frame from it: held as React state in the
 * app, every frame would re-render the whole app. Mirrors Swift `LiveFrame` (Models/LiveFrame.swift) and
 * Python `LiveFrame` (models/live_frame.py).
 */
export class LiveFrame {
  /** The frame's spectrum, at the engine's bins; null before the first frame. Swift `magnitudes`. */
  spectrum: Spectrum | null = null
  /** The loudest bin's frequency (Hz) and magnitude (dB) — Swift `peakFrequency` / `peakMagnitude`.
   *  0 Hz, −100 dB before the first frame; a silent input is −∞ dB @ 0 Hz. */
  peakFrequency = 0
  peakMagnitude = -100
  /** The input level as a readout, at the frame rate — Swift `displayLevelDB`. True digital silence is
   *  −∞; every other consumer of the level gets −100. */
  displayLevelDB = -100
  /** Time taken to process the frame, and its average over the last 30 frames, in ms. Swift
   *  `processingTimeMs` / `avgProcessingTimeMs`. */
  processingMs = 0
  avgProcessingMs = 0

  private readonly listeners = new Set<() => void>()

  /** Announce a new frame: its values are this object's. Swift `objectWillChange`; set by the engine. */
  publish(): void {
    for (const l of this.listeners) l()
  }

  /** Observe each frame — Python `frameChanged`. Returns the unsubscribe. */
  onFrame(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
