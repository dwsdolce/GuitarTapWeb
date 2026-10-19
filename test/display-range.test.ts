// @parity test/display-range
//
// The chart's display range against the shared case file `display-range.json` — the same cases the Swift and
// Python suites run: widening onto a newly identified plate / brace peak (a guitar's range is the user's
// analysis window and is never widened; a load shows the range it was saved with), and when the chart's range
// moves, a zoom or pan step of an axis, and the spectrum points drawn for a range. The analyzer's announcing each
// peak is tested in material-peak-announcement.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { expandedToInclude, widenedOnto, onSettingsDone, onNewMeasurement, loadedAfterWidening, zoomedRange, pannedRange, drawnIndices } from '../src/presentation/displayRange'
import {
  MIN_FREQUENCY_HZ,
  MAX_FREQUENCY_HZ,
  MIN_MAGNITUDE_DB,
  MAX_MAGNITUDE_DB,
  MIN_FREQUENCY_SPAN_HZ,
  MIN_MAGNITUDE_SPAN_DB,
} from '../src/presentation/chartLimits'

type Range = [number, number, number, number]
const DATA = JSON.parse(readFileSync('test/fixtures/display-range.json', 'utf8')) as {
  expandedToInclude: [number, number, number, number, number][]
  widenedOnto: [number, Parameters<typeof widenedOnto>[1], boolean, number, number, number, number][]
  onSettingsDone: { saved: Range; previouslySaved: Range; typeChanged: boolean; expect: Range | null }[]
  onNewMeasurement: { current: Range; loaded: Range | null; saved: Range; expect: Range | null }[]
  loadedAfterWidening: { loaded: Range; before: Range; after: Range; expect: Range }[]
  zoom: { id: string; note: string; axis: string; range: [number, number]; anchor: number; scale: number; expect: [number, number] | null }[]
  pan: { id: string; note: string; axis: string; range: [number, number]; delta: number; expect: [number, number] }[]
  drawnIndices: { id: string; note: string; frequencies: number[]; range: [number, number]; expect: [number, number] }[]
}
const axis = (name: string): [number, number, number] =>
  name === 'magnitude'
    ? [MIN_MAGNITUDE_DB, MAX_MAGNITUDE_DB, MIN_MAGNITUDE_SPAN_DB]
    : [MIN_FREQUENCY_HZ, MAX_FREQUENCY_HZ, MIN_FREQUENCY_SPAN_HZ]
const near = (got: [number, number] | null, want: [number, number] | null) =>
  want === null ? got === null : got !== null && Math.abs(got[0] - want[0]) <= 1e-3 && Math.abs(got[1] - want[1]) <= 1e-3
const view = (r: Range | null) => (r === null ? null : { minHz: r[0], maxHz: r[1], minDb: r[2], maxDb: r[3] })

describe('display-range — shared cases', () => {
  for (const [hz, lo, hi, expLo, expHi] of DATA.expandedToInclude) {
    it(`expandedToInclude ${hz} into ${lo}–${hi}`, () => expect(expandedToInclude(hz, lo, hi)).toEqual({ minHz: expLo, maxHz: expHi }))
  }
  for (const [hz, type, fromLoad, lo, hi, expLo, expHi] of DATA.widenedOnto) {
    it(`widenedOnto ${hz} ${type} fromLoad=${fromLoad}`, () =>
      expect(widenedOnto(hz, type, fromLoad, lo, hi)).toEqual({ minHz: expLo, maxHz: expHi }))
  }
  DATA.onSettingsDone.forEach((row, i) => {
    it(`onSettingsDone ${i + 1}`, () => expect(onSettingsDone(view(row.saved)!, view(row.previouslySaved)!, row.typeChanged)).toEqual(view(row.expect)))
  })
  DATA.onNewMeasurement.forEach((row, i) => {
    it(`onNewMeasurement ${i + 1}`, () => expect(onNewMeasurement(view(row.current)!, view(row.loaded), view(row.saved)!)).toEqual(view(row.expect)))
  })
  DATA.loadedAfterWidening.forEach((row, i) => {
    it(`loadedAfterWidening ${i + 1}`, () =>
      expect(loadedAfterWidening(view(row.loaded)!, view(row.before)!, view(row.after)!)).toEqual(view(row.expect)))
  })
  for (const row of DATA.zoom) {
    it(`zoom ${row.id}: ${row.note}`, () => {
      const [lower, upper, span] = axis(row.axis)
      const got = zoomedRange(row.range[0], row.range[1], row.anchor, row.scale, lower, upper, span)
      expect(near(got, row.expect), JSON.stringify(got)).toBe(true)
    })
  }
  for (const row of DATA.pan) {
    it(`pan ${row.id}: ${row.note}`, () => {
      const [lower, upper] = axis(row.axis)
      const got = pannedRange(row.range[0], row.range[1], row.delta, lower, upper)
      expect(near(got, row.expect), JSON.stringify(got)).toBe(true)
    })
  }
  for (const row of DATA.drawnIndices) {
    it(`drawnIndices ${row.id}: ${row.note}`, () => expect(drawnIndices(row.frequencies, row.range[0], row.range[1])).toEqual(row.expect))
  }
})
