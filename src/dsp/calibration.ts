/**
 * UMIK-1 / REW microphone calibration — parse a `.txt` / `.cal` file and
 * interpolate its dB corrections onto FFT bin frequencies. Corrections are added
 * to the magnitude spectrum in the dB domain (after the FFT), with flat
 * extrapolation outside the calibrated range.
 *
 * Mirrors the parse + interpolation half of Swift `MicrophoneCalibration.swift`
 * and Python `microphone_calibration.py`. (Device association and persistent
 * storage live separately, in `src/measurement/calibrationStore.ts`.)
 *
 * File format (UMIK-1 / REW): header/comment lines start with `"` or `*` and may
 * carry a `Sens Factor` and a reference SPL (`SESSION REF` / `SPL`); data lines are
 * `freq <tab|space|comma> correction`. Only points in the 1–24000 Hz range are
 * imported (matches Swift/Python).
 */
// @parity dsp/calibration

/** One `(frequency, correction)` pair from a calibration file. */
export interface CalibrationPoint {
  /** Frequency in Hz. */
  frequency: number
  /** Additive magnitude correction in dB to apply at `frequency`. */
  correction: number
}

/** A parsed calibration curve. */
export interface Calibration {
  /** Display name (typically the filename stem). */
  name: string
  /** `Sens Factor` from the header, in dB; `null` if absent. Stored for provenance, not applied. */
  sensitivityFactor: number | null
  /** Reference SPL (`SESSION REF` / `SPL`) from the header, in dBSPL; `null` if absent. Provenance only. */
  referenceLevel: number | null
  /** Correction points, sorted ascending by frequency. */
  points: CalibrationPoint[]
}

/** The error a calibration file with no valid data point gives — Swift's `ParseError.noDataPoints`. */
export const NO_DATA_POINTS = 'No calibration data points found in file'

// The header names as Swift reads them: spelled as written, in any case.
const SENS_RE = /Sens Factor\s*=\s*([+-]?[\d.]+)\s*dB/i
// Reference SPL: UMIK-1 "SESSION REF=94.0dBSPL" or REW "SPL 94.0 dB". Provenance only (mirrors Swift/Python).
const REF_RE = /SESSION REF\s*=\s*([\d.]+)\s*dBSPL/i
const SPL_RE = /SPL\s+([\d.]+)\s*dB/i

/**
 * Parse calibration-file content into a {@link Calibration}.
 *
 * Header/comment lines start with `"` or `*` (an optional `Sens Factor` and
 * reference SPL are captured from them); data lines are `freq <tab|space|comma>
 * correction`. Only points in 1–24000 Hz are kept (matches Swift/Python), and
 * points are returned sorted ascending by frequency.
 *
 * @param content Full calibration-file text.
 * @param name Display name for the profile (defaults to `"calibration"`).
 * @returns The parsed calibration.
 * @throws Error ({@link NO_DATA_POINTS}) when the file holds no valid data point, as Swift's
 *   `ParseError.noDataPoints`.
 */
export function parseCalibration(content: string, name = 'calibration'): Calibration {
  let sensitivityFactor: number | null = null
  let referenceLevel: number | null = null
  const points: CalibrationPoint[] = []
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    if (line.startsWith('"') || line.startsWith('*')) {
      const sm = SENS_RE.exec(line)
      if (sm) sensitivityFactor = parseFloat(sm[1]!)
      // Reference SPL: SESSION REF (UMIK-1) or SPL (REW). SPL/last occurrence wins,
      // matching Swift and Python. Unreachable in practice — a file carries one format.
      const rm = REF_RE.exec(line)
      if (rm) referenceLevel = parseFloat(rm[1]!)
      const spl = SPL_RE.exec(line)
      if (spl) referenceLevel = parseFloat(spl[1]!)
      continue
    }
    const parts = line.split(/[\t ,]+/)
    if (parts.length < 2) continue
    // Each a number in full, as Swift's Float(_:): "100abc" is no number, not 100.
    const f = Number(parts[0]!)
    const c = Number(parts[1]!)
    // Only import points in the audible range 1–24000 Hz (matches Swift
    // MicrophoneCalibration / Python microphone_calibration), so a stray
    // out-of-range line can't shift the interpolation edges.
    if (Number.isFinite(f) && Number.isFinite(c) && f >= 1 && f <= 24000) {
      points.push({ frequency: f, correction: c })
    }
  }
  if (points.length === 0) throw new Error(NO_DATA_POINTS)
  points.sort((a, b) => a.frequency - b.frequency)
  return { name, sensitivityFactor, referenceLevel, points }
}

/** The details Settings shows for a calibration: its sensitivity (when the file gives one), its number of
 *  points, and the frequencies they span (when it has any). Mirrors Swift `MicrophoneCalibration.details`. */
export function calibrationDetails(cal: Calibration): { sensitivity: string | null; dataPoints: string; range: string | null } {
  const first = cal.points[0]
  const last = cal.points[cal.points.length - 1]
  return {
    sensitivity: cal.sensitivityFactor != null ? `Sensitivity: ${cal.sensitivityFactor.toFixed(2)} dB` : null,
    dataPoints: `Data points: ${cal.points.length}`,
    range: first && last ? `${first.frequency.toFixed(0)}-${last.frequency.toFixed(0)} Hz` : null,
  }
}

/** The correction at one frequency: the bracketing points' corrections interpolated linearly, flat past
 *  either end. Mirrors Swift `MicrophoneCalibration.correction(at:)`. */
export function correctionAt(pts: CalibrationPoint[], x: number): number {
  if (pts.length === 0) return 0
  if (pts.length === 1) return pts[0]!.correction
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  if (x <= first.frequency) return first.correction
  if (x >= last.frequency) return last.correction
  for (let i = 0; i < pts.length - 1; i++) {
    const low = pts[i]!
    const high = pts[i + 1]!
    if (x >= low.frequency && x <= high.frequency) {
      const t = (x - low.frequency) / (high.frequency - low.frequency)
      return low.correction + t * (high.correction - low.correction)
    }
  }
  return 0
}

/**
 * Interpolate corrections onto `binFreqs` — linear between calibration points,
 * with flat extrapolation at the edges. An empty calibration yields all-zero
 * corrections. Mirrors Swift `MicrophoneCalibration.corrections(for:)`.
 *
 * @param cal Parsed calibration; its `points` must be sorted ascending by frequency.
 * @param binFreqs FFT bin centre frequencies, in Hz (ascending, as the FFT's are; any order is accepted).
 * @returns Additive dB corrections, parallel to `binFreqs`.
 */
export function interpolateToBins(cal: Calibration, binFreqs: ArrayLike<number>): number[] {
  const pts = cal.points
  const n = binFreqs.length
  let ascending = true
  for (let k = 1; k < n && ascending; k++) ascending = binFreqs[k - 1]! <= binFreqs[k]!
  // The FFT's bins ascend, as the points do: one pass over both — each bin's bracketing pair is the
  // previous bin's or one after it — with the same values as correctionAt for every bin.
  if (pts.length <= 1 || !ascending) return Array.from(binFreqs, (x) => correctionAt(pts, x))
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  const out = new Array<number>(n)
  let i = 0
  for (let k = 0; k < n; k++) {
    const x = binFreqs[k]!
    if (x <= first.frequency) {
      out[k] = first.correction
    } else if (x >= last.frequency) {
      out[k] = last.correction
    } else {
      while (x > pts[i + 1]!.frequency) i++
      const low = pts[i]!
      const high = pts[i + 1]!
      const t = (x - low.frequency) / (high.frequency - low.frequency)
      out[k] = low.correction + t * (high.correction - low.correction)
    }
  }
  return out
}

/**
 * Add calibration corrections to a dB magnitude spectrum, returning a new array
 * (the input is not mutated). A length mismatch is a no-op that returns a copy of
 * the input unchanged.
 *
 * @param magnitudesDb Magnitude spectrum, in dB.
 * @param corrections Per-bin dB corrections (must match `magnitudesDb` length).
 * @returns A new, corrected magnitude array.
 */
export function applyCalibration(magnitudesDb: number[], corrections: number[]): number[] {
  if (corrections.length !== magnitudesDb.length) return magnitudesDb.slice()
  return magnitudesDb.map((m, i) => m + corrections[i]!)
}