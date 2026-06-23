// Synthetic test-signal generation, mirroring the Swift/Python GatedFFT parity
// helpers (makeTwoToneSignal / _make_two_tone_signal). Samples are quantized to
// float32 (Math.fround) to match the reference, which builds the signal as a
// numpy float32 array.

export type Tone = [freqHz: number, amplitude: number]

/** Sum of sine tones, t = i/sampleRate, count = floor(sampleRate·duration). */
export function makeToneSignal(
  tones: Tone[],
  sampleRate = 48000,
  duration = 0.4,
): Float32Array {
  const count = Math.trunc(sampleRate * duration)
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate
    let v = 0
    for (const [f, a] of tones) v += a * Math.sin(2 * Math.PI * f * t)
    out[i] = Math.fround(v) // matches numpy .astype(np.float32)
  }
  return out
}

/** Silence of the given duration (for the GFFT4 noise-floor check). */
export function makeSilence(sampleRate = 48000, duration = 0.4): Float32Array {
  return new Float32Array(Math.trunc(sampleRate * duration))
}
