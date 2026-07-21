/**
 * Peak detection, parabolic interpolation, and Q / bandwidth for a magnitude
 * spectrum. Pure — takes magnitude + frequency arrays and returns {@link Peak}s.
 *
 * Mirrors the peak-finding algorithm in Swift `TapToneAnalyzer+PeakAnalysis.swift`
 * and Python `tap_tone_analyzer_peak_analysis.py`; the {@link Peak} shape mirrors
 * Swift `ResonantPeak`. Numeric output is pinned by oracle case G2
 * (`test/peaks.test.ts`).
 */
// @parity dsp/find-peaks tests=test/peaks
import { modeBands, type GuitarTypeName } from './guitarModes'

/** A detected resonant peak. Mirrors Swift `ResonantPeak` (id + frequency/magnitude/Q/bandwidth). */
export interface Peak {
  /** Unique id within a findPeaks call (for assembly/dedup bookkeeping). */
  id: number
  /** Interpolated peak frequency, in Hz. */
  frequency: number
  /** Interpolated peak magnitude, in dB. */
  magnitude: number
  /** Q factor: `frequency / bandwidth` (0 when bandwidth is 0). */
  quality: number
  /** −3 dB bandwidth, in Hz. */
  bandwidth: number
}

const WINDOW = 5 // ±5-bin local-max window
const PEAK_PROXIMITY_HZ = 2.0

/** Optional inputs to {@link findPeaks}: mode-band selection, analysis range, and magnitude gate. */
export interface FindPeaksOptions {
  /** Guitar type selecting the known-mode bands (default `'generic'`). */
  guitarType?: GuitarTypeName
  /** Low edge of the analysis range, in Hz (default 30). */
  minHz?: number
  /** High edge of the analysis range, in Hz (default 2000). */
  maxHz?: number
  /** Magnitude gate (dB). Default −60. */
  peakMinThreshold?: number
  /** Adaptive gate (e.g. median of range) for plate/brace; overrides threshold. */
  peakMinOverride?: number
}

type Spectrum = number[] | Float32Array | Float64Array

/** First index whose value satisfies `pred`, or `fallback` if none does. */
function indexWhere(arr: Spectrum, pred: (v: number) => boolean, fallback: number): number {
  for (let i = 0; i < arr.length; i++) if (pred(arr[i] as number)) return i
  return fallback
}

/** True when bin `i` is strictly greater than every neighbour within ±{@link WINDOW}. */
function isLocalMax(mags: Spectrum, i: number): boolean {
  const v = mags[i] as number
  for (let off = -WINDOW; off <= WINDOW; off++) {
    if (off === 0) continue
    if ((mags[i + off] as number) >= v) return false
  }
  return true
}

/**
 * Refine a peak's frequency and magnitude by fitting a parabola to the bin and
 * its two neighbours (α = left, β = centre, γ = right):
 * `δ = 0.5(α−γ)/(α−2β+γ)`, `f = f_bin + δ·Δf`, `A = β − 0.25(α−γ)·δ`.
 * Edge bins or a flat top (denominator ≈ 0) fall back to the raw bin.
 * @param mags Magnitude spectrum.
 * @param freqs Bin centre frequencies (same length as `mags`).
 * @param i Index of the local-max bin to refine.
 * @returns The interpolated `{ frequency, magnitude }`.
 */
export function parabolicInterpolate(
  mags: Spectrum,
  freqs: Spectrum,
  i: number,
): { frequency: number; magnitude: number } {
  if (i <= 0 || i >= mags.length - 1) {
    return { frequency: freqs[i] as number, magnitude: mags[i] as number }
  }
  const val = mags[i] as number
  const lval = mags[i - 1] as number
  const rval = mags[i + 1] as number
  const denom = lval - 2 * val + rval
  if (Math.abs(denom) <= 1e-6) return { frequency: freqs[i] as number, magnitude: val }
  const delta = (0.5 * (lval - rval)) / denom
  const binWidth = (freqs[i] as number) - (freqs[i - 1] as number)
  return {
    frequency: (freqs[i] as number) + delta * binWidth,
    magnitude: val - 0.25 * (lval - rval) * delta,
  }
}

/**
 * Q factor and −3 dB bandwidth via a symmetric bin walk outward from the peak
 * until the magnitude drops 3 dB below the (interpolated) peak magnitude.
 * @param mags Magnitude spectrum.
 * @param freqs Bin centre frequencies.
 * @param peakIndex Index of the peak bin.
 * @param peakMagnitude Reference magnitude (the interpolated peak), in dB.
 * @returns `{ quality, bandwidth }` — `quality = frequency / bandwidth` (0 if bandwidth 0).
 */
export function calculateQ(
  mags: Spectrum,
  freqs: Spectrum,
  peakIndex: number,
  peakMagnitude: number,
): { quality: number; bandwidth: number } {
  const n = mags.length
  const threshold = peakMagnitude - 3.0
  let lower = peakIndex
  while (lower > 0 && (mags[lower] as number) > threshold) lower--
  let upper = peakIndex
  while (upper < n - 1 && (mags[upper] as number) > threshold) upper++
  if (peakIndex >= freqs.length || lower >= freqs.length || upper >= freqs.length) {
    return { quality: 0, bandwidth: 0 }
  }
  const bandwidth = (freqs[upper] as number) - (freqs[lower] as number)
  const quality = bandwidth > 0 ? (freqs[peakIndex] as number) / bandwidth : 0
  return { quality, bandwidth }
}

/** Build a {@link Peak}: parabolic-interpolate bin `i`, then compute its Q and bandwidth. */
function makePeak(id: number, i: number, mags: Spectrum, freqs: Spectrum): Peak {
  const { frequency, magnitude } = parabolicInterpolate(mags, freqs, i)
  const { quality, bandwidth } = calculateQ(mags, freqs, i, magnitude)
  return { id, frequency, magnitude, quality, bandwidth }
}

/**
 * Collapse near-coincident peaks: within `PEAK_PROXIMITY_HZ` of an existing
 * entry, keep the higher-magnitude one; otherwise append. First-seen order is preserved.
 * @param peaks Peaks to deduplicate.
 * @returns The deduplicated peaks.
 */
export function removeDuplicatePeaks(peaks: Peak[]): Peak[] {
  const unique: Peak[] = []
  for (const peak of peaks) {
    const dupIdx = unique.findIndex((e) => Math.abs(e.frequency - peak.frequency) < PEAK_PROXIMITY_HZ)
    if (dupIdx === -1) unique.push(peak)
    else if (peak.magnitude > unique[dupIdx]!.magnitude) unique[dupIdx] = peak
  }
  return unique
}

/**
 * Find every significant spectral peak within the configured frequency range.
 *
 * **Detection only — this function knows nothing about guitar modes.**
 *
 * A single sweep over the spectrum in ascending frequency order. Each bin is visited
 * exactly once and mints at most one {@link Peak}, so two peaks can never describe the
 * same spectral feature.
 *
 * This is deliberate and load-bearing. The previous implementation iterated the mode
 * bands as its outer loop and the bins as its inner loop; because Top and Back overlap
 * on every guitar type, a bin inside the overlap was scanned by two mode passes and
 * `makePeak` was called on it twice, minting two peaks with two ids and otherwise
 * identical values. The assembly step then reconciled two independently deduplicated
 * lists **by id** and let the twin survive, so every guitar capture on every platform
 * saved one duplicated peak. See Development/PEAK-FINDING-DUPLICATE-PEAKS.md.
 *
 * Classification and mode claiming belong to {@link classifyAll}, which operates on the
 * returned peak *list* — where each peak has one identity and can be claimed exactly
 * once. Do not reintroduce mode-band awareness here.
 *
 * @param mags Magnitude spectrum, in dB.
 * @param freqs Bin centre frequencies, in Hz (same length as `mags`).
 * @param opts Guitar type, analysis range (`minHz`/`maxHz`), and magnitude gate.
 * @returns Detected peaks, sorted by descending magnitude.
 */
// @parity dsp/peak-analysis
export function findPeaks(mags: Spectrum, freqs: Spectrum, opts: FindPeaksOptions = {}): Peak[] {
  const n = mags.length
  if (n !== freqs.length) return []

  const loFreq = opts.minHz ?? 30
  const hiFreq = opts.maxHz ?? 2000
  const threshold = opts.peakMinOverride ?? opts.peakMinThreshold ?? -60

  const startIdx = indexWhere(freqs, (f) => f >= loFreq, 0)
  const endIdx = indexWhere(freqs, (f) => f > hiFreq, n - 1)

  // The ±WINDOW local-maximum test needs that many neighbours on each side.
  const scanStart = startIdx + WINDOW
  const scanEnd = endIdx - WINDOW
  if (scanStart >= scanEnd) return []

  let nextId = 0
  const peaks: Peak[] = []

  for (let i = scanStart; i < scanEnd; i++) {
    if (mags[i]! <= threshold) continue
    if (!isLocalMax(mags, i)) continue
    peaks.push(makePeak(nextId++, i, mags, freqs))
  }

  // Two adjacent bins can still resolve to interpolated vertices within PEAK_PROXIMITY_HZ
  // of one another; collapse those, keeping the louder.
  return removeDuplicatePeaks(peaks).sort((a, b) => b.magnitude - a.magnitude)
}
