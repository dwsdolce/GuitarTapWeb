// @parity test/gated-fft
//
// Parity tests for RealtimeFFTAnalyzer.computeGatedFFT, the transform every plate/brace capture runs.
// GFFT1–GFFT5 feed the oracle's synthetic signals and assert the oracle's dB, as Swift
// (GatedFFTParityTests.swift) and Python (test_gated_fft_parity.py) do — any systematic difference
// between the implementations shows up as a one-sided failure. The remaining cases pin rules the
// oracle cases cannot see: which window is used, that calibration is applied inside the transform,
// and that too little input is not a spectrum (#17 F49).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { reviveNonFinite } from './selfBaseline'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import { interpolateToBins, parseCalibration } from '../src/dsp/calibration'
import { makeGatedTestSignal, gatedMagnitudeAt, type Tone } from './gatedSignal'

const oracle = JSON.parse(
  readFileSync(new URL('./fixtures/parity-oracle.json', import.meta.url), 'utf8'),
  reviveNonFinite, // "-Infinity" → -Infinity, as every oracle reader does
)
const G = oracle.gatedFft
/** The cross-edition tolerance for gated-FFT dB, from the oracle. */
const TOL: number = oracle.tolerances.gatedFftDb
const SR = 48000

interface GatedCase {
  tones: Tone[]
  expected: { hz: number; db: number }[]
  deltaDb?: number
}

/** A fresh analyzer. Its constructor touches no hardware and loads no calibration. */
const analyzer = () => new RealtimeFFTAnalyzer()

/** Runs one oracle case and checks each expected tone, and the delta where the case records one. */
function check(name: string) {
  const c = G[name] as GatedCase
  const { magnitudesDb, frequencies } = analyzer().computeGatedFFT(makeGatedTestSignal(c.tones, SR), SR)
  const got = c.tones.map(([hz]) => gatedMagnitudeAt(hz, magnitudesDb, frequencies)!)
  c.tones.forEach(([hz], i) => {
    const want = c.expected.find((e) => Math.abs(e.hz - hz) < 1e-6)!.db
    expect(Math.abs(got[i]! - want), `${name} ${hz} Hz: web=${got[i]} dB, oracle=${want} dB`).toBeLessThan(TOL)
  })
  if (got.length >= 2) {
    const delta = got[1]! - got[0]!
    expect(Math.abs(delta - c.deltaDb!), `${name} delta: web=${delta} dB, oracle=${c.deltaDb} dB`).toBeLessThan(TOL)
  }
}

describe('gated FFT parity (GFFT1–5) and the transform’s own rules', () => {
  it('GFFT1 — single tone matches the oracle', () => check('GFFT1'))

  // Two tones at the plate-C capture frequencies that once exposed a discrepancy.
  it('GFFT2 — two tones match the oracle', () => check('GFFT2'))

  // Two tones whose frequencies are exact bin centres (bins 46 and 80 at 32768 points). Being bin
  // centres does NOT remove leakage here: the window spans the padded 32768 samples and the signal
  // only the first 19200, so no tone is periodic in the window. The 67 Hz tone reads differently here
  // from GFFT5, where it is alone — that difference is leakage from the 117 Hz tone.
  it('GFFT3 — bin-centred two tones match the oracle', () => check('GFFT3'))

  // Silence reads exactly the oracle's value — -Infinity in every bin. The oracle stores it as the
  // string "-Infinity", which every edition's reader decodes (#17 F44).
  it('GFFT4 — silence is -Infinity in every bin', () => {
    const { magnitudesDb } = analyzer().computeGatedFFT(makeGatedTestSignal([], SR), SR)
    let max = -Infinity
    for (const v of magnitudesDb) if (v > max) max = v
    expect(max).toBe(G.GFFT4.maxDb)
  })

  // One bin-centred tone. Pins the window's normalisation: Swift's HANN_NORM instead of HANN_DENORM
  // would read about 4.26 dB high.
  it('GFFT5 — bin-centred single tone matches the oracle', () => check('GFFT5'))

  // The window is the PERIODIC Hann, 0.5·(1 − cos 2πn/N). A constant input fills the padded length,
  // so the windowed signal IS the window, and a periodic Hann's spectrum is exactly bins 0 and 1:
  // every bin from 2 up is empty. The symmetric form, numpy.hanning's (N−1), leaks into those bins
  // at about −100 dB. The two are otherwise too close for any oracle tolerance to tell apart, which
  // is how this edition drifted to the symmetric one before.
  it('the gated window is the periodic Hann', () => {
    const n = 32768
    const { magnitudesDb } = analyzer().computeGatedFFT(new Float32Array(n).fill(1), SR)
    expect(magnitudesDb.length).toBe(n / 2)
    let highest = -Infinity
    for (let i = 2; i < magnitudesDb.length; i++) if (magnitudesDb[i]! > highest) highest = magnitudesDb[i]!
    expect(highest, `bins ≥ 2 must be empty for a periodic Hann; highest is ${highest} dB`).toBeLessThan(-120)
  })

  // Fewer than two samples is not a spectrum: the result is empty, which callers treat as a failed
  // capture ("tap again").
  it('fewer than two samples gives an empty spectrum', () => {
    for (const count of [0, 1]) {
      const { magnitudesDb, frequencies } = analyzer().computeGatedFFT(new Float32Array(count).fill(0.5), SR)
      expect(magnitudesDb.length + frequencies.length, `${count} sample(s)`).toBe(0)
    }
  })

  // Calibration is applied INSIDE the transform, from the analyzer's active calibration at the moment
  // of the call: the calibrated spectrum is the uncalibrated one plus the calibration's correction at
  // every bin. Uses the UMIK-1 calibration fixture the file-playback cases use.
  it('calibration is applied inside the gated transform', () => {
    const cal = parseCalibration(
      readFileSync(new URL('./fixtures/7108913.txt', import.meta.url), 'utf8'),
      '7108913.txt',
    )
    const signal = makeGatedTestSignal((G.GFFT2 as GatedCase).tones, SR)

    const a = analyzer()
    const plain = a.computeGatedFFT(signal, SR)
    a.setCalibration(cal)
    const calibrated = a.computeGatedFFT(signal, SR)

    expect(calibrated.frequencies).toEqual(plain.frequencies)
    const corrections = interpolateToBins(cal, plain.frequencies)
    expect(corrections.length).toBe(plain.magnitudesDb.length)
    expect(corrections.some((c) => Math.abs(c) > 0.5), 'the fixture must correct by a visible amount').toBe(true)
    let worst = 0
    plain.magnitudesDb.forEach((db, i) => {
      if (Number.isFinite(db)) worst = Math.max(worst, Math.abs(calibrated.magnitudesDb[i]! - (db + corrections[i]!)))
    })
    expect(worst, 'calibrated ≠ uncalibrated + correction').toBeLessThanOrEqual(1e-4)
  })
})
