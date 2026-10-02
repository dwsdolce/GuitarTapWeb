// @parity view/frequency-format tests=test/frequency-format

/** A frequency for display: one decimal, in kHz from 1000 Hz ("440.0 Hz", "2.5 kHz"). Mirrors Swift
 *  `Float.formattedAsFrequency()` (Extensions.swift). */
export function formattedAsFrequency(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${hz.toFixed(1)} Hz`
}

/** The line above the guitar peak list: the chart's frequency range, each bound as `formattedAsFrequency`
 *  (e.g. "Showing 25.0 Hz - 45.0 Hz"). Mirrors Swift `displayRangeLabel(minFreq:maxFreq:)`. */
export function displayRangeLabel(minHz: number, maxHz: number): string {
  return `Showing ${formattedAsFrequency(minHz)} - ${formattedAsFrequency(maxHz)}`
}
