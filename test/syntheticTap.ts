// @parity tooling/synthetic-tap
//
// A synthetic tap: a decaying sinusoid with a single resonance, at 48 kHz — the ring-out a capture
// finish is handed in place of microphone audio.
//
// Mirrors Swift GuitarTapTests/SyntheticTap.swift and Python tests/synthetic_tap.py.

/** `seconds` of a tap ringing at `hz`: 0.5 · e^(−6t) · sin(2π·hz·t), sampled at 48 kHz. */
export function syntheticTap(hz: number, seconds: number): Float32Array {
  const n = Math.floor(48000 * seconds)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = 0.5 * Math.exp((-i / 48000) * 6) * Math.sin((2 * Math.PI * hz * i) / 48000)
  return out
}
