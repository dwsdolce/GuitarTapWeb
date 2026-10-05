// @parity test/analysis-quality
//
// The guitar tap-tone quality helpers against the shared case file `analysis-quality.json` — the same cases
// the Swift and Python suites run. Guitar types are Swift's (the web's are the same); colour names are the quality roles of
// `theme.json`.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decayQuality, decayQualityColor, tapToneRatioQuality, tapToneRatioQualityColor } from '../src/dsp/analysisQuality'
import { decayThresholds, type GuitarTypeName } from '../src/dsp/guitarModes'
import { PALETTE } from '../src/presentation/palette'

type Name = keyof typeof PALETTE
const DATA = JSON.parse(readFileSync('test/fixtures/analysis-quality.json', 'utf8')) as {
  decayThresholds: [GuitarTypeName, number, number, number, number][]
  decayLabel: [GuitarTypeName, number, string][]
  decayColor: [GuitarTypeName, number, Name][]
  ratioLabel: [number, string][]
  ratioColor: [number, Name][]
  outsideEveryBand: { values: (number | string)[]; guitarType: GuitarTypeName; label: string; color: Name }
}
const number = (v: number | string) => (v === 'NaN' ? NaN : Number(v))

describe('analysis-quality — shared cases', () => {
  for (const [type, ...values] of DATA.decayThresholds) {
    it(`decayThresholds ${type}`, () => {
      const t = decayThresholds(type)
      expect([t.veryShort, t.short, t.moderate, t.good]).toEqual(values)
    })
  }
  for (const [type, value, label] of DATA.decayLabel) {
    it(`decayLabel ${type} ${value}`, () => expect(decayQuality(value, type)).toBe(label))
  }
  for (const [type, value, color] of DATA.decayColor) {
    it(`decayColor ${type} ${value}`, () => expect(decayQualityColor(value, type)).toBe(PALETTE[color]))
  }
  for (const [value, label] of DATA.ratioLabel) {
    it(`ratioLabel ${value}`, () => expect(tapToneRatioQuality(value)).toBe(label))
  }
  for (const [value, color] of DATA.ratioColor) {
    it(`ratioColor ${value}`, () => expect(tapToneRatioQualityColor(value)).toBe(PALETTE[color]))
  }
  for (const v of DATA.outsideEveryBand.values) {
    it(`outside every band ${v}`, () => {
      const o = DATA.outsideEveryBand
      const value = number(v)
      expect(decayQuality(value, o.guitarType)).toBe(o.label)
      expect(decayQualityColor(value, o.guitarType)).toBe(PALETTE[o.color])
      expect(tapToneRatioQuality(value)).toBe(o.label)
      expect(tapToneRatioQualityColor(value)).toBe(PALETTE[o.color])
    })
  }})
