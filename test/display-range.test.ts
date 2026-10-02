// @parity test/display-range
import {
  expandedToInclude,
  widenedOnto,
  onSettingsDone,
  onNewMeasurement,
  loadedAfterWidening,
  FLOOR_HZ,
} from '../src/presentation/displayRange'
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// The chart widens its frequency axis onto a newly identified material peak.
//
// A plate or brace scans a wide band (brace: 100–1200 Hz) and the display range is
// per-measurement-type and persisted, so the fL / fC / fFLC a measurement just produced can land
// off the edge of the chart. The chart's range widens to show it; a guitar's does not. The view
// only applies widenedOnto to its range, so the whole decision is tested here; the analyzer's
// announcing each peak is tested in material-peak-announcement.test.ts.
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

  it("a peak above the chart's limit widens only to the limit", () => {
    expect(expandedToInclude(4900, 100, 800).maxHz).toBe(5000) // never beyond 5 kHz
  })

  it('a peak exactly at the boundary changes nothing', () => {
    expect(expandedToInclude(800, 100, 800).maxHz).toBe(800)
    expect(expandedToInclude(100, 100, 800).minHz).toBe(100)
  })
})

describe('display-range — the decision: plate and brace widen, guitar does not', () => {
  it('a material peak outside the range widens it', () => {
    for (const t of ['plate', 'brace'] as const) {
      expect(widenedOnto(1000, t, false, 100, 800)).toEqual({ minHz: 100, maxHz: 1100 })
    }
  })

  it('a material peak inside the range leaves it alone', () => {
    expect(widenedOnto(400, 'plate', false, 100, 800)).toEqual({ minHz: 100, maxHz: 800 })
  })

  it('a material peak restored by a load leaves the range — a load shows the range it was saved with', () => {
    expect(widenedOnto(1000, 'plate', true, 100, 800)).toEqual({ minHz: 100, maxHz: 800 })
  })

  it("a guitar peak outside the range leaves it alone — a guitar's range is the user's analysis window", () => {
    for (const t of ['generic', 'acoustic', 'classical', 'flamenco'] as const) {
      expect(widenedOnto(1000, t, false, 100, 800)).toEqual({ minHz: 100, maxHz: 800 })
    }
  })
})

describe("display-range — when the chart's range moves", () => {
  const saved = { minHz: 20, maxHz: 200, minDb: -100, maxDb: 0 }
  const loaded = { minHz: 50, maxHz: 300, minDb: -90, maxDb: -10 }
  const zoomed = { minHz: 60, maxHz: 120, minDb: -90, maxDb: -10 }

  it('Settings Done with nothing changed leaves the chart', () => {
    expect(onSettingsDone(saved, saved, false)).toBeNull()
  })
  it('Settings Done with a changed frequency range moves to it', () => {
    expect(onSettingsDone(saved, { ...saved, maxHz: 250 }, false)).toEqual(saved)
  })
  it('Settings Done with a changed magnitude range moves to it', () => {
    expect(onSettingsDone(saved, { ...saved, minDb: -80 }, false)).toEqual(saved)
  })
  it("Settings Done with a changed type moves to its saved view", () => {
    expect(onSettingsDone(saved, saved, true)).toEqual(saved)
  })
  it('a new measurement with no load leaves the chart', () => {
    expect(onNewMeasurement(zoomed, null, saved)).toBeNull()
  })
  it('a new measurement while showing the load returns to the saved view', () => {
    expect(onNewMeasurement(loaded, loaded, saved)).toEqual(saved)
  })
  it('a new measurement after the user moved the chart leaves it', () => {
    expect(onNewMeasurement(zoomed, loaded, saved)).toBeNull()
  })
  it('widening while showing the load remembers the widened range', () => {
    const widened = { ...loaded, maxHz: 1100 }
    expect(loadedAfterWidening(loaded, loaded, widened)).toEqual(widened)
  })
  it('widening after the user moved the chart keeps the loaded range', () => {
    const widened = { ...zoomed, maxHz: 1100 }
    expect(loadedAfterWidening(loaded, zoomed, widened)).toEqual(loaded)
  })
})
