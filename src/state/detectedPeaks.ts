// @parity model/detected-peaks tests=test/detected-peaks
import type { ResolvedMode } from '../dsp/classify'
import type { ResonantPeak } from '../measurement/types'
import type { Uuid } from '../measurement/newId'

/**
 * The detected peaks — all of them, their Peak Min projection, their modes and which are selected — owned by the
 * {@link TapToneAnalyzer} as `detectedPeaks`, which reads and writes them through its own `peaks`,
 * `peaksAbovePeakMin`, `modeByPeak` and `selectedPeakIds`.
 *
 * While a sequence waits for a tap they are found again on every live frame, several times a second; once a
 * measurement completes they are its peaks. They are an object of their own so that only what shows peaks hears
 * of them — the chart's markers and labels, the Results list, the controls that need peaks — through
 * `PeaksReader`: announced by the analyzer, every frame would re-render the whole app. Mirrors Swift
 * `DetectedPeaks` (Models/DetectedPeaks.swift, the analyzer's `peaks`) and Python `DetectedPeaks`
 * (models/detected_peaks.py).
 */
export class DetectedPeaks {
  /** Every peak found, down to the detection floor, regardless of Peak Min. Swift `allPeaks`. */
  peaks: ResonantPeak[] = []
  /** `peaks` with Peak Min applied — set by the analyzer, which owns Peak Min. Swift `peaksAbovePeakMin`. */
  peaksAbovePeakMin: ResonantPeak[] = []
  /** Each peak's classified mode, keyed by peak id. Swift `identifiedModes`. */
  modeByPeak: Map<Uuid, ResolvedMode> = new Map()
  /** The peaks the user has marked as significant. Swift `selectedPeakIDs`. */
  selectedPeakIds: Set<Uuid> = new Set()

  private version = 0
  private readonly listeners = new Set<() => void>()

  /** Observe the peaks — Swift's `objectWillChange`, Python's `peaksChanged`. Returns the unsubscribe. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** A number that changes whenever the peaks are announced — the snapshot for `useSyncExternalStore`. */
  getVersion = (): number => this.version

  /** Announce that the peaks changed. */
  notify(): void {
    this.version += 1
    this.listeners.forEach((l) => l())
  }
}
