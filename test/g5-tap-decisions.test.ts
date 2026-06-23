import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodeWav } from '../src/dsp/wav'
import {
  findLevelCrossing,
  findAllLevelCrossings,
  alignCaptureToOnset,
} from '../src/dsp/gatedCapture'

const CHUNK = 1024

// Build a signal of `nChunks` 1024-sample chunks; chunks listed in `loud`
// carry a tone (RMS ≈ amp/√2), the rest are silent.
function chunkedSignal(nChunks: number, loud: Set<number>, amp = 0.1): Float32Array {
  const s = new Float32Array(nChunks * CHUNK)
  for (let c = 0; c < nChunks; c++) {
    if (!loud.has(c)) continue
    for (let i = 0; i < CHUNK; i++) s[c * CHUNK + i] = amp * Math.sin((2 * Math.PI * 200 * i) / 48000)
  }
  return s
}

describe('G5 — tap-detection decisions', () => {
  it('fires only after 2 consecutive above-threshold chunks (rising edge)', () => {
    // amp 0.1 sine → RMS ≈ 0.0707 → ≈ −23 dBFS, above a −50 threshold.
    const sig = chunkedSignal(12, new Set([5, 6]))
    expect(findLevelCrossing(sig, -50)).toBe(7 * CHUNK) // end of the 2nd above chunk (6)
  })

  it('does not fire on a single above-threshold chunk', () => {
    const sig = chunkedSignal(12, new Set([5])) // one loud chunk only
    expect(findLevelCrossing(sig, -50)).toBeNull()
  })

  it('separates two well-spaced taps (rising edge after a fall)', () => {
    const sig = chunkedSignal(40, new Set([5, 6, 25, 26]))
    const crossings = findAllLevelCrossings(sig, -50, 4 * CHUNK)
    expect(crossings).toEqual([7 * CHUNK, 27 * CHUNK])
  })

  it('detects the right number of taps in the real fixtures', () => {
    const load = (n: string) =>
      decodeWav(new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url))))
    const brace = load('brace-umik-1-swift-mac-1778816093.wav')
    const plate = load('plate-umik-1-swift-mac-1778816330.wav')
    const SR = 48000
    expect(findAllLevelCrossings(brace.samples, -53.33838, Math.round(SR * 0.5))).toHaveLength(1)
    expect(findAllLevelCrossings(plate.samples, -53.33838, Math.round(SR * 0.5))).toHaveLength(3)
  })

  it('onset alignment positions the transient at pre-onset (+backup)', () => {
    const buf = new Float32Array(10000)
    buf[5000] = 0.5 // a single transient after silence
    const windowSize = 4096
    const preOnset = 1000
    const out = alignCaptureToOnset(buf, windowSize, preOnset)
    let argmax = 0
    for (let i = 1; i < out.length; i++) if (Math.abs(out[i]!) > Math.abs(out[argmax]!)) argmax = i
    expect(argmax).toBe(preOnset + 32) // onset backed up by ONSET_BACKUP_SAMPLES (32)
    expect(out[argmax]).toBeCloseTo(0.5, 6)
  })
})
