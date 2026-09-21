// @parity test/pitch
import { describe, it, expect } from 'vitest'
import { Pitch, roundTiesToEven } from '../src/dsp/pitch'

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

// ── The rest of the package ────────────────────────────────────────────────────────────────
//
// Pitch is deliberately a GENERAL package, not only what the app calls: pitchRange,
// formattedNote and isInTune have no call site in any edition. They are still implemented and
// tested in all three, because the package's API is the contract, not the subset an app happens
// to use today. This edition carried only that subset until the #17 sweep, which is why
// test/pitch read 22/22/6 — a difference in surface, not a gap in coverage. See SLUG-SWEEP.md F13.
//
// Every expected value below comes from the canonical natives, not from running this code.

describe('pitchRange — the bracketing semitones', () => {
  // Which side the nearest note falls on is decided by the SIGN of the cents offset. That branch
  // is load-bearing: forcing it always-true fails the two "flat" cases below. The natives also
  // had `note === 0 / === 11` branches claiming to handle octave boundaries; those did nothing,
  // because freq() has no bounds check and the exponent carries the octave.
  it('exactly on the note: the note is the lower bound', () => {
    const r = p.pitchRange(440)
    expect(r.lower).toBeCloseTo(440.0, 4)
    expect(r.upper).toBeCloseTo(466.16376, 4)
  })

  it('sharp of the note: same side as exact', () => {
    const r = p.pitchRange(442)
    expect(r.lower).toBeCloseTo(440.0, 4)
    expect(r.upper).toBeCloseTo(466.16376, 4)
  })

  it('flat of the note: the note becomes the UPPER bound', () => {
    const r = p.pitchRange(438)
    expect(r.upper).toBeCloseTo(440.0, 4)
    expect(r.lower).toBeCloseTo(415.3047, 4)
  })

  it('sharp of B: the upper bound crosses into the next octave', () => {
    const b4 = p.freq(11, 4)
    const r = p.pitchRange(b4 * 1.01)
    expect(r.lower).toBeCloseTo(493.8833, 4)
    expect(r.upper).toBeCloseTo(523.25113, 4)
  })

  it('flat of C: the lower bound crosses into the previous octave', () => {
    const c5 = p.freq(0, 5)
    const r = p.pitchRange(c5 * 0.99)
    expect(r.upper).toBeCloseTo(523.25113, 4)
    expect(r.lower).toBeCloseTo(493.8833, 4)
  })

  it('the bounds are always one semitone apart', () => {
    for (const f of [440.0, 442.0, 438.0, 82.41, 1046.5, 65.406]) {
      const r = p.pitchRange(f)
      expect(r.upper / r.lower).toBeCloseTo(2 ** (1 / 12), 6)
    }
  })

  it('matches the natives on the reference frequencies', () => {
    const expected: [number, number, number][] = [
      [87.30731, 92.49861, 87.30706],
      [164.09756, 164.81378, 155.56349],
      [240.5668, 246.94165, 233.08188],
      [512.6888, 523.25113, 493.8833],
      [67.11537, 69.29566, 65.40639],
    ]
    for (const [f, upper, lower] of expected) {
      const r = p.pitchRange(f)
      expect(r.upper, `${f} Hz upper`).toBeCloseTo(upper, 4)
      expect(r.lower, `${f} Hz lower`).toBeCloseTo(lower, 4)
    }
  })
})

describe('formattedNote', () => {
  it('matches the natives, sign and all', () => {
    expect(p.formattedNote(440.0)).toBe('A4 (+0 cents)')
    expect(p.formattedNote(442.0)).toBe('A4 (+8 cents)')
    expect(p.formattedNote(438.0)).toBe('A4 (-8 cents)')
    expect(p.formattedNote(87.30731)).toBe('F2 (+0 cents)')
    expect(p.formattedNote(164.09756)).toBe('E3 (-8 cents)')
    expect(p.formattedNote(240.5668)).toBe('B3 (-45 cents)')
    expect(p.formattedNote(512.6888)).toBe('C5 (-35 cents)')
    expect(p.formattedNote(67.11537)).toBe('C2 (+45 cents)')
  })

  it('rounds ties to EVEN, as C printf and Python do — not away from zero like toFixed', () => {
    // Pinned on the formatter directly, not through a frequency, because an exact tie is not
    // reachable that way: 440 * 2^(2.5/1200) gives 2.5000000000003633 cents in EVERY edition,
    // which is genuinely above the tie and formats as 3 in all three. Verified against Python
    // before writing this — the first version of this test asserted 2 and was simply wrong.
    //
    // toFixed(0) would give 1, 3 and -1 for the first, third and fourth cases, so a naive port
    // would disagree with both natives at every exact half-cent.
    const cases: [number, string][] = [
      [0.5, '0'], [1.5, '2'], [2.5, '2'], [-0.5, '-0'], [-1.5, '-2'],
      [-0.4, '-0'], [0.4, '0'], [23.5, '24'], [-23.5, '-24'],
    ]
    for (const [value, want] of cases) {
      expect(roundTiesToEven(value), `${value}`).toBe(want)
    }
  })

  it('differs from toFixed exactly where the two rounding modes disagree', () => {
    // Not every tie disagrees: 1.5 and -1.5 round to 2 and -2 either way, because their floor is
    // ODD and ties-to-even goes up too. They part company only when the floor is EVEN.
    const disagree: [number, string, string][] = [
      [0.5, '0', '1'],
      [2.5, '2', '3'],
      [-0.5, '-0', '-1'],
    ]
    for (const [v, even, away] of disagree) {
      expect(roundTiesToEven(v), `${v} ties-to-even`).toBe(even)
      expect(v.toFixed(0), `${v} toFixed`).toBe(away)
    }
    for (const v of [1.5, -1.5]) {
      expect(roundTiesToEven(v)).toBe(v.toFixed(0)) // floor is odd, so both agree
    }
  })
})

describe('isInTune', () => {
  it('defaults to a 10 cent tolerance', () => {
    expect(p.isInTune(440.0)).toBe(true)
    expect(p.isInTune(442.0)).toBe(true) // 7.85 cents
    expect(p.isInTune(438.0)).toBe(true) // -7.89 cents
    expect(p.isInTune(240.5668)).toBe(false) // -45 cents
    expect(p.isInTune(512.6888)).toBe(false) // -35 cents
    expect(p.isInTune(67.11537)).toBe(false) // +45 cents
  })

  it('respects a custom threshold', () => {
    expect(p.isInTune(442.0, 5)).toBe(false) // 7.85 cents is outside 5
    expect(p.isInTune(442.0, 10)).toBe(true)
    expect(p.isInTune(442.0, 50)).toBe(true)
  })

  it('is inclusive at the threshold: |cents| <= threshold, not <', () => {
    // Pinned without needing a round number. A frequency built from 10 cents comes back as
    // 10.0000000000004 in every edition, so `isInTune(f, 10)` is FALSE in all three — asserting
    // otherwise was wrong, and Python says so too. Using the measured offset as the threshold
    // tests the comparison itself.
    const f = 440 * 2 ** (10 / 1200)
    const c = p.cents(f)
    expect(p.isInTune(f, c)).toBe(true) // equal counts as in tune
    expect(p.isInTune(f, c - 1e-9)).toBe(false) // a hair under does not
  })

  it('brackets the default threshold the way the natives do', () => {
    // Mirrors Swift justUnder10CentsSharp_isInTune / elevenCentsSharp_isNotInTune.
    expect(p.isInTune(440 * 2 ** (9.5 / 1200))).toBe(true)
    expect(p.isInTune(440 * 2 ** (11 / 1200))).toBe(false)
    expect(p.isInTune(440 * 2 ** (-8 / 1200))).toBe(true)
    expect(p.isInTune(440 * 2 ** (-15 / 1200))).toBe(false)
  })
})
