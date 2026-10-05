// @parity test/theme
//
// The palette against the shared case file `theme.json` — every colour role with its light and dark value, and the
// opacities applied to other roles — the same cases the Swift and Python suites run. Role names are Swift's.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { OPACITIES, ROLES, pair, type Opacity, type Role } from '../src/presentation/palette'

const DATA = JSON.parse(readFileSync('test/fixtures/theme.json', 'utf8')) as {
  roles: [Role, string, string][]
  opacities: [Opacity, number, number][]
}

describe('theme — shared cases', () => {
  for (const [name, light, dark] of DATA.roles) {
    it(`${name}`, () => expect(pair(name)).toEqual({ light, dark }))
  }
  it('every role, in the file order', () => {
    expect(Object.keys(ROLES)).toEqual(DATA.roles.map(([name]) => name))
  })
  for (const [name, light, dark] of DATA.opacities) {
    it(`opacity ${name}`, () => expect(OPACITIES[name]).toEqual({ light, dark }))
  }
  it('every opacity, in the file order', () => {
    expect(Object.keys(OPACITIES)).toEqual(DATA.opacities.map(([name]) => name))
  })
})
