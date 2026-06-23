import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { computeGatedFFT, magnitudeAtFrequency } from '../src/dsp/gatedFFT'
import { makeToneSignal, makeSilence, type Tone } from '../src/dsp/signal'

// Targets come from the vendored parity oracle — the single source of truth that
// Swift/Python also pin against (§4 of PHASE2-DSP-HARNESS.md).
const oracle = JSON.parse(
  readFileSync(new URL('./fixtures/parity-oracle.json', import.meta.url), 'utf8'),
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
  it('GFFT4: silence sits below the noise floor', () => {
    const { magnitudesDb } = computeGatedFFT(makeSilence(SR), SR)
    let max = -Infinity
    for (const v of magnitudesDb) if (v > max) max = v
    expect(max).toBeLessThan(G.GFFT4.maxDbBelow)
  })
  it('GFFT5: bin-centred single tone', () => check(G.GFFT5))
})
