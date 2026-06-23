import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodeWav } from '../src/dsp/wav'
import { guitarModePeaks, guitarMultiTapModePeaks } from '../src/dsp/guitarFFT'

const oracle = JSON.parse(
  readFileSync(new URL('./fixtures/parity-oracle.json', import.meta.url), 'utf8'),
)
const TOL = oracle.tolerances

function loadMono(name: string) {
  return decodeWav(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))), {
    downmix: true,
  })
}

describe('G3d — guitar file playback (non-gated)', () => {
  it('REG-G1: single-tap Air/Top/Back match the oracle', () => {
    const reg = oracle.filePlayback['REG-G1']
    const wav = loadMono(reg.fixture)
    const result = guitarModePeaks(wav.samples, wav.sampleRate, {
      peakMinThreshold: reg.settings.peakMinThreshold,
      guitarType: 'generic',
    })
    for (const exp of reg.peaks as { role: 'air' | 'top' | 'back'; frequency: number; magnitude: number }[]) {
      const peak = result[exp.role]
      expect(peak, `${exp.role} peak not found`).toBeDefined()
      console.log(
        `REG-G1 ${exp.role}: got ${peak!.frequency.toFixed(5)} / ${peak!.magnitude.toFixed(5)}  (want ${exp.frequency} / ${exp.magnitude})`,
      )
      expect(Math.abs(peak!.frequency - exp.frequency)).toBeLessThan(TOL.freqHz)
      expect(Math.abs(peak!.magnitude - exp.magnitude)).toBeLessThan(TOL.magDb)
    }
  })

  it('REG-G2: 8-tap power-averaged Air/Top/Back match the oracle', () => {
    const reg = oracle.filePlayback['REG-G2']
    const wav = loadMono(reg.fixture)
    const result = guitarMultiTapModePeaks(wav.samples, wav.sampleRate, {
      peakMinThreshold: reg.settings.peakMinThreshold,
      tapDetectionThreshold: reg.settings.tapDetectionThreshold,
      numberOfTaps: reg.settings.numberOfTaps,
      guitarType: 'generic',
    })
    for (const exp of reg.averagedPeaks as { role: 'air' | 'top' | 'back'; frequency: number; magnitude: number }[]) {
      const peak = result[exp.role]
      expect(peak, `${exp.role} peak not found`).toBeDefined()
      console.log(
        `REG-G2 ${exp.role}: got ${peak!.frequency.toFixed(5)} / ${peak!.magnitude.toFixed(5)}  (want ${exp.frequency} / ${exp.magnitude})`,
      )
      expect(Math.abs(peak!.frequency - exp.frequency)).toBeLessThan(TOL.freqHz)
      expect(Math.abs(peak!.magnitude - exp.magnitude)).toBeLessThan(TOL.magDb)
    }
  })
})
