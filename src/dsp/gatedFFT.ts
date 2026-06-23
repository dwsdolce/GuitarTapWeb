import { fftInPlace } from './fft'

// IEEE-754 binary64 epsilon — matches numpy.finfo(float).eps. Used as the
// magnitude floor before the dB conversion, exactly as the reference does.
const EPS = 2.220446049250313e-16

export interface GatedFFTResult {
  /** Magnitude spectrum in dBFS (ref 1.0), one value per bin [0, fftSize/2). */
  magnitudesDb: number[]
  /** Bin centre frequencies in Hz, parallel to magnitudesDb. */
  frequencies: number[]
}

/**
 * Hann-windowed, zero-padded magnitude FFT of a gated PCM capture.
 *
 * Faithful port of RealtimeFFTAnalyzer.compute_gated_fft (Python) /
 * computeGatedFFT (Swift):
 *   - pad up to the next power of two, capped at 32768;
 *   - apply a symmetric Hann window (numpy.hanning: 0.5−0.5·cos(2πi/(N−1)));
 *   - forward FFT; take the lower half;
 *   - magnitude = |X| / fftSize, with bins ≥1 doubled (one-sided spectrum);
 *   - floor at EPS, then 20·log10 → dBFS.
 *
 * Calibration (added in the dB domain) is applied by the caller, not here.
 */
export function computeGatedFFT(
  samples: Float32Array | Float64Array | number[],
  sampleRate: number,
): GatedFFTResult {
  const n = samples.length
  if (n === 0) return { magnitudesDb: [], frequencies: [] }

  const MAX_FFT = 32768
  let fftSize = 1
  while (fftSize < n) fftSize <<= 1
  if (fftSize > MAX_FFT) fftSize = MAX_FFT

  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  const copyCount = Math.min(n, fftSize)
  const denom = fftSize - 1 // numpy.hanning uses (N−1)
  for (let i = 0; i < copyCount; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / denom)
    re[i] = (samples[i] as number) * w
  }
  // Samples beyond copyCount stay zero; windowing zeros yields zeros, so this
  // matches "window the full padded array" exactly.

  fftInPlace(re, im)

  const halfN = fftSize >> 1
  const magnitudesDb = new Array<number>(halfN)
  const frequencies = new Array<number>(halfN)
  for (let i = 0; i < halfN; i++) {
    let mag = Math.hypot(re[i]!, im[i]!) / fftSize
    if (i >= 1) mag *= 2
    if (mag < EPS) mag = EPS
    magnitudesDb[i] = 20 * Math.log10(mag)
    frequencies[i] = (i * sampleRate) / fftSize
  }
  return { magnitudesDb, frequencies }
}

/** Magnitude (dB) at the bin nearest `targetHz`; null for an empty spectrum. */
export function magnitudeAtFrequency(
  targetHz: number,
  magnitudesDb: number[],
  frequencies: number[],
): number | null {
  if (frequencies.length === 0) return null
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < frequencies.length; i++) {
    const d = Math.abs(frequencies[i]! - targetHz)
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  return magnitudesDb[bestIdx]!
}
