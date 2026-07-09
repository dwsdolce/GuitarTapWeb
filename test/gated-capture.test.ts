// @parity test/gated-capture
// Web-extra DSP layer: exercises the gated-capture functions directly on WAV
// fixtures (brace single-tap + plate full-session), one level below the
// engine-level file-playback regression. Reconcile with Swift/Python in Phase 4.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodeWav } from '../src/dsp/wav'
import { parseCalibration } from '../src/dsp/calibration'
import { gatedSingleTapPeak, platePeaks } from '../src/dsp/gatedCapture'

const oracle = JSON.parse(
  readFileSync(new URL('./fixtures/parity-oracle.json', import.meta.url), 'utf8'),
)
const TOL = oracle.tolerances // {freqHz:1, magDb:1, q:1}

function loadWav(name: string) {
  return decodeWav(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))))
}

// ── Brace: single gated tap (REG-B1) ──
const REGB1 = oracle.filePlayback['REG-B1']
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

// ── Plate: full session L→C→FLC (REG-P1) ──
const REGP1 = oracle.filePlayback['REG-P1']
function expectedFor(role: string) {
  return REGP1.peaks.find((p: { role: string }) => p.role === role)
}
describe('G3c — plate full-session file playback (REG-P1)', () => {
  it('segments L→C→FLC and matches the oracle per phase', () => {
    const wav = decodeWav(new Uint8Array(readFileSync(new URL(`./fixtures/${REGP1.fixture}`, import.meta.url))))
    const cal = parseCalibration(
      readFileSync(new URL(`./fixtures/${REGP1.calibration}`, import.meta.url), 'utf8'),
    )
    const peaks = platePeaks(wav.samples, wav.sampleRate, {
      tapDetectionThreshold: REGP1.settings.tapDetectionThreshold,
      calibration: cal,
    })

    const phases: [keyof typeof peaks, string][] = [
      ['longitudinal', 'longitudinal'],
      ['cross', 'cross'],
      ['flc', 'flc'],
    ]
    for (const [key, role] of phases) {
      const peak = peaks[key]
      const exp = expectedFor(role)
      expect(peak, `${role} peak not detected`).not.toBeNull()
      console.log(
        `REG-P1 ${role}: got ${peak!.frequency.toFixed(5)} / ${peak!.magnitude.toFixed(5)} / Q ${peak!.quality.toFixed(3)}  (want ${exp.frequency} / ${exp.magnitude} / ${exp.q})`,
      )
      expect(Math.abs(peak!.frequency - exp.frequency)).toBeLessThan(TOL.freqHz)
      expect(Math.abs(peak!.magnitude - exp.magnitude)).toBeLessThan(TOL.magDb)
      expect(Math.abs(peak!.quality - exp.q)).toBeLessThan(TOL.q)
    }
  })
})