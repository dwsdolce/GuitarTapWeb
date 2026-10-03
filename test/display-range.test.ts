// @parity test/display-range
//
// The chart's display range against the shared case file `display-range.json` — the same cases the Swift and
// Python suites run: widening onto a newly identified plate / brace peak (a guitar's range is the user's
// analysis window and is never widened; a load shows the range it was saved with), and when the chart's range
// moves. The analyzer's announcing each peak is tested in material-peak-announcement.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { expandedToInclude, widenedOnto, onSettingsDone, onNewMeasurement, loadedAfterWidening } from '../src/presentation/displayRange'

type Range = [number, number, number, number]
const DATA = JSON.parse(readFileSync('test/fixtures/display-range.json', 'utf8')) as {
  expandedToInclude: [number, number, number, number, number][]
  widenedOnto: [number, Parameters<typeof widenedOnto>[1], boolean, number, number, number, number][]
  onSettingsDone: { saved: Range; previouslySaved: Range; typeChanged: boolean; expect: Range | null }[]
  onNewMeasurement: { current: Range; loaded: Range | null; saved: Range; expect: Range | null }[]
  loadedAfterWidening: { loaded: Range; before: Range; after: Range; expect: Range }[]
}
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
})
