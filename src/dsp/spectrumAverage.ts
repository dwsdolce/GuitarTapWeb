import type { Spectrum } from './guitarFFT'

// Frequency-domain power averaging of multiple tap spectra. Mirrors Python
// average_spectra() / Swift averageSpectra(from:): convert each bin's dB to
// linear power, average, convert back to dB. A single tap is returned unchanged;
// mismatched bin counts fall back to the first tap.
export function averageSpectra(taps: Spectrum[]): Spectrum {
  if (taps.length === 0) throw new Error('averageSpectra: no taps')
  if (taps.length === 1) return taps[0]!

  const first = taps[0]!
  const nBins = first.magnitudesDb.length
  if (!taps.every((t) => t.magnitudesDb.length === nBins)) return first

  const nTaps = taps.length
  const magnitudesDb = new Array<number>(nBins)
  for (let b = 0; b < nBins; b++) {
    let powerSum = 0
    for (let t = 0; t < nTaps; t++) powerSum += 10 ** (taps[t]!.magnitudesDb[b]! / 10)
    magnitudesDb[b] = 10 * Math.log10(powerSum / nTaps)
  }
  return { magnitudesDb, frequencies: first.frequencies }
}
