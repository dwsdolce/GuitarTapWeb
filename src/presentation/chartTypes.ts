// @parity view/spectrum-chart
// Shared chart data types — the contract between the SpectrumChart view, the canvas renderer
// (spectrumRender), and the export/transform layer (spectrumExport / measurementImage / pdfReport).
// Kept in the presentation layer (not in the SpectrumChart component) so renderer/export modules
// don't have to import from a view.

import type { Role } from './palette'
import type { Uuid } from '../measurement/newId'

/** One peak's dot + (optional) annotation badge. */
export interface PeakMarker {
  /** The peak's stable id — carried so the chart can hit-test a clicked dot back to a peak (the
   *  dot ↔ results-row highlight). Omitted for markers built without a source peak id. */
  id?: Uuid
  frequency: number
  magnitude: number
  /** The dot's colour role, resolved in the chart's scheme when drawn. */
  role?: Role
  /** A fixed dot colour, for markers without a role (gray when neither is given). */
  color?: string
  /** Mode / override name — the badge's first line. */
  label?: string
  /** Pitch line (guitar): note name + cents. Omitted → no pitch line (material). */
  note?: string
  cents?: number
  /** Italic + pencil glyph when the label is a manual override. */
  isOverride?: boolean
  /** Draw the annotation badge. The dot is ALWAYS drawn regardless of this flag —
   *  mirrors Swift's two layers: allPeaksInRange dots vs visiblePeaks annotations. */
  annotated?: boolean
  /** Stable key (peak frequency, `toFixed(1)`) identifying this badge for drag/offset edits.
   *  Present → the badge is draggable; the leader line tracks the peak. */
  annoKey?: Uuid
  /** User-dragged badge position in data-space [absFreqHz, absDB]; present → the label has been moved. */
  annoOffset?: [number, number]
  /** The label's centre in chart units [Hz, dB] — the dragged position, else the peak plus the default offset
   *  (`TapToneAnalyzer.annotationCentre`). Present on every marker the chart labels. */
  annoCentre?: [number, number]
}

/** A drawn annotation badge's screen rectangle (CSS px) — the part inside the plot — emitted by the renderer
 *  for hit-testing, with the label's centre (CSS px), where a drag starts from. */
export interface AnnotationRect {
  key: Uuid
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
}

/** A drawn peak dot's screen centre (CSS px) + radius + its peak id — pushed by the renderer so the
 *  chart can hit-test a click back to a peak (the dot ↔ results-row highlight). */
export interface DotHit {
  id: Uuid
  x: number
  y: number
  r: number
}

export interface ChartView {
  minHz: number
  maxHz: number
  minDb: number
  maxDb: number
}

export type ResetTarget = 'saved' | 'defaults'
export type ResetAxis = 'both' | 'freq' | 'mag'

/** A colored overlay curve (plate/brace per-phase spectra, later comparison curves). */
export interface SpectrumOverlay {
  magnitudesDb: number[]
  frequencies: number[]
  /** The curve's colour role, resolved in the chart's scheme when drawn. */
  role?: Role
  /** A fixed curve colour, for overlays without a role (a saved comparison's stored colour). */
  color?: string
  label: string
}