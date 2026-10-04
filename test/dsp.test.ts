// @parity test/dsp
//
// The DSP under peak finding and the live spectrum, against the shared case file, `dsp.json` — the same
// cases the Swift and Python suites run: parabolic interpolation and the Q factor (TapToneAnalyzer), and
// signals through RealtimeFFTAnalyzer's gated FFT, live FFT, live peak and per-chunk levels.
//
// Silence is -Infinity in every bin and on the readout, not a finite floor: -100 dB is a REAL reading (a
// quiet UMIK-1 reaches it, and it is the dead-input watchdog's threshold), so "no microphone at all" must
// not look like "a very quiet microphone". Detection keeps -100 on silence.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'

type Row = Record<string, unknown>
const DATA = JSON.parse(readFileSync('test/fixtures/dsp.json', 'utf8')) as Row
const rows = (key: string) => DATA[key] as Row[]

/** A number from the file: NaN and the infinities are written as strings. */
function num(value: unknown): number {
  if (value === 'NaN') return NaN
  if (value === 'Infinity') return Infinity
  if (value === '-Infinity') return -Infinity
  return value as number
}

/** `|actual − expected| ≤ relative·|expected| + absolute`; equal infinities match. */
function close(actual: number, expected: unknown): boolean {
  const e = num(expected)
  if (!Number.isFinite(e) || !Number.isFinite(actual)) return actual === e
  const tol = DATA.tolerance as { relative: number; absolute: number }
  return Math.abs(actual - e) <= tol.relative * Math.abs(e) + tol.absolute
}

/** A case's spectrum: inline, or named in `spectra`. */
function spectrum(row: Row): { mags: number[]; freqs: number[] } {
  const s = (row.spectrum ? (DATA.spectra as Record<string, Row>)[row.spectrum as string] : row) as Row
  return { mags: (s.magnitudes as unknown[]).map(num), freqs: (s.frequencies as unknown[]).map(num) }
}

/** A case's signal: silence, a constant (DC), an alternating ±amplitude (Nyquist), a constant plus an
 *  alternating, or a tone; a count of "fftSize" is the analyzer's FFT size. */
function signal(row: Row, fftSize: number): Float32Array {
  const s = row.signal as Row
  const n = s.count === 'fftSize' ? fftSize : (s.count as number)
  const out = new Float32Array(n)
  if (s.kind === 'silence') return out
  if (s.kind === 'constant') {
    const value = (s.value as number | undefined) ?? 0
    const alternating = (s.alternating as number | undefined) ?? 0
    for (let i = 0; i < n; i++) out[i] = value + (i % 2 === 0 ? alternating : -alternating)
    return out
  }
  const amp = s.amplitude as number
  const hz = s.frequency as number
  const rate = s.sampleRate as number
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate)
  return out
}

function loudest(mags: number[]): number {
  let best = 0
  for (let i = 1; i < mags.length; i++) if (mags[i]! > mags[best]!) best = i
  return best
}

describe('dsp — shared cases', () => {
  for (const row of rows('parabolicInterpolate')) {
    it(`parabolicInterpolate: ${row.id as string}`, () => {
      const { mags, freqs } = spectrum(row)
      const r = new TapToneAnalyzer().parabolicInterpolate(mags, freqs, row.peakIndex as number)
      const e = row.expect as Row
      expect(close(r.frequency, e.frequency), `frequency ${r.frequency}`).toBe(true)
      expect(close(r.magnitude, e.magnitude), `magnitude ${r.magnitude}`).toBe(true)
    })
  }

  for (const row of rows('calculateQFactor')) {
    it(`calculateQFactor: ${row.id as string}`, () => {
      const { mags, freqs } = spectrum(row)
      const r = new TapToneAnalyzer().calculateQFactor(mags, freqs, row.peakIndex as number, num(row.peakMagnitude))
      const e = row.expect as Row
      expect(close(r.quality, e.quality), `quality ${r.quality}`).toBe(true)
      expect(close(r.bandwidth, e.bandwidth), `bandwidth ${r.bandwidth}`).toBe(true)
    })
  }

  for (const row of rows('signals')) {
    it(`signal: ${row.id as string}`, () => {
      const e = row.expect as Row
      const engine = new RealtimeFFTAnalyzer()
      const samples = signal(row, engine.fftSize)
      const checkSpectrum = (mags: number[], freqs: number[]) => {
        if (e.binCount !== undefined) expect(mags.length, 'bin count').toBe(e.binCount)
        if (e.bin0 !== undefined) {
          expect(close(mags[0]!, e.bin0), `bin 0 ${mags[0]}`).toBe(true)
          expect(close(mags[mags.length - 1]!, e.lastBin), `last bin ${mags[mags.length - 1]}`).toBe(true)
          return
        }
        if (e.allNegativeInfinity !== undefined) {
          expect(mags.length > 0 && mags.every((m) => m === -Infinity), 'every bin -Infinity').toBe(e.allNegativeInfinity)
        } else {
          const i = loudest(mags)
          expect(close(freqs[i]!, e.peakFrequency), `peak frequency ${freqs[i]}`).toBe(true)
          expect(close(mags[i]!, e.peakMagnitude), `peak magnitude ${mags[i]}`).toBe(true)
        }
      }
      switch (row.path) {
        case 'gatedFFT': {
          const { magnitudesDb, frequencies } = engine.computeGatedFFT(samples, ((row.signal as Row).sampleRate as number) ?? 48000)
          checkSpectrum(magnitudesDb, frequencies)
          break
        }
        case 'computeFFT': {
          const mags = engine.computeFFT(samples)
          checkSpectrum(mags, mags.map((_, i) => (i * 48000) / engine.fftSize))
          break
        }
        case 'performFFT':
          engine.sampleRate = 48000
          engine.performFFT(samples)
          expect(close(engine.peakFrequency, e.peakFrequency), `peakFrequency ${engine.peakFrequency}`).toBe(true)
          expect(close(engine.peakMagnitude, e.peakMagnitude), `peakMagnitude ${engine.peakMagnitude}`).toBe(true)
          break
        case 'processRawSamples':
          engine.processRawSamples(samples)
          expect(close(engine.inputLevelDB, e.inputLevelDB), `inputLevelDB ${engine.inputLevelDB}`).toBe(true)
          expect(close(engine.readoutLevelDB, e.readoutLevelDB), `readoutLevelDB ${engine.readoutLevelDB}`).toBe(true)
          break
        default:
          throw new Error(`unknown path ${String(row.path)}`)
      }
    })
  }
})
