// @parity test/quality-colors
//
// The wood-quality grades — label against the shared case file `quality-colors.json`, and each grade's colour role,
// `wood.<grade>` in `theme.json` — the same cases the Swift and Python suites run.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { pair, qualityRole } from '../src/presentation/palette'
import type { WoodQuality } from '../src/dsp/material'

const GRADES = (JSON.parse(readFileSync('test/fixtures/quality-colors.json', 'utf8')) as { grades: [string, WoodQuality][] }).grades

describe('quality-colors — shared cases', () => {
  for (const [name, label] of GRADES) {
    it(`${name} is ${label}, role wood.${name}`, () => expect(qualityRole(label)).toBe(`wood.${name}`))
  }
  it('five grades are five colours, told apart in each scheme', () => {
    const roles = GRADES.map(([, label]) => qualityRole(label))
    expect(new Set(roles.map((r) => pair(r).light)).size).toBe(roles.length)
    expect(new Set(roles.map((r) => pair(r).dark)).size).toBe(roles.length)
  })
})
