// @parity test/audio-chunking
// The pipeline processes fixed-size chunks, whatever size of block the browser delivers. The worklet
// (public/spectrum-processor.js) collects the browser's render quanta into chunks of 1024 — the size Swift
// and Python process — every sample kept, in order (AC1); and the audio clock advances one chunk at a time
// (AC2). Mirrors Swift AudioChunkingTests (Python is handed chunks of this size by PortAudio).
import { beforeAll, describe, it, expect } from 'vitest'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'

type Posted = { samples: Float32Array; rms: number }
type Processor = { port: { postMessage(m: Posted): void }; process(inputs: Float32Array[][]): boolean }
let SpectrumProcessor: new () => Processor

beforeAll(async () => {
  // The worklet's globals, as the browser's AudioWorkletGlobalScope gives them.
  const scope = globalThis as unknown as Record<string, unknown>
  scope.AudioWorkletProcessor = class {
    port = { postMessage: (_m: Posted) => {} }
  }
  scope.registerProcessor = (_name: string, cls: new () => Processor) => {
    SpectrumProcessor = cls
  }
  // A path, not a literal: the worklet is plain JavaScript for the browser, with no types to resolve.
  const worklet = new URL('../public/spectrum-processor.js', import.meta.url).href
  await import(/* @vite-ignore */ worklet)
})

const ramp = (count: number, from = 0) => Float32Array.from({ length: count }, (_, i) => from + i)

describe('audio chunking (web)', () => {
  // AC1: blocks larger than, smaller than, and not a multiple of a chunk all reach the pipeline as whole
  // chunks, every sample kept in order. (The browser's blocks are 128 frames; the others are Swift's cases.)
  for (const size of [4800, 777, 512, 1024, 128]) {
    it(`AC1: blocks of ${size} reach the pipeline as whole chunks of 1024, in order`, () => {
      const processor = new SpectrumProcessor()
      const seen: Float32Array[] = []
      processor.port.postMessage = (m) => seen.push(m.samples)
      const total = 48000
      for (let sent = 0; sent < total; sent += size) processor.process([[ramp(Math.min(size, total - sent), sent)]])
      expect(seen.every((c) => c.length === 1024)).toBe(true)
      expect(seen.length).toBe(Math.floor(total / 1024))
      const all = seen.flatMap((c) => Array.from(c))
      expect(all.every((v, i) => v === i), 'REGRESSION: samples dropped, repeated or reordered between blocks').toBe(true)
    })
  }

  // AC2: the audio clock advances one chunk at a time.
  it('AC2: the audio clock advances by whole chunks', () => {
    const engine = new RealtimeFFTAnalyzer()
    engine.initForTesting()
    engine.sampleRate = 48000
    const times: number[] = []
    engine.onAudioFrame((_samples, _level, audioTime) => times.push(audioTime))
    for (let i = 0; i < 4; i++) (engine as unknown as { processRawSamples(s: Float32Array): void }).processRawSamples(ramp(1024))
    const step = 1024 / 48000
    expect(times.length).toBe(4)
    times.forEach((t, i) => expect(Math.abs(t - (i + 1) * step), `chunk ${i + 1} stamped ${t}`).toBeLessThan(1e-9))
  })
})
