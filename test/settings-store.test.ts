// @parity test/settings-store
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { MeasurementType as MeasurementTypeName } from '../src/settings'
import {
  DEFAULT_SETTINGS,
  defaultMinFrequency,
  defaultMaxFrequency,
  minFrequency,
  maxFrequency,
  setMinFrequency,
  setMaxFrequency,
  validateFrequencyRange,
  validateMagnitudeRange,
  type Settings,
} from '../src/settings'
import { enteredValue } from '../src/presentation/displayRange'
import { settingsStore } from '../src/settingsStore'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'

// The per-measurement-type display frequency range store: each type has its own default and its
// own stored minimum and maximum, a bound never stored reads the default, a stored bound keeps its exact
// value at Swift's Float precision (Save Current View comes back as saved; an untouched Settings field
// never rounds it), and an entered range is validated before it is stored.

const fresh = (): Settings => ({ ...DEFAULT_SETTINGS, displayRanges: {} })

describe('settings-store — per-type display frequency range', () => {
  it('a type with nothing stored reads its default', () => {
    const s = fresh()
    expect(minFrequency(s, 'flamenco')).toBe(75)
    expect(maxFrequency(s, 'flamenco')).toBe(350)
  })

  it('a stored range reads back', () => {
    let s = fresh()
    s = { ...s, ...setMinFrequency(s, 15, 'plate') }
    s = { ...s, ...setMaxFrequency(s, 180, 'plate') }
    expect(minFrequency(s, 'plate')).toBe(15)
    expect(maxFrequency(s, 'plate')).toBe(180)
  })

  it('storing one type does not change another', () => {
    let s = fresh()
    s = { ...s, ...setMinFrequency(s, 18, 'plate') }
    s = { ...s, ...setMinFrequency(s, 40, 'brace') }
    expect(minFrequency(s, 'plate')).toBe(18)
    expect(minFrequency(s, 'brace')).toBe(40)
  })

  it('storing one bound leaves the other', () => {
    let s = fresh()
    s = { ...s, ...setMinFrequency(s, 15, 'plate') }
    s = { ...s, ...setMaxFrequency(s, 250, 'plate') }
    expect(minFrequency(s, 'plate')).toBe(15)
    expect(maxFrequency(s, 'plate')).toBe(250)
  })

  it('a stored range keeps its exact value', () => {
    let s = fresh()
    s = { ...s, ...setMinFrequency(s, 15.37, 'plate') }
    s = { ...s, ...setMaxFrequency(s, 180.43, 'plate') }
    // Exactly, at Swift's Float precision.
    expect(minFrequency(s, 'plate')).toBe(Math.fround(15.37))
    expect(maxFrequency(s, 'plate')).toBe(Math.fround(180.43))
  })
})

type RangeRow = { input: [number, number]; saved?: [number, number]; expect: [number, number] }
const DATA = JSON.parse(readFileSync('test/fixtures/settings-store.json', 'utf8')) as {
  defaults: [MeasurementTypeName, number, number][]
  enteredValue: [string, number, number, number | null][]
  validateFrequencyRange: RangeRow[]
  validateMagnitudeRange: RangeRow[]
}

describe('settings-store — the shared cases in settings-store.json', () => {
  for (const [t, lo, hi] of DATA.defaults) {
    it(`default range ${t}`, () => expect([defaultMinFrequency(t), defaultMaxFrequency(t)]).toEqual([lo, hi]))
  }
  for (const [shown, stored, decimals, expected] of DATA.enteredValue) {
    it(`entered value ${JSON.stringify(shown)} over ${stored}`, () => expect(enteredValue(shown, stored, decimals)).toBe(expected))
  }

  // Validation of an entered range — each bound clamped, at least 10 apart, else the saved range — for the
  // current type, here generic.
  const t = 'generic' as const
  const withSaved = (freq?: [number, number], db?: [number, number]): Settings => {
    let s = fresh()
    if (freq) {
      s = { ...s, ...setMinFrequency(s, freq[0], t) }
      s = { ...s, ...setMaxFrequency(s, freq[1], t) }
    }
    return db ? { ...s, minDb: db[0], maxDb: db[1] } : s
  }
  for (const row of DATA.validateFrequencyRange) {
    it(`frequency range ${row.input.join('–')}`, () =>
      expect(validateFrequencyRange(withSaved(row.saved), row.input[0], row.input[1], t)).toEqual({ minHz: row.expect[0], maxHz: row.expect[1] }))
  }
  for (const row of DATA.validateMagnitudeRange) {
    it(`magnitude range ${row.input.join('–')}`, () =>
      expect(validateMagnitudeRange(withSaved(undefined, row.saved), row.input[0], row.input[1])).toEqual({ minDb: row.expect[0], maxDb: row.expect[1] }))
  }
})

// The settings store holds the app's settings outside React (the web's TapDisplaySettings). Its storage is
// the one the app has always used — one JSON object under one localStorage key — so settings saved before
// the store existed load unchanged, and the store saves to the same place.
describe('settings-store — the store keeps the saved settings where they were', () => {
  it('loads settings saved by the settings module unchanged, and saves its changes back there', async () => {
    const { saveSettings, loadSettings, DEFAULT_SETTINGS: defaults } = await import('../src/settings')
    const { SettingsStore } = await import('../src/settingsStore')
    const saved = new Map<string, string>()
    const storage = {
      getItem: (k: string) => saved.get(k) ?? null,
      setItem: (k: string, v: string) => void saved.set(k, v),
      removeItem: (k: string) => void saved.delete(k),
    }
    const previous = (globalThis as { localStorage?: unknown }).localStorage
    ;(globalThis as { localStorage?: unknown }).localStorage = storage
    try {
      const before = { ...defaults, measurementType: 'plate' as const, peakMinThreshold: -66, showUnknownModes: false }
      saveSettings(before)
      const store = new SettingsStore()
      expect(store.get()).toEqual(before)
      let told = 0
      store.subscribe(() => told++)
      store.update({ tapDetectionThreshold: -42 })
      expect(told).toBe(1)
      expect(loadSettings()).toEqual({ ...before, tapDetectionThreshold: -42 })
      store.update({ tapDetectionThreshold: -42 }) // no change: nobody is told
      expect(told).toBe(1)
    } finally {
      ;(globalThis as { localStorage?: unknown }).localStorage = previous
    }
  })
})

// The web's form of Swift's views re-reading the analyzer when they redraw: the analyzer's snapshot is
// rebuilt at the next read after any settings change, with no notify from the analyzer.
describe("the analyzer's snapshot follows the settings", () => {
  it('a settings change shows in the next snapshot', () => {
    const a = new TapToneAnalyzer()
    const before = a.getSnapshot()
    expect(before.measurementType).toBe('generic')
    expect(a.getSnapshot()).toBe(before) // unchanged settings: the same snapshot
    settingsStore.update({ measurementType: 'plate' })
    const after = a.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.measurementType).toBe('plate')
    expect(after.isGuitar).toBe(false)
  })
})
