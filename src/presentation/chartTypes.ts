// Shared chart data types — the contract between the SpectrumChart view, the canvas renderer
// (spectrumRender), and the export/transform layer (spectrumExport / measurementImage / pdfReport).
// Kept in the presentation layer (not in the SpectrumChart component) so renderer/export modules
// don't have to import from a view.

/** One peak's dot + (optional) annotation badge. */
export interface PeakMarker {
  frequency: number
  magnitude: number
  /** Mode color for the dot (gray when omitted — e.g. unidentified peaks). */
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
  annoKey?: string
  /** User-dragged badge position in data-space [absFreqHz, absDB]; omit → default placement. */
  annoOffset?: [number, number]
}

/** A drawn annotation badge's screen rectangle (CSS px), emitted by the renderer for hit-testing. */
export interface AnnotationRect {
  key: string
  x: number
  y: number
  w: number
  h: number
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
  color: string
  label: string
}