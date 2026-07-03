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
 * carry a `Sens Factor`; data lines are `freq <tab|space|comma> correction`. Only
 * points in the 1–24000 Hz range are imported (matches Swift/Python).
 *
 * @see Development/INVENTORY.md — "Calibration"
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
  /** Correction points, sorted ascending by frequency. */
  points: CalibrationPoint[]
}

const SENS_RE = /Sens(?:itivity)?\s*Factor\s*=\s*(-?\d+(?:\.\d+)?)/i

/**
 * Parse calibration-file content into a {@link Calibration}.
 *
 * Header/comment lines start with `"` or `*` (an optional `Sens Factor` is
 * captured from them); data lines are `freq <tab|space|comma> correction`. Only
 * points in 1–24000 Hz are kept (matches Swift/Python), and points are returned
 * sorted ascending by frequency.
 *
 * @param content Full calibration-file text.
 * @param name Display name for the profile (defaults to `"calibration"`).
 * @returns The parsed calibration; `points` is empty if the file had none valid.
 */
export function parseCalibration(content: string, name = 'calibration'): Calibration {
  let sensitivityFactor: number | null = null
  const points: CalibrationPoint[] = []
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    if (line.startsWith('"') || line.startsWith('*')) {
      const m = SENS_RE.exec(line)
      if (m) sensitivityFactor = parseFloat(m[1]!)
      continue
    }
    const parts = line.split(/[\t ,]+/)
    if (parts.length < 2) continue
    const f = parseFloat(parts[0]!)
    const c = parseFloat(parts[1]!)
    // Only import points in the audible range 1–24000 Hz (matches Swift
    // MicrophoneCalibration / Python microphone_calibration), so a stray
    // out-of-range line can't shift the interpolation edges.
    if (Number.isFinite(f) && Number.isFinite(c) && f >= 1 && f <= 24000) {
      points.push({ frequency: f, correction: c })
    }
  }
  points.sort((a, b) => a.frequency - b.frequency)
  return { name, sensitivityFactor, points }
}

/**
 * Interpolate corrections onto `binFreqs` — linear between calibration points,
 * with flat extrapolation at the edges (equivalent to
 * `numpy.interp(binFreqs, xs, ys, left=ys[0], right=ys[-1])`). An empty
 * calibration yields all-zero corrections.
 *
 * @param cal Parsed calibration; its `points` must be sorted ascending by frequency.
 * @param binFreqs FFT bin centre frequencies, in Hz.
 * @returns Additive dB corrections, parallel to `binFreqs`.
 */
export function interpolateToBins(cal: Calibration, binFreqs: ArrayLike<number>): number[] {
  const pts = cal.points
  const out = new Array<number>(binFreqs.length)
  if (pts.length === 0) {
    out.fill(0)
    return out
  }
  const first = pts[0]!.correction
  const last = pts[pts.length - 1]!.correction
  for (let i = 0; i < binFreqs.length; i++) {
    const x = binFreqs[i]!
    if (x <= pts[0]!.frequency) {
      out[i] = first
    } else if (x >= pts[pts.length - 1]!.frequency) {
      out[i] = last
    } else {
      // Binary search for the interval [lo, hi] with xs[lo] <= x < xs[hi].
      let lo = 0
      let hi = pts.length - 1
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (pts[mid]!.frequency <= x) lo = mid
        else hi = mid
      }
      const x0 = pts[lo]!.frequency
      const x1 = pts[hi]!.frequency
      const y0 = pts[lo]!.correction
      const y1 = pts[hi]!.correction
      out[i] = y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
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