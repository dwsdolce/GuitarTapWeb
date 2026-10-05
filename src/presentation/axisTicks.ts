// @parity view/axis-ticks tests=test/axis-ticks
//
// The spectrum chart's axis ticks — which are also its grid lines, one per tick, no minor lines — and their labels.
// Mirrors Swift `AxisTickGenerator`.

import { formatFixed } from '../precision'

/**
 * Tick positions for [min, max] by the nice-number algorithm: the spacing is the rough spacing
 * range / (maxTicks − 1) rounded up to {1, 2, 5} × 10ⁿ, and the bounds are extended outward to multiples of it.
 * Mirrors Swift `AxisTickGenerator.generateTicks`.
 */
export function generateTicks(min: number, max: number, maxTicks = 10): number[] {
  if (!(min < max)) return [min]
  const spacing = niceNumber((max - min) / (maxTicks - 1), false)
  const niceMin = Math.floor(min / spacing) * spacing
  const niceMax = Math.ceil(max / spacing) * spacing
  const ticks: number[] = []
  for (let tick = niceMin; tick <= niceMax + spacing * 0.01; tick += spacing) ticks.push(tick)
  return ticks
}

function niceNumber(x: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(x))
  const fraction = x / Math.pow(10, exponent)
  const nice = round
    ? fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10
    : fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return nice * Math.pow(10, exponent)
}

/**
 * The screen's frequency labels: whole Hz below 1 kHz, kHz above, with more decimals until every label is
 * different. Mirrors Swift `AxisTickGenerator.formatTickLabels`.
 */
export function formatTickLabels(values: number[]): Map<number, string> {
  for (let extra = 0; extra <= 3; extra++) {
    const labels = new Map(values.map((v) => [v, frequencyLabel(v, 1 + extra)] as const))
    if (new Set(labels.values()).size === labels.size) return labels
  }
  return new Map(values.map((v) => [v, `${formatFixed(v, 1)} Hz`] as const))
}

function frequencyLabel(value: number, kHzDecimals: number): string {
  return value >= 1000 ? `${formatFixed(value / 1000, kHzDecimals)} kHz` : `${formatFixed(value, 0)} Hz`
}

/** The exported image's compact frequency label. Mirrors Swift `AxisTickGenerator.formatTickLabel`. */
export function formatTickLabel(value: number): string {
  const magnitude = Math.abs(value)
  if (magnitude === 0) return '0'
  if (magnitude >= 1000) return `${formatFixed(value / 1000, 1)}k`
  if (magnitude >= 10) return formatFixed(value, 0)
  if (magnitude >= 0.1) return formatFixed(value, 1)
  return formatFixed(value, 2)
}

/**
 * The screen's magnitude tick spacing (dB) for a visible range of `range` dB: the smallest of 1, 2, 5, 10, 20 and
 * 50 giving at most 8 ticks. Mirrors Swift `AxisTickGenerator.magnitudeStride`.
 */
export function magnitudeStride(range: number): number {
  for (const stride of [1, 2, 5, 10, 20, 50]) if (range / stride <= 8) return stride
  return 50
}
