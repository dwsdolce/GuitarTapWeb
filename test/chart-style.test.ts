// @parity test/chart-style
//
// The chart's line and point styles, on screen and in the exported image, against the shared case file
// `chart-style.json` — the same cases the Swift and Python suites run. Names are Swift's.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { EXPORT, SCREEN } from '../src/presentation/chartStyle'

const DATA = JSON.parse(readFileSync('test/fixtures/chart-style.json', 'utf8')) as Record<string, unknown>

describe('chart-style — shared cases', () => {
  it('screen', () => expect(SCREEN).toEqual(DATA.screen))
  it('export', () => expect(EXPORT).toEqual(DATA.export))
})
