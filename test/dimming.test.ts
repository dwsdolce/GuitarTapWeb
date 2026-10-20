// @parity test/dimming
//
// How a control that cannot be used shows it, against the shared case file dimming.json: the whole group is
// disabled and drawn at the theme opacity its case names. On the web the group is a `.field`, dimmed by a class —
// `.is-disabled` (cannot act now) or `.is-faded` (does not apply) — whose rule draws the whole field at the named
// opacity's CSS variable, and whose controls are disabled with it. The same cases the Swift and Python suites run.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { cssOpacityVariable, type Opacity } from '../src/presentation/palette'

type Row = { id: string; kind: 'cannotActNow' | 'doesNotApply' | 'available'; opacity: Opacity | null; enabled: boolean }
const DATA = JSON.parse(readFileSync('test/fixtures/dimming.json', 'utf8')) as { cases: Row[] }
const CSS = readFileSync('src/App.css', 'utf8')
const APP = readFileSync('src/App.tsx', 'utf8')

const CLASS = { cannotActNow: 'is-disabled', doesNotApply: 'is-faded' } as const

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string | undefined {
  const at = CSS.indexOf(`\n${selector} {`)
  return at < 0 ? undefined : CSS.slice(at, CSS.indexOf('}', at))
}

describe('dimming — the shared cases (dimming.json)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    if (c.kind === 'available') {
      // An available field carries no dimming class, so nothing dims it.
      expect(APP).toMatch(/className=\{`field\$\{/)
      return
    }
    const body = rule(`.field.${CLASS[c.kind]}`)
    expect(body, `.field.${CLASS[c.kind]} has a rule`).toBeDefined()
    // The whole field — label, control and value — at the case's named opacity.
    expect(body).toContain(`opacity: var(${cssOpacityVariable(c.opacity!)})`)
    // Its controls are disabled with it: every field that takes the class disables its inputs under the same flag.
    const field = APP.match(new RegExp(`className=\\{\`field\\$\\{(.+?) \\? ' ${CLASS[c.kind]}'`))
    expect(field, `a field takes .${CLASS[c.kind]}`).not.toBeNull()
    expect(APP).toContain(`disabled={${field![1]}`)
  })
})
