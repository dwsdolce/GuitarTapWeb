// Fingerprint the replayed frozen spectrum — does NOT import any file I changed
// (only realtimeFFTAnalyzer, tapToneAnalyzer, decodeWav, parseCalibration).
import { readFileSync } from 'node:fs'
import { RealtimeFFTAnalyzer } from '/Users/dws/src/GuitarTapWeb/src/audio/realtimeFFTAnalyzer'
import { TapToneAnalyzer } from '/Users/dws/src/GuitarTapWeb/src/state/tapToneAnalyzer'
import { decodeWav } from '/Users/dws/src/GuitarTapWeb/src/dsp/wav'
import { parseCalibration } from '/Users/dws/src/GuitarTapWeb/src/dsp/calibration'
const D = '/Users/dws/src/GuitarTap/Tests/All Platforms', STEM = 'dws-2024-umik-1-web-mac-1784225174'
const m = JSON.parse(readFileSync(`${D}/${STEM}.guitartap`, 'utf8'))[0]
const wav = decodeWav(new Uint8Array(readFileSync(`${D}/${STEM}.wav`)), { downmix: true })
const a = new TapToneAnalyzer(); let done = false
const e = new RealtimeFFTAnalyzer({ onProgress: (c: number) => { if (c === 0) a.beginGuitarAccumulation() }, onGuitarTap: (s: any) => a.recordGuitarTap(s), onGuitarComplete: () => { a.processMultipleTaps(); done = true } }, { tapDetectionThreshold: m.tapDetectionThreshold, numberOfTaps: 1 })
e.initForTesting(); await e.playFile(wav.samples, wav.sampleRate, { calibration: parseCalibration(readFileSync('/Users/dws/src/GuitarTap/Tests/7108913.txt', 'utf8')) })
const r = a.frozenMagnitudes
let sum = 0; for (const v of r) sum += v
// exact-ish fingerprint: length, full-precision sum, and a few raw bins
console.log(`len=${r.length} sum=${sum.toExponential(12)} b1000=${r[1365]} b8000=${r[10923]} b19181=${r[26189]}`)
