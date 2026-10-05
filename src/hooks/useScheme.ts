// @parity none — React's re-render on a palette change; Swift's colours resolve themselves and Python connects its
// own redraw to the palette's signal.
import { useEffect, useState } from 'react'
import { scheme as currentScheme, subscribe } from '../presentation/palette'
import type { Scheme } from '../presentation/appearance'

/** The scheme the app is drawn in; the component re-renders when it changes. */
export function useScheme(): Scheme {
  const [scheme, setScheme] = useState(currentScheme)
  useEffect(() => subscribe(setScheme), [])
  return scheme
}
