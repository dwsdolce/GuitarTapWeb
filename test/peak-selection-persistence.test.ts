// @parity test/peak-selection-persistence
//
// Whether a guitar measurement's peak selection was the user's own (manual) or the app's (automatic) is
// saved with it: a loaded manual selection — or one from a file saved before the flag existed — enables
// the Reset to automatic selection (wand) button, and the wand makes it automatic again. The cases are the shared ones in peak-selection-persistence.json
// (PSP1–PSP6), the same as Swift and Python, run through the analyzer as they are there.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { serializeGuitarTapFile, parseGuitarTapFile, type TapToneMeasurementModel } from '../src/measurement'
import { newId } from '../src/measurement/newId'

type Case = { id: string; note: string; userModified: boolean | null }
const DATA = JSON.parse(readFileSync('test/fixtures/peak-selection-persistence.json', 'utf8')) as {
  fixture: string
  minHz: number
  maxHz: number
  savedPeakMin: number
  airHz: number
  load: (Case & { expectManual: boolean; expectAirSelected: boolean; expectManualAfterReset: boolean; expectAirSelectedAfterReset: boolean })[]
  roundTrip: (Case & { expectWritten: boolean; expectRead: boolean | null })[]
}

function analyzer(): TapToneAnalyzer {
  const a = new TapToneAnalyzer()
  a.measurementType = 'generic'
  a.minFrequency = DATA.minHz
  a.maxFrequency = DATA.maxHz
  return a
}

/** The case's measurement: every peak at -100 dB, the automatic selection at the saved Peak Min. */
function makeMeasurement(userModified: boolean | null): { m: TapToneMeasurementModel; airInSave: boolean } {
  const snapshot = parseGuitarTapFile(readFileSync(`test/fixtures/${DATA.fixture}`, 'utf8'))[0]!.spectrumSnapshot!
  const a = analyzer()
  const full = a.findPeaks(snapshot.magnitudes, snapshot.frequencies, { minHz: DATA.minHz, maxHz: DATA.maxHz, peakMinOverride: -100 })
  const displayed = full.filter((p) => p.magnitude >= DATA.savedPeakMin)
  const winners = a.guitarModeSelectedPeakIds(displayed)
  const m: TapToneMeasurementModel = {
    id: newId(),
    timestamp: '2026-07-16T18:05:05Z',
    peaks: full,
    spectrumSnapshot: {
      frequencies: snapshot.frequencies, magnitudes: snapshot.magnitudes, minFreq: 75, maxFreq: 350,
      minDB: -100, maxDB: 0, isLogarithmic: false, guitarType: 'Generic', measurementType: 'Generic Guitar',
    },
    tapDetectionThreshold: -49,
    numberOfTaps: 1,
    peakMinThreshold: DATA.savedPeakMin,
    selectedPeakIDs: [...winners],
    selectedPeakFrequencies: displayed.filter((p) => winners.has(p.id)).map((p) => p.frequency),
    ...(userModified === null ? {} : { userModifiedSelection: userModified }),
  }
  const airInSave = full.some((p) => winners.has(p.id) && Math.abs(p.frequency - DATA.airHz) < 1)
  return { m, airInSave }
}

describe('peak-selection-persistence — a loaded selection (peak-selection-persistence.json)', () => {
  it.each(DATA.load.map((r) => [r.id, r] as const))('%s', (_id, r) => {
    const { m, airInSave } = makeMeasurement(r.userModified)
    expect(airInSave, 'precondition: Air is not in the saved selection').toBe(false)
    const a = analyzer()
    a.loadMeasurement(m)
    const air = a.peaks.find((p) => Math.abs(p.frequency - DATA.airHz) < 1)
    expect(air, 'the Air peak is loaded').toBeDefined()
    expect(a.userModifiedSelection, 'manual (the wand enabled)').toBe(r.expectManual)
    expect(a.selectedPeakIds.has(air!.id), 'Air selected').toBe(r.expectAirSelected)
    a.resetToAutoSelection()
    expect(a.userModifiedSelection, 'manual after the wand').toBe(r.expectManualAfterReset)
    expect(a.selectedPeakIds.has(air!.id), 'Air selected after the wand').toBe(r.expectAirSelectedAfterReset)
  })
})

describe('peak-selection-persistence — the flag in the file (peak-selection-persistence.json)', () => {
  it.each(DATA.roundTrip.map((r) => [r.id, r] as const))('%s', (_id, r) => {
    const { m } = makeMeasurement(r.userModified)
    const text = serializeGuitarTapFile([m])
    expect(text.includes('userModifiedSelection'), 'written').toBe(r.expectWritten)
    expect(parseGuitarTapFile(text)[0]!.userModifiedSelection ?? null, 'read back').toBe(r.expectRead)
  })
})
