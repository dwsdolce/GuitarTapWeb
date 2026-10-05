// @parity test/mode-colors
//
// Each guitar mode's colour role against the shared case file `theme.json` — the same cases the Swift and Python
// suites run — and that the modes, and a freeform label, are told apart in each scheme. The web's mode names are
// the role names' (`ring`, `upper`); the file's are Swift's (`ringMode`, `upperModes`).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { modeRole, pair, type Role } from '../src/presentation/palette'
import type { ResolvedMode } from '../src/dsp/classify'

const MODE_ROLES = (JSON.parse(readFileSync('test/fixtures/theme.json', 'utf8')) as { modeRoles: [string, Role][] }).modeRoles
const MODES: ResolvedMode[] = ['air', 'top', 'back', 'dipole', 'ring', 'upper', 'unknown']

describe('mode-colors — shared cases', () => {
  it("every mode's role is one of the file's, and every one of the file's is a mode's", () => {
    expect(MODES.map(modeRole).sort()).toEqual(MODE_ROLES.map(([, role]) => role).sort())
  })
  it('seven modes and a freeform label are eight colours, told apart in each scheme', () => {
    const roles: Role[] = [...MODES.map(modeRole), 'mode.userDefined']
    expect(new Set(roles.map((r) => pair(r).light)).size).toBe(roles.length)
    expect(new Set(roles.map((r) => pair(r).dark)).size).toBe(roles.length)
  })
})
