// @parity model/live-frame tests=test/live-frame
import { useEffect, useReducer, type ReactNode } from 'react'
import type { LiveFrame } from '../audio/liveFrame'

/** The views that draw a live frame — the chart, the status bar's readouts, the Metrics panel — built inside
 *  this reader, which alone subscribes to the frame: a frame re-renders what it wraps and nothing around it.
 *  Mirrors Swift `FrameReader`. */
export function FrameReader({ frame, children }: { frame: LiveFrame; children: (frame: LiveFrame) => ReactNode }) {
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  useEffect(() => frame.onFrame(redraw), [frame])
  return <>{children(frame)}</>
}
