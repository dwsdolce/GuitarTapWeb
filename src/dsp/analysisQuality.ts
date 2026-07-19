// Guitar tap-tone analysis quality helpers — a direct port of Swift's
// Float.decayQuality(for:)/decayQualityColor(for:) and tapToneRatioQuality /
// tapToneRatioQualityColor (GuitarTap/Views/Utilities/Extensions.swift) plus the
// per-type decay thresholds (GuitarType.decayThresholds) and the tapToneRatio
// computation (TapToneMeasurement.tapToneRatio). Used by the PDF report's guitar
// analysis section so the qualitative labels/colors match the native apps exactly.
// @parity dsp/analysis-quality tests=test/analysis-quality

import type { GuitarTypeName } from './guitarModes'
import { classifyAll, type ResolvedMode } from './classify'
import type { Peak } from './peaks'

interface DecayThresholds {
  veryShort: number
  short: number
  moderate: number
  good: number
}

/** Ring-out thresholds (seconds) per guitar type — Swift GuitarType.decayThresholds. */
const DECAY_THRESHOLDS: Record<GuitarTypeName, DecayThresholds> = {
  classical: { veryShort: 0.15, short: 0.35, moderate: 0.6, good: 1.0 },
  flamenco: { veryShort: 0.08, short: 0.2, moderate: 0.35, good: 0.55 },
  acoustic: { veryShort: 0.1, short: 0.25, moderate: 0.45, good: 0.75 },
  generic: { veryShort: 0.1, short: 0.25, moderate: 0.45, good: 0.75 },
}

/** Qualitative ring-out label for a decay time (seconds), per guitar type. */
export function decayQuality(decay: number, type: GuitarTypeName): string {
  const t = DECAY_THRESHOLDS[type]
  if (decay < t.veryShort) return 'Very Short'
  if (decay < t.short) return 'Short'
  if (decay < t.moderate) return 'Moderate'
  if (decay < t.good) return 'Good'
  return 'Excellent'
}

/** Color for the ring-out quality (gray → orange → yellow → green → blue). */
export function decayQualityColor(decay: number, type: GuitarTypeName): string {
  const t = DECAY_THRESHOLDS[type]
  if (decay < t.veryShort) return '#8a8a8e'
  if (decay < t.short) return '#e08a00'
  if (decay < t.moderate) return '#c0a000'
  if (decay < t.good) return '#2c9c3c'
  return '#0a6cd8'
}

/** Qualitative tap-tone-ratio label (Low / Below Target / Ideal / Above Target / High). */
export function tapToneRatioQuality(ratio: number): string {
  if (ratio < 1.7) return 'Low'
  if (ratio < 1.9) return 'Below Target'
  if (ratio <= 2.1) return 'Ideal'
  if (ratio < 2.3) return 'Above Target'
  return 'High'
}

/** Color for the tap-tone-ratio quality (red / orange / green). */
export function tapToneRatioQualityColor(ratio: number): string {
  if (ratio < 1.7) return '#d83a30'
  if (ratio < 1.9) return '#e08a00'
  if (ratio <= 2.1) return '#2c9c3c'
  if (ratio < 2.3) return '#e08a00'
  return '#d83a30'
}

/**
 * Tap-tone ratio f_Top / f_Air, taken from the first peak whose auto-classified mode
 * normalises to `top` / `air` respectively. Returns null when either is missing.
 * Mirrors Swift TapToneMeasurement.tapToneRatio.
 */
export function tapToneRatio(peaks: Peak[], type: GuitarTypeName): number | null {
  const modeMap = classifyAll(peaks, type)
  const norm = (id: number): ResolvedMode => modeMap.get(id) ?? 'unknown'
  const air = peaks.find((p) => norm(p.id) === 'air')
  const top = peaks.find((p) => norm(p.id) === 'top')
  if (!air || !top) return null
  return top.frequency / air.frequency
}