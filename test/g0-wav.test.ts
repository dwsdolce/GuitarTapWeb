import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodeWav, encodeWavFloat32 } from '../src/dsp/wav'

function load(name: string) {
  const buf = readFileSync(new URL(`./fixtures/${name}`, import.meta.url))
  return decodeWav(new Uint8Array(buf))
}

// Frame counts / formats measured directly from the canonical fixtures.
// The brace/plate WAVs are mono float32 (the app's capture format); the guitar
// recordings are stereo int16 — decodeWav returns channel 0. (Stereo→mono
// down-mix for guitar peak parity is a G3 concern, not decode correctness.)
const cases = [
  { name: 'Recording 5.wav', sampleRate: 48000, channels: 2, format: 1, bits: 16, frames: 25390 },
  { name: 'Recording.wav', sampleRate: 48000, channels: 2, format: 1, bits: 16, frames: 871424 },
  { name: 'brace-umik-1-swift-mac-1778816093.wav', sampleRate: 48000, channels: 1, format: 3, bits: 32, frames: 201600 },
  { name: 'plate-umik-1-swift-mac-1778816330.wav', sampleRate: 48000, channels: 1, format: 3, bits: 32, frames: 1411200 },
]

describe('G0 — WAV decode (native rate, no resample)', () => {
  for (const c of cases) {
    it(`decodes ${c.name}`, () => {
      const w = load(c.name)
      expect(w.sampleRate).toBe(c.sampleRate)
      expect(w.channels).toBe(c.channels)
      expect(w.format).toBe(c.format)
      expect(w.bitsPerSample).toBe(c.bits)
      expect(w.samples.length).toBe(c.frames)
      expect(Number.isFinite(w.samples[0]!)).toBe(true)
      expect(Number.isFinite(w.samples[w.samples.length - 1]!)).toBe(true)
    })
  }
})

describe('G0 — WAV encode (Dump Capture Audio: mono float32)', () => {
  it('writes a header decodeWav reads back losslessly', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.123456, -0.9999])
    const w = decodeWav(encodeWavFloat32(samples, 44100))
    expect(w.format).toBe(3) // IEEE float
    expect(w.channels).toBe(1)
    expect(w.bitsPerSample).toBe(32)
    expect(w.sampleRate).toBe(44100)
    expect(w.samples.length).toBe(samples.length)
    for (let i = 0; i < samples.length; i++) expect(w.samples[i]!).toBeCloseTo(samples[i]!, 6)
  })

  it('preserves the capture sample rate', () => {
    expect(decodeWav(encodeWavFloat32(new Float32Array(8), 48000)).sampleRate).toBe(48000)
  })
})
