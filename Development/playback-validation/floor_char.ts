import { readFileSync } from 'node:fs'
import { RealtimeFFTAnalyzer } from '/Users/dws/src/GuitarTapWeb/src/audio/realtimeFFTAnalyzer'
import { TapToneAnalyzer } from '/Users/dws/src/GuitarTapWeb/src/state/tapToneAnalyzer'
import { decodeWav } from '/Users/dws/src/GuitarTapWeb/src/dsp/wav'
import { parseCalibration } from '/Users/dws/src/GuitarTapWeb/src/dsp/calibration'
const D = '/Users/dws/src/GuitarTap/Tests/All Platforms', STEM = 'dws-2024-umik-1-web-mac-1784225174'
const m = JSON.parse(readFileSync(`${D}/${STEM}.guitartap`, 'utf8'))[0]
function b64f32(s: string) { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4) }
const saved = b64f32(m.spectrumSnapshot.magnitudesData), freqs = b64f32(m.spectrumSnapshot.frequenciesData)
const wav = decodeWav(new Uint8Array(readFileSync(`${D}/${STEM}.wav`)), { downmix: true })
const a = new TapToneAnalyzer(); let done = false
const e = new RealtimeFFTAnalyzer({ onProgress: (c: number) => { if (c === 0) a.beginGuitarAccumulation() }, onGuitarTap: (s: any) => a.recordGuitarTap(s), onGuitarComplete: () => { a.processMultipleTaps(); done = true } }, { tapDetectionThreshold: m.tapDetectionThreshold, numberOfTaps: 1 })
e.initForTesting(); await e.playFile(wav.samples, wav.sampleRate, { calibration: parseCalibration(readFileSync('/Users/dws/src/GuitarTap/Tests/7108913.txt', 'utf8')) })
const r = a.frozenMagnitudes
// Difference stats over bins where the SAVED value is within the -100 dB display/detection range.
let maxRel = 0, maxAt = -1, sumRel = 0, nRel = 0, exactRel = 0
for (let i = 0; i < saved.length; i++) {
  if (saved[i]! < -100) continue
  const d = Math.abs(r[i]! - saved[i]!); sumRel += d; nRel++
  if (d === 0) exactRel++
  if (d > maxRel) { maxRel = d; maxAt = i }
}
console.log(`RELEVANT range (saved >= -100 dB): ${nRel} bins`)
console.log(`  max |Δ| = ${maxRel.toExponential(3)} dB at ${freqs[maxAt]!.toFixed(1)} Hz (saved ${saved[maxAt]!.toFixed(3)}, replay ${r[maxAt]!.toFixed(3)})`)
console.log(`  mean |Δ| = ${(sumRel / nRel).toExponential(3)} dB   exact bins: ${exactRel}/${nRel}`)
// The 3 swift-margin freqs and the general -75..-78 near-gate band
console.log(`Near-gate band (saved -79..-77 dB):`)
let band = 0, bmax = 0
for (let i = 0; i < saved.length; i++) if (saved[i]! <= -77 && saved[i]! >= -79) { band++; bmax = Math.max(bmax, Math.abs(r[i]! - saved[i]!)) }
console.log(`  ${band} bins, max |Δ| = ${bmax.toExponential(3)} dB`)
