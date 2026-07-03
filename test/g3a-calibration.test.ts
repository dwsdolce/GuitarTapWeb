import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseCalibration, interpolateToBins } from '../src/dsp/calibration'

const content = readFileSync(new URL('./fixtures/7108913.txt', import.meta.url), 'utf8')
const cal = parseCalibration(content, '7108913')

// Reference corrections from the canonical Python MicrophoneCalibration on the
// same file (flat extrapolation below 10.054 Hz and above 20016.816 Hz).
const REFERENCE: [freq: number, correction: number][] = [
  [5.0, -3.674], // below range → first point (flat)
  [10.054, -3.674], // first point exactly
  [35.35375, 1.291917], // plate fLC
  [67.11537, 0.982394], // plate fL
  [116.27016, 0.695389], // plate fC
  [200.0, 0.578504],
  [512.6888, 0.205131], // brace fL
  [1000.0, 0.018874],
  [25000.0, -1.1427], // above range → last point (flat)
]

describe('G3a — UMIK-1 calibration parse + interpolation', () => {
  it('parses the expected number of points and edges', () => {
    expect(cal.points.length).toBe(615)
    expect(cal.points[0]).toEqual({ frequency: 10.054, correction: -3.674 })
    expect(cal.points[cal.points.length - 1]).toEqual({ frequency: 20016.816, correction: -1.1427 })
    expect(cal.sensitivityFactor).toBeCloseTo(-0.524, 6)
  })

  it('parses referenceLevel from SESSION REF / SPL headers (provenance, mirrors Swift/Python)', () => {
    expect(cal.referenceLevel).toBeNull() // this fixture has no reference SPL
    expect(parseCalibration('"Sens Factor =-0.5dB, SESSION REF=94.0dBSPL"\n1000\t0\n').referenceLevel).toBe(94.0)
    expect(parseCalibration('* SPL 93.5 dB\n1000\t0\n').referenceLevel).toBe(93.5)
  })

  it('interpolates to bins matching the canonical Python output', () => {
    const freqs = REFERENCE.map((r) => r[0])
    const got = interpolateToBins(cal, freqs)
    REFERENCE.forEach(([, expected], i) => {
      expect(got[i]!).toBeCloseTo(expected, 5)
    })
  })
})
