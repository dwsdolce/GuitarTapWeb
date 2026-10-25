// @parity model/detected-peaks tests=test/detected-peaks
import { useSyncExternalStore, type ReactNode } from 'react'
import type { DetectedPeaks } from '../state/detectedPeaks'

/** The views that show the detected peaks — the chart's markers, the Results list, the controls that need
 *  peaks — built inside this reader, which alone subscribes to them: new peaks re-render what it wraps and
 *  nothing around it. Mirrors Swift `PeaksReader`. */
export function PeaksReader({ peaks, children }: { peaks: DetectedPeaks; children: (peaks: DetectedPeaks) => ReactNode }) {
  useSyncExternalStore(peaks.subscribe, peaks.getVersion)
  return <>{children(peaks)}</>
}
