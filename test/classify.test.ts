// @parity test/classify
import { describe, it, expect } from 'vitest'
import { classifySingle, classifyAll, getPeak } from '../src/dsp/classify'
import { modeBands, type GuitarTypeName } from '../src/dsp/guitarModes'
import {
  effectiveMode,
  ADDITIONAL_MODE_LABELS,
  MODE_BY_DISPLAY_NAME,
  MODE_DISPLAY_NAME,
  MODE_LABEL,
} from '../src/presentation/modeColors'
import type { Peak } from '../src/dsp/peaks'

const peak = (id: number, frequency: number, magnitude: number): Peak => ({
  id,
  frequency,
  magnitude,
  quality: 0,
  bandwidth: 0,
})

describe('G4c — flamenco classification', () => {
  // PARITY GAP closed 2026-07-19: Swift (GuitarModeTests) and Python (test_guitar_mode)
  // both covered flamenco here; the web did not, which is why it alone showed no failure
  // when the flamenco bands were corrected. See section 7c of
  // Development/PEAK-FINDING-DUPLICATE-PEAKS.md.
  //
  // Corrected bands: top 180–220, back 200–250 (overlapping on 200–220). The old bands were
  // top 190–250 / back 180–240 — the back range sitting BELOW the top range, so Back sorted
  // first, classifyAll's "Back above Top" guard never fired, and flamenco inverted Top/Back.

  it('185 Hz is in top only', () => {
    expect(classifySingle(185, 'flamenco')).toBe('top')
  })

  it('240 Hz is in back only (above the 200–220 overlap)', () => {
    expect(classifySingle(240, 'flamenco')).toBe('back')
  })

  it('the 200–220 overlap resolves to top by lookup order', () => {
    // classifySingle is the naive first-match lookup; classifyAll is what disambiguates.
    expect(classifySingle(210, 'flamenco')).toBe('top')
  })

  it('REGRESSION — top is claimed below back', () => {
    // Two peaks straddling the overlap must resolve Top-below-Back, as on every other
    // guitar type. Under the old inverted bands the STRONGEST peak was labelled back.
    const low = peak(0, 190, -40) // strongest
    const high = peak(1, 230, -50)
    const m = classifyAll([low, high], 'flamenco')
    expect(m.get(0)).toBe('top')
    expect(m.get(1)).toBe('back')
  })

  it('matches the other guitar types on identical input', () => {
    // The inversion showed up as flamenco disagreeing with classical and generic on the
    // same two peaks. They must now agree.
    const peaks = [peak(0, 200, -40), peak(1, 230, -50)]
    for (const gt of ['flamenco', 'classical', 'generic'] as const) {
      const m = classifyAll(peaks, gt)
      expect(m.get(0), `${gt} top`).toBe('top')
      expect(m.get(1), `${gt} back`).toBe('back')
    }
  })
})

describe('G4c — mode classification (Top/Back overlap)', () => {
  it('classifySingle resolves the first containing band (Top before Back)', () => {
    // Generic: Top 140–260, Back 180–300 overlap on 180–260.
    expect(classifySingle(95, 'generic')).toBe('air')
    expect(classifySingle(250, 'generic')).toBe('top') // overlap → Top wins (naive)
    expect(classifySingle(290, 'generic')).toBe('back') // above Top band
    expect(classifySingle(1000, 'generic')).toBe('upper')
    expect(classifySingle(40, 'generic')).toBe('unknown')
  })

  it('classifyAll disambiguates the overlap: a peak above the claimed Top goes to Back', () => {
    const peaks = [peak(0, 95, -30), peak(1, 190, -25), peak(2, 250, -35)]
    const m = classifyAll(peaks, 'generic')
    expect(m.get(0)).toBe('air')
    expect(m.get(1)).toBe('top') // strongest in Top band
    expect(m.get(2)).toBe('back') // in the overlap but above claimed Top → Back (not Top)
    expect(getPeak(peaks, 'back', 'generic')?.frequency).toBe(250)
    expect(getPeak(peaks, 'top', 'generic')?.frequency).toBe(190)
  })

  it('claims the strongest peak per band', () => {
    const peaks = [peak(0, 200, -40), peak(1, 205, -20)] // both in Top band
    expect(getPeak(peaks, 'top', 'generic')?.frequency).toBe(205) // louder one
  })
})

// ── Band classification, per guitar type ───────────────────────────────────────────────────
//
// Back-filled in the #17 sweep: this slug read 37/37/8 and web covered only flamenco and the
// Top/Back overlap. The cases and their frequencies are Swift's, from
// GuitarModeTests.GuitarModeClassificationTests — the same peaks, so the three editions now
// answer the same questions.
//
// Written as a row list plus a loop rather than one `it` per case. That is the shape Stage 2
// of #17 moves every case-driven slug to, and `pitch.test.ts` already proves it here.

const band = (id: number, frequency: number): Peak => peak(id, frequency, -20)

interface BandCase {
  hz: number
  expect: string
  why?: string
}

const BAND_CASES: Record<'acoustic' | 'classical', BandCase[]> = {
  // Acoustic: air 90–120, top 150–210, back 210–290, dipole 360–460, ring 620–880, upper 880+
  acoustic: [
    { hz: 90, expect: 'air', why: 'lower bound is inclusive' },
    { hz: 100, expect: 'air' },
    { hz: 120, expect: 'air', why: 'upper bound is inclusive' },
    { hz: 180, expect: 'top' },
    { hz: 250, expect: 'back', why: 'acoustic top and back do not overlap' },
    { hz: 400, expect: 'dipole' },
    { hz: 700, expect: 'ring' },
    { hz: 1200, expect: 'upper' },
    { hz: 320, expect: 'unknown', why: 'in the gap between back (290) and dipole (360)' },
  ],
  // Classical: air 80–110, top 170–230, back 190–280, dipole 330–430, ring 580–820, upper 820+
  classical: [
    { hz: 95, expect: 'air' },
    { hz: 200, expect: 'top', why: 'in the 190–230 overlap, but no Back peak present' },
    { hz: 240, expect: 'back', why: 'above the top band (230), so unambiguous' },
    { hz: 380, expect: 'dipole' },
    { hz: 700, expect: 'ring' },
    { hz: 1000, expect: 'upper' },
    { hz: 140, expect: 'unknown', why: 'in the gap between air (110) and top (170)' },
  ],
}

for (const [guitarType, cases] of Object.entries(BAND_CASES)) {
  describe(`band classification — ${guitarType}`, () => {
    for (const c of cases) {
      const label = `${c.hz} Hz is ${c.expect}${c.why ? ` (${c.why})` : ''}`
      it(label, () => {
        // Through classifyAll with a single peak, as Swift's tests do, so the range lookup is
        // exercised on the real entry point rather than the naive per-frequency one.
        const p = band(0, c.hz)
        expect(classifyAll([p], guitarType as GuitarTypeName).get(0)).toBe(c.expect)
      })
    }
  })
}

// ── The bands themselves ───────────────────────────────────────────────────────────────────

describe('mode bands', () => {
  // Mirrors Swift modeRange_classicalAir_matchesModeRanges / modeRange_acousticTop_*.
  // These numbers are the classifier's whole contract, and all three editions carry them
  // identically — verified band by band across all four types during the #17 sweep.
  it('match the canonical table for every guitar type', () => {
    const expected: Record<GuitarTypeName, [string, number, number][]> = {
      generic: [['air', 70, 135], ['top', 140, 260], ['back', 180, 300], ['dipole', 310, 460], ['ring', 580, 880], ['upper', 880, 20000]],
      acoustic: [['air', 90, 120], ['top', 150, 210], ['back', 210, 290], ['dipole', 360, 460], ['ring', 620, 880], ['upper', 880, 20000]],
      classical: [['air', 80, 110], ['top', 170, 230], ['back', 190, 280], ['dipole', 330, 430], ['ring', 580, 820], ['upper', 820, 20000]],
      flamenco: [['air', 85, 115], ['top', 180, 220], ['back', 200, 250], ['dipole', 350, 450], ['ring', 600, 850], ['upper', 850, 20000]],
    }
    for (const [gt, rows] of Object.entries(expected)) {
      expect(modeBands(gt as GuitarTypeName).map((b) => [b.name, b.lo, b.hi])).toEqual(rows)
    }
  })

  it('modeBands returns a fresh copy, so a caller may sort it', () => {
    // classifyAll sorts the result in place. If this returned a shared array that would
    // corrupt module state for every later caller.
    const a = modeBands('generic')
    a.sort((x, y) => y.lo - x.lo)
    expect(modeBands('generic').map((b) => b.name)).toEqual(['air', 'top', 'back', 'dipole', 'ring', 'upper'])
  })
})

// ── classifyAll edge cases ─────────────────────────────────────────────────────────────────
//
// Mirrors Swift GuitarModeClassifyAllTests.

describe('classifyAll — edge cases', () => {
  it('a peak outside every band falls back to unknown', () => {
    const p = band(0, 320) // between acoustic back (290) and dipole (360)
    expect(classifyAll([p], 'acoustic').get(0)).toBe('unknown')
  })

  it('a non-overlapping set is claimed unambiguously in one pass', () => {
    const peaks = [peak(0, 100, -30), peak(1, 180, -25), peak(2, 250, -28)]
    const m = classifyAll(peaks, 'acoustic')
    expect(m.get(0)).toBe('air')
    expect(m.get(1)).toBe('top')
    expect(m.get(2)).toBe('back')
  })

  it('empty input returns an empty map', () => {
    expect(classifyAll([], 'acoustic').size).toBe(0)
  })

  it('a second peak in the same band still classifies by range, not as leftover', () => {
    // The stronger peak is claimed in the claiming pass; the weaker one falls through to the
    // per-frequency fallback. Both must land on Air — the fallback classifies by band, it does
    // not mark unclaimed peaks unknown.
    const stronger = peak(0, 95, -15)
    const weaker = peak(1, 110, -28)
    const m = classifyAll([stronger, weaker], 'acoustic')
    expect(m.get(0)).toBe('air')
    expect(m.get(1)).toBe('air')
  })

  it('on equal magnitude the first peak wins the band', () => {
    // All three editions keep the FIRST maximal element: Swift's max(by:) and Python's max()
    // both do, and this loop only replaces on a strict >. Pinned because a tie-break that
    // differed per edition would be invisible until a real measurement produced one.
    const m = classifyAll([peak(0, 95, -20), peak(1, 100, -20)], 'acoustic')
    expect(m.get(0)).toBe('air')
    expect(getPeak([peak(0, 95, -20), peak(1, 100, -20)], 'air', 'acoustic')?.id).toBe(0)
  })
})

// ── Override labels resolve to modes ───────────────────────────────────────────────────────
//
// Added in the #17 sweep. This mapping was reachable from the override picker in Swift and
// Python and tested in NO edition, which is how the two natives came to disagree about one of
// its seven entries, and how this port came to lack it entirely.
//
// Mirrors Swift GuitarMode.fromDisplayName and Python GuitarMode.from_mode_string.

describe('override labels resolve to modes', () => {
  it('the seven standard display names resolve to their own mode', () => {
    for (const [mode, name] of Object.entries(MODE_DISPLAY_NAME)) {
      expect(MODE_BY_DISPLAY_NAME[name], name).toBe(mode)
    }
  })

  // The academic T(m,n) labels. All three editions offer these in the override picker and must
  // agree on what they mean — a file saved in one edition opens in the others.
  const ACADEMIC: [string, string][] = [
    ['Helmholtz T(1,1)_1', 'air'],
    ['Top T(1,1)_2', 'top'],
    ['Back T(1,1)_3', 'back'],
    ['Cross Dipole T(2,1)', 'dipole'],
    ['Long Dipole T(1,2)', 'dipole'],
    // Swift is canonical and maps Quadrapole to Ring Mode. Python mapped it to Upper Modes
    // until the #17 sweep — SLUG-SWEEP.md F12.
    ['Quadrapole T(2,2)', 'ring'],
    ['Cross Tripole T(3,1)', 'ring'],
  ]

  for (const [label, mode] of ACADEMIC) {
    it(`${label} resolves to ${mode}`, () => {
      expect(MODE_BY_DISPLAY_NAME[label]).toBe(mode)
      // And through the resolver the app actually calls, where a present override wins over the
      // auto classification.
      expect(effectiveMode(label, 'air')).toBe(mode)
    })
  }

  it('the picker offers exactly those seven, in that order', () => {
    expect(ADDITIONAL_MODE_LABELS).toEqual(ACADEMIC.map(([l]) => l))
  })

  it('a freeform label is unknown, and does NOT fall through to the auto mode', () => {
    expect(effectiveMode('Wolf note', 'top')).toBe('unknown')
  })

  it('no override leaves the auto classification standing', () => {
    expect(effectiveMode(null, 'top')).toBe('top')
    expect(effectiveMode(undefined, 'back')).toBe('back')
  })
})

// ── Mode names ─────────────────────────────────────────────────────────────────────────────
//
// Moved here from mode-colors.test.ts in the #17 sweep. Swift and Python file these under
// test/classify (GuitarModeTests.displayName_*, test_guitar_mode.py::test_*_display_name) while
// the web filed them under test/mode-colors, which made that slug read 1/1/3 — an artifact of
// where the rule lived, not of how much was covered. The rule adopted for the sweep: the
// canonical edition decides which slug owns a rule. See SLUG-SWEEP.md F10.

describe('mode names', () => {
  it('full display names — Air keeps its (Helmholtz) suffix', () => {
    expect(MODE_DISPLAY_NAME).toEqual({
      air: 'Air (Helmholtz)',
      top: 'Top',
      back: 'Back',
      dipole: 'Dipole',
      ring: 'Ring Mode',
      upper: 'Upper Modes',
      unknown: 'Unknown',
    })
  })

  it('compact chart abbreviations', () => {
    expect(MODE_LABEL).toEqual({
      air: 'Air',
      top: 'Top',
      back: 'Back',
      dipole: 'DP',
      ring: 'Ring',
      upper: 'Upper',
      unknown: '?',
    })
  })
})
