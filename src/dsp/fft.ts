/**
 * Iterative radix-2 Cooley–Tukey FFT, in place — a from-scratch complex FFT
 * primitive. The browser has no built-in FFT, so this stands in for the library
 * transforms the native apps use: Swift's Accelerate/vDSP and Python's
 * `numpy.fft.fft`. There is therefore no hand-written Swift/Python counterpart to
 * this function — the `@parity dsp/fft` tag on their side marks the vDSP / numpy
 * call sites. The higher-level "window → FFT → magnitude → dB" pipeline that
 * consumes this primitive is `guitarFFT.ts` (`dsp/guitar-fft` ↔ Swift `computeFFT`
 * ↔ Python `dft_anal`).
 *
 * Forward transform, `exp(-2πi·kn/N)` convention, unnormalised — identical to
 * `numpy.fft.fft` and vDSP's forward DFT, so magnitudes match the reference.
 */
// @parity dsp/fft

/**
 * In-place forward FFT of a complex signal (`re` + i·`im`); overwrites both arrays
 * with the transform. `im` is typically all-zero on input (a real signal).
 * @param re Real parts; overwritten with the transform's real parts.
 * @param im Imaginary parts (same length as `re`); overwritten with the imaginary parts.
 * @throws If `re`/`im` lengths differ, or the length is not a power of two.
 */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if (n !== im.length) throw new Error('fftInPlace: re/im length mismatch')
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new Error(`fftInPlace: length must be a power of two, got ${n}`)
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti
    }
  }

  // Butterflies.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len // forward transform
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < half; k++) {
        const a = i + k
        const b = a + half
        const bRe = re[b]! * curRe - im[b]! * curIm
        const bIm = re[b]! * curIm + im[b]! * curRe
        re[b] = re[a]! - bRe
        im[b] = im[a]! - bIm
        re[a] = re[a]! + bRe
        im[a] = im[a]! + bIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}