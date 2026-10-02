// @parity none — the web keeps the chart's limits in their own module so that settings.ts and
// displayRange.ts can both import them without importing each other; Swift and Python keep them in
// DisplayRange / display_range.
//
// The chart's limits — one set for Settings' validation, zoom, pan and widening. Mirrors Swift
// DisplayRange.frequencyBounds / magnitudeBounds / minFrequencySpan / minMagnitudeSpan.

/** The frequencies the chart may show; above 5 kHz there is no useful tap-tone data. */
export const MIN_FREQUENCY_HZ = 1
export const MAX_FREQUENCY_HZ = 5000
/** The magnitudes the chart may show (dB). */
export const MIN_MAGNITUDE_DB = -120
export const MAX_MAGNITUDE_DB = 20
/** The narrowest range the chart may show; a range exactly this wide is allowed. */
export const MIN_FREQUENCY_SPAN_HZ = 10
export const MIN_MAGNITUDE_SPAN_DB = 10
