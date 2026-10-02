// @parity presentation/display-range
//
// The rule for widening the chart's frequency axis so a newly identified peak is visible.
// Mirrors Swift Models/DisplayRange.swift and Python models/display_range.py.

import { isGuitarType, type MeasurementType } from '../settings'
import type { ChartView } from './chartTypes'
import { FieldPrecision } from '../precision'
import { MIN_FREQUENCY_HZ, MAX_FREQUENCY_HZ } from './chartLimits'

/** Ten percent of the peak's frequency, so the peak is not flush against the axis edge. */
export const PADDING_FRACTION = 0.1

/** The lowest frequency the axis may show. */
export const FLOOR_HZ = MIN_FREQUENCY_HZ

/**
 * `[minFreq, maxFreq]` widened so `frequency` is inside it, or unchanged if it already was.
 *
 * Only ever widens. A peak near the middle of the range leaves it alone, and a range is never
 * narrowed to fit, because that would hide peaks the user is already looking at.
 *
 * A plate or brace identifies fL / fC / fFLC by scanning a wide band (brace: 100–1200 Hz), and the
 * display range is per-measurement-type and persisted — so the peak a measurement just produced can
 * land off the edge of the chart.
 */
export function expandedToInclude(
  frequency: number,
  minFreq: number,
  maxFreq: number,
): { minHz: number; maxHz: number } {
  const padding = frequency * PADDING_FRACTION
  let lo = minFreq
  let hi = maxFreq
  if (frequency > hi) hi = Math.min(MAX_FREQUENCY_HZ, frequency + padding)
  if (frequency < lo) lo = Math.max(FLOOR_HZ, frequency - padding)
  return { minHz: lo, maxHz: hi }
}

/**
 * The chart range to show once a peak at `frequency` is identified: for a plate or brace, widened
 * onto it (`expandedToInclude`); unchanged for a guitar — a guitar's range is the user's analysis
 * window and is not widened for them — and for a peak restored by a load, which shows the range it
 * was saved with. Mirrors Swift `DisplayRange.widened(onto:for:fromLoad:min:max:)`.
 */
export function widenedOnto(
  frequency: number,
  type: MeasurementType,
  fromLoad: boolean,
  minFreq: number,
  maxFreq: number,
): { minHz: number; maxHz: number } {
  if (isGuitarType(type) || fromLoad) return { minHz: minFreq, maxHz: maxFreq }
  return expandedToInclude(frequency, minFreq, maxFreq)
}

// ── When the chart's range moves ──────────────────────────────────────────────
// The chart's range is each measurement type's saved view to start with, and moves only when the
// user moves it, when the app must show something (a loaded measurement's range; a newly identified
// plate or brace peak), or on a measurement-type switch. These are the decisions the view applies.
// A ChartView is the chart's four bounds — Swift DisplayRange.ChartRange.

const sameRange = (a: ChartView, b: ChartView) =>
  a.minHz === b.minHz && a.maxHz === b.maxHz && a.minDb === b.minDb && a.maxDb === b.maxDb

/** The chart range when the saved range or the measurement type changes (Settings' Done): the saved
 *  range if it changed or the type did (the chart moves to that type's saved view); null — the chart
 *  stays where it is — otherwise. Mirrors Swift `DisplayRange.onSettingsDone`. */
export function onSettingsDone(saved: ChartView, previouslySaved: ChartView, typeChanged: boolean): ChartView | null {
  return typeChanged || !sameRange(saved, previouslySaved) ? saved : null
}

/** The chart range when a new measurement starts (New Tap, Play File): the saved range if the chart is
 *  still showing a loaded measurement's range (`loaded`, as widened) — the user has not moved it since
 *  the load; null — the chart stays where it is — otherwise. Mirrors Swift `DisplayRange.onNewMeasurement`. */
export function onNewMeasurement(current: ChartView, loaded: ChartView | null, saved: ChartView): ChartView | null {
  return loaded !== null && sameRange(current, loaded) ? saved : null
}

/** The loaded range to remember after the chart widens onto a peak: the widened range if the chart was
 *  showing the loaded range (widening is the app, not the user); unchanged otherwise. Mirrors Swift
 *  `DisplayRange.loadedAfterWidening`. */
export function loadedAfterWidening(loaded: ChartView | null, before: ChartView, after: ChartView): ChartView | null {
  return loaded !== null && sameRange(before, loaded) ? after : loaded
}

/** The value of a Settings range field when Done is pressed: the stored value, exactly, if the field
 *  still shows it (`text` is its display at `decimals`) — an untouched field never rounds what was
 *  saved; otherwise the number typed, or null if it is not a number. Mirrors Swift
 *  `DisplayRange.enteredValue`. */
export function enteredValue(text: string, stored: number, decimals: number): number | null {
  if (text === FieldPrecision.string(stored, decimals)) return stored
  const n = Number(text)
  return text.trim() === '' || Number.isNaN(n) ? null : n
}

/** The indices `[lo, hi)` of the spectrum points to draw for `[minHz, maxHz]` (`frequencies` ascending):
 *  every point inside it plus the one just beyond each edge, so the segments that cross an edge are drawn
 *  and the plot area clips them — the line reaches both edges. Mirrors Swift `DisplayRange.drawnIndices`. */
export function drawnIndices(frequencies: ArrayLike<number>, minHz: number, maxHz: number): [number, number] {
  const n = frequencies.length
  let firstInside = n
  for (let i = 0; i < n; i++) if (frequencies[i]! >= minHz) { firstInside = i; break }
  let firstBeyond = n
  for (let i = 0; i < n; i++) if (frequencies[i]! > maxHz) { firstBeyond = i; break }
  const lo = Math.max(0, firstInside - 1)
  const hi = Math.min(n, firstBeyond + 1)
  return lo < hi ? [lo, hi] : [lo, lo]
}

/** One zoom step of an axis about `anchor` (`scale` > 1 zooms in), kept within `[lower, upper]`: the
 *  new `[lo, hi]`, or null — the step is refused — if it would leave the range narrower than `minSpan`.
 *  Mirrors Swift `applyFrequencyZoom` / `applyMagnitudeZoom`. */
export function zoomedRange(
  lo: number,
  hi: number,
  anchor: number,
  scale: number,
  lower: number,
  upper: number,
  minSpan: number,
): [number, number] | null {
  const newLo = Math.max(lower, anchor - (anchor - lo) / scale)
  const newHi = Math.min(upper, anchor + (hi - anchor) / scale)
  return newHi - newLo >= minSpan ? [newLo, newHi] : null
}

