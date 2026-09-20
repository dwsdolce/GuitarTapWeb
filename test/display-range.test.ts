// @parity test/display-range
import { expandedToInclude, FLOOR_HZ } from '../src/presentation/displayRange'
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SETTINGS,
  defaultDisplayRange,
  displayRangeFor,
  setDisplayRangePatch,
  type Settings,
} from '../src/settings'

// Per-measurement-type display ranges (6h). Mirrors Swift TapDisplaySettings
// minFrequency(for:)/maxFrequency(for:) + per-type defaults, and Python's
// min_frequency_for/max_frequency_for.

describe('defaultDisplayRange — per-type factory defaults', () => {
  it('matches the canonical Swift/Python values', () => {
    // Guitar (all subtypes) → 75–350.
    for (const t of ['generic', 'acoustic', 'classical', 'flamenco'] as const) {
      expect(defaultDisplayRange(t)).toEqual({ minHz: 75, maxHz: 350 })
    }
    expect(defaultDisplayRange('plate')).toEqual({ minHz: 20, maxHz: 200 })
    expect(defaultDisplayRange('brace')).toEqual({ minHz: 30, maxHz: 1000 })
  })
})

describe('displayRangeFor — resolve stored-or-default by type', () => {
  it('falls back to the type default when nothing is stored', () => {
    const s = { ...DEFAULT_SETTINGS, displayRanges: {} }
    expect(displayRangeFor(s, 'plate')).toEqual({ minHz: 20, maxHz: 200 })
    expect(displayRangeFor(s, 'generic')).toEqual({ minHz: 75, maxHz: 350 })
  })

  it('returns the stored per-type range when present', () => {
    const s: Settings = { ...DEFAULT_SETTINGS, displayRanges: { plate: { minHz: 15, maxHz: 180 } } }
    expect(displayRangeFor(s, 'plate')).toEqual({ minHz: 15, maxHz: 180 })
    // An unset type still resolves to its own default, not the stored one.
    expect(displayRangeFor(s, 'brace')).toEqual({ minHz: 30, maxHz: 1000 })
  })
})

describe('setDisplayRangePatch — per-type persistence without clobbering', () => {
  it('stores one type without disturbing another', () => {
    let s: Settings = { ...DEFAULT_SETTINGS, displayRanges: {} }
    s = { ...s, ...setDisplayRangePatch(s, 'plate', { minHz: 18, maxHz: 190 }) }
    s = { ...s, ...setDisplayRangePatch(s, 'brace', { minHz: 40 }) } // partial: max keeps the default
    expect(displayRangeFor(s, 'plate')).toEqual({ minHz: 18, maxHz: 190 })
    expect(displayRangeFor(s, 'brace')).toEqual({ minHz: 40, maxHz: 1000 })
    // Guitar untouched.
    expect(displayRangeFor(s, 'generic')).toEqual({ minHz: 75, maxHz: 350 })
  })

  it('merges a partial edit with the type current resolved range', () => {
    let s: Settings = { ...DEFAULT_SETTINGS, displayRanges: {} }
    // Editing only the max starts from the plate default (20) for the min.
    s = { ...s, ...setDisplayRangePatch(s, 'plate', { maxHz: 250 }) }
    expect(displayRangeFor(s, 'plate')).toEqual({ minHz: 20, maxHz: 250 })
  })
})
// ---------------------------------------------------------------------------
// The chart widens its frequency axis onto a newly identified material peak.
//
// A plate or brace scans a wide band (brace: 100–1200 Hz) and the display range is
// per-measurement-type and persisted, so the fL / fC / fFLC a measurement just produced can land
// off the edge of the chart. Swift has widened the axis since the feature was written; web and
// Python did neither, so the same measurement showed the peak on one edition and hid it on two.
// Ported 2026-09-20 (project issue #8) — user-visible behaviour, not an implementation difference.
//
// Twin of Swift DisplayRangeExpansionTests / Python test_display_range_expansion.py.
// ---------------------------------------------------------------------------
describe('display-range — widening onto an identified material peak', () => {
  it('a peak above the range widens the maximum with padding', () => {
    const r = expandedToInclude(1000, 100, 800)
    expect(r.maxHz).toBe(1100) // 1000 Hz + 10%
    expect(r.minHz).toBe(100) // untouched
  })

  it('a peak below the range widens the minimum with padding', () => {
    const r = expandedToInclude(50, 100, 800)
    expect(r.minHz).toBe(45) // 50 Hz - 10%
    expect(r.maxHz).toBe(800) // untouched
  })

  it('a peak inside the range leaves it alone', () => {
    const r = expandedToInclude(400, 100, 800)
    expect(r).toEqual({ minHz: 100, maxHz: 800 }) // never NARROWED — that would hide other peaks
  })

  it('a very low peak is clamped at the floor', () => {
    expect(expandedToInclude(0.5, 100, 800).minHz).toBe(FLOOR_HZ) // nothing to draw below 1 Hz
  })

  it('a peak exactly at the boundary changes nothing', () => {
    expect(expandedToInclude(800, 100, 800).maxHz).toBe(800)
    expect(expandedToInclude(100, 100, 800).minHz).toBe(100)
  })
})
