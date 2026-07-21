// Two questions: (1) is REPLAY deterministic vs itself? (2) does replay match the SAVED live capture?
import { readFileSync } from 'node:fs'
import { RealtimeFFTAnalyzer } from '/Users/dws/src/GuitarTapWeb/src/audio/realtimeFFTAnalyzer'
import { TapToneAnalyzer } from '/Users/dws/src/GuitarTapWeb/src/state/tapToneAnalyzer'
import { decodeWav } from '/Users/dws/src/GuitarTapWeb/src/dsp/wav'
import { parseCalibration } from '/Users/dws/src/GuitarTapWeb/src/dsp/calibration'

const D = '/Users/dws/src/GuitarTap/Tests/All Platforms'
const STEM = 'dws-2024-umik-1-web-mac-1784225174'
const m = JSON.parse(readFileSync(`${D}/${STEM}.guitartap`, 'utf8'))[0]
function b64f32(s: string) { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4) }
const savedMags = b64f32(m.spectrumSnapshot.magnitudesData)
const cal = parseCalibration(readFileSync('/Users/dws/src/GuitarTap/Tests/7108913.txt', 'utf8'))

async function replay(): Promise<number[]> {
  const wav = decodeWav(new Uint8Array(readFileSync(`${D}/${STEM}.wav`)), { downmix: true })
  const a = new TapToneAnalyzer(); let done = false
  const e = new RealtimeFFTAnalyzer(
    { onProgress: (c: number) => { if (c === 0) a.beginGuitarAccumulation() },
      onGuitarTap: (s: any) => a.recordGuitarTap(s),
      onGuitarComplete: () => { a.processMultipleTaps(); done = true } },
    { tapDetectionThreshold: m.tapDetectionThreshold, numberOfTaps: 1 })
  e.initForTesting()
  await e.playFile(wav.samples, wav.sampleRate, { calibration: cal })
  if (!done) throw new Error('incomplete')
  return a.frozenMagnitudes
}
const r1 = await replay(), r2 = await replay()
let dRR = 0; for (let i = 0; i < r1.length; i++) dRR = Math.max(dRR, Math.abs(r1[i]! - r2[i]!))
let dRS = 0, at = -1; for (let i = 0; i < Math.min(r1.length, savedMags.length); i++) { const d = Math.abs(r1[i]! - savedMags[i]!); if (d > dRS) { dRS = d; at = i } }
console.log(`replay vs replay:  max |Δ| = ${dRR.toExponential(3)} dB   ${dRR === 0 ? '→ REPLAY IS DETERMINISTIC (bit-identical run-to-run)' : '→ replay is NOT deterministic'}`)
console.log(`replay vs SAVED:   max |Δ| = ${dRS.toExponential(3)} dB at bin ${at}`)
// characterize where replay-vs-saved differs: peak region vs noise floor
const peakBins = [Math.round(97 / (24000 / 32768)), Math.round(198 / (24000 / 32768)), Math.round(240 / (24000 / 32768))]
for (const b of peakBins) console.log(`   at ${(b * 24000 / 32768).toFixed(0)} Hz (a resonance): saved ${savedMags[b]!.toFixed(3)}  replay ${r1[b]!.toFixed(3)}  Δ ${(r1[b]! - savedMags[b]!).toFixed(4)} dB`)
