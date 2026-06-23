import { computeGatedFFT } from './gatedFFT'
import { parabolicInterpolate, calculateQ } from './peaks'
import { interpolateToBins, applyCalibration, type Calibration } from './calibration'

// Gated capture pipeline for plate/brace, ported from Swift/Python:
//   level-crossing onset → 500 ms capture → align_capture_to_onset →
//   computeGatedFFT → (calibration) → findDominantPeak.
// align_capture_to_onset re-anchors the FFT window to the sample-level onset,
// so the exact level-crossing timing is invisible downstream — we replicate it
// faithfully but the result is robust to it.

const CHUNK = 1024
const LEVEL_CROSSING_CONFIRMATION_CHUNKS = 2

const GATED_CAPTURE_DURATION = 0.5
const GATED_FFT_WINDOW_DURATION = 0.4
const PRE_ONSET_DURATION = 0.1
const PRE_ROLL_DURATION = 0.2

const ONSET_NOISE_ESTIMATE_SAMPLES = 2048
const ONSET_THRESHOLD_MULTIPLIER = 10.0
const ONSET_MIN_THRESHOLD = 0.001
const ONSET_BACKUP_SAMPLES = 32

const MIN_Q = 3.0

type Samples = Float32Array | Float64Array | number[]

export interface MaterialPeak {
  frequency: number
  magnitude: number
  quality: number
  bandwidth: number
}

function chunkLevelDb(samples: Samples, start: number, end: number): number {
  let sumSq = 0
  for (let i = start; i < end; i++) sumSq += (samples[i] as number) ** 2
  const rms = Math.sqrt(sumSq / (end - start))
  return 20 * Math.log10(Math.max(rms, 1e-10))
}

/** Sample index just past the chunk that confirms the level crossing, or null. */
export function findLevelCrossing(samples: Samples, thresholdDb: number): number | null {
  let prevAbove = false
  let consecutive = 0
  for (let c = 0; c * CHUNK < samples.length; c++) {
    const start = c * CHUNK
    const end = Math.min(start + CHUNK, samples.length)
    if (end <= start) break
    const above = chunkLevelDb(samples, start, end) > thresholdDb
    if (above) {
      if (consecutive > 0) consecutive++
      else if (!prevAbove) consecutive = 1
      if (consecutive >= LEVEL_CROSSING_CONFIRMATION_CHUNKS) return end
    } else {
      consecutive = 0
    }
    prevAbove = above
  }
  return null
}

/**
 * All level-crossing fire points in order (multi-tap sessions, e.g. plate L→C→FLC).
 * After each fire we skip the 500 ms capture window and require a fresh fall→rise
 * before the next, so a single tap's ring-out can't double-trigger — mirroring the
 * app's disarm-during-capture / re-arm-after behaviour.
 */
export function findAllLevelCrossings(samples: Samples, thresholdDb: number, skipSamples: number): number[] {
  const captureSamples = skipSamples
  const crossings: number[] = []
  let prevAbove = false
  let consecutive = 0
  let c = 0
  while (c * CHUNK < samples.length) {
    const start = c * CHUNK
    const end = Math.min(start + CHUNK, samples.length)
    if (end <= start) break
    const above = chunkLevelDb(samples, start, end) > thresholdDb
    if (above) {
      if (consecutive > 0) consecutive++
      else if (!prevAbove) consecutive = 1
      if (consecutive >= LEVEL_CROSSING_CONFIRMATION_CHUNKS) {
        crossings.push(end)
        // Skip the captured window; require a fall→rise before the next fire.
        c = Math.ceil((end + captureSamples) / CHUNK)
        consecutive = 0
        prevAbove = true
        continue
      }
    } else {
      consecutive = 0
    }
    prevAbove = above
    c++
  }
  return crossings
}

/** Extract a window_size buffer with the tap onset at pre_onset_samples. */
export function alignCaptureToOnset(
  samples: Samples,
  windowSize: number,
  preOnsetSamples: number,
): Float64Array {
  const n = samples.length
  const out = new Float64Array(windowSize)
  const copyInto = (srcStart: number, dstStart: number, count: number) => {
    for (let k = 0; k < count; k++) out[dstStart + k] = samples[srcStart + k] as number
  }
  if (n < ONSET_NOISE_ESTIMATE_SAMPLES) {
    copyInto(0, 0, Math.min(n, windowSize))
    return out
  }
  let sumSq = 0
  for (let i = 0; i < ONSET_NOISE_ESTIMATE_SAMPLES; i++) sumSq += (samples[i] as number) ** 2
  const noiseRms = Math.sqrt(sumSq / ONSET_NOISE_ESTIMATE_SAMPLES)
  const threshold = Math.max(noiseRms * ONSET_THRESHOLD_MULTIPLIER, ONSET_MIN_THRESHOLD)

  let onset = -1
  for (let i = 0; i < n; i++) {
    if (Math.abs(samples[i] as number) > threshold) {
      onset = i
      break
    }
  }
  if (onset < 0) {
    copyInto(0, 0, Math.min(n, windowSize))
    return out
  }
  onset = Math.max(0, onset - ONSET_BACKUP_SAMPLES)
  const extractStart = onset - preOnsetSamples
  if (extractStart >= 0 && extractStart + windowSize <= n) {
    copyInto(extractStart, 0, windowSize)
  } else if (extractStart < 0) {
    const pad = -extractStart
    const avail = Math.min(windowSize - pad, n)
    copyInto(0, pad, avail)
  } else {
    const avail = Math.min(windowSize, n - extractStart)
    copyInto(extractStart, 0, avail)
  }
  return out
}

/** Strongest material resonance from a gated spectrum (HPS / minQ / 6 dB rules). */
export function findDominantPeak(
  magnitudesDb: number[],
  frequencies: number[],
  minHz: number,
  maxHz: number,
  preferLowestSignificant = false,
): MaterialPeak | null {
  const n = magnitudesDb.length
  if (n !== frequencies.length || n <= 10) return null
  const startIdx = frequencies.findIndex((f) => f >= minHz)
  let endIdx = frequencies.findIndex((f) => f > maxHz)
  if (endIdx < 0) endIdx = n
  if (startIdx < 0 || startIdx >= endIdx) return null

  const WINDOW = 5
  const searchMags = magnitudesDb.slice(startIdx, endIdx).sort((a, b) => a - b)
  const noiseFloor = searchMags[Math.floor(searchMags.length / 2)]!
  const linear = magnitudesDb.map((m) => 10 ** (Math.max(m, -160) / 20))

  interface Cand { index: number; magnitude: number; hps: number; q: number }
  const candidates: Cand[] = []
  for (let i = startIdx + WINDOW; i < endIdx - WINDOW; i++) {
    const mag = magnitudesDb[i]!
    if (mag <= noiseFloor) continue
    let isLocal = true
    for (let off = -WINDOW; off <= WINDOW; off++) {
      if (off === 0) continue
      if (magnitudesDb[i + off]! >= mag) {
        isLocal = false
        break
      }
    }
    if (!isLocal) continue
    let hps = linear[i]!
    for (const k of [2, 3]) {
      const h = i * k
      if (h < n) hps *= linear[h]!
    }
    const { quality } = calculateQ(magnitudesDb, frequencies, i, mag)
    candidates.push({ index: i, magnitude: mag, hps, q: quality })
  }
  if (candidates.length === 0) return null

  const highQ = candidates.filter((c) => c.q >= MIN_Q)
  const pool = highQ.length > 0 ? highQ : candidates
  const byMag = [...pool].sort((a, b) => b.magnitude - a.magnitude)
  const strongest = byMag[0]!

  let best: Cand
  if (preferLowestSignificant) {
    const thr = strongest.magnitude - 6.0
    best = pool.filter((c) => c.magnitude >= thr).reduce((a, b) => (b.index < a.index ? b : a))
  } else {
    let current = strongest
    for (const c of byMag.slice(1)) {
      if (c.index >= current.index) continue
      if (current.magnitude - c.magnitude < 6.0 && c.hps >= current.hps * 0.1) current = c
    }
    best = current
  }

  const { frequency, magnitude } = parabolicInterpolate(magnitudesDb, frequencies, best.index)
  const { quality, bandwidth } = calculateQ(magnitudesDb, frequencies, best.index, magnitude)
  return { frequency, magnitude, quality, bandwidth }
}

export interface PhaseSearch {
  minHz: number
  maxHz: number
  preferLowestSignificant?: boolean
  calibration?: Calibration | null
}

/** Capture+align+FFT+calibrate+dominant-peak starting from a given crossing point. */
export function gatedPeakAtCrossing(
  samples: Samples,
  sampleRate: number,
  crossEnd: number,
  search: PhaseSearch,
): MaterialPeak | null {
  const preRoll = Math.round(sampleRate * PRE_ROLL_DURATION)
  const captureSamples = Math.round(sampleRate * GATED_CAPTURE_DURATION)
  const start = Math.max(0, crossEnd - preRoll)
  const arr = ArrayBuffer.isView(samples) ? (samples as Float32Array) : (samples as number[])
  const buffer = arr.slice(start, start + captureSamples)

  const windowSize = Math.round(sampleRate * GATED_FFT_WINDOW_DURATION)
  const preOnset = Math.round(sampleRate * PRE_ONSET_DURATION)
  const aligned = alignCaptureToOnset(buffer, windowSize, preOnset)

  const { magnitudesDb, frequencies } = computeGatedFFT(aligned, sampleRate)
  if (magnitudesDb.length === 0) return null

  const mags = search.calibration
    ? applyCalibration(magnitudesDb, interpolateToBins(search.calibration, frequencies))
    : magnitudesDb
  return findDominantPeak(mags, frequencies, search.minHz, search.maxHz, search.preferLowestSignificant)
}

export interface GatedPlaybackOptions extends PhaseSearch {
  tapDetectionThreshold: number
}

/** Single-tap gated capture (brace): dominant peak from the first crossing. */
export function gatedSingleTapPeak(
  samples: Samples,
  sampleRate: number,
  opts: GatedPlaybackOptions,
): MaterialPeak | null {
  const crossEnd = findLevelCrossing(samples, opts.tapDetectionThreshold)
  if (crossEnd === null) return null
  return gatedPeakAtCrossing(samples, sampleRate, crossEnd, opts)
}

// Plate phase order in the session WAV and each phase's search window.
// L and FLC prefer the lowest significant peak; cross-grain takes the strongest.
export const PLATE_PHASES = [
  { name: 'longitudinal', minHz: 20, maxHz: 100, preferLowestSignificant: true },
  { name: 'cross', minHz: 40, maxHz: 220, preferLowestSignificant: false },
  { name: 'flc', minHz: 15, maxHz: 100, preferLowestSignificant: true },
] as const

export type PlatePhaseName = (typeof PLATE_PHASES)[number]['name']

/** Plate full-session: segment L→C→FLC by successive crossings, peak per phase. */
export function platePeaks(
  samples: Samples,
  sampleRate: number,
  opts: { tapDetectionThreshold: number; calibration?: Calibration | null },
): Record<PlatePhaseName, MaterialPeak | null> {
  const crossings = findAllLevelCrossings(
    samples,
    opts.tapDetectionThreshold,
    Math.round(sampleRate * GATED_CAPTURE_DURATION),
  )
  const result = {} as Record<PlatePhaseName, MaterialPeak | null>
  PLATE_PHASES.forEach((ph, i) => {
    const ce = crossings[i]
    result[ph.name] =
      ce === undefined
        ? null
        : gatedPeakAtCrossing(samples, sampleRate, ce, {
            minHz: ph.minHz,
            maxHz: ph.maxHz,
            preferLowestSignificant: ph.preferLowestSignificant,
            calibration: opts.calibration,
          })
  })
  return result
}
