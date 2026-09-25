// @parity dsp/gated-fft tests=test/gated-fft
import { fftInPlace } from './fft'

/** Output of {@link gatedHannFFT}: a one-sided dBFS magnitude spectrum + its bin frequencies. */
export interface GatedFFTResult {
  /** Magnitude spectrum in dBFS (ref 1.0), one value per bin [0, fftSize/2). */
  magnitudesDb: number[]
  /** Bin centre frequencies in Hz, parallel to magnitudesDb. */
  frequencies: number[]
}

/**
 * The uncalibrated gated transform: a Hann-windowed, zero-padded magnitude FFT of a gated PCM
 * capture. The app never calls this directly — it calls `RealtimeFFTAnalyzer.computeGatedFFT`, which
 * runs this and adds the analyzer's active calibration at the moment of the call, as Swift's
 * `computeGatedFFT` and Python's `compute_gated_fft` do (#17 F49).
 *
 *   - fewer than two samples → an empty spectrum (there is nothing to transform);
 *   - pad up to the next power of two, capped at 32768;
 *   - apply the PERIODIC Hann window 0.5−0.5·cos(2πi/N) — Swift's vDSP_HANN_DENORM, not
 *     numpy.hanning's symmetric (N−1) form. The two differ by less than any tolerance can see,
 *     which is how this edition drifted to the symmetric one before; a window test in all three
 *     guards it;
 *   - forward FFT; take the lower half;
 *   - magnitude = |X| / fftSize, with bins ≥1 doubled (one-sided spectrum);
 *   - 20·log10 → dBFS (no floor: an empty bin is -Infinity, as Swift gives).
 *
 * The window spans the PADDED length, not the captured one. At 48 kHz the 0.4 s capture is 19200 of
 * 32768 samples, so its last sample is weighted ≈0.93, not tapered to zero. For a steady tone that
 * is a hard edge with poor sidelobes (a tone 7 Hz from a stronger one picks up its leakage at about
 * −21 dB). For a TAP it works: the ring-out decays, so the signal supplies its own end taper, and the
 * abrupt onset — 0.1 s in, after the pre-onset silence — is weighted ≈0.2. Tested against decaying
 * modes at known frequencies, this measures a tap's frequency as well as or better than a Hann
 * spanning only the captured samples (#17 F49). Because the capture fills a different share of the
 * padded window at each sample rate, the window's gain differs with it: about −10.8 dB at 44.1 kHz,
 * −9.5 dB at 48 kHz, and −6.0 dB at 96 kHz, where the capture exceeds 32768 samples and is
 * truncated to it.
 */
export function gatedHannFFT(
  samples: Float32Array | Float64Array | number[],
  sampleRate: number,
): GatedFFTResult {
  const n = samples.length
  if (n < 2) return { magnitudesDb: [], frequencies: [] }

  const MAX_FFT = 32768
  let fftSize = 1
  while (fftSize < n) fftSize <<= 1
  if (fftSize > MAX_FFT) fftSize = MAX_FFT

  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  const copyCount = Math.min(n, fftSize)
  for (let i = 0; i < copyCount; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize) // periodic Hann (Swift HANN_DENORM)
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
    // No epsilon clamp — a bin with no energy is -Infinity, as Swift's vDSP_vdbcon gives. The
    // gated path carried the same clamp as the live one (guitarFFT); both are gone, so "nothing at
    // all" stays distinguishable from -100 dB, a real level a quiet UMIK-1 reaches (#17).
    magnitudesDb[i] = 20 * Math.log10(mag)
    frequencies[i] = (i * sampleRate) / fftSize
  }
  return { magnitudesDb, frequencies }
}
