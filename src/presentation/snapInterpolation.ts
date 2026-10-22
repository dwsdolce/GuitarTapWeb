// @parity view/spectrum-chart tests=test/snap-interpolation
// The crosshair's snap to a curve. Mirrors Swift's SpectrumView+SnapInterpolation.swift.
//
// When a result is held, or plate / brace phases or a comparison are shown, the crosshair reads a curve rather than
// the pointer: the curve's magnitude at the pointer's frequency, interpolated between the two bins either side
// (snapToWaveform). With several curves it follows the one nearest the pointer on screen, and keeps it until another
// is at least CURVE_GRAVITY_PX nearer (lockedSeries), so it does not flicker between curves close together.

/** How much nearer on screen another curve must be before the crosshair leaves the one it follows (Swift's
 *  curveGravityThreshold, in points; here in CSS pixels). */
export const CURVE_GRAVITY_PX = 12

/** The point on a curve at `targetHz`: frequency and magnitude interpolated linearly between the two bins either
 *  side of it (past an end, along the last two bins). `frequencies` ascending; null when the arrays are empty or of
 *  different lengths. Mirrors Swift `snapToWaveform(targetHz:magnitudes:frequencies:)`. */
export function snapToWaveform(
  targetHz: number,
  magnitudes: ArrayLike<number>,
  frequencies: ArrayLike<number>,
): { frequency: number; magnitude: number } | null {
  const n = frequencies.length
  if (n === 0 || magnitudes.length !== n) return null
  // The first bin at or above the target (the last when none is), then the nearer of it and the bin before.
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (frequencies[mid]! < targetHz) lo = mid + 1
    else hi = mid
  }
  const near = lo > 0 && Math.abs(frequencies[lo - 1]! - targetHz) < Math.abs(frequencies[lo]! - targetHz) ? lo - 1 : lo
  // The bins either side of the target.
  let left: number
  let right: number
  if (near < n - 1 && frequencies[near]! <= targetHz) {
    left = near
    right = near + 1
  } else if (near > 0) {
    left = near - 1
    right = near
  } else {
    return { frequency: frequencies[near]!, magnitude: magnitudes[near]! }
  }
  const span = frequencies[right]! - frequencies[left]!
  if (!(span > 0)) return { frequency: frequencies[near]!, magnitude: magnitudes[near]! }
  const t = (targetHz - frequencies[left]!) / span
  return {
    frequency: frequencies[left]! + t * span,
    magnitude: magnitudes[left]! + t * (magnitudes[right]! - magnitudes[left]!),
  }
}

/** The curve the crosshair follows, from each curve's index and on-screen distance to the pointer: the nearest,
 *  unless the one it follows (`lockedIndex`) is within CURVE_GRAVITY_PX of it. The first of equally near curves.
 *  Mirrors Swift `lockedSeries(candidates:lockedIndex:)`. */
export function lockedSeries(candidates: ReadonlyArray<{ index: number; dist: number }>, lockedIndex: number): number {
  if (candidates.length === 0) return lockedIndex
  let best = candidates[0]!
  for (const c of candidates) if (c.dist < best.dist) best = c
  if (best.index === lockedIndex) return lockedIndex
  const locked = candidates.find((c) => c.index === lockedIndex)
  if (locked && locked.dist - best.dist < CURVE_GRAVITY_PX) return lockedIndex
  return best.index
}

/** The curve to follow among `series`: each curve's snapped point at `targetHz` is placed on screen by `screenY` and
 *  measured from `cursorY`; then lockedSeries. -1 when there are no curves. Mirrors Swift `nearestSeriesIndex`. */
export function nearestSeriesIndex(
  targetHz: number,
  cursorY: number,
  screenY: (magnitude: number) => number,
  series: ReadonlyArray<{ magnitudes: ArrayLike<number>; frequencies: ArrayLike<number> }>,
  lockedIndex: number,
): number {
  if (series.length === 0) return -1
  const candidates: { index: number; dist: number }[] = []
  series.forEach((s, index) => {
    const snapped = snapToWaveform(targetHz, s.magnitudes, s.frequencies)
    if (snapped) candidates.push({ index, dist: Math.abs(screenY(snapped.magnitude) - cursorY) })
  })
  return lockedSeries(candidates, lockedIndex)
}
