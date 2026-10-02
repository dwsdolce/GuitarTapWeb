// @parity test/display-range
//
// The chart widens onto a newly identified plate / brace peak by observing the analyzer's three
// material peaks. These pin that each write of a peak is announced to observers: a load announces
// the measurement's peaks, and a redo announces the cleared one. The widening decision itself is in
// display-range.test.ts.
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { makeResonantPeak, type TapToneMeasurementModel } from '../src/measurement/types'

const peak = (id: string, frequency: number, magnitude: number) => ({
  id,
  frequency,
  magnitude,
  quality: 20,
  bandwidth: 5,
  timestamp: '2026-03-09T18:46:19Z',
})

const plate: TapToneMeasurementModel = {
  id: 'P1',
  timestamp: '2026-03-09T18:46:19Z',
  peaks: [peak('L', 1500, -20), peak('C', 180, -25), peak('F', 410, -30)],
  longitudinalSnapshot: {
    frequencies: [100, 200],
    magnitudes: [-10, -20],
    minFreq: 50,
    maxFreq: 300,
    minDB: -100,
    maxDB: 0,
    isLogarithmic: false,
    measurementType: 'Material (Plate)',
  },
  selectedLongitudinalPeakID: 'L',
  selectedCrossPeakID: 'C',
  selectedFlcPeakID: 'F',
}

/** The analyzer's three peak frequencies at each announcement after subscription. */
function listen(analyzer: TapToneAnalyzer) {
  const heard: { l: number | null; c: number | null; f: number | null }[] = []
  analyzer.subscribe(() => {
    const s = analyzer.getSnapshot()
    heard.push({
      l: s.selectedLongitudinalPeak?.frequency ?? null,
      c: s.selectedCrossPeak?.frequency ?? null,
      f: s.selectedFlcPeak?.frequency ?? null,
    })
  })
  return heard
}

describe('material peaks — each change is announced', () => {
  it('loading a plate announces each of its peaks', () => {
    const analyzer = new TapToneAnalyzer()
    const heard = listen(analyzer)
    analyzer.loadMeasurement(plate)
    expect(heard.at(-1)).toEqual({ l: 1500, c: 180, f: 410 })
  })

  it('loaded peaks are marked as from a load until a new sequence', () => {
    const analyzer = new TapToneAnalyzer()
    analyzer.loadMeasurement(plate)
    expect(analyzer.getSnapshot().materialPeaksFromLoad).toBe(true)
    analyzer.startTapSequence({ arm: false })
    expect(analyzer.getSnapshot().materialPeaksFromLoad).toBe(false)
  })

  it('each sequence start is counted, even when the measurement was not complete', () => {
    const analyzer = new TapToneAnalyzer()
    const before = analyzer.getSnapshot().sequenceStarts
    analyzer.startTapSequence({ arm: false })
    analyzer.startTapSequence({ arm: false })
    expect(analyzer.getSnapshot().sequenceStarts).toBe(before + 2)
  })

  it('redoing a phase announces its peak cleared', () => {
    const analyzer = new TapToneAnalyzer()
    analyzer.selectedLongitudinalPeak = makeResonantPeak({ frequency: 1500, magnitude: -20, quality: 20, bandwidth: 5 })
    analyzer['materialTapPhase'] = 'reviewingL'
    const heard = listen(analyzer)
    analyzer.redoMaterial()
    expect(heard.at(-1)?.l).toBeNull()
  })
})
