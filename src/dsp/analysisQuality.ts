// The guitar tap-tone quality labels and colours: a ring-out (decay) time per guitar type, and the
// tap-tone ratio. Mirrors Swift's Float.decayQuality(for:) / decayQualityColor(for:) /
// tapToneRatioQuality / tapToneRatioQualityColor (Extensions.swift); the thresholds are
// `decayThresholds` (guitarModes.ts, Swift GuitarType.decayThresholds). A colour is a palette pair; the
// caller takes the value for its background — `dark` on screen, `light` in a PDF. A negative or NaN
// value is in no band: "Unknown", gray.
// @parity dsp/analysis-quality tests=test/analysis-quality

import { decayThresholds, type GuitarTypeName } from './guitarModes'
import { PALETTE, type ColorPair } from '../presentation/palette'

/** Ring-out label for a decay time (seconds), per guitar type. */
export function decayQuality(decay: number, type: GuitarTypeName): string {
  const t = decayThresholds(type)
  if (!(decay >= 0)) return 'Unknown'
  if (decay < t.veryShort) return 'Very Short'
  if (decay < t.short) return 'Short'
  if (decay < t.moderate) return 'Moderate'
  if (decay < t.good) return 'Good'
  return 'Excellent'
}

/** Colour for the ring-out quality: gray → orange → yellow → green → blue. */
export function decayQualityColor(decay: number, type: GuitarTypeName): ColorPair {
  const t = decayThresholds(type)
  if (!(decay >= 0)) return PALETTE.gray
  if (decay < t.veryShort) return PALETTE.gray
  if (decay < t.short) return PALETTE.orange
  if (decay < t.moderate) return PALETTE.yellow
  if (decay < t.good) return PALETTE.green
  return PALETTE.blue
}

/** Tap-tone-ratio label (target 1.9–2.1): Low / Below Target / Ideal / Above Target / High. */
export function tapToneRatioQuality(ratio: number): string {
  if (!(ratio >= 0)) return 'Unknown'
  if (ratio < 1.7) return 'Low'
  if (ratio < 1.9) return 'Below Target'
  if (ratio <= 2.1) return 'Ideal'
  if (ratio < 2.3) return 'Above Target'
  return 'High'
}

/** Colour for the tap-tone-ratio quality: green ideal, orange near, red out of range. */
export function tapToneRatioQualityColor(ratio: number): ColorPair {
  if (!(ratio >= 0)) return PALETTE.gray
  if (ratio < 1.7) return PALETTE.red
  if (ratio < 1.9) return PALETTE.orange
  if (ratio <= 2.1) return PALETTE.green
  if (ratio < 2.3) return PALETTE.orange
  return PALETTE.red
}
