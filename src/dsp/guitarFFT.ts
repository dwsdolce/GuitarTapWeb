// @parity dsp/guitar-fft
import { fftInPlace } from './fft'
import { findPeaks, type Peak } from './peaks'
import { getPeak } from './classify'
import type { GuitarTypeName } from './guitarModes'

/**
 * Guitar (non-gated, continuous/display) FFT path — the web port of Swift
 * `computeFFT` / Python `dft_anal`. A rectangular (boxcar) window normalised by
 * its sum (= 1/N), a full complex FFT, then the one-sided magnitude spectrum in
 * dBFS with interior bins doubled (DC & Nyquist not). Distinct from the
 * Hann-windowed gated path used for plate/brace (`gatedFFT.ts`).
 *
 * This file hosts more than one parity group — file-level tagging is too coarse
 * to cross-check it, so each exported symbol carries its own tag:
 *   - `dftAnalRect`           → dsp/guitar-fft (the file's primary tag, above)
 *   - `modePeaksFromSpectrum` → audio/tap-analyzer (Air/Top/Back resolution from
 *       a captured/averaged spectrum; the analyzer calls it per frozen result).
 */


/** A magnitude spectrum: parallel dBFS magnitudes and their bin centre frequencies (Hz). */
export interface Spectrum {
  magnitudesDb: number[]
  frequencies: number[]
}

/**
 * Rectangular-window magnitude spectrum of `samples`, in dBFS. Mirrors Swift
 * `computeFFT` / Python `dft_anal`: window (boxcar, ÷N) → full FFT → one-sided
 * magnitudes with interior bins doubled (DC & Nyquist not) → 20·log10. The
 * reference's zero-phase (fftshift) rotation is omitted — a circular shift does
 * not change `|FFT|`.
 * @param samples Time-domain samples; truncated/zero-filled to `fftSize`.
 * @param sampleRate Sample rate, in Hz (sets the frequency axis).
 * @param fftSize FFT length (power of two).
 * @returns `{ magnitudesDb, frequencies }`, each length `fftSize/2 + 1` (DC … Nyquist).
 */
export function dftAnalRect(
  samples: Float32Array | Float64Array | number[],
  sampleRate: number,
  fftSize: number,
): Spectrum {
  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  const norm = 1 / fftSize // rectangular window divided by its sum (= fftSize)
  const copy = Math.min(samples.length, fftSize)
  for (let i = 0; i < copy; i++) re[i] = (samples[i] as number) * norm
  // The reference zero-phase-rotates (fftshift) before the FFT; that is a
  // circular shift and leaves |FFT| unchanged, so it is omitted here.

  fftInPlace(re, im)

  const half = fftSize >> 1
  const magnitudesDb = new Array<number>(half + 1)
  const frequencies = new Array<number>(half + 1)
  for (let i = 0; i <= half; i++) {
    let mag = Math.hypot(re[i]!, im[i]!)
    if (i >= 1 && i < half) mag *= 2 // one-sided: interior doubled; DC & Nyquist not
    // No epsilon clamp: a bin with no energy is -Infinity, which is what Swift's vDSP_vdbcon
    // produces. It has to stay distinguishable from -100 dB, a REAL level a live UMIK-1 reaches in
    // a quiet room — clamping to float64 epsilon put a precise-looking -313.0 dB on screen for the
    // absence of a signal instead (#17, run-review; Python carried the identical clamp).
    magnitudesDb[i] = 20 * Math.log10(mag)
    frequencies[i] = (i * sampleRate) / fftSize
  }
  return { magnitudesDb, frequencies }
}

/**
 * The spectrum's loudest bin — the live Peak readout. Mirrors Swift `RealtimeFFTAnalyzer`
 * (`db.enumerated().max(by: <)`) and Python `perform_fft` (`np.argmax`): the FIRST maximum wins a
 * tie, so an all -Infinity spectrum (a silent input) reports bin 0 — "-∞ dB @ 0.0 Hz" — rather than
 * no peak at all. Seeding the search at -Infinity and requiring a strictly greater bin found nothing
 * on silence and left the readout on "Starting..." (#17 run-review).
 */
export function spectrumPeak(spectrum: Spectrum): { frequency: number; magnitude: number } | null {
  const mags = spectrum.magnitudesDb
  if (mags.length === 0) return null
  let best = 0
  for (let i = 1; i < mags.length; i++) if (mags[i]! > mags[best]!) best = i
  return { frequency: spectrum.frequencies[best]!, magnitude: mags[best]! }
}

/** FFT length for continuous/captured guitar spectra (2^16), matching Swift/Python. */
export const GUITAR_FFT_SIZE = 65536

/** Resolved Air/Top/Back peaks (each optional) plus the full detected peak list. */
export interface GuitarModePeaks {
  air?: Peak
  top?: Peak
  back?: Peak
  peaks: Peak[]
}

/** Peak-finding inputs for a single guitar spectrum: magnitude gate, type, and analysis range. */
export interface GuitarOptions {
  peakMinThreshold: number
  guitarType?: GuitarTypeName
  minHz?: number
  maxHz?: number
}

// @parity audio/tap-analyzer
/**
 * Resolve Air/Top/Back mode peaks from an already-computed spectrum (no FFT). Used for
 * multi-tap comparison, where each tap's peaks are (re)found at the current Peak Min —
 * mirrors Swift TapEntry recomputing peaks on threshold change.
 * @param spectrum A previously-computed magnitude spectrum (dBFS) + frequency axis.
 * @param opts Peak-Min threshold, guitar type, and analysis Hz range.
 * @returns Resolved Air/Top/Back mode peaks plus the full peak list.
 */
export function modePeaksFromSpectrum(spectrum: Spectrum, opts: GuitarOptions): GuitarModePeaks {
  const guitarType = opts.guitarType ?? 'generic'
  const peaks = findPeaks(spectrum.magnitudesDb, spectrum.frequencies, {
    guitarType,
    minHz: opts.minHz ?? 30,
    maxHz: opts.maxHz ?? 2000,
    peakMinThreshold: opts.peakMinThreshold,
  })
  return {
    air: getPeak(peaks, 'air', guitarType),
    top: getPeak(peaks, 'top', guitarType),
    back: getPeak(peaks, 'back', guitarType),
    peaks,
  }
}