// @parity test/pitch
import { describe, it, expect } from 'vitest'
import { Pitch } from '../src/dsp/pitch'

const p = new Pitch(440)

// Reference values from the canonical Python Pitch(a4=440).
const REFERENCE: { f: number; note: string; cents: number; freq0: number }[] = [
  { f: 87.30731, note: 'F2', cents: 0.005, freq0: 87.30706 },
  { f: 164.09756, note: 'E3', cents: -7.53968, freq0: 164.81378 },
  { f: 240.5668, note: 'B3', cents: -45.27916, freq0: 246.94165 },
  { f: 440.0, note: 'A4', cents: 0.0, freq0: 440.0 },
  { f: 512.6888, note: 'C5', cents: -35.30417, freq0: 523.25113 },
  { f: 67.11537, note: 'C2', cents: 44.65389, freq0: 65.40639 },
]

describe('G4a — pitch (12-TET, A4=440)', () => {
  for (const r of REFERENCE) {
    it(`${r.f} Hz → ${r.note}`, () => {
      expect(p.note(r.f)).toBe(r.note)
      expect(p.cents(r.f)).toBeCloseTo(r.cents, 4)
      expect(p.freq0(r.f)).toBeCloseTo(r.freq0, 4)
    })
  }
})
