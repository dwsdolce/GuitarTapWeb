// @parity view/frequency-format tests=test/frequency-format

import { FieldPrecision } from '../precision'

/** A frequency for display: in kHz from 1000 Hz, with `peakFrequencyHz`'s decimals ("440.0 Hz",
 *  "2.5 kHz"). Mirrors Swift `Float.formattedAsFrequency()` (Extensions.swift). */
export function formattedAsFrequency(hz: number): string {
  return hz >= 1000
    ? `${FieldPrecision.string(hz / 1000, FieldPrecision.peakFrequencyHz)} kHz`
    : `${FieldPrecision.string(hz, FieldPrecision.peakFrequencyHz)} Hz`
}

/** The line above the guitar peak list: the chart's frequency range, each bound as `formattedAsFrequency`
 *  (e.g. "Showing 25.0 Hz - 45.0 Hz"). Mirrors Swift `displayRangeLabel(minFreq:maxFreq:)`. */
export function displayRangeLabel(minHz: number, maxHz: number): string {
  return `Showing ${formattedAsFrequency(minHz)} - ${formattedAsFrequency(maxHz)}`
}

/** A sample rate or bandwidth for display: whole hertz, grouped by the locale's separator ("48,000 Hz";
 *  "48.000 Hz" in German). Mirrors Swift `formattedAsWholeHertz(_:locale:)`. */
export function formattedAsWholeHertz(hz: number, locale?: string): string {
  return `${FieldPrecision.rounded(hz, 0).toLocaleString(locale)} Hz`
}
