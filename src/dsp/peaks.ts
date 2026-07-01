// @parity dsp/find-peaks tests=test/peaks
import { modeBands, type GuitarTypeName } from './guitarModes'

// Peak detection + parabolic interpolation + Q, ported from
// TapToneAnalyzer+PeakAnalysis.swift / tap_tone_analyzer_peak_analysis.py.
// Pure: operates on a magnitude/frequency spectrum, returns peaks.

export interface Peak {
  /** Unique id within a findPeaks call (for assembly/dedup bookkeeping). */
  id: number
  frequency: number
  magnitude: number
  quality: number
  bandwidth: number
}

const WINDOW = 5 // ±5-bin local-max window
const PEAK_PROXIMITY_HZ = 2.0

export interface FindPeaksOptions {
  guitarType?: GuitarTypeName
  minHz?: number
  maxHz?: number
  /** Magnitude gate (dB). Default −60. */
  peakMinThreshold?: number
  /** Adaptive gate (e.g. median of range) for plate/brace; overrides threshold. */
  peakMinOverride?: number
}

type Spectrum = number[] | Float32Array | Float64Array

function indexWhere(arr: Spectrum, pred: (v: number) => boolean, fallback: number): number {
  for (let i = 0; i < arr.length; i++) if (pred(arr[i] as number)) return i
  return fallback
}

function isLocalMax(mags: Spectrum, i: number): boolean {
  const v = mags[i] as number
  for (let off = -WINDOW; off <= WINDOW; off++) {
    if (off === 0) continue
    if ((mags[i + off] as number) >= v) return false
  }
  return true
}

/** δ = 0.5(α−γ)/(α−2β+γ); f = f_bin + δ·Δf; A = β − 0.25(α−γ)δ. Edge/flat-top → raw bin. */
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

/** −3 dB bandwidth walk (uses interpolated peak magnitude as the reference). */
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

function makePeak(id: number, i: number, mags: Spectrum, freqs: Spectrum): Peak {
  const { frequency, magnitude } = parabolicInterpolate(mags, freqs, i)
  const { quality, bandwidth } = calculateQ(mags, freqs, i, magnitude)
  return { id, frequency, magnitude, quality, bandwidth }
}

/** Keep the higher-magnitude peak of any pair within PEAK_PROXIMITY_HZ; preserve first-seen order. */
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
 * Detect, interpolate, and deduplicate peaks above threshold — mode-aware
 * two-pass strategy (Pass 1: strongest per known-mode band, low→high with a
 * claimed-bin cursor to prevent overlapping bands re-claiming a peak; Pass 2:
 * local maxima outside every known band). Assembly: one guaranteed slot per
 * mode, then all remaining peaks by descending magnitude. Sorted by magnitude.
 */
export function findPeaks(mags: Spectrum, freqs: Spectrum, opts: FindPeaksOptions = {}): Peak[] {
  const n = mags.length
  if (n !== freqs.length) return []

  const guitarType = opts.guitarType ?? 'generic'
  const loFreq = opts.minHz ?? 30
  const hiFreq = opts.maxHz ?? 2000
  const threshold = opts.peakMinOverride ?? opts.peakMinThreshold ?? -60

  const startIdx = indexWhere(freqs, (f) => f >= loFreq, 0)
  const endIdx = indexWhere(freqs, (f) => f > hiFreq, n - 1)

  const modes = modeBands(guitarType).sort((a, b) => a.lo - b.lo)

  let nextId = 0
  const strongestPerMode = new Map<number, Peak>()
  const strongestBinPerMode = new Map<number, number>()
  let lastClaimedBin = -1
  const allPeaks: Peak[] = []

  // Pass 1 — known-mode bands.
  for (let mi = 0; mi < modes.length; mi++) {
    const m = modes[mi]!
    let modeStart = Math.max(indexWhere(freqs, (f) => f >= m.lo, startIdx), startIdx)
    const modeEnd = Math.min(indexWhere(freqs, (f) => f > m.hi, endIdx), endIdx)
    if (modeStart >= modeEnd) continue
    const claimedIdx = lastClaimedBin >= 0 ? lastClaimedBin + 1 : startIdx
    const scanStart = Math.max(modeStart, claimedIdx, startIdx + WINDOW)
    const scanEnd = Math.min(modeEnd, endIdx - WINDOW)
    if (scanStart >= scanEnd) continue

    for (let i = scanStart; i < scanEnd; i++) {
      const mag = mags[i] as number
      if (mag <= threshold) continue
      if (!isLocalMax(mags, i)) continue
      const peak = makePeak(nextId++, i, mags, freqs)
      allPeaks.push(peak)
      const existing = strongestPerMode.get(mi)
      if (!existing || mag > existing.magnitude) {
        strongestPerMode.set(mi, peak)
        strongestBinPerMode.set(mi, i)
      }
    }

    const claimed = strongestPerMode.get(mi)
    if (claimed) {
      let isDup = false
      for (const [k, other] of strongestPerMode) {
        if (k !== mi && Math.abs(other.frequency - claimed.frequency) < PEAK_PROXIMITY_HZ) {
          isDup = true
          break
        }
      }
      if (isDup) {
        strongestPerMode.delete(mi)
        strongestBinPerMode.delete(mi)
      } else {
        lastClaimedBin = Math.max(lastClaimedBin, strongestBinPerMode.get(mi) ?? -1)
      }
    }
  }

  // Pass 2 — unknown / inter-mode peaks outside every known band.
  const outerStart = startIdx + WINDOW
  const outerEnd = endIdx - WINDOW
  for (let i = outerStart; i < outerEnd; i++) {
    const mag = mags[i] as number
    if (mag <= threshold) continue
    const freq = freqs[i] as number
    let inKnown = false
    for (const m of modes) {
      if (m.lo <= freq && freq <= m.hi) {
        inKnown = true
        break
      }
    }
    if (inKnown) continue
    if (!isLocalMax(mags, i)) continue
    allPeaks.push(makePeak(nextId++, i, mags, freqs))
  }

  // Assembly: guaranteed mode winners first, then the rest by descending magnitude.
  const guaranteed = removeDuplicatePeaks([...strongestPerMode.values()])
  const guaranteedIds = new Set(guaranteed.map((p) => p.id))
  const dedupPool = removeDuplicatePeaks(allPeaks)
  const others = dedupPool
    .filter((p) => !guaranteedIds.has(p.id))
    .sort((a, b) => b.magnitude - a.magnitude)

  return [...guaranteed, ...others].sort((a, b) => b.magnitude - a.magnitude)
}
