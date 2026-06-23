import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodeWav } from '../src/dsp/wav'
import { parseCalibration } from '../src/dsp/calibration'
import { gatedSingleTapPeak } from '../src/dsp/gatedCapture'

const oracle = JSON.parse(
  readFileSync(new URL('./fixtures/parity-oracle.json', import.meta.url), 'utf8'),
)
const REGB1 = oracle.filePlayback['REG-B1']
const TOL = oracle.tolerances // {freqHz:1, magDb:1, q:1}

function loadWav(name: string) {
  return decodeWav(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))))
}

describe('G3b — brace file playback (REG-B1)', () => {
  it('detects the longitudinal peak matching the oracle', () => {
    const wav = loadWav(REGB1.fixture)
    const cal = parseCalibration(
      readFileSync(new URL(`./fixtures/${REGB1.calibration}`, import.meta.url), 'utf8'),
    )
    const peak = gatedSingleTapPeak(wav.samples, wav.sampleRate, {
      tapDetectionThreshold: REGB1.settings.tapDetectionThreshold,
      minHz: 100,
      maxHz: 1200,
      preferLowestSignificant: false,
      calibration: cal,
    })
    expect(peak).not.toBeNull()
    const expected = REGB1.peaks[0]
    console.log(
      `REG-B1: got ${peak!.frequency.toFixed(5)} Hz / ${peak!.magnitude.toFixed(5)} dB / Q ${peak!.quality.toFixed(3)}`,
    )
    expect(Math.abs(peak!.frequency - expected.frequency)).toBeLessThan(TOL.freqHz)
    expect(Math.abs(peak!.magnitude - expected.magnitude)).toBeLessThan(TOL.magDb)
    expect(Math.abs(peak!.quality - expected.q)).toBeLessThan(TOL.q)
  })
})
