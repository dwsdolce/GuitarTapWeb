// @parity tooling/gated-signal
//
// The one place the gated-FFT test signal is built and read back. Used by the GFFT parity tests
// (gated-fft.test.ts) and by the self-regression runner (parityRunner.ts), so both feed the transform
// the same samples by construction rather than by two copies kept in step (#17 F49). It lived in
// src/dsp/signal.ts until then, though nothing in the app used it.
//
// Mirrors Swift GuitarTapTests/GatedTestSignal.swift and Python tests/gated_signal.py.

/** One tone of a gated test signal: `[hz, amplitude]`, the oracle's shape. */
export type Tone = [freqHz: number, amplitude: number]

/**
 * The gated-FFT test signal: a sum of sine tones as float32 PCM. The sum is evaluated in double and
 * rounded to float32 once per sample (Math.fround): real audio arrives as float32 samples each
 * correctly rounded from the true waveform. No tones gives silence. The sample count is
 * `Math.trunc(sampleRate * duration)`.
 */
export function makeGatedTestSignal(tones: Tone[], sampleRate = 48000, duration = 0.4): Float32Array {
  const count = Math.trunc(sampleRate * duration)
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate
    let v = 0
    for (const [f, a] of tones) v += a * Math.sin(2 * Math.PI * f * t)
    out[i] = Math.fround(v)
  }
  return out
}

/** The magnitude (dB) at the bin nearest `targetHz`, or null for an empty spectrum. */
export function gatedMagnitudeAt(targetHz: number, magnitudesDb: number[], frequencies: number[]): number | null {
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
