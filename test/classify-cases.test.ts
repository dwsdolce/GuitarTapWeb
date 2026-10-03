// @parity test/classify
//
// Guitar mode classification against the shared case file, `classify.json` — the same cases the Swift and
// Python suites run. The file's spellings are Swift's case names; `mode` maps them to the web's.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { classifyAll, resolvedModePeaks, type ResolvedMode } from '../src/dsp/classify'
import { modeBands, type GuitarTypeName } from '../src/dsp/guitarModes'
import { ADDITIONAL_MODE_LABELS, MODE_BY_DISPLAY_NAME, MODE_DISPLAY_NAME, MODE_LABEL, effectiveMode } from '../src/presentation/modeColors'
import type { ResonantPeak } from '../src/measurement/types'

type Row = Record<string, unknown>
const DATA = JSON.parse(readFileSync('test/fixtures/classify.json', 'utf8')) as Record<string, unknown>
const rows = (key: string) => DATA[key] as Row[]

/** Swift's case name → the web's mode name; undefined for a mode the web does not have. */
const WEB_MODE: Record<string, ResolvedMode | undefined> = {
  air: 'air', top: 'top', back: 'back', dipole: 'dipole', ringMode: 'ring', upperModes: 'upper', unknown: 'unknown',
}
function mode(name: string): ResolvedMode {
  const m = WEB_MODE[name]
  if (m === undefined) throw new Error(`the web has no mode "${name}"`)
  return m
}

const peaksOf = (row: Row): ResonantPeak[] =>
  (row.peaks as [number, number][]).map(([frequency, magnitude], i) => ({
    id: String(i), frequency, magnitude, quality: 0, bandwidth: 0, timestamp: '2026-10-02T00:00:00Z',
  }))

describe('classify — shared cases', () => {
  for (const row of rows('classifyAll')) {
    it(`${row.id as string} classifyAll`, () => {
      const peaks = peaksOf(row)
      const result = classifyAll(peaks, row.guitarType as GuitarTypeName)
      expect(result.size).toBe(peaks.length)
      expect(peaks.map((p) => result.get(p.id))).toEqual((row.expect as string[]).map(mode))
    })
  }

  for (const row of rows('resolvedModePeaks')) {
    it(`${row.id as string} resolvedModePeaks`, () => {
      const peaks = peaksOf(row)
      const resolved = resolvedModePeaks(peaks, row.guitarType as GuitarTypeName)
      expect(Object.fromEntries([...resolved].map(([m, p]) => [m, p.id]))).toEqual(
        Object.fromEntries(Object.entries(row.expect as Record<string, number>).map(([m, i]) => [mode(m), String(i)])),
      )
    })
  }

  for (const [guitarType, bands] of Object.entries(DATA.bands as Record<string, [string, number, number][]>)) {
    it(`bands — ${guitarType}`, () => {
      expect(modeBands(guitarType as GuitarTypeName).map((b) => [b.name, b.lo, b.hi])).toEqual(
        bands.map(([m, lo, hi]) => [mode(m), lo, hi]),
      )
    })
  }

  for (const [label, expected] of DATA.fromDisplayName as [string, string | null][]) {
    it(`fromDisplayName ${label}`, () => {
      expect(MODE_BY_DISPLAY_NAME[label]).toBe(expected === null ? undefined : mode(expected))
    })
  }

  it('additionalModeLabels', () => {
    expect(ADDITIONAL_MODE_LABELS).toEqual(DATA.additionalModeLabels)
  })

  for (const row of rows('effectiveMode')) {
    it(`effectiveMode ${JSON.stringify(row.override)}`, () => {
      expect(effectiveMode(row.override as string | null, mode(row.auto as string))).toBe(mode(row.expect as string))
    })
  }

  for (const [m, name] of DATA.displayName as [string, string][]) {
    it(`displayName ${m}`, () => {
      expect(MODE_DISPLAY_NAME[mode(m)]).toBe(name)
    })
  }

  for (const [m, abbreviation] of DATA.abbreviation as [string, string][]) {
    it(`abbreviation ${m}`, () => {
      expect(MODE_LABEL[mode(m)]).toBe(abbreviation)
    })
  }
})
