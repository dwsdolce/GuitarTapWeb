// Constructs the single TapToneAnalyzer (the web's lifecycle-state owner, mirroring Swift/Python
// TapToneAnalyzer) and exposes its immutable snapshot to React via useSyncExternalStore. The audio
// device (RealtimeFFTAnalyzer) and App drive the analyzer through its setters; the
// snapshot re-renders on each notify(). Introduced in 6-TEST 3c-A.
import { useRef, useSyncExternalStore } from 'react'
import { TapToneAnalyzer, type TapToneSnapshot } from '../state/tapToneAnalyzer'

export function useTapToneAnalyzer(): { analyzer: TapToneAnalyzer; snapshot: TapToneSnapshot } {
  const ref = useRef<TapToneAnalyzer | null>(null)
  if (ref.current === null) ref.current = new TapToneAnalyzer()
  const analyzer = ref.current
  // Debug handle — the live analyzer on `window`, for inspecting the model from the browser
  // console:
  //   gt.detectionState · gt.isMeasurementComplete · gt.displayMode · gt.isSettling
  //   gt.getSnapshot()
  // Swift and Python are inspectable in a debugger; web had no equivalent, and the alternative is
  // walking React's fiber tree by hand from a DOM node — which is what it took on 2026-09-22 to
  // find that a service worker was serving a bundle whose analyzer had no `detectionState` field
  // at all. Read-only in practice: nothing in the app reads `window.gt`.
  ;(window as unknown as Record<string, unknown>).gt = analyzer
  const snapshot = useSyncExternalStore(analyzer.subscribe, analyzer.getSnapshot)
  return { analyzer, snapshot }
}