// Guitar tap-tone analysis quality helpers — a direct port of Swift's
// Float.decayQuality(for:)/decayQualityColor(for:) and tapToneRatioQuality /
// tapToneRatioQualityColor (GuitarTap/Views/Utilities/Extensions.swift) plus the
// per-type decay thresholds (GuitarType.decayThresholds). These map a numeric decay or
// tap-tone ratio to a qualitative label/color; the ratio VALUE itself is the definitive
// resolver (analyzer.tapToneRatio / measurementTapToneRatio). Used by the PDF report's
// guitar analysis section so the qualitative labels/colors match the native apps exactly.
// @parity dsp/analysis-quality tests=test/analysis-quality

import type { GuitarTypeName } from './guitarModes'

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
