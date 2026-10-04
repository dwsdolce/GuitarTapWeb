/** The live spectrum's shape and FFT size. The live FFT itself is `RealtimeFFTAnalyzer.computeFFT`. */


/** A magnitude spectrum: parallel dBFS magnitudes and their bin centre frequencies (Hz). */
export interface Spectrum {
  magnitudesDb: number[]
  frequencies: number[]
}

/** FFT length for continuous/captured guitar spectra (2^16), matching Swift/Python. */
export const GUITAR_FFT_SIZE = 65536
