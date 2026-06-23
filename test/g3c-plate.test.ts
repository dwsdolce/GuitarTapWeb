import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodeWav } from '../src/dsp/wav'
import { parseCalibration } from '../src/dsp/calibration'
import { platePeaks } from '../src/dsp/gatedCapture'

const oracle = JSON.parse(
  readFileSync(new URL('./fixtures/parity-oracle.json', import.meta.url), 'utf8'),
)
const REGP1 = oracle.filePlayback['REG-P1']
const TOL = oracle.tolerances

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
