// @parity test/gated-fft
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { reviveNonFinite } from './selfBaseline'
import { computeGatedFFT, magnitudeAtFrequency } from '../src/dsp/gatedFFT'
import { makeToneSignal, makeSilence, type Tone } from '../src/dsp/signal'

// Targets come from the vendored parity oracle — the single source of truth that
// Swift/Python also pin against (§4 of PHASE2-DSP-HARNESS.md).
const oracle = JSON.parse(
  readFileSync(new URL('./fixtures/parity-oracle.json', import.meta.url), 'utf8'),
  reviveNonFinite, // "-Infinity" → -Infinity, as every oracle reader does
)
const G = oracle.gatedFft
const TOL: number = oracle.tolerances.gatedFftDb // 1.0 dB
const SR = 48000

interface GatedCase {
  tones: Tone[]
  binCentered?: boolean
  expected: { hz: number; db: number }[]
  deltaDb?: number
}

function check(c: GatedCase) {
  const { magnitudesDb, frequencies } = computeGatedFFT(makeToneSignal(c.tones, SR), SR)
  const got = c.expected.map((e) => magnitudeAtFrequency(e.hz, magnitudesDb, frequencies)!)
  c.expected.forEach((e, i) => {
    expect(Math.abs(got[i]! - e.db), `${e.hz} Hz: got ${got[i]}, want ${e.db}`).toBeLessThan(TOL)
  })
  if (c.deltaDb !== undefined) {
    const delta = got[got.length - 1]! - got[0]! // oracle lists tones low→high
    expect(Math.abs(delta - c.deltaDb), `delta: got ${delta}, want ${c.deltaDb}`).toBeLessThan(TOL)
  }
}

describe('G1 — gated FFT parity (GFFT1–5)', () => {
  it('GFFT1: single 100 Hz tone', () => check(G.GFFT1))
  it('GFFT2: two tones 67 / 117 Hz (+ delta)', () => check(G.GFFT2))
  it('GFFT3: bin-centred tones (+ delta)', () => check(G.GFFT3))
  // Silence reads EXACTLY what Swift reads — -Infinity in every bin, not a floor. The oracle used to
  // record only a bound (maxDbBelow: -100) because JSON cannot hold infinity; it now stores
  // "-Infinity" as a string and every edition compares exactly (#17 F44).
  it('GFFT4: silence reads -Infinity, exactly as Swift', () => {
    const { magnitudesDb } = computeGatedFFT(makeSilence(SR), SR)
    let max = -Infinity
    for (const v of magnitudesDb) if (v > max) max = v
    expect(max).toBe(G.GFFT4.maxDb)
  })
  it('GFFT5: bin-centred single tone', () => check(G.GFFT5))
})
