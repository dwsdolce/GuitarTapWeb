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
  const snapshot = useSyncExternalStore(analyzer.subscribe, analyzer.getSnapshot)
  return { analyzer, snapshot }
}