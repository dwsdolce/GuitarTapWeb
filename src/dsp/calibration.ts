// UMIK-1 / REW microphone calibration: parse the .txt/.cal file and interpolate
// its dB corrections onto FFT bin frequencies. Corrections are added to the
// magnitude spectrum in the dB domain (after the FFT), with flat extrapolation
// outside the calibrated range — mirrors MicrophoneCalibration (Python/Swift).
// @parity dsp/calibration

export interface CalibrationPoint {
  frequency: number
  correction: number
}

export interface Calibration {
  name: string
  sensitivityFactor: number | null
  points: CalibrationPoint[] // sorted ascending by frequency
}

const SENS_RE = /Sens(?:itivity)?\s*Factor\s*=\s*(-?\d+(?:\.\d+)?)/i

/** Parse calibration file content. Header lines start with `"` or `*`; data
 *  lines are `freq <tab/space/comma> correction`. */
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
    if (Number.isFinite(f) && Number.isFinite(c)) points.push({ frequency: f, correction: c })
  }
  points.sort((a, b) => a.frequency - b.frequency)
  return { name, sensitivityFactor, points }
}

/** Interpolate corrections onto `binFreqs` (linear, flat extrapolation at edges).
 *  Equivalent to numpy.interp(binFreqs, xs, ys, left=ys[0], right=ys[-1]). */
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

/** Add calibration corrections to a dB magnitude spectrum (in place-safe copy). */
export function applyCalibration(magnitudesDb: number[], corrections: number[]): number[] {
  if (corrections.length !== magnitudesDb.length) return magnitudesDb.slice()
  return magnitudesDb.map((m, i) => m + corrections[i]!)
}
