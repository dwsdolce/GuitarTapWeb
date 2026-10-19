// @parity test/wav-dump-folder
// The capture WAV the web hands the browser to download when Dump Capture Audio is on: one channel of 32-bit
// floats at the capture's rate, its samples as recorded (WD1–WD2, the shared cases in wav-dump-folder.json —
// the same list as Swift WavDumpFolderTests and Python test_wav_dump_folder.py, which write theirs to the
// dump folder).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodeWav, encodeWavFloat32 } from '../src/dsp/wav'

type Case = {
  id: string
  note: string
  samples: number[]
  sampleRate: number
  expect: { format: number; channels: number; bitsPerSample: number; sampleRate: number }
}
const DATA = JSON.parse(readFileSync('test/fixtures/wav-dump-folder.json', 'utf8')) as { cases: Case[] }

describe('wav-dump — the file written (wav-dump-folder.json)', () => {
  for (const c of DATA.cases) {
    it(`${c.id}: ${c.note}`, () => {
      const w = decodeWav(encodeWavFloat32(new Float32Array(c.samples), c.sampleRate))
      expect(w.format, `${c.id} format`).toBe(c.expect.format)
      expect(w.channels, `${c.id} channels`).toBe(c.expect.channels)
      expect(w.bitsPerSample, `${c.id} bitsPerSample`).toBe(c.expect.bitsPerSample)
      expect(w.sampleRate, `${c.id} sampleRate`).toBe(c.expect.sampleRate)
      expect(w.samples.length, `${c.id} samples`).toBe(c.samples.length)
      c.samples.forEach((v, i) => expect(Math.abs(w.samples[i]! - v), `${c.id} sample ${i}`).toBeLessThanOrEqual(1e-6))
    })
  }
})
