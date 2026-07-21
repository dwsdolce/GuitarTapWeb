// Corpus playback report (web engine) — replay every web-captured guitar WAV with the
// calibration named in its own measurement file; report winners vs saved + duplicate check.
import { readFileSync } from 'node:fs'
import { RealtimeFFTAnalyzer } from '/Users/dws/src/GuitarTapWeb/src/audio/realtimeFFTAnalyzer'
import { TapToneAnalyzer } from '/Users/dws/src/GuitarTapWeb/src/state/tapToneAnalyzer'
import { decodeWav } from '/Users/dws/src/GuitarTapWeb/src/dsp/wav'
import { findPeaks } from '/Users/dws/src/GuitarTapWeb/src/dsp/peaks'
import { resolvedModePeaks } from '/Users/dws/src/GuitarTapWeb/src/dsp/classify'
import { parseCalibration } from '/Users/dws/src/GuitarTapWeb/src/dsp/calibration'

const D = '/Users/dws/src/GuitarTap/Tests/All Platforms'
const CAL = '/Users/dws/src/GuitarTap/Tests/7108913.txt'
const ref = JSON.parse(readFileSync('/private/tmp/claude-501/-Users-dws-src-GuitarTapWeb/0cf0989c-33d7-43de-8dfd-b5bc591c0172/scratchpad/ref_winners.json', 'utf8'))
const FILES = Object.keys(ref).filter((s) => s.includes('web')).sort()
const PROX = 2

for (const stem of FILES) {
  const r = ref[stem]
  const wav = decodeWav(new Uint8Array(readFileSync(`${D}/${stem}.wav`)), { downmix: true })
  const analyzer = new TapToneAnalyzer()
  let complete = false
  const engine = new RealtimeFFTAnalyzer(
    {
      onProgress: (c: number) => { if (c === 0) analyzer.beginGuitarAccumulation() },
      onGuitarTap: (s: any) => analyzer.recordGuitarTap(s),
      onGuitarComplete: () => { analyzer.processMultipleTaps(); complete = true },
    },
    { tapDetectionThreshold: r.tapThr, numberOfTaps: r.taps },
  )
  engine.initForTesting()
  const cal = r.cal ? parseCalibration(readFileSync(CAL, 'utf8')) : null
  await engine.playFile(wav.samples, wav.sampleRate, { calibration: cal })
  if (!complete) { console.log(`${stem}: CAPTURE DID NOT COMPLETE`); continue }

  const peaks = findPeaks(analyzer.frozenMagnitudes, analyzer.frozenFrequencies, {
    guitarType: 'generic', peakMinThreshold: r.peakMin, minHz: 30, maxHz: 2000,
  }).sort((a, b) => a.frequency - b.frequency)
  const dupes: string[] = []
  for (let i = 0; i < peaks.length; i++) for (let j = i + 1; j < peaks.length; j++)
    if (Math.abs(peaks[i]!.frequency - peaks[j]!.frequency) < PROX) dupes.push(peaks[i]!.frequency.toFixed(3))
  const winners = resolvedModePeaks(peaks, 'generic')
  console.log(`╔══ ${stem}  [web, cal=${r.cal}, taps=${r.taps}] ══`)
  console.log(`║ replay peaks: ${peaks.length}   saved: ${r.savedPeaks}   duplicates: ${dupes.length ? dupes.join(', ') : 'NONE ✓'}`)
  for (const [name, mode] of [['Air', 'air'], ['Top', 'top'], ['Back', 'back']] as const) {
    const p = winners.get(mode), w = r.winners[name.toLowerCase()]
    if (!w) { console.log(`║ ${name}: saved none  replay ${p ? p.frequency.toFixed(2) + 'Hz' : 'none'}`); continue }
    if (!p) { console.log(`║ ${name}: MISSING in replay (saved ${w.f} Hz)`); continue }
    console.log(`║ ${name.padEnd(4)} replay ${p.frequency.toFixed(3).padStart(8)} ${p.magnitude.toFixed(2).padStart(7)}   saved ${w.f.toFixed(3).padStart(8)} ${w.m.toFixed(2).padStart(7)}   Δ ${(p.frequency - w.f >= 0 ? '+' : '') + (p.frequency - w.f).toFixed(2)}Hz ${(p.magnitude - w.m >= 0 ? '+' : '') + (p.magnitude - w.m).toFixed(2)}dB`)
  }
  console.log('╚' + '═'.repeat(40))
}
