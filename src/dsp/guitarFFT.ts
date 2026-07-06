// @parity dsp/guitar-fft
import { fftInPlace } from './fft'
import { findPeaks, type Peak } from './peaks'
import { getPeak } from './classify'
import { findAllLevelCrossings } from './gatedCapture'
import type { GuitarTypeName } from './guitarModes'

/**
 * Guitar (non-gated, continuous/display) FFT path — the web port of Swift
 * `computeFFT` / Python `dft_anal`. A rectangular (boxcar) window normalised by
 * its sum (= 1/N), a full complex FFT, then the one-sided magnitude spectrum in
 * dBFS with interior bins doubled (DC & Nyquist not). Distinct from the
 * Hann-windowed gated path used for plate/brace (`gatedFFT.ts`).
 *
 * This file hosts MORE THAN ONE @parity group — file-level tagging is too coarse
 * to cross-check it, so each exported symbol carries its own tag:
 *   - `dftAnalRect`                → dsp/guitar-fft (the file's primary tag, above)
 *   - `averagePowerDb`             → dsp/spectrum-average
 *   - `guitarModePeaks`,
 *     `modePeaksFromSpectrum`,
 *     `guitarMultiTapModePeaks`    → audio/tap-analyzer (the web has no analyzer
 *       class, so its per-tap / multi-tap orchestration lives here as free
 *       functions, doc-enriched under that group).
 */

const EPS = 2.220446049250313e-16

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
    if (mag < EPS) mag = EPS
    magnitudesDb[i] = 20 * Math.log10(mag)
    frequencies[i] = (i * sampleRate) / fftSize
  }
  return { magnitudesDb, frequencies }
}

export const GUITAR_FFT_SIZE = 65536

export interface GuitarModePeaks {
  air?: Peak
  top?: Peak
  back?: Peak
  peaks: Peak[]
}

export interface GuitarOptions {
  peakMinThreshold: number
  guitarType?: GuitarTypeName
  minHz?: number
  maxHz?: number
}

// @parity audio/tap-analyzer
/**
 * Analyze one captured tap: rectangular-window FFT of `monoWindow`, then peak-find and
 * Air/Top/Back mode resolution — the web's per-tap equivalent of the Swift/Python analyzer's
 * analyze-magnitudes flow (no analyzer class on the web).
 * @param monoWindow Mono PCM capture window (fftSize 65536; truncated/zero-filled).
 * @param sampleRate Sample rate, in Hz.
 * @param opts Peak-Min threshold, guitar type, and analysis Hz range.
 * @returns Resolved Air/Top/Back mode peaks plus the full peak list.
 */
export function guitarModePeaks(
  monoWindow: Float32Array | Float64Array | number[],
  sampleRate: number,
  opts: GuitarOptions,
): GuitarModePeaks {
  const { magnitudesDb, frequencies } = dftAnalRect(monoWindow, sampleRate, GUITAR_FFT_SIZE)
  const guitarType = opts.guitarType ?? 'generic'
  const peaks = findPeaks(magnitudesDb, frequencies, {
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

const PRE_ROLL_DURATION = 0.2

// @parity dsp/spectrum-average
/**
 * Power-domain average of dB spectra — the web equivalent of Swift `averageSpectra`
 * / Python `average_spectra`. Averaging in the frequency domain (phase discarded) is
 * correct for non-periodic impulse responses: no inter-tap phase to preserve, and
 * power averaging reduces random noise while keeping consistent resonance peaks.
 *
 * Per bin: `dB_avg = 10·log10( mean( 10^(dB_t/10) ) )`.
 *
 * Unlike Swift/Python, this omits their length-mismatch guard (they return the first
 * spectrum if bin counts differ): every caller feeds spectra from
 * `dftAnalRect(GUITAR_FFT_SIZE)`, so all inputs are the same length and the guard
 * would be unreachable here.
 *
 * @param spectraDb One dBFS spectrum per tap (all the same length).
 * @returns The averaged dBFS spectrum ([] if empty; a copy of the single spectrum
 *   if there is only one).
 */
export function averagePowerDb(spectraDb: number[][]): number[] {
  const n = spectraDb.length
  if (n === 0) return []
  if (n === 1) return spectraDb[0]!.slice()
  const bins = spectraDb[0]!.length
  const out = new Array<number>(bins)
  for (let b = 0; b < bins; b++) {
    let powerSum = 0
    for (let t = 0; t < n; t++) powerSum += 10 ** (spectraDb[t]![b]! / 10)
    out[b] = 10 * Math.log10(powerSum / n)
  }
  return out
}

export interface GuitarMultiTapOptions extends GuitarOptions {
  tapDetectionThreshold: number
  numberOfTaps: number
}

// @parity audio/tap-analyzer
/**
 * Multi-tap guitar analysis over a whole recording: segment N taps by level-crossing, FFT
 * each 65536-sample window, power-average the spectra, then find + resolve modes on the
 * average. Mirrors the Swift/Python multi-tap flow (per-tap capture → averageSpectra →
 * findPeaks on the average).
 * @param mono Full mono recording to segment.
 * @param sampleRate Sample rate, in Hz.
 * @param opts Tap-detection threshold, number of taps, Peak-Min, guitar type, Hz range.
 * @returns Resolved Air/Top/Back mode peaks (from the averaged spectrum) plus the peak list.
 */
export function guitarMultiTapModePeaks(
  mono: Float32Array | Float64Array | number[],
  sampleRate: number,
  opts: GuitarMultiTapOptions,
): GuitarModePeaks {
  const crossings = findAllLevelCrossings(mono, opts.tapDetectionThreshold, GUITAR_FFT_SIZE)
  const preRoll = Math.round(sampleRate * PRE_ROLL_DURATION)
  const arr = ArrayBuffer.isView(mono) ? (mono as Float32Array) : (mono as number[])
  const taps = Math.min(opts.numberOfTaps, crossings.length)

  const perTapDb: number[][] = []
  let frequencies: number[] = []
  for (let t = 0; t < taps; t++) {
    const start = Math.max(0, crossings[t]! - preRoll)
    const window = arr.slice(start, start + GUITAR_FFT_SIZE)
    const spec = dftAnalRect(window, sampleRate, GUITAR_FFT_SIZE)
    perTapDb.push(spec.magnitudesDb)
    frequencies = spec.frequencies
  }

  const avg = averagePowerDb(perTapDb)
  const guitarType = opts.guitarType ?? 'generic'
  const peaks = findPeaks(avg, frequencies, {
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
