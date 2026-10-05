// @parity view/chart-style tests=test/chart-style
//
// How the spectrum chart draws its lines and points: widths, dashes, opacities and point sizes. Unlike the palette's
// colours these do not change with the colour scheme; they are pinned here so every edition draws the chart the same
// way. The screen and the exported image each have their own set. Mirrors Swift `ChartStyle`.

/** One set of chart styles. Widths and dashes in points, opacities 0–1, point sizes as areas (pt²). */
export interface ChartLines {
  spectrumWidth: number
  overlayWidth: number
  gridWidth: number
  modeBoundaryWidth: number
  modeBoundaryDash: number[]
  modeBoundaryOpacity: number
  peakMinWidth: number
  peakMinDash: number[]
  peakMinOpacity: number
  crosshairWidth: number
  crosshairDash: number[]
  leaderWidth: number
  leaderDash: number[]
  leaderOpacity: number
  labelBorderWidth: number
  dotArea: number
  highlightedDotArea: number
  /** The magnitude axis's tick spacing (dB), or null to choose it from the visible range. */
  magnitudeStride: number | null
}

/** The chart on screen. */
export const SCREEN: ChartLines = {
  spectrumWidth: 1,
  overlayWidth: 1.5,
  gridWidth: 1,
  modeBoundaryWidth: 1.5,
  modeBoundaryDash: [5, 5],
  modeBoundaryOpacity: 0.3,
  peakMinWidth: 1.5,
  peakMinDash: [8, 3],
  peakMinOpacity: 0.7,
  crosshairWidth: 1,
  crosshairDash: [4, 3],
  leaderWidth: 1.5,
  leaderDash: [4, 3],
  leaderOpacity: 0.4,
  labelBorderWidth: 1.5,
  dotArea: 40,
  highlightedDotArea: 120,
  magnitudeStride: null,
}

/** The exported spectrum image (PNG, and the image in the PDF report). */
export const EXPORT: ChartLines = {
  spectrumWidth: 2,
  overlayWidth: 2,
  gridWidth: 1,
  modeBoundaryWidth: 2,
  modeBoundaryDash: [8, 8],
  modeBoundaryOpacity: 0.3,
  peakMinWidth: 1.5,
  peakMinDash: [8, 3],
  peakMinOpacity: 0.7,
  crosshairWidth: 1,
  crosshairDash: [4, 3],
  leaderWidth: 2,
  leaderDash: [5, 4],
  leaderOpacity: 0.5,
  labelBorderWidth: 1.5,
  dotArea: 200,
  highlightedDotArea: 200,
  magnitudeStride: 20,
}

/** A round point's diameter for its area: 2·√(area/π). */
export function diameter(area: number): number {
  return 2 * Math.sqrt(area / Math.PI)
}
