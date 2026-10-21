// @parity test/button-style
//
// What a button the app draws looks like, by kind and state, against the shared case file button-style.json. On
// the web the look is the stylesheet: each kind and state is a rule — `.btn` (plain), `.btn.tint` with a `tint-*`
// class naming its role, `.btn-primary` (prominent) — and this reads each case's rule and checks it names the
// case's roles and opacities, as their CSS variables. The same cases the Swift and Python suites run.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { cssOpacityVariable, cssVariable, type Opacity, type Role } from '../src/presentation/palette'

type Row = {
  id: string; kind: 'plain' | 'tinted' | 'prominent'; role?: Role
  state: 'rest' | 'hover' | 'pressed' | 'on' | 'onHover' | 'cannotAct'
  text: Role; fill: [Role, Opacity | null]; wash: [Role, Opacity] | null; border: Role | null; drawnAt: Opacity | null
}
const DATA = JSON.parse(readFileSync('test/fixtures/button-style.json', 'utf8')) as { cases: Row[] }
const CSS = readFileSync('src/App.css', 'utf8')

/** The declarations of the rule whose selector is exactly `selector` (at any indent). */
function rule(selector: string): string {
  const m = CSS.match(new RegExp(`\\n\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))
  expect(m, `a rule for ${selector}`).not.toBeNull()
  return m![1]!
}

const pct = (o: Opacity) => `calc(var(${cssOpacityVariable(o)}) * 100%)`
const SELECTOR: Record<Row['kind'], Partial<Record<Row['state'], string>>> = {
  plain: { rest: '.btn', hover: '.btn:not(.tint):not(.btn-primary):hover:not(:disabled)', cannotAct: '.btn:disabled' },
  tinted: {
    rest: '.btn.tint', hover: '.btn.tint:hover:not(:disabled)', pressed: '.btn.tint:active:not(:disabled)',
    on: '.btn.tint.on', onHover: '.btn.tint.on:hover:not(:disabled)', cannotAct: '.btn:disabled',
  },
  prominent: { rest: '.btn-primary', hover: '.btn-primary:hover:not(:disabled)', cannotAct: '.btn-primary:disabled' },
}

describe('button style — the shared cases (button-style.json)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const body = rule(SELECTOR[c.kind][c.state]!)
    if (c.kind === 'tinted') {
      // The role is the tint-* class's --tint; the rule colours by --tint.
      const tintClasses = [...CSS.matchAll(/\n\.(tint-[a-z-]+) \{\s*--tint: var\(([^)]+)\);/g)].map((m) => m[2])
      expect(tintClasses, `a tint-* class for ${c.role}`).toContain(cssVariable(c.role!))
      if (c.state === 'cannotAct') {
        expect(body).toContain(`opacity: var(${cssOpacityVariable(c.drawnAt!)})`)
        expect(rule('.btn.tint')).toContain(`var(--tint) ${pct(c.fill[1]!)}`)
        return
      }
      if (c.state === 'rest') expect(body).toContain('color: var(--tint)')
      expect(body).toContain(`var(--tint) ${pct(c.fill[1]!)}`)
      return
    }
    if (c.state === 'cannotAct') {
      expect(rule('.btn:disabled')).toContain(`opacity: var(${cssOpacityVariable(c.drawnAt!)})`)
      if (c.kind === 'prominent') {
        // Drawn as a plain button: its fill, border and text.
        expect(body).toContain(`var(${cssVariable(c.fill[0])})`)
        expect(body).toContain(`var(${cssVariable(c.border!)})`)
        expect(body).toContain(`color: var(${cssVariable(c.text)})`)
      }
      return
    }
    if (c.state === 'rest') {
      expect(body).toContain(`color: var(${cssVariable(c.text)})`)
      expect(body).toContain(`var(${cssVariable(c.fill[0])})`)
      if (c.border) expect(body).toContain(`var(${cssVariable(c.border)})`)
    }
    if (c.fill[1]) expect(body).toContain(`var(${cssVariable(c.fill[0])}) ${pct(c.fill[1])}`)
    if (c.wash) expect(body).toContain(`var(${cssVariable(c.wash[0])}) ${pct(c.wash[1])}`)
  })
})
