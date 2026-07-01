// @parity test/display-range
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