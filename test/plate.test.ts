// @parity test/plate
//
// Plate material properties (PlateProperties, MaterialDimensions, WoodQuality) against the shared case
// file, `plate.json` — the same cases the Swift and Python suites run. Its first row is the hub's committed
// plate measurement (Tests/Plate/plate-umik-1-swift-mac-1778816330.guitartap), whose values match the ones
// GuitarTap reported for it in the .pdf beside that file.
import { describe, it, expect } from 'vitest'
import { PlateProperties, WoodQuality, type GrainDirection, type WoodType } from '../src/dsp/material'
import { close, dimensions, load, type Row } from './materialCases'

const DATA = load('plate')
const rows = (key: string) => DATA[key] as Row[]

describe('plate — shared cases', () => {
  for (const row of rows('plates')) {
    it(row.id as string, () => {
      const e = row.expect as Record<string, number | string | null>
      const dims = dimensions(row)
      const p = new PlateProperties(dims, row.fL as number, row.fC as number, row.fLC as number | null)
      const numbers: Record<string, number> = {
        volume: dims.volume,
        density: dims.density,
        densityGPerCm3: dims.densityGPerCm3,
        youngsModulusLong: p.youngsModulusLong,
        youngsModulusCross: p.youngsModulusCross,
        youngsModulusLongGPa: p.youngsModulusLongGPa,
        youngsModulusCrossGPa: p.youngsModulusCrossGPa,
        speedOfSoundLong: p.speedOfSoundLong,
        speedOfSoundCross: p.speedOfSoundCross,
        specificModulusLong: p.specificModulusLong,
        specificModulusCross: p.specificModulusCross,
        radiationRatioLong: p.radiationRatioLong,
        radiationRatioCross: p.radiationRatioCross,
        crossLongRatio: p.crossLongRatio,
        longCrossRatio: p.longCrossRatio,
        goreYoungsModulusLong: p.goreYoungsModulusLong,
        goreYoungsModulusCross: p.goreYoungsModulusCross,
      }
      for (const [name, value] of Object.entries(numbers)) {
        expect(close(value, e[name] as number, DATA), `${name}: ${value} vs ${e[name]}`).toBe(true)
      }
      expect(p.spruceQualityLong, 'spruceQualityLong').toBe(e.spruceQualityLong)
      expect(p.spruceQualityCross, 'spruceQualityCross').toBe(e.spruceQualityCross)
      expect(p.overallQuality, 'overallQuality').toBe(e.overallQuality)
      if (e.goreShearModulus === null) expect(p.goreShearModulus, 'goreShearModulus').toBeNull()
      else expect(close(p.goreShearModulus!, e.goreShearModulus as number, DATA), 'goreShearModulus').toBe(true)
      for (const g of (row.goreTargetThickness as Row[] | undefined) ?? []) {
        const t = p.goreTargetThickness(g.bodyLengthMm as number, g.bodyWidthMm as number, g.vibrationalStiffness as number)
        if (g.expect === null) expect(t, JSON.stringify(g)).toBeNull()
        else expect(t != null && close(t, g.expect as number, DATA), `${JSON.stringify(g)} → ${t}`).toBe(true)
      }
    })
  }

  it('woodQuality', () => {
    for (const row of rows('woodQuality')) {
      const q = WoodQuality.evaluate(row.specificModulus as number, row.direction as GrainDirection, row.woodType as WoodType)
      expect(q, JSON.stringify(row)).toBe(row.expect)
    }
  })

  it('numericScore', () => {
    for (const row of rows('numericScore')) {
      expect(WoodQuality.numericScore(row.quality as WoodQuality), row.quality as string).toBe(row.expect)
    }
  })
})
