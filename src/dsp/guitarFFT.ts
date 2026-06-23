import { fftInPlace } from './fft'
import { findPeaks, type Peak } from './peaks'
import { getPeak } from './classify'
import { findAllLevelCrossings } from './gatedCapture'
import type { GuitarTypeName } from './guitarModes'

// Guitar (non-gated) FFT path, ported from dft_anal / performFFT:
// rectangular (boxcar) window normalised by its sum (= 1/N), one-sided spectrum
// with interior bins doubled (DC & Nyquist not), dBFS. This is distinct from the
// Hann-windowed gated path used for plate/brace.

const EPS = 2.220446049250313e-16

export interface Spectrum {
  magnitudesDb: number[]
  frequencies: number[]
}

/** Rectangular-window magnitude spectrum, length fftSize/2 + 1 (DC … Nyquist). */
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

/** Run the guitar FFT + peak-find + mode resolution on a mono spectrum window. */
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

const PRE_ROLL_DURATION = 0.2

/** Power-domain average of dB spectra: 10·log10(mean(10^(dB/10))). */
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

/** Multi-tap guitar: segment N taps, FFT each 65536 window, power-average, find modes. */
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
