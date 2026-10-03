// @parity test/brace
//
// Brace material properties (BraceProperties) against the shared case file, `brace.json` — the same cases
// the Swift and Python suites run.
import { describe, it, expect } from 'vitest'
import { BraceProperties } from '../src/dsp/material'
import { close, dimensions, load, type Row } from './materialCases'

const DATA = load('brace')

describe('brace — shared cases', () => {
  for (const row of DATA.braces as Row[]) {
    it(row.id as string, () => {
      const e = row.expect as Record<string, number | string>
      const dims = dimensions(row)
      const p = new BraceProperties(dims, row.fL as number)
      const numbers: Record<string, number> = {
        volume: dims.volume,
        density: dims.density,
        densityGPerCm3: dims.densityGPerCm3,
        youngsModulusLong: p.youngsModulusLong,
        youngsModulusLongGPa: p.youngsModulusLongGPa,
        speedOfSoundLong: p.speedOfSoundLong,
        specificModulusLong: p.specificModulusLong,
        radiationRatioLong: p.radiationRatioLong,
      }
      for (const [name, value] of Object.entries(numbers)) {
        expect(close(value, e[name] as number, DATA), `${name}: ${value} vs ${e[name]}`).toBe(true)
      }
      expect(p.spruceQuality, 'spruceQuality').toBe(e.spruceQuality)
    })
  }
})
