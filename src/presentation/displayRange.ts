// @parity presentation/display-range
//
// The rule for widening the chart's frequency axis so a newly identified peak is visible.
// Mirrors Swift Models/DisplayRange.swift and Python models/display_range.py.

/** Ten percent of the peak's frequency, so the peak is not flush against the axis edge. */
export const PADDING_FRACTION = 0.1

/** The lowest frequency the axis may show. Below 1 Hz there is nothing to draw. */
export const FLOOR_HZ = 1

/**
 * `[minFreq, maxFreq]` widened so `frequency` is inside it, or unchanged if it already was.
 *
 * Only ever widens. A peak near the middle of the range leaves it alone, and a range is never
 * narrowed to fit, because that would hide peaks the user is already looking at.
 *
 * A plate or brace identifies fL / fC / fFLC by scanning a wide band (brace: 100–1200 Hz), and the
 * display range is per-measurement-type and persisted — so the peak a measurement just produced can
 * land off the edge of the chart. Swift has widened the axis since the feature was written; web and
 * Python did neither, so the same measurement showed the peak on one edition and hid it on two.
 * Ported 2026-09-20 (project issue #8).
 */
export function expandedToInclude(
  frequency: number,
  minFreq: number,
  maxFreq: number,
): { minHz: number; maxHz: number } {
  const padding = frequency * PADDING_FRACTION
  let lo = minFreq
  let hi = maxFreq
  if (frequency > hi) hi = frequency + padding
  if (frequency < lo) lo = Math.max(FLOOR_HZ, frequency - padding)
  return { minHz: lo, maxHz: hi }
}
